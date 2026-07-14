import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/android/rlnc-decision-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-android-rlnc-decision-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function reviewer(record, role) {
  const value = record.reviewers.find((candidate) => candidate.role === role);
  assert.ok(value, `fixture missing reviewer ${role}`);
  return value;
}

function check(record, id) {
  const value = record.checks.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing check ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-android-rlnc-decision.js"];
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

expectPass("complete synthetic Android RLNC decision", fixture);
expectFailure(
  "synthetic Android RLNC decision without explicit allow flag",
  fixture,
  /synthetic Android RLNC decision requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "high ABI risk",
  writeVariant("high-abi-risk", (record) => {
    record.implementation.abiRisk = "high";
    return record;
  }),
  /implementation\.abiRisk must not be high for launch/
);
expectFailure(
  "unselected implementation",
  writeVariant("unselected-implementation", (record) => {
    record.implementation.version = "0.8.7";
    return record;
  }),
  /implementation\.version must match selected Android RLNC implementation/
);
expectFailure(
  "missing legal reviewer",
  writeVariant("missing-legal-reviewer", (record) => {
    record.reviewers = record.reviewers.filter((candidate) => candidate.role !== "legal");
    return record;
  }),
  /missing required reviewer role legal/
);
expectFailure(
  "duplicate reviewer",
  writeVariant("duplicate-reviewer", (record) => {
    record.reviewers.push({ ...reviewer(record, "android") });
    return record;
  }),
  /duplicate reviewer role android/
);
expectFailure(
  "invalid reviewer timestamp",
  writeVariant("invalid-review-date", (record) => {
    reviewer(record, "performance").reviewedAt = "not-a-date";
    return record;
  }),
  /performance\.reviewedAt must be ISO-8601 parseable/
);
expectFailure(
  "missing fuzz check",
  writeVariant("missing-fuzz-check", (record) => {
    record.checks = record.checks.filter((candidate) => candidate.id !== "fuzz-malformed-packets");
    return record;
  }),
  /missing required Android RLNC check fuzz-malformed-packets/
);
expectFailure(
  "decode benchmark failed",
  writeVariant("decode-benchmark-failed", (record) => {
    check(record, "decode-benchmark").status = "fail";
    return record;
  }),
  /decode-benchmark\.status must pass before Android RLNC approval/
);
expectFailure(
  "duplicate RLNC check",
  writeVariant("duplicate-check", (record) => {
    record.checks.push({ ...check(record, "license-review") });
    return record;
  }),
  /duplicate RLNC decision check license-review/
);
expectFailure(
  "sensitive check evidence",
  writeVariant("sensitive-check-evidence", (record) => {
    check(record, "license-review").evidence.push("email=person@example.com");
    return record;
  }),
  /license-review\.evidence evidence reference looks like it may contain sensitive material/
);
expectFailure(
  "decode CPU above budget",
  writeVariant("decode-cpu-high", (record) => {
    record.benchmarks.decodeCpuMsP95 = 101;
    return record;
  }),
  /benchmarks\.decodeCpuMsP95 must be between 0 and 100/
);
expectFailure(
  "battery drain above budget",
  writeVariant("battery-high", (record) => {
    record.benchmarks.batteryDrainPctPerHour = 9;
    return record;
  }),
  /benchmarks\.batteryDrainPctPerHour must be between 0 and 8/
);
expectFailure(
  "k outside byte range",
  writeVariant("bad-k", (record) => {
    record.benchmarks.k = 256;
    return record;
  }),
  /benchmarks\.k must be between 1 and 255/
);
expectFailure(
  "too few fuzz cases",
  writeVariant("few-fuzz-cases", (record) => {
    record.fuzz.cases = 999;
    return record;
  }),
  /fuzz\.cases must be between 1000 and Infinity/
);
expectFailure(
  "fuzz crash observed",
  writeVariant("fuzz-crash", (record) => {
    record.fuzz.crashes = 1;
    return record;
  }),
  /fuzz\.crashes must be between 0 and 0/
);
expectFailure(
  "device decode has too few devices",
  writeVariant("few-devices", (record) => {
    record.deviceDecode.devices = 1;
    return record;
  }),
  /deviceDecode\.devices must be between 2 and Infinity/
);
expectFailure(
  "no verified decoded segments",
  writeVariant("no-verified-segments", (record) => {
    record.deviceDecode.verifiedSegments = 0;
    return record;
  }),
  /deviceDecode\.verifiedSegments must be between 1 and Infinity/
);
expectFailure(
  "device decode hash failure",
  writeVariant("hash-failure", (record) => {
    record.deviceDecode.hashFailures = 1;
    return record;
  }),
  /deviceDecode\.hashFailures must be between 0 and 0/
);
expectFailure(
  "segment store not verified",
  writeVariant("segment-store-not-verified", (record) => {
    record.deviceDecode.segmentStoreVerified = false;
    return record;
  }),
  /deviceDecode\.segmentStoreVerified must be true/
);
expectFailure(
  "sensitive device decode evidence",
  writeVariant("sensitive-device-decode", (record) => {
    record.deviceDecode.evidence.push("sourceUrl=https://upstream.example/live/channel.m3u8?token=synthetic");
    return record;
  }),
  /deviceDecode\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("Android RLNC decision validation smoke OK: pass=1 failures=20");
