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
  "webrtc-offer-answer",
  "ice-connected",
  "datachannel-open",
  "peer-segment-transfer",
  "hash-verification",
  "edge-fallback",
  "tracker-stats",
  "p2p-disable-closes-peers",
  "cellular-receive-only"
];
const requiredDeviceNetworks = ["wifi", "cellular"];
const requiredTransferEvidence = [
  "webrtc-datachannel",
  "tracker-signaling-relay",
  "verified-segment-hash",
  "edge-fallback",
  "p2p-disable-closes-peers",
  "cellular-no-upload"
];
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

function integerField(name, value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (!Number.isInteger(value)) fail(`${name} must be an integer`);
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
  if (!Array.isArray(record.devices) || record.devices.length < 2) fail("devices must include at least two devices");
  const devices = new Map();
  for (const device of record.devices) {
    const id = cleanString("device.id", device.id, /^[a-z0-9-]+$/);
    if (devices.has(id)) fail(`duplicate device ${id}`);
    cleanString(`${id}.name`, device.name);
    cleanString(`${id}.androidVersion`, device.androidVersion, /^[0-9][0-9._-]*$/);
    cleanString(`${id}.network`, device.network, /^(wifi|cellular|ethernet)$/);
    devices.set(id, device);
  }
  for (const network of requiredDeviceNetworks) {
    if (![...devices.values()].some((device) => device.network === network)) {
      fail(`devices must include ${network} Android P2P evidence`);
    }
  }
  return devices;
}

function validateChecks(record, devices) {
  if (!Array.isArray(record.checks)) fail("checks must be an array");
  const seen = new Set();
  for (const check of record.checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9-]+$/);
    if (seen.has(id)) fail(`duplicate P2P check ${id}`);
    seen.add(id);
    if (check.status !== "pass") fail(`${id}.status must pass before Android P2P approval`);
    cleanString(`${id}.owner`, check.owner);
    if (!Array.isArray(check.deviceIds) || check.deviceIds.length < 2) fail(`${id}.deviceIds must include at least two devices`);
    for (const deviceId of check.deviceIds) {
      const normalized = cleanString(`${id}.deviceIds[]`, deviceId, /^[a-z0-9-]+$/);
      if (!devices.has(normalized)) fail(`${id} references unknown device ${normalized}`);
    }
    validateEvidenceList(`${id}.evidence`, check.evidence);
  }
  for (const id of requiredChecks) {
    if (!seen.has(id)) fail(`missing required Android P2P check ${id}`);
  }
}

function validateTransfer(record, devices) {
  const transfer = record.transfer;
  if (!transfer || typeof transfer !== "object") fail("transfer is required");
  cleanString("transfer.channelId", transfer.channelId, /^[a-zA-Z0-9._-]+$/);
  cleanString("transfer.deliveryMode", transfer.deliveryMode, /^p2p-with-edge-fallback$/);
  if (transfer.p2pEnabled !== true) fail("transfer.p2pEnabled must be true");
  if (transfer.edgeFallbackVerified !== true) fail("transfer.edgeFallbackVerified must be true");
  for (const key of ["sourceDeviceId", "sinkDeviceId"]) {
    const id = cleanString(`transfer.${key}`, transfer[key], /^[a-z0-9-]+$/);
    if (!devices.has(id)) fail(`transfer.${key} references unknown device ${id}`);
  }
  if (transfer.sourceDeviceId === transfer.sinkDeviceId) fail("transfer source and sink devices must differ");
  if (devices.get(transfer.sourceDeviceId).network !== "wifi") fail("transfer source device must be wifi for upload evidence");
  if (devices.get(transfer.sinkDeviceId).network !== "cellular") fail("transfer sink device must be cellular for receive-only evidence");
  integerField("transfer.verifiedSegments", transfer.verifiedSegments, { min: 1 });
  integerField("transfer.peerBytes", transfer.peerBytes, { min: 1 });
  integerField("transfer.edgeBytes", transfer.edgeBytes, { min: 0 });
  integerField("transfer.hashFailures", transfer.hashFailures, { min: 0, max: 0 });
  integerField("transfer.disconnects", transfer.disconnects, { min: 0, max: 0 });
  numberField("transfer.offloadRatio", transfer.offloadRatio, { min: 0.01, max: 1 });
  numberField("transfer.stallRate", transfer.stallRate, { min: 0, max: budgets.androidStallRateMax });
  numberField("transfer.bufferMsMin", transfer.bufferMsMin, { min: budgets.androidBufferMsMin });
  validateEvidenceList("transfer.evidence", transfer.evidence);
  const joinedEvidence = transfer.evidence.join("\n");
  for (const required of requiredTransferEvidence) {
    if (!joinedEvidence.includes(required)) fail(`transfer.evidence must mention ${required}`);
  }
}

function validateConnectivity(record) {
  if (!record.connectivity || !Array.isArray(record.connectivity.networks)) {
    fail("connectivity.networks must be an array");
  }
  const networks = new Set();
  for (const row of record.connectivity.networks) {
    const network = cleanString("connectivity.network", row.network, /^(wifi|cellular|ethernet)$/);
    if (networks.has(network)) fail(`duplicate connectivity network ${network}`);
    networks.add(network);
    const attempts = integerField(`connectivity.${network}.attempts`, row.attempts, { min: 1 });
    const successes = integerField(`connectivity.${network}.successes`, row.successes, { min: 0 });
    const failures = integerField(`connectivity.${network}.failures`, row.failures, { min: 0 });
    if (successes + failures > attempts) fail(`connectivity.${network} outcomes exceed attempts`);
    if (!row.selectedCandidates || typeof row.selectedCandidates !== "object") {
      fail(`connectivity.${network}.selectedCandidates is required`);
    }
    const classified = ["host", "srflx", "prflx", "relay", "unknown"].reduce((total, type) =>
      total + integerField(`connectivity.${network}.selectedCandidates.${type}`, row.selectedCandidates[type], { min: 0 }), 0);
    if (classified !== successes) fail(`connectivity.${network} selected candidates must sum to successes`);
  }
  for (const network of requiredDeviceNetworks) {
    if (!networks.has(network)) fail(`connectivity must include ${network} ICE outcomes`);
  }
  validateEvidenceList("connectivity.evidence", record.connectivity.evidence);
  const evidence = record.connectivity.evidence.join("\n");
  for (const marker of ["ice-network-class", "ice-selected-candidate-type"]) {
    if (!evidence.includes(marker)) fail(`connectivity.evidence must mention ${marker}`);
  }
}

function validateRecord(record, file) {
  cleanString("reviewId", record.reviewId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("appVersion", record.appVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  parseTime("testedAt", record.testedAt);
  if (record.synthetic && !allowSynthetic) fail("synthetic Android P2P evidence requires --allow-synthetic");
  const devices = validateDevices(record);
  validateChecks(record, devices);
  validateTransfer(record, devices);
  validateConnectivity(record);
  return `${file}: Android P2P evidence OK: devices=${devices.size}, checks=${requiredChecks.length}, verifiedSegments=${record.transfer.verifiedSegments}`;
}

if (!budgetPath || files.length === 0) {
  console.error("Usage: node scripts/validate-android-p2p-evidence.js [--allow-synthetic] [--budgets config/performance-budgets.json] <android-p2p-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Android P2P evidence validation failed: ${error.message}`);
  process.exit(1);
}
