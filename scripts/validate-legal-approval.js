import { readFileSync } from "node:fs";

const requiredApproverRoles = ["legal", "content-licensing", "privacy"];
const requiredRights = [
  "redistribution",
  "rebroadcast",
  "peerRelay",
  "viewerDeviceRetransmission",
  "territoriesApproved",
  "appStoreDistribution",
  "operationalMetricsLogging",
  "privacyDisclosure"
];
const requiredRightEvidence = {
  redistribution: "redistribution-rights",
  rebroadcast: "rebroadcast-rights",
  peerRelay: "peer-relay-rights",
  viewerDeviceRetransmission: "viewer-device-retransmission",
  territoriesApproved: "territory-platform-scope",
  appStoreDistribution: "app-store-distribution",
  operationalMetricsLogging: "operational-metrics-logging",
  privacyDisclosure: "privacy-disclosure"
};
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

function validateStringList(name, values) {
  if (!Array.isArray(values) || values.length === 0) fail(`${name} must be a non-empty array`);
  const seen = new Set();
  for (const value of values) {
    const normalized = cleanString(`${name}[]`, value).toLowerCase();
    if (seen.has(normalized)) fail(`${name} contains duplicate ${value}`);
    seen.add(normalized);
  }
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

function validateRights(rights, evidence) {
  if (!rights || typeof rights !== "object" || Array.isArray(rights)) fail("rights is required");
  const joinedEvidence = Array.isArray(evidence) ? evidence.join("\n") : "";
  for (const right of requiredRights) {
    if (rights[right] !== true) fail(`rights.${right} must be true`);
    const requiredEvidence = requiredRightEvidence[right];
    if (requiredEvidence && !joinedEvidence.includes(requiredEvidence)) {
      fail(`evidence must mention ${requiredEvidence}`);
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

function validateRecord(record, file) {
  cleanString("approvalId", record.approvalId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("contentProvider", record.contentProvider);
  cleanString("contractRef", record.contractRef);
  const reviewedAt = cleanString("reviewedAt", record.reviewedAt);
  if (Number.isNaN(Date.parse(reviewedAt))) fail("reviewedAt must be ISO-8601 parseable");
  if (record.synthetic && !allowSynthetic) fail("synthetic legal approval requires --allow-synthetic");
  validateStringList("territories", record.territories);
  validateStringList("contentClasses", record.contentClasses);
  validateStringList("platforms", record.platforms);
  validateApprovals(record.approvals);
  validateEvidenceList("evidence", record.evidence);
  validateRights(record.rights, record.evidence);
  return `${file}: Legal approval OK: territories=${record.territories.length}, rights=${requiredRights.length}, approvers=${requiredApproverRoles.length}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-legal-approval.js [--allow-synthetic] <legal-approval.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Legal approval validation failed: ${error.message}`);
  process.exit(1);
}
