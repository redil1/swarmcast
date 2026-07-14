import { readFileSync } from "node:fs";

const requiredChecks = [
  "auth-token-issuance",
  "auth-token-verify",
  "source-preflight",
  "catalog-search-pagination",
  "ingest-demand-segments",
  "edge-cache-miss-hit",
  "tracker-join-peer-list-signal-stats-metrics",
  "retention-health-metrics",
  "offload-dashboard-alert-query"
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

function validateEvidenceList(name, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${name} must include evidence`);
  for (const item of evidence) {
    const value = cleanString(`${name}[]`, item);
    if (sensitiveEvidencePatterns.some((pattern) => pattern.test(value))) {
      fail(`${name} evidence reference looks like it may contain sensitive source, token, or personal material`);
    }
  }
}

function validateChecks(checks) {
  if (!Array.isArray(checks)) fail("checks must be an array");
  const byId = new Map();
  const incomplete = [];
  for (const check of checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9-]+$/);
    if (byId.has(id)) fail(`duplicate production smoke check ${id}`);
    byId.set(id, check);
    cleanString(`${id}.owner`, check.owner);
    if (!validStatuses.has(check.status)) fail(`${id}.status must be pass, fail, blocked, or partial`);
    validateEvidenceList(`${id}.evidence`, check.evidence);
    if (check.status !== "pass") incomplete.push(id);
  }
  for (const id of requiredChecks) {
    if (!byId.has(id)) fail(`missing required production smoke check ${id}`);
  }
  return incomplete;
}

function validateRecord(record, file) {
  cleanString("evidenceId", record.evidenceId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  const startedAt = parseTime("startedAt", record.startedAt);
  const completedAt = parseTime("completedAt", record.completedAt);
  if (completedAt <= startedAt) fail("completedAt must be after startedAt");
  if (record.thirdPartyCdnUsed !== false) fail("thirdPartyCdnUsed must be false");
  if (record.sourceUrlsExposed !== false) fail("sourceUrlsExposed must be false");
  if (record.tokensExposed !== false) fail("tokensExposed must be false");
  if (record.synthetic && !allowSynthetic) fail("synthetic production smoke evidence requires --allow-synthetic");
  const incomplete = validateChecks(record.checks);
  if (record.environment !== "production") incomplete.push("environment");
  if (incomplete.length > 0 && !allowIncomplete && !record.synthetic) {
    fail(`production smoke evidence is incomplete for launch: ${incomplete.join(", ")}`);
  }
  const status = incomplete.length === 0 ? "launch-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Production smoke evidence OK: checks=${requiredChecks.length}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-production-smoke-evidence.js [--allow-incomplete] [--allow-synthetic] <production-smoke-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Production smoke evidence validation failed: ${error.message}`);
  process.exit(1);
}
