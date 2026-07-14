import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/retention/retention-approval-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-retention-approval-"));

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

function control(record, id) {
  const value = record.controls.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing control ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-retention-approval.js"];
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

expectPass("complete synthetic retention approval", fixture);
expectFailure(
  "synthetic approval without explicit allow flag",
  fixture,
  /synthetic retention approval requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "missing required approver",
  writeVariant("missing-legal-approver", (record) => {
    record.approvers = record.approvers.filter((candidate) => candidate.role !== "legal");
    return record;
  }),
  /missing required approver role legal/
);
expectFailure(
  "missing retention class approval",
  writeVariant("missing-peer-stats", (record) => {
    record.classes = record.classes.filter((candidate) => candidate.id !== "peer_stats");
    return record;
  }),
  /missing retention approval for peer_stats/
);
expectFailure(
  "retention window does not match policy",
  writeVariant("raw-retention-mismatch", (record) => {
    retentionClass(record, "auth_logs").rawRetentionDays = 31;
    return record;
  }),
  /auth_logs\.rawRetentionDays must match policy/
);
expectFailure(
  "waived class missing waiver",
  writeVariant("waived-no-metadata", (record) => {
    retentionClass(record, "metrics").status = "waived";
    return record;
  }),
  /metrics\.waiver is required/
);
expectFailure(
  "missing required control",
  writeVariant("missing-incident-hold", (record) => {
    record.controls = record.controls.filter((candidate) => candidate.id !== "incident-hold-process");
    return record;
  }),
  /missing required retention control incident-hold-process/
);
expectFailure(
  "control did not pass",
  writeVariant("control-failed", (record) => {
    control(record, "retention-job").status = "fail";
    return record;
  }),
  /retention-job\.status must pass before data retention approval/
);
expectFailure(
  "sensitive evidence reference",
  writeVariant("sensitive-evidence", (record) => {
    retentionClass(record, "ip_related_logs").evidence.push("email=person@example.com");
    return record;
  }),
  /ip_related_logs\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("retention approval validation smoke OK: pass=1 failures=8");
