import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/restore/evidence-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-restore-evidence-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function asset(record, id) {
  const value = record.assets.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing asset ${id}`);
  return value;
}

function check(record, id) {
  const value = record.checks.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing check ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true, allowIncomplete = false } = {}) {
  const args = ["scripts/validate-restore-evidence.js"];
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

expectPass("complete synthetic restore evidence", fixture);
expectFailure(
  "synthetic evidence without explicit allow flag",
  fixture,
  /synthetic restore evidence requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "missing required asset",
  writeVariant("missing-release-images", (record) => {
    record.assets = record.assets.filter((candidate) => candidate.id !== "release-images");
    return record;
  }),
  /missing required asset release-images/
);
expectFailure(
  "asset was not restored",
  writeVariant("asset-not-restored", (record) => {
    asset(record, "catalog-snapshot").restored = false;
    return record;
  }),
  /catalog-snapshot\.restored must be true/
);
expectFailure(
  "invalid checksum",
  writeVariant("invalid-checksum", (record) => {
    asset(record, "auth-keys").checksum = "sha256:not-a-valid-checksum";
    return record;
  }),
  /auth-keys\.checksum has invalid format/
);
expectFailure(
  "missing required check",
  writeVariant("missing-post-restore-smokes", (record) => {
    record.checks = record.checks.filter((candidate) => candidate.id !== "post-restore-smokes");
    return record;
  }),
  /missing required check post-restore-smokes/
);
expectFailure(
  "incomplete check without explicit allowance",
  writeVariant("incomplete-check", (record) => {
    check(record, "retention-dry-run").status = "partial";
    return record;
  }),
  /restore evidence has incomplete checks: retention-dry-run/
);
expectPass(
  "shape-only incomplete restore evidence with explicit allowance",
  writeVariant("incomplete-check-allowed", (record) => {
    check(record, "retention-dry-run").status = "partial";
    return record;
  }),
  { allowIncomplete: true }
);
expectFailure(
  "completed before start",
  writeVariant("bad-time-order", (record) => {
    record.completedAt = record.startedAt;
    return record;
  }),
  /completedAt must be after startedAt/
);
expectFailure(
  "sensitive evidence reference",
  writeVariant("sensitive-evidence", (record) => {
    check(record, "auth-token-verify").evidence.push("token=synthetic-secret");
    return record;
  }),
  /auth-token-verify\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("restore evidence validation smoke OK: pass=2 failures=8");
