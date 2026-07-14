import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/legal/legal-approval-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-legal-approval-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function approval(record, role) {
  const value = record.approvals.find((candidate) => candidate.role === role);
  assert.ok(value, `fixture missing approval role ${role}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-legal-approval.js"];
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

expectPass("complete synthetic legal approval", fixture);
expectFailure(
  "synthetic legal approval without explicit allow flag",
  fixture,
  /synthetic legal approval requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "missing peer relay right",
  writeVariant("missing-peer-relay", (record) => {
    record.rights.peerRelay = false;
    return record;
  }),
  /rights\.peerRelay must be true/
);
expectFailure(
  "missing viewer retransmission evidence",
  writeVariant("missing-viewer-retransmission-evidence", (record) => {
    record.evidence = record.evidence.filter((item) => !item.includes("viewer-device-retransmission"));
    return record;
  }),
  /evidence must mention viewer-device-retransmission/
);
expectFailure(
  "missing privacy approval",
  writeVariant("missing-privacy-approval", (record) => {
    record.approvals = record.approvals.filter((candidate) => candidate.role !== "privacy");
    return record;
  }),
  /missing required approval role privacy/
);
expectFailure(
  "duplicate approval role",
  writeVariant("duplicate-legal-approval", (record) => {
    record.approvals.push({ ...approval(record, "legal") });
    return record;
  }),
  /duplicate approval role legal/
);
expectFailure(
  "invalid approval timestamp",
  writeVariant("invalid-approval-date", (record) => {
    approval(record, "content-licensing").approvedAt = "not-a-date";
    return record;
  }),
  /content-licensing\.approvedAt must be ISO-8601 parseable/
);
expectFailure(
  "duplicate territory",
  writeVariant("duplicate-territory", (record) => {
    record.territories.push("US");
    return record;
  }),
  /territories contains duplicate US/
);
expectFailure(
  "sensitive approval evidence",
  writeVariant("sensitive-approval-evidence", (record) => {
    approval(record, "privacy").evidence.push("jwt=synthetic-secret");
    return record;
  }),
  /privacy\.evidence evidence reference looks like it may contain sensitive source, token, or personal material/
);
expectFailure(
  "sensitive top-level evidence",
  writeVariant("sensitive-evidence", (record) => {
    record.evidence.push("https://source.example/live/channel.m3u8?token=synthetic");
    return record;
  }),
  /evidence evidence reference looks like it may contain sensitive source, token, or personal material/
);

console.log("legal approval validation smoke OK: pass=1 failures=9");
