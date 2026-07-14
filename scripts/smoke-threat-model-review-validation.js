import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/security/threat-model-review-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-threat-model-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function threat(record, id) {
  const value = record.threats.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing threat ${id}`);
  return value;
}

function area(record, id) {
  const value = record.areas.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing area ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-threat-model-review.js"];
  if (allowSynthetic) args.push("--allow-synthetic");
  args.push(file);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function expectPass(label, file) {
  const result = validate(file);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, file, pattern, options = {}) {
  const result = validate(file, options);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass("complete synthetic threat model review", fixture);
expectFailure(
  "synthetic review without explicit allow flag",
  fixture,
  /synthetic threat model review requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "missing required area",
  writeVariant("missing-rlnc-area", (record) => {
    record.areas = record.areas.filter((candidate) => candidate.id !== "rlnc");
    return record;
  }),
  /missing required threat-model area rlnc/
);
expectFailure(
  "missing required threat",
  writeVariant("missing-threat", (record) => {
    record.threats = record.threats.filter((candidate) => candidate.id !== "T-014");
    return record;
  }),
  /missing required threat T-014/
);
expectFailure(
  "invalid threat status",
  writeVariant("invalid-threat-status", (record) => {
    threat(record, "T-010").status = "open";
    return record;
  }),
  /T-010\.status must be mitigated, accepted, or waived/
);
expectFailure(
  "waived threat missing waiver",
  writeVariant("waived-threat-no-waiver", (record) => {
    threat(record, "T-006").status = "waived";
    return record;
  }),
  /T-006\.waiver is required/
);
expectFailure(
  "missing open gate acknowledgement",
  writeVariant("missing-open-gate", (record) => {
    record.openGates = record.openGates.filter((candidate) => candidate.id !== "load-ladder");
    return record;
  }),
  /missing required open gate acknowledgement load-ladder/
);
expectFailure(
  "missing signoff role",
  writeVariant("missing-operations-signoff", (record) => {
    record.signoffs = record.signoffs.filter((candidate) => candidate.role !== "operations");
    return record;
  }),
  /missing required signoff role operations/
);
expectFailure(
  "sensitive evidence reference",
  writeVariant("sensitive-evidence", (record) => {
    area(record, "auth").evidence.push("bearer synthetic-secret");
    return record;
  }),
  /auth\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("threat model review validation smoke OK: pass=1 failures=8");
