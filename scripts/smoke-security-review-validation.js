import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/security/security-review-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-security-review-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function scope(record, id) {
  const value = record.scopes.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing scope ${id}`);
  return value;
}

function finding(record, id) {
  const value = record.findings.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing finding ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-security-review.js"];
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

expectPass("complete synthetic security review", fixture);
expectFailure(
  "synthetic review without explicit allow flag",
  fixture,
  /synthetic security review requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "missing required scope",
  writeVariant("missing-tracker-abuse", (record) => {
    record.scopes = record.scopes.filter((candidate) => candidate.id !== "tracker-abuse");
    return record;
  }),
  /missing required scope tracker-abuse/
);
expectFailure(
  "scope not passing",
  writeVariant("scope-partial", (record) => {
    scope(record, "source-url-protection").status = "partial";
    return record;
  }),
  /source-url-protection must pass before security review can be approved/
);
expectFailure(
  "blocking finding still open",
  writeVariant("p1-open", (record) => {
    finding(record, "SEC-002").status = "open";
    return record;
  }),
  /SEC-002 is P1 and must be fixed or waived before launch/
);
expectFailure(
  "waived blocking finding without waiver metadata",
  writeVariant("p1-waived-no-metadata", (record) => {
    finding(record, "SEC-002").status = "waived";
    return record;
  }),
  /SEC-002\.waiver is required/
);
expectFailure(
  "waiver expiration is invalid",
  writeVariant("p1-waiver-bad-date", (record) => {
    const target = finding(record, "SEC-002");
    target.status = "waived";
    target.waiver = {
      reason: "temporary production exception",
      approvedBy: "security-lead",
      expiresAt: "not-a-date"
    };
    return record;
  }),
  /SEC-002\.waiver\.expiresAt must be ISO-8601 parseable/
);
expectFailure(
  "sensitive scope evidence",
  writeVariant("sensitive-scope-evidence", (record) => {
    scope(record, "authentication-and-tokens").evidence.push("jwt=synthetic-secret");
    return record;
  }),
  /authentication-and-tokens\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("security review validation smoke OK: pass=1 failures=7");
