import { readFileSync } from "node:fs";

const policy = JSON.parse(readFileSync("config/data-retention.json", "utf8"));
const requiredClasses = policy.classes.map((item) => item.id);
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
  /email=/i,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/
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
      fail(`${name} evidence reference looks like it may contain sensitive retention material`);
    }
  }
}

function validateCommandCheck(name, check, commandFragment) {
  if (!check || typeof check !== "object" || Array.isArray(check)) fail(`${name} is required`);
  const command = cleanString(`${name}.command`, check.command);
  if (!command.includes(commandFragment)) fail(`${name}.command must include ${commandFragment}`);
  if (!validStatuses.has(check.status)) fail(`${name}.status must be pass, fail, blocked, or partial`);
  validateEvidenceList(`${name}.evidence`, check.evidence);
  return check.status === "pass" ? [] : [name];
}

function validateClasses(classes) {
  if (!Array.isArray(classes)) fail("classes must be an array");
  const byId = new Map();
  for (const item of classes) {
    const id = cleanString("class.id", item.id, /^[a-z0-9_]+$/);
    if (byId.has(id)) fail(`duplicate retention class ${id}`);
    byId.set(id, item);
    nonNegativeInteger(`${id}.scannedRecords`, item.scannedRecords);
    nonNegativeInteger(`${id}.appliedRecords`, item.appliedRecords);
    nonNegativeInteger(`${id}.failedRecords`, item.failedRecords);
    if (item.failedRecords !== 0) fail(`${id}.failedRecords must be 0`);
    if (item.policyMatched !== true) fail(`${id}.policyMatched must be true`);
    validateEvidenceList(`${id}.evidence`, item.evidence);
  }
  for (const id of requiredClasses) {
    if (!byId.has(id)) fail(`missing retention execution class ${id}`);
  }
}

function validateRun(name, run, commandFragment) {
  const incomplete = validateCommandCheck(name, run, commandFragment);
  const scannedRecords = nonNegativeInteger(`${name}.scannedRecords`, run.scannedRecords);
  nonNegativeInteger(`${name}.appliedRecords`, run.appliedRecords);
  nonNegativeInteger(`${name}.failures`, run.failures);
  if (scannedRecords === 0) fail(`${name}.scannedRecords must be greater than 0`);
  if (run.failures !== 0) incomplete.push(`${name}.failures`);
  if (run.metricsExported !== true) fail(`${name}.metricsExported must be true`);
  if (run.actionLogRedacted !== true) fail(`${name}.actionLogRedacted must be true`);
  return incomplete;
}

function validateRecord(record, file) {
  cleanString("evidenceId", record.evidenceId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("policyReviewDate", record.policyReviewDate, /^\d{4}-\d{2}-\d{2}$/);
  if (record.policyReviewDate !== policy.reviewDate) fail("policyReviewDate must match config/data-retention.json");
  const startedAt = parseTime("startedAt", record.startedAt);
  const completedAt = parseTime("completedAt", record.completedAt);
  if (completedAt <= startedAt) fail("completedAt must be after startedAt");
  if (record.scopedCredentials !== true) fail("scopedCredentials must be true");
  if (record.destructiveGuardVerified !== true) fail("destructiveGuardVerified must be true");
  if (record.noSensitiveMaterialLeaked !== true) fail("noSensitiveMaterialLeaked must be true");
  if (record.synthetic && !allowSynthetic) fail("synthetic retention execution evidence requires --allow-synthetic");
  const incomplete = [
    ...validateCommandCheck("approvalValidation", record.approvalValidation, "retention:approval:validate"),
    ...validateRun("dryRun", record.dryRun, "retention:job"),
    ...validateRun("executeRun", record.executeRun, "--execute")
  ];
  validateClasses(record.classes);
  if (record.environment !== "production") incomplete.push("environment");
  if (incomplete.length > 0 && !allowIncomplete && !record.synthetic) {
    fail(`retention execution evidence is incomplete for launch: ${incomplete.join(", ")}`);
  }
  const status = incomplete.length === 0 ? "launch-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Retention execution evidence OK: classes=${requiredClasses.length}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-retention-execution-evidence.js [--allow-incomplete] [--allow-synthetic] <retention-execution-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Retention execution evidence validation failed: ${error.message}`);
  process.exit(1);
}
