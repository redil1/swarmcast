import { readFileSync } from "node:fs";

const requiredServices = [
  "auth",
  "ingest",
  "tracker",
  "control-plane",
  "retention-worker"
];
const requiredPreflightChecks = [
  "freeze-deployments",
  "previous-stable-images",
  "backup-or-restore-coverage",
  "release-images-check",
  "compose-config-rendered"
];
const requiredCommands = [
  "pull-previous-images",
  "up-no-build",
  "service-ps"
];
const requiredPostChecks = [
  "auth-token-verify",
  "source-preflight",
  "catalog-channels",
  "catalog-groups",
  "ingest-demand-segments",
  "tracker-join-signal-stats-metrics",
  "edge-cache-miss-hit",
  "retention-health-metrics",
  "dashboard-snapshot",
  "android-release-halt-ready",
  "app-incident-delivery-fleet-only",
  "tail-edge-only-mode"
];
const args = process.argv.slice(2);
const allowIncomplete = args.includes("--allow-incomplete");
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const validStatuses = new Set(["pass", "fail", "blocked", "partial"]);
const digestImagePattern = /^[a-z0-9][a-z0-9._/-]+@[sS][hH][aA]256:[a-fA-F0-9]{64}$/;
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
  return value;
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

function validateImageSet(name, images) {
  if (!images || typeof images !== "object" || Array.isArray(images)) fail(`${name} must be an object`);
  for (const service of requiredServices) {
    cleanString(`${name}.${service}`, images[service], digestImagePattern);
  }
}

function validateDistinctRollbackImages(record) {
  for (const service of requiredServices) {
    if (record.currentImages[service] === record.rollbackImages[service]) {
      fail(`${service} rollback image must differ from current image`);
    }
  }
}

function validateChecks(name, checks, requiredIds) {
  if (!Array.isArray(checks)) fail(`${name} must be an array`);
  const byId = new Map();
  const incomplete = [];
  for (const check of checks) {
    const id = cleanString(`${name}.id`, check.id, /^[a-z0-9-]+$/);
    if (byId.has(id)) fail(`duplicate ${name} check ${id}`);
    byId.set(id, check);
    cleanString(`${id}.owner`, check.owner);
    if (!validStatuses.has(check.status)) fail(`${id}.status must be pass, fail, blocked, or partial`);
    validateEvidenceList(`${id}.evidence`, check.evidence);
    if (check.status !== "pass") incomplete.push(id);
  }
  for (const id of requiredIds) {
    if (!byId.has(id)) fail(`missing required ${name} check ${id}`);
  }
  return incomplete;
}

function validateCommands(record) {
  if (!Array.isArray(record.commands)) fail("commands must be an array");
  const byId = new Map();
  const incomplete = [];
  for (const command of record.commands) {
    const id = cleanString("command.id", command.id, /^[a-z0-9-]+$/);
    if (byId.has(id)) fail(`duplicate command ${id}`);
    byId.set(id, command);
    cleanString(`${id}.command`, command.command);
    if (id === "up-no-build" && !command.command.includes("up -d --no-build")) {
      fail("up-no-build command must use up -d --no-build");
    }
    if (/\bdocker\s+build\b|\bcompose\s+build\b|\bup\b.*\s--build\b/.test(command.command)) {
      fail(`${id}.command must not build images during rollback`);
    }
    if (!validStatuses.has(command.status)) fail(`${id}.status must be pass, fail, blocked, or partial`);
    if (command.status !== "pass") incomplete.push(id);
    validateEvidenceList(`${id}.evidence`, command.evidence);
  }
  for (const id of requiredCommands) {
    if (!byId.has(id)) fail(`missing required rollback command ${id}`);
  }
  return incomplete;
}

function validateRecord(record, file) {
  cleanString("drillId", record.drillId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^staging$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("currentVersion", record.currentVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("rollbackVersion", record.rollbackVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  if (record.currentVersion === record.rollbackVersion) fail("rollbackVersion must differ from currentVersion");
  const startedAt = parseTime("startedAt", record.startedAt);
  const completedAt = parseTime("completedAt", record.completedAt);
  if (completedAt <= startedAt) fail("completedAt must be after startedAt");
  nonNegativeNumber("rtoSeconds", record.rtoSeconds);
  if (record.rtoSeconds > Math.ceil((completedAt - startedAt) / 1000)) fail("rtoSeconds cannot exceed drill duration");
  cleanString("reason", record.reason);
  cleanString("decision", record.decision, /^(keep-rollback|retry-deploy|open-incident)$/);
  if (record.noThirdPartyCdnFallback !== true) fail("noThirdPartyCdnFallback must be true");
  if (record.dataLoss !== false) fail("dataLoss must be false");
  if (record.synthetic && !allowSynthetic) fail("synthetic rollback evidence requires --allow-synthetic");

  validateImageSet("currentImages", record.currentImages);
  validateImageSet("rollbackImages", record.rollbackImages);
  validateDistinctRollbackImages(record);
  const incomplete = [
    ...validateChecks("preflightChecks", record.preflightChecks, requiredPreflightChecks),
    ...validateCommands(record),
    ...validateChecks("postRollbackChecks", record.postRollbackChecks, requiredPostChecks)
  ];
  if (incomplete.length > 0 && !allowIncomplete) fail(`rollback evidence has incomplete checks: ${incomplete.join(", ")}`);
  const status = incomplete.length === 0 ? "rollback-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Rollback evidence OK: services=${requiredServices.length}, postChecks=${requiredPostChecks.length}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-rollback-evidence.js [--allow-incomplete] [--allow-synthetic] <rollback-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Rollback evidence validation failed: ${error.message}`);
  process.exit(1);
}
