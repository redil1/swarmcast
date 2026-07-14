import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const policyArgIndex = args.indexOf("--policy");
const policyPath = policyArgIndex === -1 ? "config/data-retention.json" : args[policyArgIndex + 1];
const files = args.filter((arg, index) => {
  if (arg === "--allow-synthetic" || arg === "--policy") return false;
  if (policyArgIndex !== -1 && index === policyArgIndex + 1) return false;
  return !arg.startsWith("--");
});

const requiredApproverRoles = ["privacy", "legal", "security", "operations"];
const requiredControls = [
  "structured-logging-redaction",
  "public-catalog-sanitization",
  "retention-job",
  "destructive-execution-guard",
  "retention-worker-health",
  "staging-execution",
  "backup-restore-retention",
  "incident-hold-process"
];
const allowedClassStatuses = new Set(["approved", "waived"]);
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
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

function policyClassMap(policy) {
  if (!Array.isArray(policy.classes) || policy.classes.length === 0) fail("policy.classes must be a non-empty array");
  const byId = new Map();
  for (const item of policy.classes) {
    const id = cleanString("policy class id", item.id, /^[a-z0-9_]+$/);
    if (byId.has(id)) fail(`duplicate policy class ${id}`);
    byId.set(id, item);
  }
  return byId;
}

function validateApprovers(record) {
  if (!Array.isArray(record.approvers)) fail("approvers must be an array");
  const seen = new Set();
  for (const approver of record.approvers) {
    const role = cleanString("approver.role", approver.role, /^[a-z0-9-]+$/);
    if (seen.has(role)) fail(`duplicate approver role ${role}`);
    seen.add(role);
    cleanString(`${role}.name`, approver.name);
    parseTime(`${role}.approvedAt`, approver.approvedAt);
  }
  for (const role of requiredApproverRoles) {
    if (!seen.has(role)) fail(`missing required approver role ${role}`);
  }
}

function validateWaiver(item) {
  if (!item.waiver || typeof item.waiver !== "object") fail(`${item.id}.waiver is required`);
  cleanString(`${item.id}.waiver.reason`, item.waiver.reason);
  cleanString(`${item.id}.waiver.approvedBy`, item.waiver.approvedBy);
  parseTime(`${item.id}.waiver.expiresAt`, item.waiver.expiresAt);
}

function validateClasses(record, policy) {
  if (!Array.isArray(record.classes)) fail("classes must be an array");
  const policyClasses = policyClassMap(policy);
  const seen = new Set();
  let waived = 0;
  for (const item of record.classes) {
    const id = cleanString("class.id", item.id, /^[a-z0-9_]+$/);
    if (!policyClasses.has(id)) fail(`${id} is not present in data retention policy`);
    if (seen.has(id)) fail(`duplicate retention class ${id}`);
    seen.add(id);
    if (!allowedClassStatuses.has(item.status)) fail(`${id}.status must be approved or waived`);
    cleanString(`${id}.owner`, item.owner);
    const policyItem = policyClasses.get(id);
    if (item.rawRetentionDays !== policyItem.rawRetentionDays) fail(`${id}.rawRetentionDays must match policy`);
    if (item.aggregateRetentionDays !== policyItem.aggregateRetentionDays) fail(`${id}.aggregateRetentionDays must match policy`);
    validateEvidenceList(`${id}.evidence`, item.evidence);
    if (item.status === "waived") {
      waived += 1;
      validateWaiver(item);
    }
  }
  for (const id of policyClasses.keys()) {
    if (!seen.has(id)) fail(`missing retention approval for ${id}`);
  }
  return { approved: seen.size - waived, waived };
}

function validateControls(record) {
  if (!Array.isArray(record.controls)) fail("controls must be an array");
  const seen = new Set();
  for (const control of record.controls) {
    const id = cleanString("control.id", control.id, /^[a-z0-9-]+$/);
    if (seen.has(id)) fail(`duplicate retention control ${id}`);
    seen.add(id);
    if (control.status !== "pass") fail(`${id}.status must pass before data retention approval`);
    cleanString(`${id}.owner`, control.owner);
    validateEvidenceList(`${id}.evidence`, control.evidence);
  }
  for (const id of requiredControls) {
    if (!seen.has(id)) fail(`missing required retention control ${id}`);
  }
}

function validateRecord(record, file, policy) {
  cleanString("approvalId", record.approvalId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  parseTime("approvedAt", record.approvedAt);
  cleanString("policyRevision", record.policyRevision);
  if (record.synthetic && !allowSynthetic) fail("synthetic retention approval requires --allow-synthetic");
  validateApprovers(record);
  const summary = validateClasses(record, policy);
  validateControls(record);
  return `${file}: Retention approval OK: classes=${record.classes.length}, approved=${summary.approved}, waived=${summary.waived}, controls=${requiredControls.length}`;
}

if (!policyPath || files.length === 0) {
  console.error("Usage: node scripts/validate-retention-approval.js [--allow-synthetic] [--policy config/data-retention.json] <retention-approval.json> [...]");
  process.exit(2);
}

try {
  const policy = readJson(policyPath);
  for (const file of files) {
    console.log(validateRecord(readJson(file), file, policy));
  }
} catch (error) {
  console.error(`Retention approval validation failed: ${error.message}`);
  process.exit(1);
}
