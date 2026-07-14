import { readFileSync } from "node:fs";

const requiredApproverRoles = ["privacy", "legal", "support"];
const requiredChecks = [
  "privacy-policy-text-reviewed",
  "app-store-notes-reviewed",
  "support-faq-reviewed",
  "peer-ip-disclosure-present",
  "p2p-toggle-before-playback",
  "cellular-no-upload",
  "low-battery-upload-disabled",
  "p2p-disable-closes-links",
  "telemetry-source-url-redaction",
  "retention-policy-linked"
];
const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
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

function validateEvidenceList(name, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${name} must include evidence`);
  for (const item of evidence) {
    const value = cleanString(`${name}[]`, item);
    if (sensitiveEvidencePatterns.some((pattern) => pattern.test(value))) {
      fail(`${name} evidence reference looks like it may contain sensitive source, token, or personal material`);
    }
  }
}

function validateApprovals(approvals) {
  if (!Array.isArray(approvals)) fail("approvals must be an array");
  const byRole = new Map();
  for (const approval of approvals) {
    const role = cleanString("approval.role", approval.role, /^[a-z0-9-]+$/);
    if (byRole.has(role)) fail(`duplicate approval role ${role}`);
    byRole.set(role, approval);
    cleanString(`${role}.name`, approval.name);
    const approvedAt = cleanString(`${role}.approvedAt`, approval.approvedAt);
    if (Number.isNaN(Date.parse(approvedAt))) fail(`${role}.approvedAt must be ISO-8601 parseable`);
    validateEvidenceList(`${role}.evidence`, approval.evidence);
  }
  for (const role of requiredApproverRoles) {
    if (!byRole.has(role)) fail(`missing required approval role ${role}`);
  }
}

function validateChecks(checks) {
  if (!Array.isArray(checks)) fail("checks must be an array");
  const byId = new Map();
  for (const check of checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9-]+$/);
    if (byId.has(id)) fail(`duplicate privacy/store compliance check ${id}`);
    byId.set(id, check);
    cleanString(`${id}.owner`, check.owner);
    if (check.status !== "pass") fail(`${id}.status must pass`);
    validateEvidenceList(`${id}.evidence`, check.evidence);
  }
  for (const id of requiredChecks) {
    if (!byId.has(id)) fail(`missing required privacy/store compliance check ${id}`);
  }
}

function validateRecord(record, file) {
  cleanString("reviewId", record.reviewId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  const reviewedAt = cleanString("reviewedAt", record.reviewedAt);
  if (Number.isNaN(Date.parse(reviewedAt))) fail("reviewedAt must be ISO-8601 parseable");
  if (record.synthetic && !allowSynthetic) fail("synthetic privacy/store compliance evidence requires --allow-synthetic");
  validateApprovals(record.approvals);
  validateChecks(record.checks);
  validateEvidenceList("evidence", record.evidence);
  return `${file}: Privacy/store compliance OK: checks=${requiredChecks.length}, approvers=${requiredApproverRoles.length}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-privacy-store-compliance.js [--allow-synthetic] <privacy-store-compliance.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Privacy/store compliance validation failed: ${error.message}`);
  process.exit(1);
}
