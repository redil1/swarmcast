import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/retention/retention-execution-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-retention-execution-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function retentionClass(record, id) {
  const value = record.classes.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing class ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true, allowIncomplete = false } = {}) {
  const args = ["scripts/validate-retention-execution-evidence.js"];
  if (allowSynthetic) args.push("--allow-synthetic");
  if (allowIncomplete) args.push("--allow-incomplete");
  args.push(file);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function expectPass(label, file, options) {
  const result = validate(file, options);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, file, pattern, options = {}) {
  const result = validate(file, options);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass("complete synthetic retention execution evidence", fixture);
expectFailure(
  "synthetic evidence without explicit allow flag",
  fixture,
  /synthetic retention execution evidence requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "policy review date mismatch",
  writeVariant("policy-review-date-mismatch", (record) => {
    record.policyReviewDate = "2026-07-04";
    return record;
  }),
  /policyReviewDate must match config\/data-retention\.json/
);
expectFailure(
  "scoped credentials missing",
  writeVariant("scoped-credentials-false", (record) => {
    record.scopedCredentials = false;
    return record;
  }),
  /scopedCredentials must be true/
);
expectFailure(
  "destructive guard not verified",
  writeVariant("destructive-guard-false", (record) => {
    record.destructiveGuardVerified = false;
    return record;
  }),
  /destructiveGuardVerified must be true/
);
expectFailure(
  "sensitive leak flag not clear",
  writeVariant("sensitive-leak-flag", (record) => {
    record.noSensitiveMaterialLeaked = false;
    return record;
  }),
  /noSensitiveMaterialLeaked must be true/
);
expectFailure(
  "dry run scanned no records",
  writeVariant("dry-run-empty", (record) => {
    record.dryRun.scannedRecords = 0;
    return record;
  }),
  /dryRun\.scannedRecords must be greater than 0/
);
expectFailure(
  "execute command missing execute flag",
  writeVariant("execute-command-missing", (record) => {
    record.executeRun.command = "RETENTION_EXECUTE=1 npm run retention:job -- --prometheus";
    return record;
  }),
  /executeRun\.command must include --execute/
);
expectFailure(
  "class failures present",
  writeVariant("class-failures", (record) => {
    retentionClass(record, "auth_logs").failedRecords = 1;
    return record;
  }),
  /auth_logs\.failedRecords must be 0/
);
expectFailure(
  "missing execution class",
  writeVariant("missing-class", (record) => {
    record.classes = record.classes.filter((candidate) => candidate.id !== "metrics");
    return record;
  }),
  /missing retention execution class metrics/
);
expectFailure(
  "sensitive evidence reference",
  writeVariant("sensitive-evidence", (record) => {
    retentionClass(record, "ip_related_logs").evidence.push("192.168.0.1");
    return record;
  }),
  /ip_related_logs\.evidence evidence reference looks like it may contain sensitive retention material/
);

console.log("retention execution evidence validation smoke OK: pass=1 failures=10");
