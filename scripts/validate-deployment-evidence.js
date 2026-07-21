import { readFileSync } from "node:fs";

const requiredServices = ["auth", "ingest", "tracker", "control-plane", "retention-worker", "segment-bus", "segment-bus-exporter", "turn"];
const requiredChecks = [
  "release-manifest-validated",
  "image-digests-pinned",
  "production-env-validated",
  "secrets-evidence-validated",
  "host-provisioning-validated",
  "compose-rendered",
  "images-pulled",
  "deployed-up-no-build",
  "service-health",
  "post-deploy-smokes",
  "rollback-ready",
  "no-third-party-cdn"
];

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

function validateCommands(commands) {
  if (!Array.isArray(commands) || commands.length === 0) fail("commands must be a non-empty array");
  const joined = commands.join("\n");
  if (!joined.includes("pull")) fail("commands must include image pull");
  if (!joined.includes("up") || !joined.includes("--no-build")) fail("commands must include up --no-build");
  if (/\bbuild\b/.test(joined.replace(/--no-build/g, ""))) fail("deployment commands must not build images");
  for (const service of requiredServices) {
    if (!joined.includes(service)) fail(`commands must include service ${service}`);
  }
}

function validateServices(services) {
  if (!Array.isArray(services)) fail("services must be an array");
  const seen = new Set();
  for (const service of services) {
    const name = cleanString("service.name", service.name, /^[a-z0-9][a-z0-9-]*$/);
    if (seen.has(name)) fail(`duplicate service ${name}`);
    seen.add(name);
    cleanString(`${name}.image`, service.image, /@sha256:[a-fA-F0-9]{64}$/);
    if (service.pulled !== true) fail(`${name}.pulled must be true`);
    if (service.running !== true) fail(`${name}.running must be true`);
    cleanString(`${name}.health`, service.health, /^(healthy|ready)$/);
    const evidence = validateEvidenceList(`${name}.evidence`, service.evidence);
    if (!evidence.some((item) => item.includes(name))) fail(`${name}.evidence must mention ${name}`);
  }
  for (const service of requiredServices) {
    if (!seen.has(service)) fail(`missing service ${service}`);
  }
}

function validateChecks(checks) {
  if (!Array.isArray(checks)) fail("checks must be an array");
  const byId = new Map();
  const incomplete = [];
  for (const check of checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9][a-z0-9-]*$/);
    if (byId.has(id)) fail(`duplicate deployment check ${id}`);
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
    if (!byId.has(id)) fail(`missing required deployment check ${id}`);
  }
  return incomplete;
}

function validateRecord(record, file) {
  cleanString("deploymentId", record.deploymentId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("deployedBy", record.deployedBy);
  const startedAt = parseTime("startedAt", record.startedAt);
  const completedAt = parseTime("completedAt", record.completedAt);
  if (completedAt <= startedAt) fail("completedAt must be after startedAt");
  if (record.thirdPartyCdnUsed !== false) fail("thirdPartyCdnUsed must be false");
  if (record.synthetic && !allowSynthetic) fail("synthetic deployment evidence requires --allow-synthetic");
  validateCommands(record.commands);
  validateServices(record.services);
  const incomplete = validateChecks(record.checks);
  if (record.environment !== "production") incomplete.push("environment");
  if (incomplete.length > 0 && !allowIncomplete && !record.synthetic) {
    fail(`deployment evidence is incomplete for launch: ${incomplete.join(", ")}`);
  }
  const status = incomplete.length === 0 ? "launch-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Deployment evidence OK: services=${requiredServices.length}, checks=${requiredChecks.length}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-deployment-evidence.js [--allow-incomplete] [--allow-synthetic] <deployment-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Deployment evidence validation failed: ${error.message}`);
  process.exit(1);
}
