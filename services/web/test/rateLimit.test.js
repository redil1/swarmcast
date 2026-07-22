import test from "node:test";
import assert from "node:assert/strict";
import { IpRateLimiter } from "../src/rateLimit.js";

test("rate limiter exhausts and refills per client", () => {
  let now = 0;
  const limiter = new IpRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => now });
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  assert.equal(limiter.allow("b"), true);
  now = 1_000;
  assert.equal(limiter.allow("a"), true);
});
