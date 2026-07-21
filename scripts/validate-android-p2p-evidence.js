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
const minimumSessionSeconds = 30 * 60;
const minimumVerifiedSegments = 100;
const maximumSampleIntervalSeconds = 30;
const requiredChecks = [
  "webrtc-offer-answer",
  "ice-connected",
  "datachannel-open",
  "peer-segment-transfer",
  "hash-verification",
  "edge-fallback",
  "tracker-stats",
  "p2p-disable-closes-peers",
  "cellular-receive-only",
  "relay-accounting"
];
const requiredDeviceNetworks = ["wifi", "cellular"];
const requiredTransferEvidence = [
  "webrtc-datachannel",
  "tracker-signaling-relay",
  "verified-segment-hash",
  "edge-fallback",
  "p2p-disable-closes-peers",
  "cellular-no-upload",
  "direct-relay-payload-attribution",
  "relay-egress-reconciled",
  "edge-egress-reconciled",
  "origin-bootstrap-reconciled",
  "physical-devices",
  "two-wifi-networks",
  "two-cellular-carriers",
  "play-installed",
  "cellular-zero-upload-measured",
  "30m-soak"
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

function assertReconciled(name, clientBytes, accessBytes, tolerance) {
  if (clientBytes === 0 && accessBytes === 0) return;
  const relativeError = Math.abs(clientBytes - accessBytes) / Math.max(clientBytes, accessBytes, 1);
  if (relativeError > tolerance) fail(`${name} is not reconciled within tolerance`);
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
  if (!Array.isArray(record.devices) || record.devices.length < 4) fail("devices must include at least four physical devices");
  const releaseApkSha256 = cleanString("releaseApkSha256", record.releaseApkSha256, /^[a-fA-F0-9]{64}$/).toLowerCase();
  const devices = new Map();
  const fingerprints = new Set();
  const wifiNetworks = new Set();
  const cellularCarriers = new Set();
  for (const device of record.devices) {
    const id = cleanString("device.id", device.id, /^[a-z0-9-]+$/);
    if (devices.has(id)) fail(`duplicate device ${id}`);
    cleanString(`${id}.name`, device.name);
    cleanString(`${id}.androidVersion`, device.androidVersion, /^[0-9][0-9._-]*$/);
    const network = cleanString(`${id}.network`, device.network, /^(wifi|cellular)$/);
    if (device.physical !== true) fail(`${id}.physical must be true`);
    cleanString(`${id}.installationSource`, device.installationSource, /^play-store$/);
    const fingerprint = cleanString(`${id}.deviceFingerprintSha256`, device.deviceFingerprintSha256, /^[a-fA-F0-9]{64}$/).toLowerCase();
    if (fingerprints.has(fingerprint)) fail(`duplicate physical device fingerprint for ${id}`);
    fingerprints.add(fingerprint);
    const apkSha256 = cleanString(`${id}.apkSha256`, device.apkSha256, /^[a-fA-F0-9]{64}$/).toLowerCase();
    if (apkSha256 !== releaseApkSha256) fail(`${id}.apkSha256 must match releaseApkSha256`);
    const measuredUploadBytes = integerField(`${id}.measuredUploadBytes`, device.measuredUploadBytes, { min: 0 });
    if (network === "wifi") {
      if (measuredUploadBytes === 0) fail(`${id}.measuredUploadBytes must prove useful WiFi upload`);
      wifiNetworks.add(cleanString(`${id}.wifiNetworkId`, device.wifiNetworkId, /^[a-z0-9][a-z0-9._-]*$/));
      if (device.carrierId !== undefined) fail(`${id}.carrierId must be omitted for wifi devices`);
    } else {
      if (measuredUploadBytes !== 0) fail(`${id}.measuredUploadBytes must be zero on cellular`);
      cellularCarriers.add(cleanString(`${id}.carrierId`, device.carrierId, /^[a-z0-9][a-z0-9._-]*$/));
      if (device.wifiNetworkId !== undefined) fail(`${id}.wifiNetworkId must be omitted for cellular devices`);
    }
    devices.set(id, device);
  }
  for (const network of requiredDeviceNetworks) {
    if (![...devices.values()].some((device) => device.network === network)) {
      fail(`devices must include ${network} Android P2P evidence`);
    }
  }
  if (wifiNetworks.size < 2) fail("devices must include at least two WiFi network failure domains");
  if (cellularCarriers.size < 2) fail("devices must include at least two cellular carrier failure domains");
  return devices;
}

function validateChecks(record, devices) {
  if (!Array.isArray(record.checks)) fail("checks must be an array");
  const seen = new Map();
  for (const check of record.checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9-]+$/);
    if (seen.has(id)) fail(`duplicate P2P check ${id}`);
    seen.set(id, check);
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
  return seen;
}

function validateTransfer(record, devices, checks) {
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
  const durationSeconds = integerField("transfer.durationSeconds", transfer.durationSeconds, { min: minimumSessionSeconds });
  const sampleIntervalSeconds = integerField("transfer.sampleIntervalSeconds", transfer.sampleIntervalSeconds, { min: 1, max: maximumSampleIntervalSeconds });
  integerField("transfer.sampleCount", transfer.sampleCount, { min: Math.floor(durationSeconds / sampleIntervalSeconds) });
  integerField("transfer.verifiedSegments", transfer.verifiedSegments, { min: minimumVerifiedSegments });
  const directP2pBytes = integerField("transfer.directP2pBytes", transfer.directP2pBytes, { min: 1 });
  const edgeBytes = integerField("transfer.edgeBytes", transfer.edgeBytes, { min: 0 });
  const bootstrapOriginBytes = integerField("transfer.bootstrapOriginBytes", transfer.bootstrapOriginBytes, { min: 0 });
  const relayBytes = integerField("transfer.relayBytes", transfer.relayBytes, { min: 0 });
  const relayAccessEgressBytes = integerField("transfer.relayAccessEgressBytes", transfer.relayAccessEgressBytes, { min: 0 });
  const edgeAccessEgressBytes = integerField("transfer.edgeAccessEgressBytes", transfer.edgeAccessEgressBytes, { min: 0 });
  const originAccessBootstrapBytes = integerField("transfer.originAccessBootstrapBytes", transfer.originAccessBootstrapBytes, { min: 0 });
  const trackerP2pDownloadBytes = integerField("transfer.trackerP2pDownloadBytes", transfer.trackerP2pDownloadBytes, { min: 1 });
  const trackerRelayDownloadBytes = integerField("transfer.trackerRelayDownloadBytes", transfer.trackerRelayDownloadBytes, { min: 0 });
  const sourceUploadBytes = integerField("transfer.sourceUploadBytes", transfer.sourceUploadBytes, { min: 1 });
  integerField("transfer.sinkUploadBytes", transfer.sinkUploadBytes, { min: 0, max: 0 });
  const trackerUploadBytes = integerField("transfer.trackerUploadBytes", transfer.trackerUploadBytes, { min: 1 });
  integerField("transfer.p2pDisabledActiveLinks", transfer.p2pDisabledActiveLinks, { min: 0, max: 0 });
  integerField("transfer.p2pDisabledEdgeBytes", transfer.p2pDisabledEdgeBytes, { min: 1 });
  const reconciliationTolerance = numberField("transfer.reconciliationTolerance", transfer.reconciliationTolerance, { min: 0, max: 0.05 });
  integerField("transfer.hashFailures", transfer.hashFailures, { min: 0, max: 0 });
  integerField("transfer.disconnects", transfer.disconnects, { min: 0, max: 0 });
  const offloadRatio = numberField("transfer.offloadRatio", transfer.offloadRatio, { min: 0.90, max: 1 });
  const totalDeliveryBytes = directP2pBytes + edgeBytes + bootstrapOriginBytes + relayBytes;
  const computedOffload = directP2pBytes / totalDeliveryBytes;
  if (Math.abs(computedOffload - offloadRatio) > 0.001) {
    fail("transfer.offloadRatio does not match direct P2P over all delivery bytes");
  }
  assertReconciled("transfer relay egress", relayBytes, relayAccessEgressBytes, reconciliationTolerance);
  assertReconciled("transfer edge egress", edgeBytes, edgeAccessEgressBytes, reconciliationTolerance);
  assertReconciled("transfer origin bootstrap", bootstrapOriginBytes, originAccessBootstrapBytes, reconciliationTolerance);
  assertReconciled("transfer tracker direct P2P", directP2pBytes, trackerP2pDownloadBytes, reconciliationTolerance);
  assertReconciled("transfer tracker relay", relayBytes, trackerRelayDownloadBytes, reconciliationTolerance);
  assertReconciled("transfer tracker upload", sourceUploadBytes, trackerUploadBytes, reconciliationTolerance);
  const measuredDeviceUploadBytes = [...devices.values()].reduce((total, device) => total + device.measuredUploadBytes, 0);
  assertReconciled("transfer device upload", measuredDeviceUploadBytes, sourceUploadBytes, reconciliationTolerance);
  if (sourceUploadBytes < directP2pBytes + relayBytes) {
    fail("transfer.sourceUploadBytes must cover direct and relayed peer payload");
  }
  numberField("transfer.stallRate", transfer.stallRate, { min: 0, max: budgets.androidStallRateMax });
  numberField("transfer.bufferMsMin", transfer.bufferMsMin, { min: budgets.androidBufferMsMin });
  numberField("transfer.batteryDrainPctPerHour", transfer.batteryDrainPctPerHour, { min: 0, max: budgets.androidBatteryDrainPctPerHour });
  validateEvidenceList("transfer.evidence", transfer.evidence);
  const joinedEvidence = transfer.evidence.join("\n");
  for (const required of requiredTransferEvidence) {
    if (!joinedEvidence.includes(required)) fail(`transfer.evidence must mention ${required}`);
  }
  const cellularDeviceIds = [...devices.values()]
    .filter((device) => device.network === "cellular")
    .map((device) => device.id);
  const cellularCheckIds = new Set(checks.get("cellular-receive-only")?.deviceIds || []);
  if (!cellularDeviceIds.every((id) => cellularCheckIds.has(id))) {
    fail("cellular-receive-only check must cover every cellular carrier device");
  }
}

function validateConnectivity(record, devices) {
  if (!record.connectivity || !Array.isArray(record.connectivity.devices)) {
    fail("connectivity.devices must be an array");
  }
  const connectedDevices = new Set();
  for (const row of record.connectivity.devices) {
    const deviceId = cleanString("connectivity.deviceId", row.deviceId, /^[a-z0-9-]+$/);
    if (!devices.has(deviceId)) fail(`connectivity references unknown device ${deviceId}`);
    if (connectedDevices.has(deviceId)) fail(`duplicate connectivity device ${deviceId}`);
    connectedDevices.add(deviceId);
    const attempts = integerField(`connectivity.${deviceId}.attempts`, row.attempts, { min: 1 });
    const successes = integerField(`connectivity.${deviceId}.successes`, row.successes, { min: 1 });
    const failures = integerField(`connectivity.${deviceId}.failures`, row.failures, { min: 0 });
    if (successes + failures !== attempts) fail(`connectivity.${deviceId} outcomes must equal attempts`);
    if (!row.selectedCandidates || typeof row.selectedCandidates !== "object") {
      fail(`connectivity.${deviceId}.selectedCandidates is required`);
    }
    const classified = ["host", "srflx", "prflx", "relay", "unknown"].reduce((total, type) =>
      total + integerField(`connectivity.${deviceId}.selectedCandidates.${type}`, row.selectedCandidates[type], { min: 0 }), 0);
    if (classified !== successes) fail(`connectivity.${deviceId} selected candidates must sum to successes`);
    if (row.selectedCandidates.unknown !== 0) fail(`connectivity.${deviceId} selected candidates must not be unknown`);
  }
  for (const deviceId of devices.keys()) {
    if (!connectedDevices.has(deviceId)) fail(`connectivity must include device ${deviceId}`);
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
  const checks = validateChecks(record, devices);
  validateTransfer(record, devices, checks);
  validateConnectivity(record, devices);
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
