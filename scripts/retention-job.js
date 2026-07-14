import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatRetentionMetrics,
  runRetentionJob,
  validateRetentionPolicy
} from "../packages/config/src/retention.js";
import { createJsonlRetentionStore } from "../packages/config/src/retentionStores.js";

const args = new Set(process.argv.slice(2));
const dryRun = !args.has("--execute");
const prometheus = args.has("--prometheus");

if (!dryRun && process.env.RETENTION_EXECUTE !== "1") {
  console.error("Refusing destructive retention execution: set RETENTION_EXECUTE=1 and pass --execute.");
  process.exit(2);
}

const policyFile = process.env.RETENTION_POLICY_FILE || "config/data-retention.json";
const policy = validateRetentionPolicy(JSON.parse(readFileSync(policyFile, "utf8")));
const now = new Date(process.env.RETENTION_NOW || Date.now());

async function createStore() {
  if (process.env.RETENTION_STORE_MODULE) {
    const modulePath = pathToFileURL(resolve(process.env.RETENTION_STORE_MODULE)).href;
    const module = await import(modulePath);
    if (typeof module.createRetentionStore !== "function") {
      throw new Error("RETENTION_STORE_MODULE must export createRetentionStore");
    }
    return module.createRetentionStore({
      env: process.env,
      dryRun
    });
  }

  return createJsonlRetentionStore({
    recordsFile: process.env.RETENTION_RECORDS_FILE || "test-fixtures/retention/records.jsonl",
    actionLogFile: process.env.RETENTION_ACTION_LOG || "var/retention-actions.jsonl"
  });
}

const store = await createStore();
const result = await runRetentionJob({
  policy,
  store,
  now,
  dryRun
});
const metrics = formatRetentionMetrics(result.summary, {
  failuresTotal: result.failures.length,
  lastSuccessTimestampSeconds: result.ok ? Math.floor(now.getTime() / 1000) : 0
});

if (prometheus) {
  console.log(metrics);
} else {
  console.log(JSON.stringify({
    ok: result.ok,
    dryRun: result.dryRun,
    now: result.now,
    policyReviewDate: policy.reviewDate,
    scannedRecords: result.scannedRecords,
    appliedRecords: result.appliedRecords,
    summary: result.summary,
    failures: result.failures
  }, null, 2));
}

if (!result.ok) process.exitCode = 1;
