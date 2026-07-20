import { readFileSync } from "node:fs";

const requiredScopes = [
  "authentication-and-tokens",
  "internal-apis",
  "source-url-protection",
  "tracker-abuse",
  "p2p-poisoning",
  "turn-relay",
  "release-gate"
];
const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const validScopeStatuses = new Set(["pass", "partial", "fail"]);
const validFindingStatuses = new Set(["fixed", "waived", "open", "accepted"]);
const blockingSeverities = new Set(["P0", "P1"]);
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
  if (Number.isNaN(Date.parse(normalized))) fail(`${name} must be ISO-8601 parseable`);
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

function validateReviewers(record) {
  if (!Array.isArray(record.reviewers) || record.reviewers.length === 0) fail("reviewers must include at least one reviewer");
  for (const reviewer of record.reviewers) {
    cleanString("reviewer.name", reviewer.name);
    cleanString("reviewer.role", reviewer.role);
  }
}

function validateScopes(record) {
  if (!Array.isArray(record.scopes)) fail("scopes must be an array");
  const byId = new Map();
  for (const scope of record.scopes) {
    const id = cleanString("scope.id", scope.id, /^[a-z0-9-]+$/);
    if (byId.has(id)) fail(`duplicate scope ${id}`);
    byId.set(id, scope);
    if (!validScopeStatuses.has(scope.status)) fail(`${id}.status must be pass, partial, or fail`);
    if (scope.status !== "pass") fail(`${id} must pass before security review can be approved`);
    validateEvidenceList(`${id}.evidence`, scope.evidence);
  }
  for (const id of requiredScopes) {
    if (!byId.has(id)) fail(`missing required scope ${id}`);
  }
}

function validateWaiver(finding) {
  if (!finding.waiver || typeof finding.waiver !== "object") fail(`${finding.id}.waiver is required`);
  cleanString(`${finding.id}.waiver.reason`, finding.waiver.reason);
  cleanString(`${finding.id}.waiver.approvedBy`, finding.waiver.approvedBy);
  parseTime(`${finding.id}.waiver.expiresAt`, finding.waiver.expiresAt);
}

function validateFindings(record) {
  if (!Array.isArray(record.findings)) fail("findings must be an array");
  const ids = new Set();
  for (const finding of record.findings) {
    const id = cleanString("finding.id", finding.id, /^[A-Z]+-[0-9]{3}$/);
    if (ids.has(id)) fail(`duplicate finding ${id}`);
    ids.add(id);
    const severity = cleanString(`${id}.severity`, finding.severity, /^P[0-3]$/);
    if (!validFindingStatuses.has(finding.status)) fail(`${id}.status must be fixed, waived, open, or accepted`);
    cleanString(`${id}.owner`, finding.owner);
    validateEvidenceList(`${id}.evidence`, finding.evidence);
    if (finding.status === "waived") validateWaiver(finding);
    if (blockingSeverities.has(severity) && !["fixed", "waived"].includes(finding.status)) {
      fail(`${id} is ${severity} and must be fixed or waived before launch`);
    }
  }
}

function validateRecord(record, file) {
  cleanString("reviewId", record.reviewId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  parseTime("reviewedAt", record.reviewedAt);
  cleanString("threatModel", record.threatModel);
  if (record.synthetic && !allowSynthetic) fail("synthetic security review requires --allow-synthetic");
  validateReviewers(record);
  validateScopes(record);
  validateFindings(record);
  return `${file}: Security review OK: scopes=${requiredScopes.length}, findings=${record.findings.length}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-security-review.js [--allow-synthetic] <security-review.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Security review validation failed: ${error.message}`);
  process.exit(1);
}
