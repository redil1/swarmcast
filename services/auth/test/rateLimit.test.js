import test from "node:test";
import assert from "node:assert/strict";
import { IpRateLimiter } from "../src/rateLimit.js";

test("IpRateLimiter rejects requests beyond capacity and refills", () => {
  let now = 0;
  const limiter = new IpRateLimiter({
    capacity: 2,
    refillPerMinute: 1,
    now: () => now
  });

  assert.equal(limiter.allow("1.2.3.4"), true);
  assert.equal(limiter.allow("1.2.3.4"), true);
  assert.equal(limiter.allow("1.2.3.4"), false);
  assert.equal(limiter.allow("5.6.7.8"), true);

  now = 60_000;
  assert.equal(limiter.allow("1.2.3.4"), true);
});
