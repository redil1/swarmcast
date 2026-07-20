import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const requiredAreas = [
  "auth",
  "tracker",
  "control-plane",
  "ingest",
  "retention-worker",
  "edge",
  "turn-relay",
  "android-p2p",
  "rlnc",
  "release",
  "dependency-supply-chain",
  "monitoring-logs"
];
const requiredThreats = [
  "T-001",
  "T-002",
  "T-003",
  "T-004",
  "T-005",
  "T-006",
  "T-007",
  "T-008",
  "T-009",
  "T-010",
  "T-011",
  "T-012",
  "T-013",
  "T-014",
  "T-015",
  "T-016"
];
const requiredOpenGates = [
  "android-rlnc-library",
  "nginx-tls-smoke",
  "load-ladder",
  "staging-chaos-drills",
  "data-retention-approval",
  "dependency-review",
  "turn-carrier-proof"
];
const requiredSignoffRoles = ["security", "platform", "android", "operations"];
const allowedThreatStatuses = new Set(["mitigated", "accepted", "waived"]);
const sensitiveEvidencePatterns = [
  /token=/i,
  /jwt=/i,
  /bearer\s+/i,
  /sourceurl/i,
  /source_url/i,
  /\.m3u8(?:\?|$)/i,
  /-----BEGIN/i,
  /password=/i
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

function validateAreas(record) {
  if (!Array.isArray(record.areas)) fail("areas must be an array");
  const seen = new Set();
  for (const area of record.areas) {
    const id = cleanString("area.id", area.id, /^[a-z0-9-]+$/);
    if (seen.has(id)) fail(`duplicate area ${id}`);
    seen.add(id);
    cleanString(`${id}.owner`, area.owner);
    validateEvidenceList(`${id}.evidence`, area.evidence);
  }
  for (const id of requiredAreas) {
    if (!seen.has(id)) fail(`missing required threat-model area ${id}`);
  }
}

function validateThreats(record) {
  if (!Array.isArray(record.threats)) fail("threats must be an array");
  const seen = new Set();
  for (const threat of record.threats) {
    const id = cleanString("threat.id", threat.id, /^T-[0-9]{3}$/);
    if (seen.has(id)) fail(`duplicate threat ${id}`);
    seen.add(id);
    if (!allowedThreatStatuses.has(threat.status)) fail(`${id}.status must be mitigated, accepted, or waived`);
    cleanString(`${id}.owner`, threat.owner);
    cleanString(`${id}.decision`, threat.decision);
    validateEvidenceList(`${id}.evidence`, threat.evidence);
    if (threat.status === "waived") {
      if (!threat.waiver || typeof threat.waiver !== "object") fail(`${id}.waiver is required`);
      cleanString(`${id}.waiver.reason`, threat.waiver.reason);
      cleanString(`${id}.waiver.approvedBy`, threat.waiver.approvedBy);
      parseTime(`${id}.waiver.expiresAt`, threat.waiver.expiresAt);
    }
  }
  for (const id of requiredThreats) {
    if (!seen.has(id)) fail(`missing required threat ${id}`);
  }
}

function validateOpenGates(record) {
  if (!Array.isArray(record.openGates)) fail("openGates must be an array");
  const seen = new Set();
  for (const gate of record.openGates) {
    const id = cleanString("openGate.id", gate.id, /^[a-z0-9-]+$/);
    if (seen.has(id)) fail(`duplicate open gate ${id}`);
    seen.add(id);
    cleanString(`${id}.owner`, gate.owner);
    cleanString(`${id}.riskAcceptedBy`, gate.riskAcceptedBy);
    validateEvidenceList(`${id}.evidence`, gate.evidence);
  }
  for (const id of requiredOpenGates) {
    if (!seen.has(id)) fail(`missing required open gate acknowledgement ${id}`);
  }
}

function validateSignoffs(record) {
  if (!Array.isArray(record.signoffs)) fail("signoffs must be an array");
  const seen = new Set();
  for (const signoff of record.signoffs) {
    const role = cleanString("signoff.role", signoff.role, /^[a-z0-9-]+$/);
    if (seen.has(role)) fail(`duplicate signoff role ${role}`);
    seen.add(role);
    cleanString(`${role}.name`, signoff.name);
    parseTime(`${role}.signedAt`, signoff.signedAt);
  }
  for (const role of requiredSignoffRoles) {
    if (!seen.has(role)) fail(`missing required signoff role ${role}`);
  }
}

function validateRecord(record, file) {
  cleanString("reviewId", record.reviewId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  parseTime("reviewedAt", record.reviewedAt);
  cleanString("modelRevision", record.modelRevision);
  if (record.synthetic && !allowSynthetic) fail("synthetic threat model review requires --allow-synthetic");
  validateAreas(record);
  validateThreats(record);
  validateOpenGates(record);
  validateSignoffs(record);
  return `${file}: Threat model review OK: areas=${requiredAreas.length}, threats=${requiredThreats.length}, signoffs=${requiredSignoffRoles.length}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-threat-model-review.js [--allow-synthetic] <threat-model-review.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Threat model review validation failed: ${error.message}`);
  process.exit(1);
}
