import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  issueAttestationChallenge,
  requestHashForChallenge,
  verifyAttestationChallenge
} from "../src/attestationChallenge.js";
import { createAuthServer } from "../src/index.js";
import { PlayIntegrityVerifier } from "../src/playIntegrity.js";
import { IpRateLimiter } from "../src/rateLimit.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const CERTIFICATE = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function verdict(overrides = {}) {
  return {
    requestDetails: {
      requestPackageName: "tv.swarmcast",
      requestHash: "request-hash",
      timestampMillis: "1700000000000"
    },
    appIntegrity: {
      appRecognitionVerdict: "PLAY_RECOGNIZED",
      packageName: "tv.swarmcast",
      certificateSha256Digest: [CERTIFICATE],
      versionCode: "1"
    },
    accountDetails: { appLicensingVerdict: "LICENSED" },
    deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
    ...overrides
  };
}

test("attestation challenges are signed, bounded, and request-bound", () => {
  const issued = issueAttestationChallenge({ secret: SECRET, ttlSeconds: 120, nowSeconds: 1_700_000_000 });
  assert.equal(issued.expiresAt, 1_700_000_120);
  const decoded = verifyAttestationChallenge(issued.challenge, {
    secret: SECRET,
    nowSeconds: 1_700_000_030
  });
  assert.equal(decoded.v, 1);
  assert.equal(decoded.exp, issued.expiresAt);
  assert.match(requestHashForChallenge(issued.challenge), /^[A-Za-z0-9_-]{43}$/);

  assert.throws(() => verifyAttestationChallenge(`${issued.challenge}x`, {
    secret: SECRET,
    nowSeconds: 1_700_000_030
  }), /signature/);
  assert.throws(() => verifyAttestationChallenge(issued.challenge, {
    secret: SECRET,
    nowSeconds: issued.expiresAt
  }), /expired/);
});

test("attestation challenge rotation accepts only the bounded previous secret", () => {
  const previousSecret = "abcdef0123456789abcdef0123456789";
  const issued = issueAttestationChallenge({
    secret: previousSecret,
    ttlSeconds: 120,
    nowSeconds: 1_700_000_000
  });
  const decoded = verifyAttestationChallenge(issued.challenge, {
    secret: SECRET,
    previousSecret,
    nowSeconds: 1_700_000_030
  });
  assert.equal(decoded.exp, issued.expiresAt);
  assert.throws(() => verifyAttestationChallenge(issued.challenge, {
    secret: SECRET,
    nowSeconds: 1_700_000_030
  }), /signature/);
});

test("Play Integrity verifier enforces request, app, license, certificate, device, and freshness verdicts", async () => {
  let payload = verdict();
  const verifier = new PlayIntegrityVerifier({
    packageName: "tv.swarmcast",
    certificateDigests: [CERTIFICATE],
    decodeToken: async () => ({ tokenPayloadExternal: payload }),
    nowMs: () => 1_700_000_030_000,
    maxTokenAgeSeconds: 60
  });
  const accepted = await verifier.verify({ integrityToken: "integrity-token", expectedRequestHash: "request-hash" });
  assert.equal(accepted.packageName, "tv.swarmcast");
  assert.deepEqual(accepted.deviceRecognitionVerdict, ["MEETS_DEVICE_INTEGRITY"]);

  const invalidPayloads = [
    verdict({ requestDetails: { ...verdict().requestDetails, requestHash: "wrong" } }),
    verdict({ appIntegrity: { ...verdict().appIntegrity, appRecognitionVerdict: "UNRECOGNIZED_VERSION" } }),
    verdict({ appIntegrity: { ...verdict().appIntegrity, certificateSha256Digest: ["BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"] } }),
    verdict({ accountDetails: { appLicensingVerdict: "UNLICENSED" } }),
    verdict({ deviceIntegrity: { deviceRecognitionVerdict: [] } }),
    verdict({ requestDetails: { ...verdict().requestDetails, timestampMillis: "1699999900000" } })
  ];
  for (const invalid of invalidPayloads) {
    payload = invalid;
    await assert.rejects(
      verifier.verify({ integrityToken: "integrity-token", expectedRequestHash: "request-hash" })
    );
  }
});

test("auth service requires a valid request-bound integrity verdict before token issuance", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-auth-attestation-"));
  let nowSeconds = 1_700_000_000;
  let verifiedRequest = null;
  const server = await createAuthServer({
    keyPath: path.join(dir, "es256.pem"),
    appApiKey: "app-key",
    playIntegrityEnabled: true,
    attestationChallengeSecret: SECRET,
    attestationChallengeTtlSeconds: 120,
    playIntegrityVerifier: {
      verify: async (request) => {
        verifiedRequest = request;
        if (request.integrityToken !== "valid-integrity-token") throw new Error("invalid token");
      }
    },
    nowSeconds: () => nowSeconds,
    tokenRateLimiter: new IpRateLimiter({ capacity: 100, refillPerMinute: 100 }),
    attestationChallengeRateLimiter: new IpRateLimiter({ capacity: 100, refillPerMinute: 100 })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const challengeResponse = await fetch(`${base}/attestation/challenge`, {
      method: "POST",
      headers: { "x-app-key": "app-key" }
    });
    assert.equal(challengeResponse.status, 200);
    const challenge = await challengeResponse.json();

    const missing = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-key": "app-key" },
      body: JSON.stringify({})
    });
    assert.equal(missing.status, 401);

    const issued = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-key": "app-key" },
      body: JSON.stringify({ challenge: challenge.challenge, integrityToken: "valid-integrity-token" })
    });
    assert.equal(issued.status, 200);
    assert.equal(verifiedRequest.integrityToken, "valid-integrity-token");
    assert.equal(verifiedRequest.expectedRequestHash, requestHashForChallenge(challenge.challenge));

    nowSeconds = challenge.expiresAt;
    const expired = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-key": "app-key" },
      body: JSON.stringify({ challenge: challenge.challenge, integrityToken: "valid-integrity-token" })
    });
    assert.equal(expired.status, 401);

    const metrics = await (await fetch(`${base}/metrics`)).text();
    assert.match(metrics, /swarmcast_auth_attestation_challenges_issued_total 1/);
    assert.match(metrics, /swarmcast_auth_attestation_verify_ok_total 1/);
    assert.match(metrics, /swarmcast_auth_attestation_verify_fail_total 2/);
    assert.match(metrics, /swarmcast_auth_tokens_issued_total 1/);
  } finally {
    server.close();
  }
});
