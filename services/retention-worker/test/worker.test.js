import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRetentionWorkerConfig } from "@swarmcast/config/env";
import {
  createRetentionWorker
} from "../src/index.js";

function policyFixture() {
  return JSON.parse(readFileSync(new URL("../../../config/data-retention.json", import.meta.url), "utf8"));
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("retention worker runs a dry-run job and exposes metrics", async () => {
  const store = {
    async listRetentionRecords({ classId }) {
      if (classId !== "peer_stats") return [];
      return [
        { id: "peer-old", classId, observedAt: "2026-06-01T00:00:00.000Z" }
      ];
    },
    async applyRetentionAction() {}
  };
  const worker = createRetentionWorker({
    policy: policyFixture(),
    store,
    config: loadRetentionWorkerConfig({
      RETENTION_WORKER_PORT: "7020",
      RETENTION_INTERVAL_MS: "60000"
    }),
    nowProvider: () => new Date("2026-07-05T00:00:00.000Z")
  });

  const result = await worker.runOnce();
  assert.equal(result.ok, true);
  assert.equal(result.summary["peer_stats:aggregate_then_delete_raw"], 1);

  const base = await listen(worker.server);
  try {
    const metrics = await fetch(`${base}/metrics`);
    const text = await metrics.text();
    assert.equal(metrics.status, 200);
    assert.match(text, /swarmcast_retention_records_total\{class="peer_stats",action="aggregate_then_delete_raw"\} 1/);
    assert.match(text, /swarmcast_retention_last_success_timestamp_seconds 1783209600/);

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      dryRun: true,
      running: false,
      failuresTotal: 0,
      lastSuccessTimestampSeconds: 1783209600
    });
  } finally {
    worker.server.close();
  }
});
