import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueAttestationChallenge({ secret, ttlSeconds, nowSeconds }) {
  const payload = encode(JSON.stringify({
    v: 1,
    id: randomBytes(18).toString("base64url"),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  }));
  return {
    challenge: `${payload}.${sign(payload, secret)}`,
    expiresAt: nowSeconds + ttlSeconds
  };
}

export function verifyAttestationChallenge(challenge, {
  secret,
  previousSecret = "",
  nowSeconds,
  maxFutureSkewSeconds = 5
}) {
  if (typeof challenge !== "string" || challenge.length < 40 || challenge.length > 1024) {
    throw new Error("invalid attestation challenge");
  }
  const [payload, signature, extra] = challenge.split(".");
  if (!payload || !signature || extra !== undefined) throw new Error("invalid attestation challenge");
  const actual = Buffer.from(signature);
  const signatureMatches = [secret, previousSecret]
    .filter(Boolean)
    .some((candidateSecret) => {
      const expected = Buffer.from(sign(payload, candidateSecret));
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
  if (!signatureMatches) {
    throw new Error("invalid attestation challenge signature");
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid attestation challenge payload");
  }
  if (decoded?.v !== 1 || typeof decoded.id !== "string" || !Number.isInteger(decoded.iat) || !Number.isInteger(decoded.exp)) {
    throw new Error("invalid attestation challenge payload");
  }
  if (decoded.iat > nowSeconds + maxFutureSkewSeconds) throw new Error("attestation challenge is not active");
  if (decoded.exp <= nowSeconds) throw new Error("attestation challenge expired");
  return decoded;
}

export function requestHashForChallenge(challenge) {
  return createHash("sha256").update(challenge).digest("base64url");
}
