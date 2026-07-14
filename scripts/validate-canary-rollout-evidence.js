import { readFileSync } from "node:fs";

const requiredStages = ["internal", "one-percent", "five-percent", "twenty-five-percent", "full-public"];
const requiredChecks = [
  "canary-metrics-validated",
  "android-rollout-control-ready",
  "rollback-halt-tested",
  "edge-egress-budget-reviewed",
  "alerts-clear",
  "support-monitoring-ready",
  "no-third-party-cdn"
];
const requiredStageEvidenceMarkers = [
  "canary:metrics:validate",
  "peerTimeouts5m",
  "peerHashFailures5m=0",
  "peerDisconnects5m=0"
];

const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const allowIncomplete = args.includes("--allow-incomplete");
const files = args.filter((arg) => !arg.startsWith("--"));
const sensitiveEvidencePatterns = [
  /bearer\s+/i,
  /token=/i,
  /secret=/i,
  /password=/i,
  /api[_-]?key=/i,
  /sourceurl/i,
  /source_url/i,
  /\.m3u8(?:\?|$)/i
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

function validateEvidenceList(name, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${name} must include evidence`);
  for (const item of evidence) {
    const value = cleanString(`${name}[]`, item);
    if (sensitiveEvidencePatterns.some((pattern) => pattern.test(value))) {
      fail(`${name} evidence reference looks like it may contain sensitive material`);
    }
  }
}

function validateStage(stage) {
  const id = cleanString("stage.id", stage.id, /^[a-z0-9][a-z0-9-]*$/);
  const cohortPercent = Number(stage.cohortPercent);
  if (!Number.isFinite(cohortPercent) || cohortPercent < 0 || cohortPercent > 100) {
    fail(`${id}.cohortPercent must be between 0 and 100`);
  }
  const startedAt = parseTime(`${id}.startedAt`, stage.startedAt);
  const completedAt = parseTime(`${id}.completedAt`, stage.completedAt);
  if (completedAt <= startedAt) fail(`${id}.completedAt must be after startedAt`);
  if (!["pass", "fail", "blocked", "partial"].includes(stage.status)) {
    fail(`${id}.status must be pass, fail, blocked, or partial`);
  }
  if (stage.alertState !== "clear") fail(`${id}.alertState must be clear`);
  if (stage.rollbackAvailable !== true) fail(`${id}.rollbackAvailable must be true`);
  validateEvidenceList(`${id}.evidence`, stage.evidence);
  const joinedEvidence = stage.evidence.join("\n");
  for (const marker of requiredStageEvidenceMarkers) {
    if (!joinedEvidence.includes(marker)) fail(`${id}.evidence must include ${marker}`);
  }
  return stage.status === "pass" ? null : id;
}

function validateChecks(checks) {
  if (!Array.isArray(checks)) fail("checks must be an array");
  const byId = new Map();
  const incomplete = [];
  for (const check of checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9][a-z0-9-]*$/);
    if (byId.has(id)) fail(`duplicate canary rollout check ${id}`);
    byId.set(id, check);
    cleanString(`${id}.owner`, check.owner);
    if (!["pass", "fail", "blocked", "partial"].includes(check.status)) {
      fail(`${id}.status must be pass, fail, blocked, or partial`);
    }
    validateEvidenceList(`${id}.evidence`, check.evidence);
    if (check.status !== "pass") incomplete.push(id);
  }
  for (const id of requiredChecks) {
    if (!byId.has(id)) fail(`missing required canary rollout check ${id}`);
  }
  return incomplete;
}

function validateRecord(record, file) {
  cleanString("rolloutId", record.rolloutId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  parseTime("reviewedAt", record.reviewedAt);
  if (record.thirdPartyCdnUsed !== false) fail("thirdPartyCdnUsed must be false");
  if (record.synthetic && !allowSynthetic) fail("synthetic canary rollout evidence requires --allow-synthetic");
  if (!Array.isArray(record.stages)) fail("stages must be an array");
  const byId = new Map();
  const incomplete = [];
  for (const stage of record.stages) {
    const id = cleanString("stage.id", stage.id, /^[a-z0-9][a-z0-9-]*$/);
    if (byId.has(id)) fail(`duplicate canary rollout stage ${id}`);
    byId.set(id, stage);
    const stageIncomplete = validateStage(stage);
    if (stageIncomplete) incomplete.push(stageIncomplete);
  }
  for (const id of requiredStages) {
    if (!byId.has(id)) fail(`missing required canary rollout stage ${id}`);
  }
  incomplete.push(...validateChecks(record.checks));
  if (record.environment !== "production") incomplete.push("environment");
  if (incomplete.length > 0 && !allowIncomplete && !record.synthetic) {
    fail(`canary rollout evidence is incomplete for launch: ${incomplete.join(", ")}`);
  }
  const status = incomplete.length === 0 ? "launch-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Canary rollout evidence OK: stages=${requiredStages.length}, checks=${requiredChecks.length}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-canary-rollout-evidence.js [--allow-incomplete] [--allow-synthetic] <canary-rollout-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Canary rollout evidence validation failed: ${error.message}`);
  process.exit(1);
}
