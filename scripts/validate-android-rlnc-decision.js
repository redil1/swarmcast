import { readFileSync } from "node:fs";
import { validatePerformanceBudgets } from "../packages/config/src/performanceBudgets.js";

const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const budgetArgIndex = args.indexOf("--budgets");
const budgetPath = budgetArgIndex === -1 ? "config/performance-budgets.json" : args[budgetArgIndex + 1];
const files = args.filter((arg, index) => {
  if (arg === "--allow-synthetic" || arg === "--budgets") return false;
  if (budgetArgIndex !== -1 && index === budgetArgIndex + 1) return false;
  return !arg.startsWith("--");
});
const budgets = validatePerformanceBudgets(JSON.parse(readFileSync(budgetPath, "utf8")));
const requiredChecks = [
  "license-review",
  "abi-review",
  "decode-benchmark",
  "allocation-benchmark",
  "fuzz-malformed-packets",
  "bad-decode-rejection",
  "device-swarm-decode",
  "hash-verify-before-store",
  "maintenance-owner"
];
const requiredReviewerRoles = ["android", "security", "legal", "performance"];
const selectedImplementation = Object.freeze({
  name: "backblaze-javareedsolomon-gf256",
  version: "d3c481dc69471e0c47ff6f67f33d53bde941675e",
  license: "MIT"
});
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
  if (Number.isNaN(Date.parse(normalized))) fail(`${name} must be ISO-8601 parseable`);
}

function numberField(name, value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${name} must be a finite number`);
  if (value < min || value > max) fail(`${name} must be between ${min} and ${max}`);
}

function integerField(name, value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (!Number.isInteger(value)) fail(`${name} must be an integer`);
  if (value < min || value > max) fail(`${name} must be between ${min} and ${max}`);
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

function validateImplementation(record) {
  const implementation = record.implementation;
  if (!implementation || typeof implementation !== "object") fail("implementation is required");
  cleanString("implementation.name", implementation.name);
  cleanString("implementation.version", implementation.version, /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
  cleanString("implementation.source", implementation.source);
  cleanString("implementation.license", implementation.license);
  cleanString("implementation.maintenanceOwner", implementation.maintenanceOwner);
  cleanString("implementation.abiRisk", implementation.abiRisk, /^(low|medium|high)$/);
  if (implementation.abiRisk === "high") fail("implementation.abiRisk must not be high for launch");
  for (const [field, expected] of Object.entries(selectedImplementation)) {
    if (implementation[field] !== expected) {
      fail(`implementation.${field} must match selected Android RLNC implementation ${expected}`);
    }
  }
  if (!implementation.source.includes("docs/adr/0008-android-rlnc-library-boundary.md#dependency-provenance")) {
    fail("implementation.source must reference the selected Android RLNC dependency provenance");
  }
}

function validateReviewers(record) {
  if (!Array.isArray(record.reviewers)) fail("reviewers must be an array");
  const seen = new Set();
  for (const reviewer of record.reviewers) {
    const role = cleanString("reviewer.role", reviewer.role, /^[a-z0-9-]+$/);
    if (seen.has(role)) fail(`duplicate reviewer role ${role}`);
    seen.add(role);
    cleanString(`${role}.name`, reviewer.name);
    parseTime(`${role}.reviewedAt`, reviewer.reviewedAt);
  }
  for (const role of requiredReviewerRoles) {
    if (!seen.has(role)) fail(`missing required reviewer role ${role}`);
  }
}

function validateChecks(record) {
  if (!Array.isArray(record.checks)) fail("checks must be an array");
  const seen = new Set();
  for (const check of record.checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9-]+$/);
    if (seen.has(id)) fail(`duplicate RLNC decision check ${id}`);
    seen.add(id);
    if (check.status !== "pass") fail(`${id}.status must pass before Android RLNC approval`);
    cleanString(`${id}.owner`, check.owner);
    validateEvidenceList(`${id}.evidence`, check.evidence);
  }
  for (const id of requiredChecks) {
    if (!seen.has(id)) fail(`missing required Android RLNC check ${id}`);
  }
}

function validateBenchmarks(record) {
  const benchmarks = record.benchmarks;
  if (!benchmarks || typeof benchmarks !== "object") fail("benchmarks are required");
  numberField("benchmarks.decodeCpuMsP95", benchmarks.decodeCpuMsP95, { min: 0, max: budgets.androidDecodeCpuMsPerSegmentP95 });
  numberField("benchmarks.allocationBytesP95", benchmarks.allocationBytesP95, { min: 1 });
  numberField("benchmarks.batteryDrainPctPerHour", benchmarks.batteryDrainPctPerHour, { min: 0, max: budgets.androidBatteryDrainPctPerHour });
  integerField("benchmarks.segmentSizeBytes", benchmarks.segmentSizeBytes, { min: 1 });
  integerField("benchmarks.k", benchmarks.k, { min: 1, max: 255 });
}

function validateFuzz(record) {
  const fuzz = record.fuzz;
  if (!fuzz || typeof fuzz !== "object") fail("fuzz is required");
  integerField("fuzz.cases", fuzz.cases, { min: 1000 });
  integerField("fuzz.crashes", fuzz.crashes, { min: 0, max: 0 });
  integerField("fuzz.badStores", fuzz.badStores, { min: 0, max: 0 });
  validateEvidenceList("fuzz.evidence", fuzz.evidence);
}

function validateDeviceDecode(record) {
  const deviceDecode = record.deviceDecode;
  if (!deviceDecode || typeof deviceDecode !== "object") fail("deviceDecode is required");
  integerField("deviceDecode.devices", deviceDecode.devices, { min: 2 });
  integerField("deviceDecode.verifiedSegments", deviceDecode.verifiedSegments, { min: 1 });
  integerField("deviceDecode.hashFailures", deviceDecode.hashFailures, { min: 0, max: 0 });
  if (deviceDecode.segmentStoreVerified !== true) fail("deviceDecode.segmentStoreVerified must be true");
  validateEvidenceList("deviceDecode.evidence", deviceDecode.evidence);
}

function validateRecord(record, file) {
  cleanString("decisionId", record.decisionId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  parseTime("decidedAt", record.decidedAt);
  if (record.synthetic && !allowSynthetic) fail("synthetic Android RLNC decision requires --allow-synthetic");
  validateImplementation(record);
  validateReviewers(record);
  validateChecks(record);
  validateBenchmarks(record);
  validateFuzz(record);
  validateDeviceDecode(record);
  return `${file}: Android RLNC decision OK: checks=${requiredChecks.length}, reviewers=${requiredReviewerRoles.length}, verifiedSegments=${record.deviceDecode.verifiedSegments}`;
}

if (!budgetPath || files.length === 0) {
  console.error("Usage: node scripts/validate-android-rlnc-decision.js [--allow-synthetic] [--budgets config/performance-budgets.json] <android-rlnc-decision.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Android RLNC decision validation failed: ${error.message}`);
  process.exit(1);
}
