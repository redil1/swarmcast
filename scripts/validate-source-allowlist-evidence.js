import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowIncomplete = args.includes("--allow-incomplete");
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const validStatuses = new Set(["pass", "fail", "blocked", "partial"]);
const hostPattern = /^(\*\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i;
const disallowedHostPattern = /(^|\.)example\.|localhost|127\.0\.0\.1|0\.0\.0\.0|(^|\.)local$|(^|\.)internal$/i;
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

function nonNegativeInteger(name, value) {
  if (!Number.isInteger(value) || value < 0) fail(`${name} must be a non-negative integer`);
  return value;
}

function validateEvidenceList(name, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${name} must include evidence`);
  for (const item of evidence) {
    const value = cleanString(`${name}[]`, item);
    if (sensitiveEvidencePatterns.some((pattern) => pattern.test(value))) {
      fail(`${name} evidence reference looks like it may contain sensitive source or token material`);
    }
  }
}

function validateHosts(record) {
  if (!Array.isArray(record.approvedHosts) || record.approvedHosts.length === 0) fail("approvedHosts must be a non-empty array");
  const seen = new Set();
  for (const host of record.approvedHosts) {
    const normalized = cleanString("approvedHosts[]", host, hostPattern).toLowerCase();
    if (normalized === "*" || normalized === "*.*" || normalized.includes("..")) fail(`approvedHosts[] has unsafe host ${host}`);
    if (disallowedHostPattern.test(normalized)) fail(`approvedHosts[] contains placeholder or local host ${host}`);
    if (seen.has(normalized)) fail(`duplicate approved host ${host}`);
    seen.add(normalized);
  }
  if (record.privateNetworksAllowed !== false) fail("privateNetworksAllowed must be false");
  if (record.catchAllWildcardAllowed !== false) fail("catchAllWildcardAllowed must be false");
  cleanString("approvedBy", record.approvedBy);
  cleanString("approvalRef", record.approvalRef);
}

function validateCommandCheck(name, check, commandFragment) {
  if (!check || typeof check !== "object" || Array.isArray(check)) fail(`${name} is required`);
  const command = cleanString(`${name}.command`, check.command);
  if (!command.includes(commandFragment)) fail(`${name}.command must include ${commandFragment}`);
  if (!validStatuses.has(check.status)) fail(`${name}.status must be pass, fail, blocked, or partial`);
  validateEvidenceList(`${name}.evidence`, check.evidence);
  return check.status === "pass" ? [] : [name];
}

function validatePreflight(preflight) {
  if (!preflight || typeof preflight !== "object" || Array.isArray(preflight)) fail("sourcePreflight is required");
  const incomplete = validateCommandCheck("sourcePreflight", preflight, "source:preflight");
  const total = nonNegativeInteger("sourcePreflight.total", preflight.total);
  const healthy = nonNegativeInteger("sourcePreflight.healthy", preflight.healthy);
  const failed = nonNegativeInteger("sourcePreflight.failed", preflight.failed);
  if (total === 0) fail("sourcePreflight.total must be greater than 0");
  if (healthy + failed !== total) fail("sourcePreflight healthy + failed must equal total");
  if (failed !== 0) incomplete.push("sourcePreflight.failed");
  if (preflight.rawSourceUrlsExposed !== false) fail("sourcePreflight.rawSourceUrlsExposed must be false");
  if (preflight.privateNetworkSourcesRejected !== true) fail("sourcePreflight.privateNetworkSourcesRejected must be true");
  if (preflight.credentialedSourcesRejected !== true) fail("sourcePreflight.credentialedSourcesRejected must be true");
  validateEvidenceList("sourcePreflight.evidence", preflight.evidence);
  return incomplete;
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) fail("catalogImport is required");
  const total = nonNegativeInteger("catalogImport.channelCount", catalog.channelCount);
  if (total === 0) fail("catalogImport.channelCount must be greater than 0");
  if (catalog.publicCatalogStripsSourceUrls !== true) fail("catalogImport.publicCatalogStripsSourceUrls must be true");
  if (catalog.stableIdsGenerated !== true) fail("catalogImport.stableIdsGenerated must be true");
  validateEvidenceList("catalogImport.evidence", catalog.evidence);
}

function validateRecord(record, file) {
  cleanString("evidenceId", record.evidenceId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  const startedAt = parseTime("startedAt", record.startedAt);
  const completedAt = parseTime("completedAt", record.completedAt);
  if (completedAt <= startedAt) fail("completedAt must be after startedAt");
  if (record.synthetic && !allowSynthetic) fail("synthetic source allowlist evidence requires --allow-synthetic");
  validateHosts(record);
  const incomplete = [
    ...validateCommandCheck("productionEnvValidation", record.productionEnvValidation, "env:production:validate"),
    ...validatePreflight(record.sourcePreflight)
  ];
  validateCatalog(record.catalogImport);
  if (record.environment !== "production") incomplete.push("environment");
  if (incomplete.length > 0 && !allowIncomplete && !record.synthetic) {
    fail(`source allowlist evidence is incomplete for launch: ${incomplete.join(", ")}`);
  }
  const status = incomplete.length === 0 ? "launch-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Source allowlist evidence OK: hosts=${record.approvedHosts.length}, channels=${record.catalogImport.channelCount}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-source-allowlist-evidence.js [--allow-incomplete] [--allow-synthetic] <source-allowlist-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Source allowlist evidence validation failed: ${error.message}`);
  process.exit(1);
}
