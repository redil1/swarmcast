import { readFileSync } from "node:fs";

const requiredChecks = [
  "ubuntu-2404-lts",
  "docker-compose-installed",
  "sysctl-applied",
  "file-limits-applied",
  "tmpfs-var-hls-mounted",
  "firewall-applied",
  "internal-ports-denied",
  "tls-certificates-issued",
  "certbot-renew-dry-run",
  "compose-renders",
  "public-dns-configured"
];
const requiredHostRoles = ["origin", "edge", "api", "tracker", "control-plane", "retention-worker", "turn", "monitoring"];
const requiredCheckEvidence = Object.fromEntries(requiredChecks.map((id) => [id, id]));
const requiredDeniedPorts = [7000, 7001, 7002, 7003, 7010, 7020, 9101];
const args = process.argv.slice(2);
const allowIncomplete = args.includes("--allow-incomplete");
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const validStatuses = new Set(["pass", "fail", "blocked", "partial"]);
const hostnamePattern = /^(?!.*(?:example|localhost|127\.0\.0\.1|0\.0\.0\.0))[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i;
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
  const time = Date.parse(normalized);
  if (Number.isNaN(time)) fail(`${name} must be ISO-8601 parseable`);
  return time;
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

function validateHosts(hosts) {
  if (!Array.isArray(hosts) || hosts.length === 0) fail("hosts must be a non-empty array");
  const roles = new Set();
  const ids = new Set();
  for (const host of hosts) {
    const id = cleanString("host.id", host.id, /^[a-z0-9][a-z0-9-]*$/);
    if (ids.has(id)) fail(`duplicate host ${id}`);
    ids.add(id);
    const role = cleanString(`${host.id}.role`, host.role, /^(origin|edge|api|tracker|control-plane|retention-worker|turn|monitoring)$/);
    roles.add(role);
    if (!Array.isArray(host.publicHostnames) || host.publicHostnames.length === 0) fail(`${host.id}.publicHostnames must be non-empty`);
    for (const hostname of host.publicHostnames) cleanString(`${host.id}.publicHostnames[]`, hostname, hostnamePattern);
    validateEvidenceList(`${host.id}.evidence`, host.evidence);
  }
  for (const role of requiredHostRoles) {
    if (!roles.has(role)) fail(`hosts must include ${role}`);
  }
}

function validateChecks(checks) {
  if (!Array.isArray(checks)) fail("checks must be an array");
  const byId = new Map();
  const incomplete = [];
  for (const check of checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9-]+$/);
    if (byId.has(id)) fail(`duplicate host provisioning check ${id}`);
    byId.set(id, check);
    cleanString(`${id}.owner`, check.owner);
    if (!validStatuses.has(check.status)) fail(`${id}.status must be pass, fail, blocked, or partial`);
    validateEvidenceList(`${id}.evidence`, check.evidence);
    const requiredEvidence = requiredCheckEvidence[id];
    if (requiredEvidence && !check.evidence.join("\n").includes(requiredEvidence)) {
      fail(`${id}.evidence must mention ${requiredEvidence}`);
    }
    if (check.status !== "pass") incomplete.push(id);
  }
  for (const id of requiredChecks) {
    if (!byId.has(id)) fail(`missing required host provisioning check ${id}`);
  }
  return incomplete;
}

function validatePorts(record) {
  if (!Array.isArray(record.publicTcpPorts) || record.publicTcpPorts.join(",") !== "80,443") {
    fail("publicTcpPorts must be exactly [80,443]");
  }
  if (!Array.isArray(record.deniedInternalTcpPorts)) fail("deniedInternalTcpPorts must be an array");
  for (const port of requiredDeniedPorts) {
    if (!record.deniedInternalTcpPorts.includes(port)) fail(`deniedInternalTcpPorts must include ${port}`);
  }
  if (!Array.isArray(record.turnPublicUdpPorts) || record.turnPublicUdpPorts.join(",") !== "3478") {
    fail("turnPublicUdpPorts must be exactly [3478]");
  }
  if (!Array.isArray(record.turnPublicTcpPorts) || record.turnPublicTcpPorts.join(",") !== "3478,5349") {
    fail("turnPublicTcpPorts must be exactly [3478,5349]");
  }
  if (!Array.isArray(record.turnRelayPortRange) || record.turnRelayPortRange.join(",") !== "49152,65535") {
    fail("turnRelayPortRange must be exactly [49152,65535]");
  }
  if (record.turnMetricsRestrictedToMonitoring !== true) {
    fail("turnMetricsRestrictedToMonitoring must be true");
  }
}

function validateRecord(record, file) {
  cleanString("evidenceId", record.evidenceId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  const startedAt = parseTime("startedAt", record.startedAt);
  const completedAt = parseTime("completedAt", record.completedAt);
  if (completedAt <= startedAt) fail("completedAt must be after startedAt");
  if (record.thirdPartyCdnUsed !== false) fail("thirdPartyCdnUsed must be false");
  if (record.synthetic && !allowSynthetic) fail("synthetic host provisioning evidence requires --allow-synthetic");
  validateHosts(record.hosts);
  validatePorts(record);
  const incomplete = validateChecks(record.checks);
  if (record.environment !== "production") incomplete.push("environment");
  if (incomplete.length > 0 && !allowIncomplete && !record.synthetic) {
    fail(`host provisioning evidence is incomplete for launch: ${incomplete.join(", ")}`);
  }
  const status = incomplete.length === 0 ? "launch-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Host provisioning evidence OK: hosts=${record.hosts.length}, checks=${requiredChecks.length}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-host-provisioning-evidence.js [--allow-incomplete] [--allow-synthetic] <host-provisioning-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Host provisioning evidence validation failed: ${error.message}`);
  process.exit(1);
}
