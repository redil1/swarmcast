import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
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
    assert.match(text, /swarmcast_auth_verify_ok_total 2/);
    assert.match(text, /swarmcast_auth_verify_fail_total 1/);
  });
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
