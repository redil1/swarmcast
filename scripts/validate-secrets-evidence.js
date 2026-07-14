import { readFileSync } from "node:fs";

const requiredSecrets = [
  "internal-token",
  "app-api-key",
  "auth-signing-key",
  "retention-store-token",
  "alertmanager-webhook-default",
  "alertmanager-webhook-critical",
  "production-env-file"
];

const requiredSecretDefinitions = new Map([
  ["internal-token", { purpose: "internal service authentication", injectedInto: ["auth", "ingest", "tracker", "control-plane", "retention-worker"] }],
  ["app-api-key", { purpose: "android app authentication", injectedInto: ["auth", "android"] }],
  ["auth-signing-key", { purpose: "jwt signing", injectedInto: ["auth"] }],
  ["retention-store-token", { purpose: "retention store authentication", injectedInto: ["retention-worker"] }],
  ["alertmanager-webhook-default", { purpose: "default alert notifications", injectedInto: ["alertmanager"] }],
  ["alertmanager-webhook-critical", { purpose: "critical alert notifications", injectedInto: ["alertmanager"] }],
  ["production-env-file", { purpose: "production environment injection", injectedInto: ["compose"] }]
]);

const requiredChecks = [
  "production-env-validated",
  "secret-manager-access-reviewed",
  "deployment-injection-tested",
  "auth-key-rotation-ready",
  "backup-restore-covered",
  "redaction-proof-reviewed",
  "alertmanager-receiver-secrets-reviewed"
];

const allowedStorage = new Set(["secret-manager", "github-environment-secret", "host-encrypted-file"]);
const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const allowIncomplete = args.includes("--allow-incomplete");
const files = args.filter((arg) => !arg.startsWith("--"));
const sensitiveEvidencePatterns = [
  /bearer\s+/i,
  /token=/i,
  /secret=/i,
  /password=/i,
  /api[_-]?key=/i,
  /-----BEGIN/i,
  /\b[a-f0-9]{64}\b/i
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

function validateEvidenceList(name, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${name} must include evidence`);
  const normalized = [];
  for (const item of evidence) {
    const value = cleanString(`${name}[]`, item);
    if (sensitiveEvidencePatterns.some((pattern) => pattern.test(value))) {
      fail(`${name} evidence reference looks like it may contain secret material`);
    }
    normalized.push(value);
  }
  return normalized;
}

function validateSecret(secret) {
  const id = cleanString("secret.id", secret.id, /^[a-z0-9][a-z0-9-]*$/);
  cleanString(`${id}.owner`, secret.owner);
  const expected = requiredSecretDefinitions.get(id);
  if (expected) {
    const purpose = cleanString(`${id}.purpose`, secret.purpose);
    if (purpose !== expected.purpose) fail(`${id}.purpose must be ${expected.purpose}`);
  }
  if (secret.environmentScope !== "production") fail(`${id}.environmentScope must be production`);
  const storage = cleanString(`${id}.storage`, secret.storage);
  if (!allowedStorage.has(storage)) fail(`${id}.storage must be an approved storage type`);
  cleanString(`${id}.pathRef`, secret.pathRef, /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
  if (secret.valueExposed !== false) fail(`${id}.valueExposed must be false`);
  if (secret.plainTextStored !== false) fail(`${id}.plainTextStored must be false`);
  const rotatedAt = parseTime(`${id}.rotatedAt`, secret.rotatedAt);
  const nextRotationDueAt = parseTime(`${id}.nextRotationDueAt`, secret.nextRotationDueAt);
  if (nextRotationDueAt <= rotatedAt) fail(`${id}.nextRotationDueAt must be after rotatedAt`);
  const rotationPolicyDays = Number(secret.rotationPolicyDays);
  if (!Number.isInteger(rotationPolicyDays) || rotationPolicyDays < 1 || rotationPolicyDays > 92) {
    fail(`${id}.rotationPolicyDays must be an integer between 1 and 92`);
  }
  const rotationWindowDays = Math.ceil((nextRotationDueAt - rotatedAt) / 86400000);
  if (rotationWindowDays > rotationPolicyDays) fail(`${id}.nextRotationDueAt exceeds rotationPolicyDays`);
  if (!Array.isArray(secret.injectedInto) || secret.injectedInto.length === 0) fail(`${id}.injectedInto must be non-empty`);
  const injectedInto = new Set();
  for (const service of secret.injectedInto) {
    injectedInto.add(cleanString(`${id}.injectedInto[]`, service, /^[a-z0-9][a-z0-9-]*$/));
  }
  for (const service of expected?.injectedInto ?? []) {
    if (!injectedInto.has(service)) fail(`${id}.injectedInto must include ${service}`);
  }
  const evidence = validateEvidenceList(`${id}.evidence`, secret.evidence);
  if (!evidence.some((item) => item.includes(id))) fail(`${id}.evidence must mention ${id}`);
  return id;
}

function validateChecks(checks) {
  if (!Array.isArray(checks)) fail("checks must be an array");
  const byId = new Map();
  const incomplete = [];
  for (const check of checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9][a-z0-9-]*$/);
    if (byId.has(id)) fail(`duplicate secrets check ${id}`);
    byId.set(id, check);
    cleanString(`${id}.owner`, check.owner);
    if (!["pass", "fail", "blocked", "partial"].includes(check.status)) {
      fail(`${id}.status must be pass, fail, blocked, or partial`);
    }
    const evidence = validateEvidenceList(`${id}.evidence`, check.evidence);
    if (!evidence.some((item) => item.includes(id))) fail(`${id}.evidence must mention ${id}`);
    if (check.status !== "pass") incomplete.push(id);
  }
  for (const id of requiredChecks) {
    if (!byId.has(id)) fail(`missing required secrets check ${id}`);
  }
  return incomplete;
}

function validateRecord(record, file) {
  cleanString("evidenceId", record.evidenceId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  parseTime("reviewedAt", record.reviewedAt);
  if (record.synthetic && !allowSynthetic) fail("synthetic secrets evidence requires --allow-synthetic");
  if (record.rawSecretValuesPresent !== false) fail("rawSecretValuesPresent must be false");

  if (!Array.isArray(record.secrets)) fail("secrets must be an array");
  const seen = new Set();
  for (const secret of record.secrets) {
    const id = validateSecret(secret);
    if (seen.has(id)) fail(`duplicate secret ${id}`);
    seen.add(id);
  }
  for (const id of requiredSecrets) {
    if (!seen.has(id)) fail(`missing required secret ${id}`);
  }

  const incomplete = validateChecks(record.checks);
  if (record.environment !== "production") incomplete.push("environment");
  if (incomplete.length > 0 && !allowIncomplete && !record.synthetic) {
    fail(`secrets evidence is incomplete for launch: ${incomplete.join(", ")}`);
  }
  const status = incomplete.length === 0 ? "launch-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Secrets evidence OK: secrets=${requiredSecrets.length}, checks=${requiredChecks.length}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-secrets-evidence.js [--allow-incomplete] [--allow-synthetic] <secrets-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Secrets evidence validation failed: ${error.message}`);
  process.exit(1);
}
