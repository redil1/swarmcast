import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/privacy/privacy-store-compliance-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-privacy-store-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function check(record, id) {
  const value = record.checks.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing check ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-privacy-store-compliance.js"];
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

expectPass("complete synthetic privacy/store compliance evidence", fixture);
expectFailure(
  "synthetic evidence without explicit allow flag",
  fixture,
  /synthetic privacy\/store compliance evidence requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "missing legal approval",
  writeVariant("missing-legal-approval", (record) => {
    record.approvals = record.approvals.filter((approval) => approval.role !== "legal");
    return record;
  }),
  /missing required approval role legal/
);
expectFailure(
  "missing support faq check",
  writeVariant("missing-support-faq", (record) => {
    record.checks = record.checks.filter((candidate) => candidate.id !== "support-faq-reviewed");
    return record;
  }),
  /missing required privacy\/store compliance check support-faq-reviewed/
);
expectFailure(
  "failed p2p disable check",
  writeVariant("failed-p2p-disable", (record) => {
    check(record, "p2p-disable-closes-links").status = "fail";
    return record;
  }),
  /p2p-disable-closes-links\.status must pass/
);
expectFailure(
  "sensitive evidence",
  writeVariant("sensitive-evidence", (record) => {
    check(record, "telemetry-source-url-redaction").evidence.push("sourceUrl=https://source.example/live/private.m3u8");
    return record;
  }),
  /telemetry-source-url-redaction\.evidence evidence reference looks like it may contain sensitive source, token, or personal material/
);

console.log("privacy/store compliance validation smoke OK: pass=1 failures=5");
