import { readFileSync } from "node:fs";

const requiredAssets = [
  "auth-keys",
  "control-plane-placement",
  "catalog-snapshot",
  "monitoring-config",
  "nginx-config",
  "retention-config",
  "release-images"
];
const requiredChecks = [
  "auth-jwks",
  "auth-token-verify",
  "source-preflight",
  "placement-restart",
  "alertmanager-routing",
  "retention-dry-run",
  "post-restore-smokes"
];
const args = process.argv.slice(2);
const allowIncomplete = args.includes("--allow-incomplete");
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const validStatuses = new Set(["pass", "fail", "blocked", "partial"]);
const sensitiveEvidencePatterns = [
  /token=/i,
  /jwt=/i,
  /bearer\s+/i,
  /sourceurl/i,
  /source_url/i,
  /\.m3u8(?:\?|$)/i,
  /-----BEGIN/i
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
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${name} must be a non-negative number`);
  }
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

function validateAssets(record) {
  if (!Array.isArray(record.assets)) fail("assets must be an array");
  const byId = new Map();
  for (const asset of record.assets) {
    const id = cleanString("asset.id", asset.id, /^[a-z0-9-]+$/);
    if (byId.has(id)) fail(`duplicate asset ${id}`);
    byId.set(id, asset);
    cleanString(`${id}.snapshotId`, asset.snapshotId);
    cleanString(`${id}.checksum`, asset.checksum, /^sha256:[a-fA-F0-9]{64}$/);
    if (asset.restored !== true) fail(`${id}.restored must be true`);
  }
  for (const id of requiredAssets) {
    if (!byId.has(id)) fail(`missing required asset ${id}`);
  }
}

function validateChecks(record) {
  if (!Array.isArray(record.checks)) fail("checks must be an array");
  const byId = new Map();
  const incomplete = [];
  for (const check of record.checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9-]+$/);
    if (byId.has(id)) fail(`duplicate check ${id}`);
    byId.set(id, check);
    cleanString(`${id}.owner`, check.owner);
    if (!validStatuses.has(check.status)) fail(`${id}.status must be pass, fail, blocked, or partial`);
    validateEvidenceList(`${id}.evidence`, check.evidence);
    if (check.status !== "pass") incomplete.push(id);
  }
  for (const id of requiredChecks) {
    if (!byId.has(id)) fail(`missing required check ${id}`);
  }
  if (incomplete.length > 0 && !allowIncomplete) {
    fail(`restore evidence has incomplete checks: ${incomplete.join(", ")}`);
  }
  return incomplete;
}

function validateRecord(record, file) {
  cleanString("drillId", record.drillId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^staging$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  const startedAt = parseTime("startedAt", record.startedAt);
  const completedAt = parseTime("completedAt", record.completedAt);
  if (completedAt <= startedAt) fail("completedAt must be after startedAt");
  nonNegativeNumber("rtoSeconds", record.rtoSeconds);
  nonNegativeNumber("rpoSeconds", record.rpoSeconds);
  if (record.synthetic && !allowSynthetic) fail("synthetic restore evidence requires --allow-synthetic");

  validateAssets(record);
  const incomplete = validateChecks(record);
  const status = incomplete.length === 0 ? "restore-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Restore evidence OK: assets=${requiredAssets.length}, checks=${requiredChecks.length}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-restore-evidence.js [--allow-incomplete] [--allow-synthetic] <restore-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Restore evidence validation failed: ${error.message}`);
  process.exit(1);
}
