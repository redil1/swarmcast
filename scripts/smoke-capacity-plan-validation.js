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

function markMeasured(plan) {
  plan.offloadMeasurementStatus = "measured";
  plan.directP2pOffloadRatio = 0.9;
  plan.offloadMeasurementEvidence = "evidence/load/real-device-offload.json";
  plan.superPeerSweepEvidence = "evidence/load/real-vm-super-peer-sweep.json";
  plan.edgeNodeCapacityMeasurementStatus = "measured";
  plan.edgeNodeCapacityEvidence = "evidence/capacity/edge-tls-throughput.json";
  plan.segmentBusCapacityMeasurementStatus = "measured";
  plan.segmentBusCapacityEvidence = "evidence/capacity/segment-bus-capacity.json";
  plan.providerTrafficTermsApproved = true;
  plan.providerTrafficTermsEvidence = "evidence/capacity/provider-traffic-approval.md";
  plan.plannedEdgeNodes = 17;
  return plan;
}

function validate(file, { allowDraft = false } = {}) {
  const args = ["scripts/validate-capacity-plan.js"];
  if (allowDraft) args.push("--allow-draft");
  args.push(file);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function expectPass(label, file, options = {}) {
  const result = validate(file, options);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, file, pattern, options = {}) {
  const result = validate(file, options);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass("draft capacity plan shape", fixture, { allowDraft: true });
expectPass("measured launch capacity shape", writeVariant("measured", markMeasured));
expectFailure(
  "draft rejected as launch evidence",
  fixture,
  /offloadMeasurementStatus must be measured before launch/
);
expectFailure(
  "invalid review date",
  writeVariant("invalid-review-date", (plan) => {
    plan.reviewDate = "07/05/2026";
    return plan;
  }),
  /reviewDate must use YYYY-MM-DD/,
  { allowDraft: true }
);
expectFailure(
  "offload below launch gate",
  writeVariant("offload-low", (plan) => {
    markMeasured(plan);
    plan.directP2pOffloadRatio = 0.89;
    return plan;
  }),
  /directP2pOffloadRatio must be at least 0\.90 before launch/
);
expectFailure(
  "self sustaining threshold above launch gate",
  writeVariant("self-sustaining-high", (plan) => {
    plan.selfSustainingSuperPeerFraction = 0.3;
    return plan;
  }),
  /selfSustainingSuperPeerFraction must be at or below 0\.25 before launch/,
  { allowDraft: true }
);
expectFailure(
  "unsafe sweep evidence reference",
  writeVariant("unsafe-sweep-evidence", (plan) => {
    plan.superPeerSweepEvidence = "token=synthetic-secret";
    return plan;
  }),
  /superPeerSweepEvidence has invalid format/,
  { allowDraft: true }
);
expectFailure(
  "edge cache below launch gate",
  writeVariant("edge-cache-low", (plan) => {
    plan.edgeCacheHitRatio = 0.79;
    return plan;
  }),
  /edgeCacheHitRatio must be at least 0\.80 before launch/,
  { allowDraft: true }
);
expectFailure(
  "edge node count below conservative capacity",
  writeVariant("edge-node-shortfall", (plan) => {
    plan.plannedEdgeNodes = 24;
    return plan;
  }),
  /plannedEdgeNodes 24 is below required 25/,
  { allowDraft: true }
);
expectFailure(
  "origin node count below required capacity",
  writeVariant("origin-node-shortfall", (plan) => {
    plan.plannedOriginNodes = 4;
    return plan;
  }),
  /plannedOriginNodes 4 is below required 5/,
  { allowDraft: true }
);
expectFailure(
  "edge capacity exceeds physical utilization budget",
  writeVariant("edge-capacity-over-link-budget", (plan) => {
    plan.edgeNodeCapacityMbps = 801;
    return plan;
  }),
  /edgeNodeCapacityMbps exceeds the sustained link utilization budget/,
  { allowDraft: true }
);
expectFailure(
  "unmeasured edge throughput rejected at launch",
  writeVariant("edge-throughput-unmeasured", (plan) => {
    markMeasured(plan);
    plan.edgeNodeCapacityMeasurementStatus = "conservative-assumption";
    return plan;
  }),
  /edgeNodeCapacityMeasurementStatus must be measured before launch/
);
expectFailure(
  "segment bus target below derived peak plus headroom",
  writeVariant("segment-bus-target-low", (plan) => {
    plan.segmentBusTargetMessagesPerSecond = 324;
    return plan;
  }),
  /segmentBusTargetMessagesPerSecond 324 is below required 325/,
  { allowDraft: true }
);
expectFailure(
  "unmeasured segment bus capacity rejected at launch",
  writeVariant("segment-bus-unmeasured", (plan) => {
    markMeasured(plan);
    plan.segmentBusCapacityMeasurementStatus = "pending";
    return plan;
  }),
  /segmentBusCapacityMeasurementStatus must be measured before launch/
);
expectFailure(
  "pending segment bus evidence rejected at launch",
  writeVariant("segment-bus-evidence-pending", (plan) => {
    markMeasured(plan);
    plan.segmentBusCapacityEvidence = "capacity/segment-bus-capacity.pending.json";
    return plan;
  }),
  /segmentBusCapacityEvidence must reference non-synthetic completed evidence/
);
expectFailure(
  "synthetic offload evidence rejected at launch",
  writeVariant("offload-evidence-synthetic", (plan) => {
    markMeasured(plan);
    plan.offloadMeasurementEvidence = "load-ladder/physical-device.synthetic.json";
    return plan;
  }),
  /offloadMeasurementEvidence must reference non-synthetic completed evidence/
);
expectFailure(
  "pending edge throughput evidence rejected at launch",
  writeVariant("edge-throughput-evidence-pending", (plan) => {
    markMeasured(plan);
    plan.edgeNodeCapacityEvidence = "capacity/edge-node-throughput.pending.json";
    return plan;
  }),
  /edgeNodeCapacityEvidence must reference non-synthetic completed evidence/
);
expectFailure(
  "unapproved provider traffic terms rejected at launch",
  writeVariant("provider-terms-unapproved", (plan) => {
    markMeasured(plan);
    plan.providerTrafficTermsApproved = false;
    return plan;
  }),
  /providerTrafficTermsApproved must be true before launch/
);
expectFailure(
  "pending provider terms evidence rejected at launch",
  writeVariant("provider-terms-evidence-pending", (plan) => {
    markMeasured(plan);
    plan.providerTrafficTermsEvidence = "capacity/provider-traffic-terms.pending.md";
    return plan;
  }),
  /providerTrafficTermsEvidence must reference non-synthetic completed evidence/
);
expectFailure(
  "relay egress omitted",
  writeVariant("relay-egress-omitted", (plan) => {
    plan.relayEgressIncluded = false;
    return plan;
  }),
  /relayEgressIncluded must be true/,
  { allowDraft: true }
);
expectFailure(
  "one million sensitivity node count drift",
  writeVariant("sensitivity-node-drift", (plan) => {
    plan.offloadSensitivity.find((row) => row.directP2pOffloadRatio === 0.7).requiredEdgeNodes = 2437;
    return plan;
  }),
  /offloadSensitivity 0\.70 requiredEdgeNodes must equal 2438/,
  { allowDraft: true }
);

console.log("capacity plan validation smoke OK: pass=2 failures=18");
