import { readFileSync } from "node:fs";

const requiredChecks = [
  "source-preflight-passed",
  "source-allowlist-approved",
  "snapshot-written",
  "snapshot-sanitized",
  "operator-signature-verified",
  "public-catalog-smoke",
  "rollback-snapshot-ready"
];

const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const allowIncomplete = args.includes("--allow-incomplete");
const files = args.filter((arg) => !arg.startsWith("--"));
const validStatuses = new Set(["pass", "fail", "blocked", "partial"]);
const signatureAlgorithms = new Set(["minisign", "cosign", "gpg"]);
const sensitiveEvidencePatterns = [
  /bearer\s+/i,
  /token=/i,
  /jwt=/i,
  /secret=/i,
  /password=/i,
  /api[_-]?key=/i,
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
  if (sensitiveEvidencePatterns.some((sensitivePattern) => sensitivePattern.test(normalized))) {
    fail(`${name} looks like it may contain sensitive source or token material`);
  }
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

function positiveInteger(name, value) {
  const parsed = nonNegativeInteger(name, value);
  if (parsed === 0) fail(`${name} must be greater than 0`);
  return parsed;
}

function sha256Hex(name, value) {
  return cleanString(name, value, /^[a-f0-9]{64}$/i);
}

function validateEvidenceList(name, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${name} must include evidence`);
  for (const item of evidence) cleanString(`${name}[]`, item);
}

function validateCommandCheck(name, check, commandFragment) {
  if (!check || typeof check !== "object" || Array.isArray(check)) fail(`${name} is required`);
  const command = cleanString(`${name}.command`, check.command);
  if (!command.includes(commandFragment)) fail(`${name}.command must include ${commandFragment}`);
  if (!validStatuses.has(check.status)) fail(`${name}.status must be pass, fail, blocked, or partial`);
  validateEvidenceList(`${name}.evidence`, check.evidence);
  return check.status === "pass" ? [] : [name];
}

function validateSourcePreflight(preflight) {
  const incomplete = validateCommandCheck("sourcePreflightEvidence", preflight, "source:preflight");
  const total = positiveInteger("sourcePreflightEvidence.total", preflight.total);
  const healthy = nonNegativeInteger("sourcePreflightEvidence.healthy", preflight.healthy);
  const failed = nonNegativeInteger("sourcePreflightEvidence.failed", preflight.failed);
  if (healthy + failed !== total) fail("sourcePreflightEvidence healthy + failed must equal total");
  if (failed !== 0) incomplete.push("sourcePreflightEvidence.failed");
  if (preflight.rawSourceUrlsExposed !== false) fail("sourcePreflightEvidence.rawSourceUrlsExposed must be false");
  return { total, incomplete };
}

function validateSourceAllowlist(allowlist) {
  return validateCommandCheck("sourceAllowlistEvidence", allowlist, "source:allowlist:evidence:validate");
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) fail("snapshot is required");
  if (snapshot.schemaVersion !== 1) fail("snapshot.schemaVersion must be 1");
  const snapshotPath = cleanString("snapshot.path", snapshot.path);
  if (/^https?:\/\//i.test(snapshotPath)) fail("snapshot.path must be an artifact path, not an upstream URL");
  const sha256 = sha256Hex("snapshot.sha256", snapshot.sha256);
  const etag = sha256Hex("snapshot.etag", snapshot.etag);
  const channelCount = positiveInteger("snapshot.channelCount", snapshot.channelCount);
  const groupCount = nonNegativeInteger("snapshot.groupCount", snapshot.groupCount);
  if (snapshot.sourceUrlsStripped !== true) fail("snapshot.sourceUrlsStripped must be true");
  return { channelCount, groupCount, sha256, etag };
}

function validateSignature(signature) {
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) fail("signature is required");
  const algorithm = cleanString("signature.algorithm", signature.algorithm);
  if (!signatureAlgorithms.has(algorithm)) fail("signature.algorithm must be minisign, cosign, or gpg");
  cleanString("signature.signedBy", signature.signedBy);
  cleanString("signature.signatureRef", signature.signatureRef);
}

function validateChecks(checks) {
  if (!Array.isArray(checks)) fail("checks must be an array");
  const byId = new Map();
  const incomplete = [];
  for (const check of checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9][a-z0-9-]*$/);
    if (byId.has(id)) fail(`duplicate catalog import check ${id}`);
    byId.set(id, check);
    cleanString(`${id}.owner`, check.owner);
    if (!validStatuses.has(check.status)) fail(`${id}.status must be pass, fail, blocked, or partial`);
    validateEvidenceList(`${id}.evidence`, check.evidence);
    if (check.status !== "pass") incomplete.push(id);
  }
  for (const id of requiredChecks) {
    if (!byId.has(id)) fail(`missing required catalog import check ${id}`);
  }
  return incomplete;
}

function validateRecord(record, file) {
  cleanString("importId", record.importId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-f0-9]{7,40}$/i);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("catalogRevision", record.catalogRevision, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("operator", record.operator);
  parseTime("reviewedAt", record.reviewedAt);
  if (record.synthetic && !allowSynthetic) fail("synthetic catalog import evidence requires --allow-synthetic");
  if (record.rawSourceUrlsPresent !== false) fail("rawSourceUrlsPresent must be false");

  const sourcePreflight = validateSourcePreflight(record.sourcePreflightEvidence);
  const incomplete = [
    ...sourcePreflight.incomplete,
    ...validateSourceAllowlist(record.sourceAllowlistEvidence)
  ];
  const snapshot = validateSnapshot(record.snapshot);
  if (snapshot.channelCount !== sourcePreflight.total) {
    fail("snapshot.channelCount must equal sourcePreflightEvidence.total");
  }
  validateSignature(record.signature);
  incomplete.push(...validateChecks(record.checks));
  if (record.environment !== "production") incomplete.push("environment");

  if (incomplete.length > 0 && !allowIncomplete && !record.synthetic) {
    fail(`catalog import evidence is incomplete for launch: ${incomplete.join(", ")}`);
  }
  const status = incomplete.length === 0 ? "launch-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Catalog import evidence OK: channels=${snapshot.channelCount}, checks=${requiredChecks.length}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-catalog-import.js [--allow-incomplete] [--allow-synthetic] <catalog-import-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Catalog import evidence validation failed: ${error.message}`);
  process.exit(1);
}
