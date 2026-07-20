import http from "node:http";
import { createPrivateKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadAuthConfig } from "@swarmcast/config/env";
import { ERROR_CODES, httpStatusForError, publicError } from "@swarmcast/config/errors";
import { closeHttpServer, createServiceLifecycle } from "@swarmcast/config/lifecycle";
import { createLogger, logHttpRequest } from "@swarmcast/config/logging";
import { createLocalJWKSet, exportJWK, jwtVerify, SignJWT } from "jose";
import { createAuthMetrics, formatAuthMetrics } from "./metrics.js";
import { IpRateLimiter } from "./rateLimit.js";
import { issueTurnCredentials } from "./turnCredentials.js";
import {
  issueAttestationChallenge,
  requestHashForChallenge,
  verifyAttestationChallenge
} from "./attestationChallenge.js";
import { createGooglePlayIntegrityVerifier } from "./playIntegrity.js";

const DEFAULT_CONFIG = loadAuthConfig();

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function errorJson(res, code, message = "") {
  return json(res, httpStatusForError(code), publicError(code, message));
}

function ensurePrivateKey(path) {
  if (!existsSync(path)) {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  }
  return createPrivateKey(readFileSync(path));
}

function loadPreviousPublicJwks(path, currentKeyId) {
  if (!path) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed.keys)) throw new Error("AUTH_PREVIOUS_JWKS_PATH must contain a JWKS object with keys");

  const seen = new Set([currentKeyId]);
  return parsed.keys.map((key, index) => {
    const publicKey = { ...key };
    delete publicKey.d;
    if (!publicKey.kid) throw new Error(`previous JWKS key ${index} is missing kid`);
    if (seen.has(publicKey.kid)) throw new Error(`duplicate JWKS kid: ${publicKey.kid}`);
    seen.add(publicKey.kid);
    return publicKey;
  });
}

function verifyTokenFromRequest(req) {
  const headerToken = req.headers["x-auth-token"];
  if (headerToken) return headerToken;

  const originalUri = req.headers["x-original-uri"];
  if (!originalUri) return "";
  try {
    return new URL(originalUri, "http://swarmcast.local").searchParams.get("token") || "";
  } catch {
    return "";
  }
}

function requestIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request body must be an object");
  return parsed;
}

export async function createAuthServer({
  keyPath = DEFAULT_CONFIG.keyPath,
  keyId = DEFAULT_CONFIG.keyId,
  previousJwksPath = DEFAULT_CONFIG.previousJwksPath,
  jwtAudience = DEFAULT_CONFIG.jwtAudience,
  jwtIssuer = DEFAULT_CONFIG.jwtIssuer,
  tokenTtlSeconds = DEFAULT_CONFIG.tokenTtlSeconds,
  playIntegrityEnabled = DEFAULT_CONFIG.playIntegrityEnabled,
  attestationChallengeSecret = DEFAULT_CONFIG.attestationChallengeSecret,
  attestationPreviousChallengeSecret = DEFAULT_CONFIG.attestationPreviousChallengeSecret,
  attestationChallengeTtlSeconds = DEFAULT_CONFIG.attestationChallengeTtlSeconds,
  playIntegrityVerifier = null,
  stunUrls = DEFAULT_CONFIG.stunUrls,
  turnEnabled = DEFAULT_CONFIG.turnEnabled,
  turnUrls = DEFAULT_CONFIG.turnUrls,
  turnSharedSecret = DEFAULT_CONFIG.turnSharedSecret,
  turnCredentialTtlSeconds = DEFAULT_CONFIG.turnCredentialTtlSeconds,
  appApiKey = DEFAULT_CONFIG.appApiKey,
  tokenRateLimiter = new IpRateLimiter(),
  attestationChallengeRateLimiter = new IpRateLimiter(),
  nowSeconds = () => Math.floor(Date.now() / 1000),
  isReady = () => true,
  logger = null
} = {}) {
  if (!appApiKey) throw new Error("APP_API_KEY is required");
  if (turnEnabled && !turnSharedSecret) throw new Error("TURN_SHARED_SECRET is required when TURN is enabled");
  if (playIntegrityEnabled && !attestationChallengeSecret) {
    throw new Error("AUTH_ATTESTATION_CHALLENGE_SECRET is required when Play Integrity is enabled");
  }
  if (playIntegrityEnabled && !playIntegrityVerifier) {
    throw new Error("Play Integrity verifier is required when Play Integrity is enabled");
  }

  const privateKey = ensurePrivateKey(keyPath);
  const publicJwk = await exportJWK(privateKey);
  publicJwk.kid = keyId;
  publicJwk.alg = "ES256";
  delete publicJwk.d;
  const publicJwks = { keys: [publicJwk, ...loadPreviousPublicJwks(previousJwksPath, keyId)] };
  const jwksVerifier = createLocalJWKSet(publicJwks);
  const metrics = createAuthMetrics();

  return http.createServer(async (req, res) => {
    logHttpRequest(req, res, logger);
    const url = new URL(req.url, "http://auth.local");

    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (url.pathname === "/ready") {
      const ready = isReady();
      return json(res, ready ? 200 : 503, { ok: ready });
    }
    if (url.pathname === "/metrics") {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(formatAuthMetrics(metrics));
      return;
    }
    if (url.pathname === "/jwks") return json(res, 200, publicJwks);

    if (url.pathname === "/attestation/challenge" && req.method === "POST" && playIntegrityEnabled) {
      if (req.headers["x-app-key"] !== appApiKey) {
        logger?.warn("auth_attestation_challenge_rejected", { error_class: "unauthorized" }, "attestation challenge rejected");
        return errorJson(res, ERROR_CODES.UNAUTHORIZED, "unauthorized");
      }
      const ip = requestIp(req);
      if (!attestationChallengeRateLimiter.allow(ip)) {
        logger?.warn("auth_attestation_challenge_rate_limited", { error_class: "rate_limited" }, "attestation challenge rate limited");
        return errorJson(res, ERROR_CODES.RATE_LIMITED, "rate limited");
      }
      const challenge = issueAttestationChallenge({
        secret: attestationChallengeSecret,
        ttlSeconds: attestationChallengeTtlSeconds,
        nowSeconds: nowSeconds()
      });
      metrics.attestationChallengesIssued += 1;
      return json(res, 200, challenge);
    }

    if (url.pathname === "/token" && req.method === "POST") {
      if (req.headers["x-app-key"] !== appApiKey) {
        logger?.warn("auth_token_rejected", { error_class: "unauthorized" }, "token request rejected");
        return errorJson(res, ERROR_CODES.UNAUTHORIZED, "unauthorized");
      }
      const ip = requestIp(req);
      if (!tokenRateLimiter.allow(ip)) {
        logger?.warn("auth_token_rate_limited", { error_class: "rate_limited" }, "token request rate limited");
        return errorJson(res, ERROR_CODES.RATE_LIMITED, "rate limited");
      }
      if (playIntegrityEnabled) {
        try {
          const body = await readJsonBody(req);
          verifyAttestationChallenge(body.challenge, {
            secret: attestationChallengeSecret,
            previousSecret: attestationPreviousChallengeSecret,
            nowSeconds: nowSeconds()
          });
          await playIntegrityVerifier.verify({
            integrityToken: body.integrityToken,
            expectedRequestHash: requestHashForChallenge(body.challenge)
          });
          metrics.attestationVerifyOk += 1;
        } catch {
          metrics.attestationVerifyFail += 1;
          logger?.warn(
            "auth_attestation_failed",
            { error_class: "unauthorized" },
            "app attestation failed"
          );
          return errorJson(res, ERROR_CODES.UNAUTHORIZED, "app attestation failed");
        }
      }
      const issuedAt = nowSeconds();
      const subject = randomUUID();
      const token = await new SignJWT({ scope: "view" })
        .setProtectedHeader({ alg: "ES256", kid: keyId })
        .setSubject(subject)
        .setAudience(jwtAudience)
        .setIssuer(jwtIssuer)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + tokenTtlSeconds)
        .sign(privateKey);
      const iceServers = [{ urls: [...stunUrls] }];
      if (turnEnabled) {
        iceServers.push(issueTurnCredentials({
          urls: turnUrls,
          sharedSecret: turnSharedSecret,
          ttlSeconds: turnCredentialTtlSeconds,
          subject,
          nowSeconds: issuedAt
        }));
        metrics.turnCredentialsIssued += 1;
      }
      metrics.tokensIssued += 1;
      logger?.info("auth_token_issued", { request_id: req.headers["x-request-id"] || null }, "token issued");
      return json(res, 200, { token, expiresIn: tokenTtlSeconds, iceServers });
    }

    if (url.pathname === "/verify") {
      const token = verifyTokenFromRequest(req);
      try {
        await jwtVerify(token, jwksVerifier, { audience: jwtAudience, issuer: jwtIssuer });
        metrics.verifyOk += 1;
        res.writeHead(204);
        res.end();
      } catch {
        metrics.verifyFail += 1;
        logger?.warn("auth_verify_failed", { error_class: "unauthorized" }, "auth verify failed");
        res.writeHead(401);
        res.end();
      }
      return;
    }

    return errorJson(res, ERROR_CODES.NOT_FOUND, "not found");
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtimeConfig = loadAuthConfig(process.env, { requireSecrets: true });
  const logger = createLogger({ service: "auth" });
  const lifecycle = createServiceLifecycle({ service: "auth", logger });
  const server = await createAuthServer({
    keyPath: runtimeConfig.keyPath,
    keyId: runtimeConfig.keyId,
    previousJwksPath: runtimeConfig.previousJwksPath,
    jwtAudience: runtimeConfig.jwtAudience,
    jwtIssuer: runtimeConfig.jwtIssuer,
    tokenTtlSeconds: runtimeConfig.tokenTtlSeconds,
    playIntegrityEnabled: runtimeConfig.playIntegrityEnabled,
    attestationChallengeSecret: runtimeConfig.attestationChallengeSecret,
    attestationPreviousChallengeSecret: runtimeConfig.attestationPreviousChallengeSecret,
    attestationChallengeTtlSeconds: runtimeConfig.attestationChallengeTtlSeconds,
    playIntegrityVerifier: runtimeConfig.playIntegrityEnabled
      ? createGooglePlayIntegrityVerifier({
        packageName: runtimeConfig.playIntegrityPackageName,
        certificateDigests: runtimeConfig.playIntegrityCertificateDigests,
        serviceAccountPath: runtimeConfig.playIntegrityServiceAccountPath,
        maxTokenAgeSeconds: runtimeConfig.playIntegrityMaxTokenAgeSeconds
      })
      : null,
    stunUrls: runtimeConfig.stunUrls,
    turnEnabled: runtimeConfig.turnEnabled,
    turnUrls: runtimeConfig.turnUrls,
    turnSharedSecret: runtimeConfig.turnSharedSecret,
    turnCredentialTtlSeconds: runtimeConfig.turnCredentialTtlSeconds,
    appApiKey: runtimeConfig.appApiKey,
    isReady: lifecycle.isReady,
    logger
  });
  lifecycle.install(() => closeHttpServer(server));
  server.listen(runtimeConfig.port, () => {
    lifecycle.markReady();
    logger.info("service_started", { node_id: "auth", port: runtimeConfig.port }, "auth listening");
  });
}
