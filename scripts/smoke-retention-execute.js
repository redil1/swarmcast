import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const NOW = "2026-07-05T00:00:00.000Z";
const tempDir = mkdtempSync(path.join(tmpdir(), "swarmcast-retention-execute-"));
const recordsFile = path.join(tempDir, "records.jsonl");
const actionLogFile = path.join(tempDir, "actions.jsonl");

function runRetention(env) {
  return spawnSync(process.execPath, ["scripts/retention-job.js", "--execute"], {
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

try {
  copyFileSync("test-fixtures/retention/records.jsonl", recordsFile);

  const refused = runRetention({ RETENTION_EXECUTE: "" });
  if (refused.status !== 2 || !refused.stderr.includes("Refusing destructive retention execution")) {
    throw new Error(`expected retention execute guard to refuse without RETENTION_EXECUTE=1; status=${refused.status}`);
  }

  const executed = runRetention({ RETENTION_EXECUTE: "1" });
  if (executed.status !== 0) {
    throw new Error(`retention execute failed\nSTDOUT:\n${executed.stdout}\nSTDERR:\n${executed.stderr}`);
  }

  const result = JSON.parse(executed.stdout);
  if (result.dryRun !== false || !result.ok) throw new Error("retention execute result was not successful execute mode");
  if (result.scannedRecords !== 5 || result.appliedRecords !== 5) {
    throw new Error(`expected 5 scanned/applied records, got ${result.scannedRecords}/${result.appliedRecords}`);
  }

  if (!existsSync(actionLogFile)) throw new Error("execute mode did not create retention action log");
  const actions = readFileSync(actionLogFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  if (actions.length !== 5) throw new Error(`expected 5 retention action records, got ${actions.length}`);
  const actionSet = new Set(actions.map((entry) => entry.action));
  for (const required of ["keep_raw", "aggregate_then_delete_raw", "delete_aggregate"]) {
    if (!actionSet.has(required)) throw new Error(`missing retention action ${required}`);
  }
  if (!actions.every((entry) => entry.at === NOW && entry.recordId && entry.classId && entry.observedAt)) {
    throw new Error("retention action log entries are missing required fields");
  }

  console.log(`retention execute smoke OK: scanned=${result.scannedRecords} applied=${result.appliedRecords} actions=${actions.length} guardRefused=true`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
