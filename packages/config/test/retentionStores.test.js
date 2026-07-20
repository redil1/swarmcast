import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJsonlRetentionStore } from "../src/retentionStores.js";

test("JSONL retention store initializes a missing production records file when enabled", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "swarmcast-retention-store-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const recordsFile = path.join(root, "nested", "records.jsonl");

  const store = createJsonlRetentionStore({ recordsFile, initializeIfMissing: true });

  assert.equal(existsSync(recordsFile), true);
  assert.deepEqual(await store.listRetentionRecords({ classId: "peer_stats" }), []);
});

test("JSONL retention store still rejects a missing file unless initialization is explicit", () => {
  const recordsFile = path.join(tmpdir(), `swarmcast-missing-retention-${process.pid}.jsonl`);
  assert.throws(
    () => createJsonlRetentionStore({ recordsFile }),
    /retention records file not found/
  );
});
