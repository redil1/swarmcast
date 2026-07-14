import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/dependency/dependency-review-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-dependency-review-"));

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

function decision(record, id) {
  const value = record.decisions.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing decision ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-dependency-review.js"];
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

expectPass("complete synthetic dependency review", fixture);
expectFailure(
  "synthetic review without explicit allow flag",
  fixture,
  /synthetic dependency review requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "missing required check",
  writeVariant("missing-android-release-build", (record) => {
    record.checks = record.checks.filter((candidate) => candidate.id !== "android-release-build");
    return record;
  }),
  /missing required dependency check android-release-build/
);
expectFailure(
  "check did not pass",
  writeVariant("image-scans-failed", (record) => {
    check(record, "image-scans").status = "fail";
    return record;
  }),
  /image-scans\.status must pass before dependency review can be approved/
);
expectFailure(
  "missing required reviewer role",
  writeVariant("missing-security-reviewer", (record) => {
    record.reviewers = record.reviewers.filter((reviewer) => reviewer.role !== "application-security");
    return record;
  }),
  /reviewers must include application-security/
);
expectFailure(
  "check evidence missing check id",
  writeVariant("check-evidence-missing-id", (record) => {
    check(record, "release-image-refs").evidence = ["npm run release:images:check synthetic digest refs"];
    return record;
  }),
  /release-image-refs\.evidence must mention release-image-refs/
);
expectFailure(
  "missing inventory decision",
  writeVariant("missing-jose-decision", (record) => {
    record.decisions = record.decisions.filter((candidate) => candidate.id !== "jose");
    return record;
  }),
  /missing dependency decision for jose/
);
expectFailure(
  "unknown decision id",
  writeVariant("unknown-decision", (record) => {
    decision(record, "jose").id = "unknown-library";
    return record;
  }),
  /unknown-library is not present in dependency inventory/
);
expectFailure(
  "decision evidence missing decision id",
  writeVariant("decision-evidence-missing-id", (record) => {
    decision(record, "jose").evidence = ["services/auth/test/auth.test.js"];
    return record;
  }),
  /jose\.evidence must mention jose/
);
expectFailure(
  "waiver missing metadata",
  writeVariant("waiver-missing-metadata", (record) => {
    delete decision(record, "ffmpeg").waiver;
    return record;
  }),
  /ffmpeg\.waiver is required/
);
expectFailure(
  "waiver expiration invalid",
  writeVariant("waiver-bad-date", (record) => {
    decision(record, "android-rlnc-library").waiver.expiresAt = "not-a-date";
    return record;
  }),
  /android-rlnc-library\.waiver\.expiresAt must be ISO-8601 parseable/
);
expectFailure(
  "waiver expired before review",
  writeVariant("waiver-expired", (record) => {
    decision(record, "ffmpeg").waiver.expiresAt = "2026-07-01T00:00:00.000Z";
    return record;
  }),
  /ffmpeg\.waiver\.expiresAt must be after reviewedAt/
);
expectFailure(
  "sensitive evidence reference",
  writeVariant("sensitive-evidence", (record) => {
    decision(record, "node-runtime").evidence.push("password=synthetic-secret");
    return record;
  }),
  /node-runtime\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("dependency review validation smoke OK: pass=1 failures=12");
