import test from "node:test";
import assert from "node:assert/strict";
import { createAuthMetrics, formatAuthMetrics } from "../src/metrics.js";

test("formatAuthMetrics emits auth counters", () => {
  const text = formatAuthMetrics({
    tokensIssued: 2,
    turnCredentialsIssued: 1,
    verifyOk: 3,
    verifyFail: 1
  });

  assert.match(text, /swarmcast_auth_tokens_issued_total 2/);
  assert.match(text, /swarmcast_auth_turn_credentials_issued_total 1/);
  assert.match(text, /swarmcast_auth_verify_ok_total 3/);
  assert.match(text, /swarmcast_auth_verify_fail_total 1/);
});

test("createAuthMetrics starts at zero", () => {
  assert.deepEqual(createAuthMetrics(), {
    tokensIssued: 0,
    turnCredentialsIssued: 0,
    verifyOk: 0,
    verifyFail: 0
  });
});
