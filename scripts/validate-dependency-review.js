import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const inventoryArgIndex = args.indexOf("--inventory");
const inventoryPath = inventoryArgIndex === -1 ? "config/dependency-inventory.json" : args[inventoryArgIndex + 1];
const files = args.filter((arg, index) => {
  if (arg === "--allow-synthetic" || arg === "--inventory") return false;
  if (inventoryArgIndex !== -1 && index === inventoryArgIndex + 1) return false;
  return !arg.startsWith("--");
});

const requiredChecks = [
  "npm-audit",
  "sbom",
  "release-image-refs",
  "image-scans",
  "android-debug-build",
  "android-release-build"
];
const allowedDecisionStatuses = new Set(["approved", "waived"]);
const allowedCheckStatuses = new Set(["pass"]);
const requiredWaiverFields = ["reason", "approvedBy", "expiresAt"];
const requiredReviewerRoles = ["release-engineering", "application-security"];
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
  const time = Date.parse(normalized);
  if (Number.isNaN(time)) fail(`${name} must be ISO-8601 parseable`);
  return time;
}

function validateEvidenceList(name, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${name} must include evidence`);
  const normalized = [];
  for (const item of evidence) {
    const value = cleanString(`${name}[]`, item);
    if (sensitiveEvidencePatterns.some((pattern) => pattern.test(value))) {
      fail(`${name} evidence reference looks like it may contain sensitive material`);
    }
    normalized.push(value);
  }
  return normalized;
}

function validateReviewers(record) {
  if (!Array.isArray(record.reviewers) || record.reviewers.length === 0) fail("reviewers must include at least one reviewer");
  const roles = new Set();
  for (const reviewer of record.reviewers) {
    cleanString("reviewer.name", reviewer.name);
    roles.add(cleanString("reviewer.role", reviewer.role));
  }
  for (const role of requiredReviewerRoles) {
    if (!roles.has(role)) fail(`reviewers must include ${role}`);
  }
}

function validateWaiver(decision, reviewedAt) {
  if (!decision.waiver || typeof decision.waiver !== "object") fail(`${decision.id}.waiver is required`);
  for (const field of requiredWaiverFields) {
    cleanString(`${decision.id}.waiver.${field}`, decision.waiver[field]);
  }
  const expiresAt = parseTime(`${decision.id}.waiver.expiresAt`, decision.waiver.expiresAt);
  if (expiresAt <= reviewedAt) fail(`${decision.id}.waiver.expiresAt must be after reviewedAt`);
}

function inventoryIds(inventory) {
  if (!Array.isArray(inventory.items) || inventory.items.length === 0) fail("inventory.items must be a non-empty array");
  const ids = new Set();
  for (const item of inventory.items) {
    const id = cleanString("inventory item id", item.id, /^[a-z0-9-]+$/);
    if (ids.has(id)) fail(`duplicate inventory id ${id}`);
    ids.add(id);
  }
  return ids;
}

function validateDecisions(record, inventory, reviewedAt) {
  if (!Array.isArray(record.decisions)) fail("decisions must be an array");
  const requiredIds = inventoryIds(inventory);
  const seen = new Set();
  let waived = 0;
  for (const decision of record.decisions) {
    const id = cleanString("decision.id", decision.id, /^[a-z0-9-]+$/);
    if (!requiredIds.has(id)) fail(`${id} is not present in dependency inventory`);
    if (seen.has(id)) fail(`duplicate decision ${id}`);
    seen.add(id);
    if (!allowedDecisionStatuses.has(decision.status)) fail(`${id}.status must be approved or waived`);
    cleanString(`${id}.owner`, decision.owner);
    cleanString(`${id}.decision`, decision.decision);
    const evidence = validateEvidenceList(`${id}.evidence`, decision.evidence);
    if (!evidence.some((item) => item.includes(id))) fail(`${id}.evidence must mention ${id}`);
    if (decision.status === "waived") {
      waived += 1;
      validateWaiver(decision, reviewedAt);
    }
  }
  for (const id of requiredIds) {
    if (!seen.has(id)) fail(`missing dependency decision for ${id}`);
  }
  return { approved: seen.size - waived, waived };
}

function validateChecks(record) {
  if (!Array.isArray(record.checks)) fail("checks must be an array");
  const byId = new Map();
  for (const check of record.checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9-]+$/);
    if (byId.has(id)) fail(`duplicate check ${id}`);
    byId.set(id, check);
    if (!allowedCheckStatuses.has(check.status)) fail(`${id}.status must pass before dependency review can be approved`);
    cleanString(`${id}.owner`, check.owner);
    const evidence = validateEvidenceList(`${id}.evidence`, check.evidence);
    if (!evidence.some((item) => item.includes(id))) fail(`${id}.evidence must mention ${id}`);
  }
  for (const id of requiredChecks) {
    if (!byId.has(id)) fail(`missing required dependency check ${id}`);
  }
}

function validateRecord(record, file, inventory) {
  cleanString("reviewId", record.reviewId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  const reviewedAt = parseTime("reviewedAt", record.reviewedAt);
  if (record.synthetic && !allowSynthetic) fail("synthetic dependency review requires --allow-synthetic");
  validateReviewers(record);
  validateChecks(record);
  const summary = validateDecisions(record, inventory, reviewedAt);
  return `${file}: Dependency review OK: decisions=${record.decisions.length}, approved=${summary.approved}, waived=${summary.waived}`;
}

if (!inventoryPath || files.length === 0) {
  console.error("Usage: node scripts/validate-dependency-review.js [--allow-synthetic] [--inventory config/dependency-inventory.json] <dependency-review.json> [...]");
  process.exit(2);
}

try {
  const inventory = readJson(inventoryPath);
  for (const file of files) {
    console.log(validateRecord(readJson(file), file, inventory));
  }
} catch (error) {
  console.error(`Dependency review validation failed: ${error.message}`);
  process.exit(1);
}
