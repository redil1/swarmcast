import http from "node:http";
import { createPrivateKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadAuthConfig } from "@swarmcast/config/env";
import { ERROR_CODES, httpStatusForError, publicError } from "@swarmcast/config/errors";
import { createLogger, logHttpRequest } from "@swarmcast/config/logging";
import { createLocalJWKSet, exportJWK, jwtVerify, SignJWT } from "jose";
import { createAuthMetrics, formatAuthMetrics } from "./metrics.js";
import { IpRateLimiter } from "./rateLimit.js";

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

export async function createAuthServer({
  keyPath = DEFAULT_CONFIG.keyPath,
  keyId = DEFAULT_CONFIG.keyId,
  previousJwksPath = DEFAULT_CONFIG.previousJwksPath,
  jwtAudience = DEFAULT_CONFIG.jwtAudience,
  jwtIssuer = DEFAULT_CONFIG.jwtIssuer,
  tokenTtlSeconds = DEFAULT_CONFIG.tokenTtlSeconds,
  appApiKey = DEFAULT_CONFIG.appApiKey,
  tokenRateLimiter = new IpRateLimiter(),
  logger = null
} = {}) {
  if (!appApiKey) throw new Error("APP_API_KEY is required");

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
    if (url.pathname === "/metrics") {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(formatAuthMetrics(metrics));
      return;
    }
    if (url.pathname === "/jwks") return json(res, 200, publicJwks);

    if (url.pathname === "/token" && req.method === "POST") {
      if (req.headers["x-app-key"] !== appApiKey) {
        logger?.warn("auth_token_rejected", { error_class: "unauthorized" }, "token request rejected");
        return errorJson(res, ERROR_CODES.UNAUTHORIZED, "unauthorized");
      }
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      if (!tokenRateLimiter.allow(ip)) {
        logger?.warn("auth_token_rate_limited", { error_class: "rate_limited" }, "token request rate limited");
        return errorJson(res, ERROR_CODES.RATE_LIMITED, "rate limited");
      }
      const token = await new SignJWT({ scope: "view" })
        .setProtectedHeader({ alg: "ES256", kid: keyId })
        .setSubject(randomUUID())
        .setAudience(jwtAudience)
        .setIssuer(jwtIssuer)
        .setIssuedAt()
        .setExpirationTime(`${tokenTtlSeconds}s`)
        .sign(privateKey);
      metrics.tokensIssued += 1;
      logger?.info("auth_token_issued", { request_id: req.headers["x-request-id"] || null }, "token issued");
      return json(res, 200, { token, expiresIn: tokenTtlSeconds });
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
  const server = await createAuthServer({
    keyPath: runtimeConfig.keyPath,
    keyId: runtimeConfig.keyId,
    previousJwksPath: runtimeConfig.previousJwksPath,
    jwtAudience: runtimeConfig.jwtAudience,
    jwtIssuer: runtimeConfig.jwtIssuer,
    tokenTtlSeconds: runtimeConfig.tokenTtlSeconds,
    appApiKey: runtimeConfig.appApiKey,
    logger
  });
  server.listen(runtimeConfig.port, () => {
    logger.info("service_started", { node_id: "auth", port: runtimeConfig.port }, "auth listening");
  });
}
