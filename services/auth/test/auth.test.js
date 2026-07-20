import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, createPrivateKey, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodeJwt, decodeProtectedHeader, exportJWK, SignJWT } from "jose";
import { createAuthServer } from "../src/index.js";
import { IpRateLimiter } from "../src/rateLimit.js";

async function withAuthServer(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-auth-"));
  const server = await createAuthServer({
    keyPath: path.join(dir, "es256.pem"),
    appApiKey: "app-key",
    tokenRateLimiter: new IpRateLimiter({ capacity: 100, refillPerMinute: 100 })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test("auth service issues token and verifies it", async () => {
  await withAuthServer(async (base) => {
    const denied = await fetch(`${base}/token`, { method: "POST" });
    assert.equal(denied.status, 401);

    const issued = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "x-app-key": "app-key" }
    });
    assert.equal(issued.status, 200);
    const body = await issued.json();
    assert.equal(typeof body.token, "string");
    assert.equal(body.expiresIn, 21600);
    const claims = decodeJwt(body.token);
    assert.equal(claims.aud, "swarmcast");
    assert.equal(claims.iss, "swarmcast-auth");
    assert.equal(claims.exp - claims.iat, 21600);

    const verified = await fetch(`${base}/verify`, {
      headers: { "x-auth-token": body.token }
    });
    assert.equal(verified.status, 204);

    const nginxVerified = await fetch(`${base}/verify`, {
      headers: { "x-original-uri": `/live/demo/playlist.m3u8?token=${encodeURIComponent(body.token)}` }
    });
    assert.equal(nginxVerified.status, 204);

    const bad = await fetch(`${base}/verify`, {
      headers: { "x-auth-token": "bad-token" }
    });
    assert.equal(bad.status, 401);

    const metrics = await fetch(`${base}/metrics`);
    const text = await metrics.text();
    assert.match(text, /swarmcast_auth_tokens_issued_total 1/);
    assert.match(text, /swarmcast_auth_turn_credentials_issued_total 0/);
    assert.match(text, /swarmcast_auth_verify_ok_total 2/);
    assert.match(text, /swarmcast_auth_verify_fail_total 1/);
  });
});

test("auth readiness reflects lifecycle state", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-auth-ready-"));
  let ready = false;
  const server = await createAuthServer({
    keyPath: path.join(dir, "es256.pem"),
    appApiKey: "app-key",
    isReady: () => ready
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    ready = true;
    assert.equal((await fetch(`${base}/ready`)).status, 200);
  } finally {
    server.close();
  }
});

test("auth service issues short-lived coturn credentials with viewer tokens", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-auth-turn-"));
  const sharedSecret = "0123456789abcdef0123456789abcdef";
  const server = await createAuthServer({
    keyPath: path.join(dir, "es256.pem"),
    appApiKey: "app-key",
    stunUrls: ["stun:stun.swarmcast.tv:3478"],
    turnEnabled: true,
    turnUrls: [
      "turn:turn.swarmcast.tv:3478?transport=udp",
      "turns:turn.swarmcast.tv:443?transport=tcp"
    ],
    turnSharedSecret: sharedSecret,
    turnCredentialTtlSeconds: 3600,
    nowSeconds: () => 1_700_000_000,
    tokenRateLimiter: new IpRateLimiter({ capacity: 100, refillPerMinute: 100 })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const issued = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "x-app-key": "app-key" }
    });
    assert.equal(issued.status, 200);
    const body = await issued.json();
    assert.deepEqual(body.iceServers[0], { urls: ["stun:stun.swarmcast.tv:3478"] });
    assert.deepEqual(body.iceServers[1].urls, [
      "turn:turn.swarmcast.tv:3478?transport=udp",
      "turns:turn.swarmcast.tv:443?transport=tcp"
    ]);
    assert.equal(body.iceServers[1].expiresAt, 1_700_003_600);
    assert.match(body.iceServers[1].username, /^1700003600:/);
    assert.equal(
      body.iceServers[1].credential,
      createHmac("sha1", sharedSecret).update(body.iceServers[1].username).digest("base64")
    );

    const metrics = await (await fetch(`${base}/metrics`)).text();
    assert.match(metrics, /swarmcast_auth_turn_credentials_issued_total 1/);
  } finally {
    server.close();
  }
});

test("auth service exposes public jwks", async () => {
  await withAuthServer(async (base) => {
    const response = await fetch(`${base}/jwks`);
    assert.equal(response.status, 200);
    const jwks = await response.json();
    assert.equal(jwks.keys.length, 1);
    assert.equal(jwks.keys[0].kid, "swarmcast-1");
    assert.equal(jwks.keys[0].alg, "ES256");
    assert.equal("d" in jwks.keys[0], false);
  });
});

test("auth service supports staged signing key rotation", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-auth-rotation-"));
  const { privateKey: previousPrivateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const previousPublicJwk = await exportJWK(previousPrivateKey);
  previousPublicJwk.kid = "swarmcast-1";
  previousPublicJwk.alg = "ES256";
  delete previousPublicJwk.d;
  const previousJwksPath = path.join(dir, "previous-jwks.json");
  writeFileSync(previousJwksPath, JSON.stringify({ keys: [previousPublicJwk] }));

  const server = await createAuthServer({
    keyPath: path.join(dir, "es256-new.pem"),
    keyId: "swarmcast-2",
    previousJwksPath,
    appApiKey: "app-key",
    tokenRateLimiter: new IpRateLimiter({ capacity: 100, refillPerMinute: 100 })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const jwks = await (await fetch(`${base}/jwks`)).json();
    assert.deepEqual(jwks.keys.map((key) => key.kid).sort(), ["swarmcast-1", "swarmcast-2"]);
    assert.equal(jwks.keys.some((key) => "d" in key), false);

    const oldToken = await new SignJWT({ scope: "view" })
      .setProtectedHeader({ alg: "ES256", kid: "swarmcast-1" })
      .setSubject("old-viewer")
      .setAudience("swarmcast")
      .setIssuer("swarmcast-auth")
      .setIssuedAt()
      .setExpirationTime("6h")
      .sign(previousPrivateKey);
    const oldVerified = await fetch(`${base}/verify`, {
      headers: { "x-auth-token": oldToken }
    });
    assert.equal(oldVerified.status, 204);

    const issued = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "x-app-key": "app-key" }
    });
    const body = await issued.json();
    assert.equal(decodeProtectedHeader(body.token).kid, "swarmcast-2");
  } finally {
    server.close();
  }
});

test("auth service honors configured JWT issuer, audience, and ttl", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-auth-claims-"));
  const server = await createAuthServer({
    keyPath: path.join(dir, "es256.pem"),
    keyId: "swarmcast-claims",
    jwtAudience: "swarmcast-viewers",
    jwtIssuer: "swarmcast-auth-staging",
    tokenTtlSeconds: 900,
    appApiKey: "app-key",
    tokenRateLimiter: new IpRateLimiter({ capacity: 100, refillPerMinute: 100 })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const issued = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "x-app-key": "app-key" }
    });
    const body = await issued.json();
    assert.equal(body.expiresIn, 900);
    const claims = decodeJwt(body.token);
    assert.equal(claims.aud, "swarmcast-viewers");
    assert.equal(claims.iss, "swarmcast-auth-staging");
    assert.equal(claims.exp - claims.iat, 900);

    const verified = await fetch(`${base}/verify`, {
      headers: { "x-auth-token": body.token }
    });
    assert.equal(verified.status, 204);

    const wrongIssuerToken = await new SignJWT({ scope: "view" })
      .setProtectedHeader({ alg: "ES256", kid: "swarmcast-claims" })
      .setSubject("bad-issuer")
      .setAudience("swarmcast-viewers")
      .setIssuer("wrong-issuer")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(createPrivateKey(readFileSync(path.join(dir, "es256.pem"))));
    const rejected = await fetch(`${base}/verify`, {
      headers: { "x-auth-token": wrongIssuerToken }
    });
    assert.equal(rejected.status, 401);
  } finally {
    server.close();
  }
});

test("auth service rate limits token issuance by forwarded IP", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-auth-"));
  const server = await createAuthServer({
    keyPath: path.join(dir, "es256.pem"),
    appApiKey: "app-key",
    tokenRateLimiter: new IpRateLimiter({ capacity: 1, refillPerMinute: 0 })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const first = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "x-app-key": "app-key", "x-forwarded-for": "1.2.3.4" }
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "x-app-key": "app-key", "x-forwarded-for": "1.2.3.4" }
    });
    assert.equal(second.status, 429);
  } finally {
    server.close();
  }
});
