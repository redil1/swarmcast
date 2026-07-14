import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/launch/canary-rollout-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-canary-rollout-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function stage(record, id) {
  const value = record.stages.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing stage ${id}`);
  return value;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-canary-rollout-evidence.js", "--allow-synthetic", file], {
    encoding: "utf8"
  });
}

function expectPass(label, file) {
  const result = validate(file);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, file, pattern) {
  const result = validate(file);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass("complete synthetic canary rollout evidence", fixture);
expectFailure(
  "third-party cdn used",
  writeVariant("third-party-cdn", (record) => {
    record.thirdPartyCdnUsed = true;
    return record;
  }),
  /thirdPartyCdnUsed must be false/
);
expectFailure(
  "stage alert not clear",
  writeVariant("stage-alert-not-clear", (record) => {
    stage(record, "one-percent").alertState = "firing";
    return record;
  }),
  /one-percent\.alertState must be clear/
);
expectFailure(
  "rollback unavailable",
  writeVariant("rollback-unavailable", (record) => {
    stage(record, "five-percent").rollbackAvailable = false;
    return record;
  }),
  /five-percent\.rollbackAvailable must be true/
);
expectFailure(
  "missing stage metrics evidence",
  writeVariant("missing-stage-metrics", (record) => {
    stage(record, "twenty-five-percent").evidence = ["canary/manual-review-synthetic"];
    return record;
  }),
  /twenty-five-percent\.evidence must include canary:metrics:validate/
);
expectFailure(
  "missing stage peer health evidence",
  writeVariant("missing-stage-peer-health", (record) => {
    stage(record, "five-percent").evidence = ["canary:metrics:validate five-percent-synthetic-pass"];
    return record;
  }),
  /five-percent\.evidence must include peerTimeouts5m/
);
expectFailure(
  "missing required stage",
  writeVariant("missing-full-public", (record) => {
    record.stages = record.stages.filter((candidate) => candidate.id !== "full-public");
    return record;
  }),
  /missing required canary rollout stage full-public/
);
expectFailure(
  "sensitive rollout evidence",
  writeVariant("sensitive-evidence", (record) => {
    stage(record, "internal").evidence.push("token=synthetic-secret");
    return record;
  }),
  /internal\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("canary rollout evidence validation smoke OK: pass=1 failures=7");
