import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const files = args.filter((arg) => !arg.startsWith("--"));

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

function validateCapacityPlan(file) {
  const plan = JSON.parse(readFileSync(file, "utf8"));
  const reviewDate = String(plan.reviewDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) fail("reviewDate must use YYYY-MM-DD");

  const peakConcurrentViewers = integerField(plan, "peakConcurrentViewers", { min: 1 });
  const averageBitrateMbps = numberField(plan, "averageBitrateMbps", { min: 0.1 });
  const measuredOffloadRatio = numberField(plan, "measuredOffloadRatio", { min: 0, max: 1 });
  const selfSustainingSuperPeerFraction = numberField(plan, "selfSustainingSuperPeerFraction", { min: 0.01, max: 1 });
  integerField(plan, "helperUploadPacketsPerSegment", { min: 1 });
  stringField(plan, "superPeerSweepEvidence", /^[A-Za-z0-9._/-]+$/);
  const edgeCacheHitRatio = numberField(plan, "edgeCacheHitRatio", { min: 0, max: 1 });
  const activeChannelsPeak = integerField(plan, "activeChannelsPeak", { min: 1 });
  const edgeNodeCapacityMbps = numberField(plan, "edgeNodeCapacityMbps", { min: 1 });
  const originNodeCapacityChannels = integerField(plan, "originNodeCapacityChannels", { min: 1 });
  const headroomRatio = numberField(plan, "headroomRatio", { min: 0.1, max: 2 });
  const plannedEdgeNodes = integerField(plan, "plannedEdgeNodes", { min: 1 });
  const plannedOriginNodes = integerField(plan, "plannedOriginNodes", { min: 1 });

  if (measuredOffloadRatio < 0.9) fail("measuredOffloadRatio must be at least 0.90 before launch");
  if (selfSustainingSuperPeerFraction > 0.25) {
    fail("selfSustainingSuperPeerFraction must be at or below 0.25 before launch");
  }
  if (edgeCacheHitRatio < 0.8) fail("edgeCacheHitRatio must be at least 0.80 before launch");

  const viewerTrafficMbps = peakConcurrentViewers * averageBitrateMbps;
  const edgeDeliveryMbps = viewerTrafficMbps * (1 - measuredOffloadRatio);
  const originFillMbps = edgeDeliveryMbps * (1 - edgeCacheHitRatio);
  const requiredEdgeNodes = Math.ceil((edgeDeliveryMbps * (1 + headroomRatio)) / edgeNodeCapacityMbps);
  const requiredOriginNodes = Math.ceil((activeChannelsPeak * (1 + headroomRatio)) / originNodeCapacityChannels);

  if (plannedEdgeNodes < requiredEdgeNodes) {
    fail(`plannedEdgeNodes ${plannedEdgeNodes} is below required ${requiredEdgeNodes}`);
  }
  if (plannedOriginNodes < requiredOriginNodes) {
    fail(`plannedOriginNodes ${plannedOriginNodes} is below required ${requiredOriginNodes}`);
  }

  return `${file}: Capacity plan OK: edgeDelivery=${edgeDeliveryMbps.toFixed(1)}Mbps originFill=${originFillMbps.toFixed(1)}Mbps superPeerFlatten=${(selfSustainingSuperPeerFraction * 100).toFixed(1)}% edgeNodes=${plannedEdgeNodes}/${requiredEdgeNodes} originNodes=${plannedOriginNodes}/${requiredOriginNodes}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-capacity-plan.js <capacity-plan.json> [...]");
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
