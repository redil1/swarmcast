import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowDraft = args.includes("--allow-draft");
const files = args.filter((arg) => !arg.startsWith("--"));
const nonProductionEvidencePattern = /(?:^|[./_-])(pending|synthetic|modeled)(?:[./_-]|$)/i;

function fail(message) {
  throw new Error(message);
}

function numberField(plan, key, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const value = plan[key];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${key} must be a finite number`);
  if (value < min || value > max) fail(`${key} must be between ${min} and ${max}`);
  return value;
}

function integerField(plan, key, options = {}) {
  const value = numberField(plan, key, options);
  if (!Number.isInteger(value)) fail(`${key} must be an integer`);
  return value;
}

function stringField(plan, key, pattern) {
  const value = plan[key];
  if (typeof value !== "string" || value.trim() === "") fail(`${key} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) fail(`${key} has invalid format`);
  if (/token=|jwt=|bearer\s+|sourceurl|source_url|\.m3u8(?:\?|$)|-----BEGIN|password=|email=/i.test(normalized)) {
    fail(`${key} looks like it may contain sensitive material`);
  }
  return normalized;
}

function requireProductionEvidence(name, value) {
  if (nonProductionEvidencePattern.test(value)) fail(`${name} must reference non-synthetic completed evidence`);
}

function validateSensitivity(plan, averageBitrateMbps, edgeNodeCapacityMbps, headroomRatio) {
  const peakViewers = integerField(plan, "sensitivityPeakConcurrentViewers", { min: 1000000 });
  if (!Array.isArray(plan.offloadSensitivity)) fail("offloadSensitivity must be an array");
  const rows = new Map();
  for (const [index, row] of plan.offloadSensitivity.entries()) {
    if (!row || typeof row !== "object") fail(`offloadSensitivity[${index}] must be an object`);
    const ratio = numberField(row, "directP2pOffloadRatio", { min: 0, max: 1 });
    const key = ratio.toFixed(2);
    if (rows.has(key)) fail(`offloadSensitivity contains duplicate ratio ${key}`);
    const ownedDeliveryMbps = numberField(row, "ownedDeliveryMbps", { min: 0 });
    const requiredEdgeNodes = integerField(row, "requiredEdgeNodes", { min: 1 });
    const computedDelivery = peakViewers * averageBitrateMbps * (1 - ratio);
    const computedNodes = Math.ceil((computedDelivery * (1 + headroomRatio)) / edgeNodeCapacityMbps);
    if (Math.abs(ownedDeliveryMbps - computedDelivery) > 0.1) {
      fail(`offloadSensitivity ${key} ownedDeliveryMbps is inconsistent`);
    }
    if (requiredEdgeNodes !== computedNodes) fail(`offloadSensitivity ${key} requiredEdgeNodes must equal ${computedNodes}`);
    rows.set(key, requiredEdgeNodes);
  }
  for (const ratio of [0.99, 0.9, 0.7, 0.5]) {
    if (!rows.has(ratio.toFixed(2))) fail(`offloadSensitivity missing ratio ${ratio.toFixed(2)}`);
  }
  return rows;
}

function validateCapacityPlan(file) {
  const plan = JSON.parse(readFileSync(file, "utf8"));
  const reviewDate = String(plan.reviewDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) fail("reviewDate must use YYYY-MM-DD");

  const peakConcurrentViewers = integerField(plan, "peakConcurrentViewers", { min: 1 });
  const averageBitrateMbps = numberField(plan, "averageBitrateMbps", { min: 0.1 });
  const offloadMeasurementStatus = stringField(plan, "offloadMeasurementStatus", /^(modeled|measured)$/);
  const directP2pOffloadRatio = numberField(plan, "directP2pOffloadRatio", { min: 0, max: 1 });
  const offloadMeasurementEvidence = stringField(plan, "offloadMeasurementEvidence", /^[A-Za-z0-9._/-]+$/);
  const selfSustainingSuperPeerFraction = numberField(plan, "selfSustainingSuperPeerFraction", { min: 0.01, max: 1 });
  integerField(plan, "helperUploadPacketsPerSegment", { min: 1 });
  const superPeerSweepEvidence = stringField(plan, "superPeerSweepEvidence", /^[A-Za-z0-9._/-]+$/);
  const edgeCacheHitRatio = numberField(plan, "edgeCacheHitRatio", { min: 0, max: 1 });
  const activeChannelsPeak = integerField(plan, "activeChannelsPeak", { min: 1 });
  const segmentDurationSeconds = integerField(plan, "segmentDurationSeconds", { min: 1, max: 30 });
  const segmentBusCapacityMeasurementStatus = stringField(plan, "segmentBusCapacityMeasurementStatus", /^(pending|measured)$/);
  const segmentBusTargetMessagesPerSecond = integerField(plan, "segmentBusTargetMessagesPerSecond", { min: 1 });
  const segmentBusCapacityEvidence = stringField(plan, "segmentBusCapacityEvidence", /^[A-Za-z0-9._/-]+$/);
  const edgeNodeCapacityMeasurementStatus = stringField(plan, "edgeNodeCapacityMeasurementStatus", /^(conservative-assumption|measured)$/);
  const edgeNodeLinkCapacityMbps = numberField(plan, "edgeNodeLinkCapacityMbps", { min: 1 });
  const edgeNodeSustainedUtilizationRatio = numberField(plan, "edgeNodeSustainedUtilizationRatio", { min: 0.1, max: 0.9 });
  const edgeNodeCapacityMbps = numberField(plan, "edgeNodeCapacityMbps", { min: 1 });
  const edgeNodeCapacityEvidence = stringField(plan, "edgeNodeCapacityEvidence", /^[A-Za-z0-9._/-]+$/);
  const providerTrafficTermsEvidence = stringField(plan, "providerTrafficTermsEvidence", /^[A-Za-z0-9._/-]+$/);
  const originNodeCapacityChannels = integerField(plan, "originNodeCapacityChannels", { min: 1 });
  const headroomRatio = numberField(plan, "headroomRatio", { min: 0.3, max: 2 });
  const plannedEdgeNodes = integerField(plan, "plannedEdgeNodes", { min: 1 });
  const plannedOriginNodes = integerField(plan, "plannedOriginNodes", { min: 1 });
  const segmentBusProjectedMessagesPerSecond = Math.ceil(activeChannelsPeak / segmentDurationSeconds);
  const requiredSegmentBusMessagesPerSecond = Math.ceil(segmentBusProjectedMessagesPerSecond * (1 + headroomRatio));

  if (plan.relayEgressIncluded !== true) fail("relayEgressIncluded must be true");
  if (edgeNodeCapacityMbps > edgeNodeLinkCapacityMbps * edgeNodeSustainedUtilizationRatio) {
    fail("edgeNodeCapacityMbps exceeds the sustained link utilization budget");
  }
  if (selfSustainingSuperPeerFraction > 0.25) {
    fail("selfSustainingSuperPeerFraction must be at or below 0.25 before launch");
  }
  if (edgeCacheHitRatio < 0.8) fail("edgeCacheHitRatio must be at least 0.80 before launch");
  if (segmentBusTargetMessagesPerSecond < requiredSegmentBusMessagesPerSecond) {
    fail(`segmentBusTargetMessagesPerSecond ${segmentBusTargetMessagesPerSecond} is below required ${requiredSegmentBusMessagesPerSecond}`);
  }

  if (!allowDraft) {
    if (offloadMeasurementStatus !== "measured") fail("offloadMeasurementStatus must be measured before launch");
    if (directP2pOffloadRatio < 0.9) fail("directP2pOffloadRatio must be at least 0.90 before launch");
    requireProductionEvidence("offloadMeasurementEvidence", offloadMeasurementEvidence);
    requireProductionEvidence("superPeerSweepEvidence", superPeerSweepEvidence);
    if (edgeNodeCapacityMeasurementStatus !== "measured") {
      fail("edgeNodeCapacityMeasurementStatus must be measured before launch");
    }
    requireProductionEvidence("edgeNodeCapacityEvidence", edgeNodeCapacityEvidence);
    if (segmentBusCapacityMeasurementStatus !== "measured") {
      fail("segmentBusCapacityMeasurementStatus must be measured before launch");
    }
    requireProductionEvidence("segmentBusCapacityEvidence", segmentBusCapacityEvidence);
    if (plan.providerTrafficTermsApproved !== true) fail("providerTrafficTermsApproved must be true before launch");
    requireProductionEvidence("providerTrafficTermsEvidence", providerTrafficTermsEvidence);
  } else if (typeof plan.providerTrafficTermsApproved !== "boolean") {
    fail("providerTrafficTermsApproved must be a boolean");
  }

  const viewerTrafficMbps = peakConcurrentViewers * averageBitrateMbps;
  const ownedDeliveryMbps = viewerTrafficMbps * (1 - directP2pOffloadRatio);
  const originFillMbps = ownedDeliveryMbps * (1 - edgeCacheHitRatio);
  const requiredEdgeNodes = Math.ceil((ownedDeliveryMbps * (1 + headroomRatio)) / edgeNodeCapacityMbps);
  const requiredOriginNodes = Math.ceil((activeChannelsPeak * (1 + headroomRatio)) / originNodeCapacityChannels);

  if (plannedEdgeNodes < requiredEdgeNodes) {
    fail(`plannedEdgeNodes ${plannedEdgeNodes} is below required ${requiredEdgeNodes}`);
  }
  if (plannedOriginNodes < requiredOriginNodes) {
    fail(`plannedOriginNodes ${plannedOriginNodes} is below required ${requiredOriginNodes}`);
  }

  const sensitivity = validateSensitivity(plan, averageBitrateMbps, edgeNodeCapacityMbps, headroomRatio);
  const mode = allowDraft ? "draft" : "launch";
  return `${file}: Capacity plan OK (${mode}): ownedDelivery=${ownedDeliveryMbps.toFixed(1)}Mbps originFill=${originFillMbps.toFixed(1)}Mbps segmentBus=${segmentBusTargetMessagesPerSecond}/${requiredSegmentBusMessagesPerSecond}msgps superPeerFlatten=${(selfSustainingSuperPeerFraction * 100).toFixed(1)}% edgeNodes=${plannedEdgeNodes}/${requiredEdgeNodes} originNodes=${plannedOriginNodes}/${requiredOriginNodes} oneMillionNodes99=${sensitivity.get("0.99")} oneMillionNodes90=${sensitivity.get("0.90")} oneMillionNodes70=${sensitivity.get("0.70")} oneMillionNodes50=${sensitivity.get("0.50")}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-capacity-plan.js [--allow-draft] <capacity-plan.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    console.log(validateCapacityPlan(file));
  }
} catch (error) {
  console.error(`Capacity plan validation failed: ${error.message}`);
  process.exit(1);
}
