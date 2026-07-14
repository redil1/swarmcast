import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "config/capacity-plan.json";
const basePlan = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-capacity-plan-"));

function clonePlan() {
  return JSON.parse(JSON.stringify(basePlan));
}

function writeVariant(name, transform) {
  const plan = transform(clonePlan());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
  return file;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-capacity-plan.js", file], {
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

expectPass("current capacity plan", fixture);
expectFailure(
  "invalid review date",
  writeVariant("invalid-review-date", (plan) => {
    plan.reviewDate = "07/05/2026";
    return plan;
  }),
  /reviewDate must use YYYY-MM-DD/
);
expectFailure(
  "offload below launch gate",
  writeVariant("offload-low", (plan) => {
    plan.measuredOffloadRatio = 0.89;
    return plan;
  }),
  /measuredOffloadRatio must be at least 0\.90 before launch/
);
expectFailure(
  "self sustaining threshold above launch gate",
  writeVariant("self-sustaining-high", (plan) => {
    plan.selfSustainingSuperPeerFraction = 0.3;
    return plan;
  }),
  /selfSustainingSuperPeerFraction must be at or below 0\.25 before launch/
);
expectFailure(
  "unsafe sweep evidence reference",
  writeVariant("unsafe-sweep-evidence", (plan) => {
    plan.superPeerSweepEvidence = "token=synthetic-secret";
    return plan;
  }),
  /superPeerSweepEvidence has invalid format/
);
expectFailure(
  "edge cache below launch gate",
  writeVariant("edge-cache-low", (plan) => {
    plan.edgeCacheHitRatio = 0.79;
    return plan;
  }),
  /edgeCacheHitRatio must be at least 0\.80 before launch/
);
expectFailure(
  "edge node count below required capacity",
  writeVariant("edge-node-shortfall", (plan) => {
    plan.plannedEdgeNodes = 1;
    return plan;
  }),
  /plannedEdgeNodes 1 is below required 2/
);
expectFailure(
  "origin node count below required capacity",
  writeVariant("origin-node-shortfall", (plan) => {
    plan.plannedOriginNodes = 4;
    return plan;
  }),
  /plannedOriginNodes 4 is below required 5/
);

console.log("capacity plan validation smoke OK: pass=1 failures=7");
