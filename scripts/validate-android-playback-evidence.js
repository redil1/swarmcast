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
const minimumSoakSeconds = 30 * 60;
const requiredPlaybackNetworks = ["wifi", "cellular"];
const requiredSessionEvidence = ["delivery-fleet-only", "30m-soak", "edge-cache-hit", "crash-free"];
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
  return value;
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

function validateDevices(record) {
  if (!Array.isArray(record.devices) || record.devices.length === 0) fail("devices must include at least one device");
  const devices = new Map();
  for (const device of record.devices) {
    const id = cleanString("device.id", device.id, /^[a-z0-9-]+$/);
    if (devices.has(id)) fail(`duplicate device ${id}`);
    cleanString(`${id}.name`, device.name);
    cleanString(`${id}.androidVersion`, device.androidVersion, /^[0-9][0-9._-]*$/);
    cleanString(`${id}.network`, device.network, /^(wifi|cellular|ethernet)$/);
    devices.set(id, device);
  }
  return devices;
}

function validateSessions(record, devices) {
  if (!Array.isArray(record.sessions) || record.sessions.length === 0) fail("sessions must include at least one playback session");
  const sessionIds = new Set();
  const observedNetworks = new Set();
  for (const session of record.sessions) {
    const id = cleanString("session.id", session.id, /^[a-z0-9-]+$/);
    if (sessionIds.has(id)) fail(`duplicate playback session ${id}`);
    sessionIds.add(id);
    const deviceId = cleanString(`${id}.deviceId`, session.deviceId, /^[a-z0-9-]+$/);
    if (!devices.has(deviceId)) fail(`${id} references unknown device ${deviceId}`);
    observedNetworks.add(devices.get(deviceId).network);
    cleanString(`${id}.channelId`, session.channelId, /^[a-zA-Z0-9._-]+$/);
    cleanString(`${id}.deliveryMode`, session.deliveryMode, /^delivery-fleet-only$/);
    if (session.p2pEnabled !== false) fail(`${id}.p2pEnabled must be false`);
    if (session.authenticated !== true) fail(`${id}.authenticated must be true`);
    if (session.crashFree !== true) fail(`${id}.crashFree must be true`);
    numberField(`${id}.durationSeconds`, session.durationSeconds, { min: minimumSoakSeconds });
    numberField(`${id}.startupLatencyMsP95`, session.startupLatencyMsP95, { min: 0, max: budgets.androidStartupLatencyMsP95 });
    numberField(`${id}.stallRate`, session.stallRate, { min: 0, max: budgets.androidStallRateMax });
    numberField(`${id}.bufferMsMin`, session.bufferMsMin, { min: budgets.androidBufferMsMin });
    numberField(`${id}.edgeCacheHitRatio`, session.edgeCacheHitRatio, { min: budgets.edgeCacheHitRatioMin, max: 1 });
    numberField(`${id}.batteryDrainPctPerHour`, session.batteryDrainPctPerHour, { min: 0, max: budgets.androidBatteryDrainPctPerHour });
    validateEvidenceList(`${id}.evidence`, session.evidence);
    const joinedEvidence = session.evidence.join("\n");
    for (const required of requiredSessionEvidence) {
      if (!joinedEvidence.includes(required)) fail(`${id}.evidence must mention ${required}`);
    }
  }
  for (const network of requiredPlaybackNetworks) {
    if (!observedNetworks.has(network)) fail(`playback sessions must include ${network} device evidence`);
  }
}

function validateRecord(record, file) {
  cleanString("reviewId", record.reviewId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("appVersion", record.appVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  parseTime("testedAt", record.testedAt);
  if (record.synthetic && !allowSynthetic) fail("synthetic Android playback evidence requires --allow-synthetic");
  const devices = validateDevices(record);
  validateSessions(record, devices);
  return `${file}: Android playback evidence OK: devices=${devices.size}, sessions=${record.sessions.length}, minSoakSeconds=${minimumSoakSeconds}`;
}

if (!budgetPath || files.length === 0) {
  console.error("Usage: node scripts/validate-android-playback-evidence.js [--allow-synthetic] [--budgets config/performance-budgets.json] <android-playback-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Android playback evidence validation failed: ${error.message}`);
  process.exit(1);
}
