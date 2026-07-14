import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/android/ci-build-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-android-ci-evidence-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function step(record, id) {
  const value = record.steps.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing step ${id}`);
  return value;
}

function artifact(record, variant) {
  const value = record.artifacts.find((candidate) => candidate.variant === variant);
  assert.ok(value, `fixture missing artifact ${variant}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-android-ci-evidence.js"];
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

expectPass("complete synthetic Android CI evidence", fixture);
expectFailure(
  "synthetic Android CI evidence without explicit allow flag",
  fixture,
  /synthetic Android CI evidence requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "invalid GitHub Actions run URL",
  writeVariant("bad-run-url", (record) => {
    record.runUrl = "https://ci.example.invalid/runs/123";
    return record;
  }),
  /runUrl has invalid format/
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
  "invalid Android platform",
  writeVariant("bad-android-platform", (record) => {
    record.toolchain.androidPlatform = "35";
    return record;
  }),
  /toolchain\.androidPlatform has invalid format/
);
expectFailure(
  "missing Android unit test step",
  writeVariant("missing-unit-test", (record) => {
    record.steps = record.steps.filter((candidate) => candidate.id !== "testDebugUnitTest");
    return record;
  }),
  /missing required Android CI step testDebugUnitTest/
);
expectFailure(
  "missing release assembly step",
  writeVariant("missing-assemble-release", (record) => {
    record.steps = record.steps.filter((candidate) => candidate.id !== "assembleRelease");
    return record;
  }),
  /missing required Android CI step assembleRelease/
);
expectFailure(
  "missing release artifact upload step",
  writeVariant("missing-upload-release", (record) => {
    record.steps = record.steps.filter((candidate) => candidate.id !== "uploadReleaseArtifact");
    return record;
  }),
  /missing required Android CI step uploadReleaseArtifact/
);
expectFailure(
  "debug assembly step failed",
  writeVariant("assemble-debug-failed", (record) => {
    step(record, "assembleDebug").status = "fail";
    return record;
  }),
  /assembleDebug\.status must be pass/
);
expectFailure(
  "duplicate CI step",
  writeVariant("duplicate-step", (record) => {
    record.steps.push({ ...step(record, "checkout") });
    return record;
  }),
  /duplicate step checkout/
);
expectFailure(
  "sensitive step evidence",
  writeVariant("sensitive-step-evidence", (record) => {
    step(record, "setup-android").evidence.push("token=synthetic-secret");
    return record;
  }),
  /setup-android\.evidence evidence reference looks like it may contain sensitive material/
);
expectFailure(
  "missing release artifact",
  writeVariant("missing-release-artifact", (record) => {
    record.artifacts = record.artifacts.filter((candidate) => candidate.variant !== "release");
    return record;
  }),
  /missing required Android CI artifact release/
);
expectFailure(
  "invalid release artifact path",
  writeVariant("bad-release-path", (record) => {
    artifact(record, "release").path = "tmp/app-release.apk";
    return record;
  }),
  /release\.path has invalid format/
);
expectFailure(
  "invalid debug checksum",
  writeVariant("bad-debug-checksum", (record) => {
    artifact(record, "debug").sha256 = "sha256:not-a-real-checksum";
    return record;
  }),
  /debug\.sha256 has invalid format/
);
expectFailure(
  "empty release artifact",
  writeVariant("empty-release-artifact", (record) => {
    artifact(record, "release").sizeBytes = 0;
    return record;
  }),
  /release\.sizeBytes must be a positive number/
);
expectFailure(
  "duplicate artifact",
  writeVariant("duplicate-debug-artifact", (record) => {
    record.artifacts.push({ ...artifact(record, "debug") });
    return record;
  }),
  /duplicate artifact debug/
);
expectFailure(
  "missing debug upload artifact evidence",
  writeVariant("missing-debug-upload-evidence", (record) => {
    artifact(record, "debug").evidence = artifact(record, "debug").evidence.filter((item) => item !== "swarmcast-android-debug-apk");
    return record;
  }),
  /debug\.evidence must mention swarmcast-android-debug-apk/
);
expectFailure(
  "missing release checksum sidecar evidence",
  writeVariant("missing-release-checksum-evidence", (record) => {
    artifact(record, "release").evidence = artifact(record, "release").evidence.filter((item) => !item.includes(".sha256"));
    return record;
  }),
  /release\.evidence must mention \.sha256/
);

console.log("Android CI evidence validation smoke OK: pass=1 failures=17");
