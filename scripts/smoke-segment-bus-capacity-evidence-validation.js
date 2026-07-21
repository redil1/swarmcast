import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { validatePerformanceBudgets } from "../packages/config/src/performanceBudgets.js";
import { validateSegmentBusCapacityEvidence } from "./validate-segment-bus-capacity-evidence.js";

const fixtureRecord = JSON.parse(readFileSync("test-fixtures/segment-bus/segment-bus-capacity.complete.synthetic.json", "utf8"));
const fixtureRaw = JSON.parse(readFileSync("test-fixtures/segment-bus/segment-bus-capacity-raw.complete.synthetic.json", "utf8"));
const capacityPlan = JSON.parse(readFileSync("config/capacity-plan.json", "utf8"));
const budgets = validatePerformanceBudgets(JSON.parse(readFileSync("config/performance-budgets.json", "utf8")));
const clone = (value) => structuredClone(value);
const digest = (value) => createHash("sha256").update(value).digest("hex");

function writeCase(record, raw, { rawText, symlinkTarget } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "segment-bus-capacity-evidence-"));
  const evidenceFile = path.join(directory, "evidence.json");
  const rawFile = path.join(directory, "raw.json");
  let serializedRaw;
  if (symlinkTarget) {
    symlinkSync(symlinkTarget, rawFile);
    serializedRaw = readFileSync(symlinkTarget);
  } else {
    serializedRaw = rawText ?? `${JSON.stringify(raw, null, 2)}\n`;
    writeFileSync(rawFile, serializedRaw, { mode: 0o600 });
    chmodSync(rawFile, 0o600);
  }
  record.rawProbeArtifact = { path: "raw.json", sha256: digest(serializedRaw) };
  writeFileSync(evidenceFile, `${JSON.stringify(record, null, 2)}\n`);
  return evidenceFile;
}

function validate(record, raw, options = {}) {
  const evidenceFile = writeCase(record, raw, options);
  return validateSegmentBusCapacityEvidence(record, evidenceFile, {
    allowSynthetic: true,
    capacityPlan,
    budgets
  });
}

const positive = validate(clone(fixtureRecord), clone(fixtureRaw));
if (positive.probe.load.achievedMessagesPerSecond !== 325) throw new Error("positive evidence did not retain measured rate");

let failures = 0;
function expectFailure(name, action) {
  try {
    action();
  } catch {
    failures += 1;
    return;
  }
  throw new Error(`${name} unexpectedly passed`);
}

expectFailure("synthetic allowance", () => {
  const record = clone(fixtureRecord);
  const file = writeCase(record, clone(fixtureRaw));
  validateSegmentBusCapacityEvidence(record, file, { capacityPlan, budgets });
});
expectFailure("unsupported evidence field", () => {
  const record = clone(fixtureRecord); record.extra = true;
  validate(record, clone(fixtureRaw));
});
expectFailure("artifact hash", () => {
  const record = clone(fixtureRecord);
  const file = writeCase(record, clone(fixtureRaw));
  record.rawProbeArtifact.sha256 = "0".repeat(64);
  validateSegmentBusCapacityEvidence(record, file, { allowSynthetic: true, capacityPlan, budgets });
});
expectFailure("artifact path traversal", () => {
  const record = clone(fixtureRecord);
  const file = writeCase(record, clone(fixtureRaw));
  record.rawProbeArtifact.path = "../raw.json";
  validateSegmentBusCapacityEvidence(record, file, { allowSynthetic: true, capacityPlan, budgets });
});
expectFailure("missing reviewers", () => {
  const record = clone(fixtureRecord); record.reviewers.pop();
  validate(record, clone(fixtureRaw));
});
expectFailure("duplicate reviewer role", () => {
  const record = clone(fixtureRecord); record.reviewers[1].role = "platform";
  validate(record, clone(fixtureRaw));
});
expectFailure("duplicate reviewer identity", () => {
  const record = clone(fixtureRecord); record.reviewers[1].reviewerId = record.reviewers[0].reviewerId;
  validate(record, clone(fixtureRaw));
});
expectFailure("review before run completion", () => {
  const record = clone(fixtureRecord); record.reviewers[0].reviewedAt = "2026-07-20T23:59:59.000Z";
  validate(record, clone(fixtureRaw));
});
expectFailure("missing wrapper marker", () => {
  const record = clone(fixtureRecord); record.evidenceMarkers.pop();
  validate(record, clone(fixtureRaw));
});
expectFailure("duplicate wrapper marker", () => {
  const record = clone(fixtureRecord); record.evidenceMarkers[12] = record.evidenceMarkers[0];
  validate(record, clone(fixtureRaw));
});
expectFailure("release binding", () => {
  const record = clone(fixtureRecord); record.releaseVersion = "v0.1.1-synthetic";
  validate(record, clone(fixtureRaw));
});
expectFailure("raw unsupported field", () => {
  const raw = clone(fixtureRaw); raw.extra = true;
  validate(clone(fixtureRecord), raw);
});
expectFailure("synthetic binding", () => {
  const raw = clone(fixtureRaw); raw.synthetic = false;
  validate(clone(fixtureRecord), raw);
});
expectFailure("provider collapse", () => {
  const raw = clone(fixtureRaw); raw.topology.forEach((node) => { node.provider = "provider-a"; });
  validate(clone(fixtureRecord), raw);
});
expectFailure("failure-domain collapse", () => {
  const raw = clone(fixtureRaw); raw.topology[1].failureDomain = raw.topology[0].failureDomain;
  validate(clone(fixtureRecord), raw);
});
expectFailure("duplicate certificate", () => {
  const raw = clone(fixtureRaw); raw.topology[1].certificateSha256 = raw.topology[0].certificateSha256;
  validate(clone(fixtureRecord), raw);
});
expectFailure("TLS verification", () => {
  const raw = clone(fixtureRaw); raw.transport.clientTlsHostnameVerified = false;
  validate(clone(fixtureRecord), raw);
});
expectFailure("route mTLS", () => {
  const raw = clone(fixtureRaw); raw.transport.routeMutualTlsVerified = false;
  validate(clone(fixtureRecord), raw);
});
expectFailure("stream replicas", () => {
  const raw = clone(fixtureRaw); raw.stream.replicas = 2;
  validate(clone(fixtureRecord), raw);
});
expectFailure("runtime stream management", () => {
  const raw = clone(fixtureRaw); raw.stream.runtimeManageStream = true;
  validate(clone(fixtureRecord), raw);
});
expectFailure("publish acknowledgement", () => {
  const raw = clone(fixtureRaw); raw.load.acknowledgedMessages -= 1;
  validate(clone(fixtureRecord), raw);
});
expectFailure("delivery reconciliation", () => {
  const raw = clone(fixtureRaw); raw.load.receivedDeliveries -= 1;
  validate(clone(fixtureRecord), raw);
});
expectFailure("byte reconciliation", () => {
  const raw = clone(fixtureRaw); raw.load.deliveredBytes -= 1;
  validate(clone(fixtureRecord), raw);
});
expectFailure("achieved throughput", () => {
  const raw = clone(fixtureRaw); raw.load.achievedMessagesPerSecond = 324;
  validate(clone(fixtureRecord), raw);
});
expectFailure("publish latency budget", () => {
  const raw = clone(fixtureRaw); raw.load.publishAckLatencyMs.p99 = 101;
  validate(clone(fixtureRecord), raw);
});
expectFailure("delivery latency budget", () => {
  const raw = clone(fixtureRaw); raw.load.endToEndDeliveryLatencyMs.p99 = 251;
  validate(clone(fixtureRecord), raw);
});
expectFailure("CPU budget", () => {
  const raw = clone(fixtureRaw); raw.load.nodeMetrics[0].cpuPctP95 = 71;
  validate(clone(fixtureRecord), raw);
});
expectFailure("slow consumer", () => {
  const raw = clone(fixtureRaw); raw.load.nodeMetrics[0].slowConsumersMax = 1;
  validate(clone(fixtureRecord), raw);
});
expectFailure("leader failure", () => {
  const raw = clone(fixtureRaw); raw.failover.failedNodeWasLeader = false;
  validate(clone(fixtureRecord), raw);
});
expectFailure("leader election budget", () => {
  const raw = clone(fixtureRaw); raw.failover.leaderElectionMs = 10001;
  validate(clone(fixtureRecord), raw);
});
expectFailure("failure-window publish loss", () => {
  const raw = clone(fixtureRaw); raw.failover.failedPublishesDuringFailure = 1;
  validate(clone(fixtureRecord), raw);
});
expectFailure("persistent restart", () => {
  const raw = clone(fixtureRaw); raw.recovery.fullClusterRestarted = false;
  validate(clone(fixtureRecord), raw);
});
expectFailure("latest sequence replay", () => {
  const raw = clone(fixtureRaw); raw.recovery.latestSequenceAfterReplay -= 1;
  validate(clone(fixtureRecord), raw);
});
expectFailure("permission denial", () => {
  const raw = clone(fixtureRaw); raw.permissions.trackerPublishDenied = false;
  validate(clone(fixtureRecord), raw);
});
expectFailure("credential rotation", () => {
  const raw = clone(fixtureRaw); raw.credentialRotation.oldTrackerRejected = false;
  validate(clone(fixtureRecord), raw);
});
expectFailure("monitoring scrape", () => {
  const raw = clone(fixtureRaw); raw.monitoring.allNodesScraped = false;
  validate(clone(fixtureRecord), raw);
});
expectFailure("monitoring samples", () => {
  const raw = clone(fixtureRaw); raw.monitoring.samplesPerNode = 0;
  validate(clone(fixtureRecord), raw);
});
expectFailure("monitoring growth", () => {
  const raw = clone(fixtureRaw); raw.monitoring.storageGrowthBytes += 1;
  validate(clone(fixtureRecord), raw);
});
expectFailure("raw symlink", () => {
  const targetDirectory = mkdtempSync(path.join(tmpdir(), "segment-bus-capacity-target-"));
  const target = path.join(targetDirectory, "raw.json");
  writeFileSync(target, `${JSON.stringify(fixtureRaw)}\n`, { mode: 0o600 });
  const record = clone(fixtureRecord);
  const file = writeCase(record, clone(fixtureRaw), { symlinkTarget: target });
  validateSegmentBusCapacityEvidence(record, file, { allowSynthetic: true, capacityPlan, budgets });
});
expectFailure("invalid raw JSON", () => {
  validate(clone(fixtureRecord), clone(fixtureRaw), { rawText: "{invalid\n" });
});

function realShape() {
  const record = clone(fixtureRecord);
  const raw = clone(fixtureRaw);
  record.synthetic = false;
  raw.synthetic = false;
  raw.completedAt = "2026-07-21T00:15:00.000Z";
  raw.durationSeconds = 900;
  raw.load.attemptedMessages = 292500;
  raw.load.acknowledgedMessages = 292500;
  raw.load.expectedDeliveries = 585000;
  raw.load.receivedDeliveries = 585000;
  raw.load.publishBytes = 58500000;
  raw.load.deliveredBytes = 117000000;
  raw.load.nodeMetrics.forEach((metric) => { metric.restarts = 1; });
  raw.monitoring.samplesPerNode = 30;
  record.reviewers.forEach((reviewer, index) => {
    reviewer.reviewedAt = `2026-07-21T00:${16 + index}:00.000Z`;
  });
  return { record, raw };
}
expectFailure("unmeasured capacity plan", () => {
  const { record, raw } = realShape();
  const file = writeCase(record, raw);
  validateSegmentBusCapacityEvidence(record, file, { allowSynthetic: false, capacityPlan, budgets });
});
expectFailure("capacity evidence path binding", () => {
  const { record, raw } = realShape();
  const file = writeCase(record, raw);
  const measuredPlan = { ...capacityPlan, segmentBusCapacityMeasurementStatus: "measured", segmentBusCapacityEvidence: "evidence/other.json" };
  validateSegmentBusCapacityEvidence(record, file, { allowSynthetic: false, capacityPlan: measuredPlan, budgets });
});

console.log(`segment bus capacity evidence smoke OK: pass=1 failures=${failures}`);
