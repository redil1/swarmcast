import { readFileSync } from "node:fs";

const requiredNotifications = [
  {
    id: "warning-firing",
    alertName: "SwarmcastLowOffloadRatio",
    severity: "warning",
    status: "firing",
    receiver: "oncall-default"
  },
  {
    id: "critical-firing",
    alertName: "SwarmcastHighStallRate",
    severity: "critical",
    status: "firing",
    receiver: "oncall-critical"
  },
  {
    id: "critical-resolved",
    alertName: "SwarmcastHighStallRate",
    severity: "critical",
    status: "resolved",
    receiver: "oncall-critical"
  }
];
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
  /webhooks?\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/i
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

function nonNegativeNumber(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${name} must be a non-negative number`);
  return value;
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

function requireEvidenceMarker(name, evidence, marker) {
  if (!evidence.some((item) => item.includes(marker))) fail(`${name} evidence must mention ${marker}`);
}

function validateCommandCheck(name, check, commandFragment) {
  if (!check || typeof check !== "object" || Array.isArray(check)) fail(`${name} is required`);
  const command = cleanString(`${name}.command`, check.command);
  if (!command.includes(commandFragment)) fail(`${name}.command must include ${commandFragment}`);
  if (!validStatuses.has(check.status)) fail(`${name}.status must be pass, fail, blocked, or partial`);
  const evidence = validateEvidenceList(`${name}.evidence`, check.evidence);
  requireEvidenceMarker(`${name}.evidence`, evidence, commandFragment);
  return check.status === "pass" ? [] : [name];
}

function validateNotifications(notifications) {
  if (!Array.isArray(notifications)) fail("notifications must be an array");
  const byId = new Map();
  const incomplete = [];
  for (const notification of notifications) {
    const id = cleanString("notification.id", notification.id, /^[a-z0-9-]+$/);
    if (byId.has(id)) fail(`duplicate notification ${id}`);
    byId.set(id, notification);
    const expected = requiredNotifications.find((item) => item.id === id);
    if (!expected) fail(`unexpected fire-drill notification ${id}`);
    cleanString(`${id}.alertName`, notification.alertName);
    cleanString(`${id}.severity`, notification.severity, /^(warning|critical)$/);
    cleanString(`${id}.status`, notification.status, /^(firing|resolved)$/);
    cleanString(`${id}.expectedReceiver`, notification.expectedReceiver, /^oncall-(default|critical)$/);
    cleanString(`${id}.observedReceiver`, notification.observedReceiver, /^oncall-(default|critical)$/);
    if (notification.alertName !== expected.alertName) fail(`${id}.alertName must be ${expected.alertName}`);
    if (notification.severity !== expected.severity) fail(`${id}.severity must be ${expected.severity}`);
    if (notification.status !== expected.status) fail(`${id}.status must be ${expected.status}`);
    if (notification.expectedReceiver !== expected.receiver) fail(`${id}.expectedReceiver must be ${expected.receiver}`);
    if (notification.observedReceiver !== expected.receiver) fail(`${id}.observedReceiver must be ${expected.receiver}`);
    if (notification.notificationObserved !== true) fail(`${id}.notificationObserved must be true`);
    if (notification.acknowledged !== true) incomplete.push(id);
    nonNegativeNumber(`${id}.ackSeconds`, notification.ackSeconds);
    const sentAt = parseTime(`${id}.sentAt`, notification.sentAt);
    const deliveredAt = parseTime(`${id}.deliveredAt`, notification.deliveredAt);
    const acknowledgedAt = parseTime(`${id}.acknowledgedAt`, notification.acknowledgedAt);
    if (deliveredAt < sentAt) fail(`${id}.deliveredAt must be at or after sentAt`);
    if (acknowledgedAt < deliveredAt) fail(`${id}.acknowledgedAt must be at or after deliveredAt`);
    const evidence = validateEvidenceList(`${id}.evidence`, notification.evidence);
    requireEvidenceMarker(`${id}.evidence`, evidence, id);
    requireEvidenceMarker(`${id}.evidence`, evidence, notification.observedReceiver);
    requireEvidenceMarker(`${id}.evidence`, evidence, "acknowledged");
  }
  for (const expected of requiredNotifications) {
    if (!byId.has(expected.id)) fail(`missing required fire-drill notification ${expected.id}`);
  }
  return incomplete;
}

function validateRecord(record, file) {
  cleanString("drillId", record.drillId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("receiverConfig", record.receiverConfig);
  const startedAt = parseTime("startedAt", record.startedAt);
  const completedAt = parseTime("completedAt", record.completedAt);
  if (completedAt <= startedAt) fail("completedAt must be after startedAt");
  if (record.synthetic && !allowSynthetic) fail("synthetic Alertmanager fire-drill evidence requires --allow-synthetic");

  const incomplete = [
    ...validateCommandCheck("receiverValidation", record.receiverValidation, "alertmanager:receivers:validate"),
    ...validateCommandCheck("routingSmoke", record.routingSmoke, "smoke:alertmanager-routing"),
    ...validateNotifications(record.notifications)
  ];
  if (incomplete.length > 0 && !allowIncomplete) {
    fail(`Alertmanager fire-drill evidence has incomplete checks: ${incomplete.join(", ")}`);
  }
  const status = incomplete.length === 0 ? "fire-drill-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Alertmanager fire-drill evidence OK: notifications=${requiredNotifications.length}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-alertmanager-fire-drill.js [--allow-incomplete] [--allow-synthetic] <fire-drill-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Alertmanager fire-drill evidence validation failed: ${error.message}`);
  process.exit(1);
}
