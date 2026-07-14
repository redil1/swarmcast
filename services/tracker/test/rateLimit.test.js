import test from "node:test";
import assert from "node:assert/strict";
import { TokenBucketRateLimiter } from "../src/rateLimit.js";

test("TokenBucketRateLimiter rejects bursts beyond capacity and refills", () => {
  let now = 0;
  const limiter = new TokenBucketRateLimiter({
    capacity: 2,
    refillPerSecond: 1,
    now: () => now
  });
  const peer = {};

  assert.equal(limiter.allow(peer), true);
  assert.equal(limiter.allow(peer), true);
  assert.equal(limiter.allow(peer), false);

  now = 1000;
  assert.equal(limiter.allow(peer), true);
  assert.equal(limiter.allow(peer), false);
});
