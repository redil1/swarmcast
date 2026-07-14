import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const NOW = "2026-07-05T00:00:00.000Z";
const SENSITIVE_SENTINELS = [
  "https://source.invalid/private/master.m3u8",
  "SYNTHETIC_JWT_SHOULD_NOT_APPEAR",
  "203.0.113.10",
  "viewer@example.invalid",
  "super-secret-api-key"
];

const tempDir = mkdtempSync(path.join(tmpdir(), "swarmcast-retention-redaction-"));
const recordsFile = path.join(tempDir, "sensitive-records.jsonl");
const actionLogFile = path.join(tempDir, "actions.jsonl");

function runRetention(args, env = {}) {
  return spawnSync(process.execPath, ["scripts/retention-job.js", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RETENTION_NOW: NOW,
      RETENTION_RECORDS_FILE: recordsFile,
      RETENTION_ACTION_LOG: actionLogFile,
      ...env
    },
    encoding: "utf8"
  });
}

function assertNoSensitive(label, text) {
  for (const sentinel of SENSITIVE_SENTINELS) {
    assert.equal(text.includes(sentinel), false, `${label} leaked sensitive sentinel: ${sentinel}`);
  }
}

function assertActionLogIsMinimal(text) {
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(entries.length, 5, "expected five retention action-log entries");

  const allowedKeys = new Set(["at", "recordId", "classId", "observedAt", "action"]);
  for (const entry of entries) {
    for (const key of Object.keys(entry)) {
      assert.equal(allowedKeys.has(key), true, `retention action log emitted disallowed field: ${key}`);
    }
    assert.equal(entry.at, NOW);
    assert.match(entry.recordId, /^redaction-/);
    assert.ok(entry.classId);
    assert.ok(entry.observedAt);
    assert.ok(entry.action);
  }
}

try {
  copyFileSync("test-fixtures/retention/sensitive-records.jsonl", recordsFile);

  const dryRun = runRetention([]);
  assert.equal(dryRun.status, 0, `retention dry run failed\nSTDOUT:\n${dryRun.stdout}\nSTDERR:\n${dryRun.stderr}`);
  assertNoSensitive("dry-run stdout", dryRun.stdout);
  assertNoSensitive("dry-run stderr", dryRun.stderr);
  const dryRunResult = JSON.parse(dryRun.stdout);
  assert.equal(dryRunResult.ok, true);
  assert.equal(dryRunResult.dryRun, true);
  assert.equal(dryRunResult.scannedRecords, 5);
  assert.equal(dryRunResult.appliedRecords, 5);

  const metrics = runRetention(["--prometheus"]);
  assert.equal(metrics.status, 0, `retention metrics run failed\nSTDOUT:\n${metrics.stdout}\nSTDERR:\n${metrics.stderr}`);
  assertNoSensitive("prometheus stdout", metrics.stdout);
  assertNoSensitive("prometheus stderr", metrics.stderr);
  assert.match(metrics.stdout, /swarmcast_retention_records_total/);
  assert.match(metrics.stdout, /swarmcast_retention_failures_total 0/);

  const executed = runRetention(["--execute"], { RETENTION_EXECUTE: "1" });
  assert.equal(executed.status, 0, `retention execute failed\nSTDOUT:\n${executed.stdout}\nSTDERR:\n${executed.stderr}`);
  assertNoSensitive("execute stdout", executed.stdout);
  assertNoSensitive("execute stderr", executed.stderr);
  assert.equal(existsSync(actionLogFile), true, "execute mode did not create retention action log");

  const actionLogText = readFileSync(actionLogFile, "utf8");
  assertNoSensitive("action log", actionLogText);
  assertActionLogIsMinimal(actionLogText);

  console.log("retention redaction smoke OK: dryRunClean=true prometheusClean=true actionLogClean=true scanned=5");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
