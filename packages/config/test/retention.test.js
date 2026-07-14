import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RETENTION_ACTIONS,
  formatRetentionMetrics,
  retentionDecision,
  retentionPlan,
  runRetentionJob,
  validateRetentionPolicy
} from "../src/retention.js";

function policyFixture() {
  return JSON.parse(readFileSync(new URL("../../../config/data-retention.json", import.meta.url), "utf8"));
}

test("data retention policy validates", () => {
  const policy = policyFixture();
  assert.equal(validateRetentionPolicy(policy), policy);
});

test("retentionDecision maps raw and aggregate windows", () => {
  const policy = policyFixture();
  const now = new Date("2026-07-05T00:00:00.000Z");

  assert.equal(retentionDecision({
    policy,
    classId: "ip_related_logs",
    observedAt: "2026-07-04T00:00:00.000Z",
    now
  }), RETENTION_ACTIONS.KEEP_RAW);

  assert.equal(retentionDecision({
    policy,
    classId: "ip_related_logs",
    observedAt: "2026-06-20T00:00:00.000Z",
    now
  }), RETENTION_ACTIONS.AGGREGATE_THEN_DELETE_RAW);

  assert.equal(retentionDecision({
    policy,
    classId: "ip_related_logs",
    observedAt: "2026-03-01T00:00:00.000Z",
    now
  }), RETENTION_ACTIONS.DELETE_AGGREGATE);
});

test("retentionPlan summarizes classes and actions", () => {
  const policy = policyFixture();
  const summary = retentionPlan({
    policy,
    now: new Date("2026-07-05T00:00:00.000Z"),
    records: [
      { classId: "peer_stats", observedAt: "2026-07-01T00:00:00.000Z" },
      { classId: "peer_stats", observedAt: "2026-06-01T00:00:00.000Z" },
      { classId: "metrics", observedAt: "2025-01-01T00:00:00.000Z" }
    ]
  });

  assert.deepEqual(summary, {
    "peer_stats:keep_raw": 1,
    "peer_stats:aggregate_then_delete_raw": 1,
    "metrics:delete_aggregate": 1
  });
});

test("formatRetentionMetrics emits prometheus counters and gauges", () => {
  const text = formatRetentionMetrics({
    "peer_stats:aggregate_then_delete_raw": 2
  }, {
    failuresTotal: 1,
    lastSuccessTimestampSeconds: 1783209600
  });

  assert.match(text, /swarmcast_retention_records_total\{class="peer_stats",action="aggregate_then_delete_raw"\} 2/);
  assert.match(text, /swarmcast_retention_failures_total 1/);
  assert.match(text, /swarmcast_retention_last_success_timestamp_seconds 1783209600/);
});

test("runRetentionJob applies policy actions through a dry-run store", async () => {
  const policy = policyFixture();
  const applied = [];
  const store = {
    async listRetentionRecords({ classId, rawCutoff, aggregateCutoff }) {
      assert.ok(rawCutoff instanceof Date);
      assert.ok(aggregateCutoff instanceof Date);
      return [
        { id: `${classId}-fresh`, classId, observedAt: "2026-07-04T00:00:00.000Z" },
        { id: `${classId}-old`, classId, observedAt: "2025-01-01T00:00:00.000Z" }
      ];
    },
    async applyRetentionAction(input) {
      applied.push(input);
    }
  };

  const result = await runRetentionJob({
    policy,
    store,
    now: new Date("2026-07-05T00:00:00.000Z"),
    dryRun: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.scannedRecords, policy.classes.length * 2);
  assert.equal(applied.length, policy.classes.length * 2);
  assert.equal(result.summary["peer_stats:keep_raw"], 1);
  assert.equal(result.summary["peer_stats:delete_aggregate"], 1);
});

test("runRetentionJob records per-record apply failures without stopping the job", async () => {
  const policy = policyFixture();
  const store = {
    async listRetentionRecords({ classId }) {
      if (classId !== "peer_stats") return [];
      return [
        { id: "ok", classId, observedAt: "2026-06-01T00:00:00.000Z" },
        { id: "bad", classId, observedAt: "2026-06-01T00:00:00.000Z" }
      ];
    },
    async applyRetentionAction({ record }) {
      if (record.id === "bad") throw new Error("write failed");
    }
  };

  const result = await runRetentionJob({
    policy,
    store,
    now: new Date("2026-07-05T00:00:00.000Z"),
    dryRun: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.appliedRecords, 1);
  assert.deepEqual(result.failures, [{
    classId: "peer_stats",
    recordId: "bad",
    stage: "apply",
    error: "write failed"
  }]);
});
