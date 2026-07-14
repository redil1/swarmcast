import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const requiredDrills = [
  "tracker-restart-android-playback",
  "ffmpeg-worker-crash",
  "edge-node-failover",
  "ingest-node-failover",
  "control-plane-restart",
  "multi-service-recovery",
  "peer-health-incident"
];
const sensitiveEvidencePatterns = [
  /token=/i,
  /jwt=/i,
  /bearer\s+/i,
  /sourceurl/i,
  /source_url/i,
  /\.m3u8(?:\?|$)/i,
  /-----BEGIN/i,
  /password=/i,
  /email=/i
];

function fail(message) {
  throw new Error(message);
}

function cleanString(name, value, pattern) {
  if (typeof value !== "string" || value.trim() === "") fail(`${name} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) fail(`${name} has invalid format`);
  return normalized;
}

function parseTime(name, value) {
  const normalized = cleanString(name, value);
  const time = Date.parse(normalized);
  if (Number.isNaN(time)) fail(`${name} must be ISO-8601 parseable`);
  return time;
}

function nonNegativeNumber(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${name} must be a non-negative number`);
}

function validateEvidenceList(name, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${name} must include evidence`);
  for (const item of evidence) {
    const value = cleanString(`${name}[]`, item);
    if (sensitiveEvidencePatterns.some((pattern) => pattern.test(value))) {
      fail(`${name} evidence reference looks like it may contain sensitive material`);
    }
  }
}

function validateDrill(drill) {
  const id = cleanString("drill.id", drill.id, /^[a-z0-9-]+$/);
  if (!requiredDrills.includes(id)) fail(`unexpected chaos drill ${id}`);
  if (drill.status !== "pass") fail(`${id}.status must pass`);
  cleanString(`${id}.owner`, drill.owner);
  cleanString(`${id}.command`, drill.command);
  cleanString(`${id}.target`, drill.target, /^[a-z0-9-]+$/);
  const startedAt = parseTime(`${id}.startedAt`, drill.startedAt);
  const completedAt = parseTime(`${id}.completedAt`, drill.completedAt);
  if (completedAt <= startedAt) fail(`${id}.completedAt must be after startedAt`);
  if (drill.alertObserved !== true) fail(`${id}.alertObserved must be true`);
  if (drill.recovered !== true) fail(`${id}.recovered must be true`);
  if (drill.noCascade !== true) fail(`${id}.noCascade must be true`);
  if (drill.thirdPartyCdnUsed !== false) fail(`${id}.thirdPartyCdnUsed must be false`);
  if (drill.dataLoss !== false) fail(`${id}.dataLoss must be false`);
  cleanString(`${id}.customerImpact`, drill.customerImpact, /^(none|bounded)$/);
  nonNegativeNumber(`${id}.recoverySeconds`, drill.recoverySeconds);
  validateEvidenceList(`${id}.evidence`, drill.evidence);
  const joinedEvidence = drill.evidence.join("\n");
  if (["tracker-restart-android-playback", "edge-node-failover", "ingest-node-failover", "multi-service-recovery"].includes(id) && !joinedEvidence.includes("android-playback-continuity")) {
    fail(`${id}.evidence must include android-playback-continuity`);
  }
  if (["edge-node-failover", "multi-service-recovery"].includes(id) && !joinedEvidence.includes("owned-edge-failover")) {
    fail(`${id}.evidence must include owned-edge-failover`);
  }
  if (["ingest-node-failover", "multi-service-recovery"].includes(id) && !joinedEvidence.includes("placement-failover")) {
    fail(`${id}.evidence must include placement-failover`);
  }
  if (id === "control-plane-restart" && !joinedEvidence.includes("durable-placement-restore")) {
    fail(`${id}.evidence must include durable-placement-restore`);
  }
  if (id === "peer-health-incident" && !joinedEvidence.includes("docs/runbooks/peer-health.md")) {
    fail(`${id}.evidence must include docs/runbooks/peer-health.md`);
  }
  if (id === "peer-health-incident" && !joinedEvidence.includes("SwarmcastPeerHashFailures")) {
    fail(`${id}.evidence must include SwarmcastPeerHashFailures`);
  }
  return id;
}

function validateRecord(record, file) {
  cleanString("drillId", record.drillId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^staging$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  if (record.synthetic && !allowSynthetic) fail("synthetic staging chaos evidence requires --allow-synthetic");
  if (!Array.isArray(record.drills)) fail("drills must be an array");
  const seen = new Set();
  for (const drill of record.drills) {
    const id = validateDrill(drill);
    if (seen.has(id)) fail(`duplicate chaos drill ${id}`);
    seen.add(id);
  }
  for (const id of requiredDrills) {
    if (!seen.has(id)) fail(`missing required staging chaos drill ${id}`);
  }
  return `${file}: Staging chaos evidence OK: drills=${seen.size}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-staging-chaos-evidence.js [--allow-synthetic] <staging-chaos-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Staging chaos evidence validation failed: ${error.message}`);
  process.exit(1);
}
