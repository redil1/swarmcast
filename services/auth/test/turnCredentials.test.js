import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { issueTurnCredentials } from "../src/turnCredentials.js";

test("issues coturn REST credentials bound to subject and expiration", () => {
  const credentials = issueTurnCredentials({
    urls: ["turn:turn.swarmcast.tv:3478?transport=udp"],
    sharedSecret: "0123456789abcdef0123456789abcdef",
    ttlSeconds: 3600,
    subject: "viewer-123",
    nowSeconds: 1_700_000_000
  });

  assert.deepEqual(credentials.urls, ["turn:turn.swarmcast.tv:3478?transport=udp"]);
  assert.equal(credentials.expiresAt, 1_700_003_600);
  assert.equal(credentials.username, "1700003600:viewer-123");
  assert.equal(
    credentials.credential,
    createHmac("sha1", "0123456789abcdef0123456789abcdef")
      .update(credentials.username)
      .digest("base64")
  );
});
