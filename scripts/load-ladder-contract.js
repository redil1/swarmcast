import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const LOAD_STAGE_EXPECTATIONS = new Map([
  ["1-channel-3-devices", { channels: 1, peers: 3, offload: 0.5, distributed: false }],
  ["1-channel-200-peers", { channels: 1, peers: 200, offload: 0.9, distributed: true, minDurationSeconds: 300, minGenerators: 2 }],
  ["50-channels-2000-peers", { channels: 50, peers: 2000, offload: 0.9, distributed: true, minDurationSeconds: 600, minGenerators: 2 }],
  ["zipf-catalog", { channels: 50, peers: 2000, offload: 0.9, distributed: true, minDurationSeconds: 600, minGenerators: 2 }],
  ["1-channel-1000-cell-peers", { channels: 1, peers: 1000, offload: 0.9, minCells: 2, distributed: true, minDurationSeconds: 600, minGenerators: 2 }],
  ["1-channel-10000-cell-peers", { channels: 1, peers: 10000, offload: 0.9, minCells: 2, distributed: true, minDurationSeconds: 600, minGenerators: 2 }],
  ["1-channel-100000-cell-peers", { channels: 1, peers: 100000, offload: 0.9, minCells: 5, distributed: true, minDurationSeconds: 900, minGenerators: 5 }]
]);

const FORBIDDEN_KEY = /token|secret|password|credential|authorization|cookie|source.?url|peer.?id|public.?ip|email/i;
const FORBIDDEN_VALUE = /(?:bearer\s+[A-Za-z0-9._~-]+|-----BEGIN|(?:token|secret|password|credential|authorization|cookie)=)/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PROBE_KEYS = new Set([
  "schemaVersion", "synthetic", "probeId", "runId", "stageId", "environment", "commit", "releaseVersion",
  "targetId", "generatorId", "generatorProvider", "generatorRegion", "generatorFailureDomain",
  "networkEgressFingerprintSha256", "driverSha256", "driverImageDigest", "transport", "signalingPath", "authMode",
  "startedAt", "completedAt", "durationSeconds", "assignedPeerStart", "assignedPeerCount", "joinedPeers", "joinFailures",
  "dataChannelEndpoints", "successfulConnections", "failedConnections", "verifiedSendTransfers", "verifiedReceiveTransfers",
  "failedTransfers", "crossGeneratorEndpoints", "remoteGeneratorIds", "signalingMessages", "clientP2pBytes", "clientEdgeBytes",
  "clientBootstrapOriginBytes", "clientRelayBytes", "clientUploadBytes", "verifiedPayloadBytesSent",
  "verifiedPayloadBytesReceived", "candidateSelections", "playbackSamples", "stallEvents", "startupLatencyMsP95",
  "bufferMsMin", "joinLatencyMsP95", "channelOpenMsP95", "transferMsP95", "trackerCellIds", "evidenceMarkers"
]);

export function failLoadContract(message) {
  throw new Error(message);
}

export function cleanLoadString(name, value, pattern = null) {
  if (typeof value !== "string" || value.trim() === "") failLoadContract(`${name} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) failLoadContract(`${name} has invalid format`);
  return normalized;
}

export function loadInteger(name, value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    failLoadContract(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function loadNumber(name, value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    failLoadContract(`${name} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

export function loadTime(name, value) {
  const normalized = cleanLoadString(name, value);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) failLoadContract(`${name} must be ISO-8601 parseable`);
  return parsed;
}

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function assertSanitized(value, path = "probe") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitized(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && FORBIDDEN_VALUE.test(value)) {
      failLoadContract(`${path} contains sensitive material`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) failLoadContract(`${path} contains forbidden key ${key}`);
    assertSanitized(child, `${path}.${key}`);
  }
}

function validateCandidateSelections(name, value, successfulConnections) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failLoadContract(`${name} is required`);
  }
  const candidateKeys = Object.keys(value);
  if (candidateKeys.length !== 5 || candidateKeys.some((key) => !["host", "srflx", "prflx", "relay", "unknown"].includes(key))) {
    failLoadContract(`${name} contains unsupported candidate fields`);
  }
  let total = 0;
  for (const type of ["host", "srflx", "prflx", "relay", "unknown"]) {
    total += loadInteger(`${name}.${type}`, value[type], { min: 0 });
  }
  if (value.unknown !== 0) failLoadContract(`${name}.unknown must equal 0`);
  if (total !== successfulConnections) {
    failLoadContract(`${name} must reconcile to successfulConnections`);
  }
}

export function validateLoadProbe(input, { allowSynthetic = false, source = "probe" } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) failLoadContract(`${source} must be an object`);
  assertSanitized(input, source);
  for (const key of Object.keys(input)) {
    if (!PROBE_KEYS.has(key)) failLoadContract(`${source} contains unsupported key ${key}`);
  }
  const probe = structuredClone(input);
  if (probe.schemaVersion !== 1) failLoadContract(`${source}.schemaVersion must equal 1`);
  const synthetic = probe.synthetic === true;
  if (synthetic && !allowSynthetic) failLoadContract(`${source} synthetic evidence requires --allow-synthetic`);
  const probeId = cleanLoadString(`${source}.probeId`, probe.probeId, ID_PATTERN);
  cleanLoadString(`${source}.runId`, probe.runId, ID_PATTERN);
  const stageId = cleanLoadString(`${source}.stageId`, probe.stageId, ID_PATTERN);
  const expectation = LOAD_STAGE_EXPECTATIONS.get(stageId);
  if (!expectation?.distributed) failLoadContract(`${source}.stageId must identify a distributed load stage`);
  cleanLoadString(`${source}.environment`, probe.environment, /^(staging|production)$/);
  cleanLoadString(`${source}.commit`, probe.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanLoadString(`${source}.releaseVersion`, probe.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanLoadString(`${source}.targetId`, probe.targetId, ID_PATTERN);
  cleanLoadString(`${source}.generatorId`, probe.generatorId, ID_PATTERN);
  cleanLoadString(`${source}.generatorProvider`, probe.generatorProvider, ID_PATTERN);
  cleanLoadString(`${source}.generatorRegion`, probe.generatorRegion, ID_PATTERN);
  cleanLoadString(`${source}.generatorFailureDomain`, probe.generatorFailureDomain, ID_PATTERN);
  cleanLoadString(`${source}.networkEgressFingerprintSha256`, probe.networkEgressFingerprintSha256, HASH_PATTERN);
  cleanLoadString(`${source}.driverSha256`, probe.driverSha256, HASH_PATTERN);
  cleanLoadString(`${source}.driverImageDigest`, probe.driverImageDigest, IMAGE_DIGEST_PATTERN);
  cleanLoadString(`${source}.transport`, probe.transport, /^webrtc-datachannel$/);
  cleanLoadString(`${source}.signalingPath`, probe.signalingPath, /^tracker-signaling-relay$/);
  cleanLoadString(`${source}.authMode`, probe.authMode, /^per-viewer-short-lived$/);
  const startedAt = loadTime(`${source}.startedAt`, probe.startedAt);
  const completedAt = loadTime(`${source}.completedAt`, probe.completedAt);
  if (completedAt <= startedAt) failLoadContract(`${source}.completedAt must be after startedAt`);
  const minimumDuration = synthetic ? 1 : expectation.minDurationSeconds;
  const durationSeconds = loadInteger(`${source}.durationSeconds`, probe.durationSeconds, { min: minimumDuration, max: 7200 });
  const observedDuration = (completedAt - startedAt) / 1000;
  if (Math.abs(observedDuration - durationSeconds) > 2) {
    failLoadContract(`${source}.durationSeconds does not match probe timestamps`);
  }
  loadInteger(`${source}.assignedPeerStart`, probe.assignedPeerStart, { min: 0, max: expectation.peers - 1 });
  const assignedPeerCount = loadInteger(`${source}.assignedPeerCount`, probe.assignedPeerCount, { min: 2, max: expectation.peers });
  loadInteger(`${source}.joinedPeers`, probe.joinedPeers, { min: assignedPeerCount, max: assignedPeerCount });
  loadInteger(`${source}.joinFailures`, probe.joinFailures, { min: 0, max: 0 });
  loadInteger(`${source}.dataChannelEndpoints`, probe.dataChannelEndpoints, { min: assignedPeerCount, max: assignedPeerCount });
  const successfulConnections = loadInteger(`${source}.successfulConnections`, probe.successfulConnections, {
    min: assignedPeerCount,
    max: assignedPeerCount
  });
  loadInteger(`${source}.failedConnections`, probe.failedConnections, { min: 0, max: 0 });
  const verifiedSendTransfers = loadInteger(`${source}.verifiedSendTransfers`, probe.verifiedSendTransfers, { min: 1 });
  const verifiedReceiveTransfers = loadInteger(`${source}.verifiedReceiveTransfers`, probe.verifiedReceiveTransfers, { min: 1 });
  loadInteger(`${source}.failedTransfers`, probe.failedTransfers, { min: 0, max: 0 });
  const crossGeneratorEndpoints = loadInteger(`${source}.crossGeneratorEndpoints`, probe.crossGeneratorEndpoints, { min: 1, max: assignedPeerCount });
  if (!Array.isArray(probe.remoteGeneratorIds) || probe.remoteGeneratorIds.length === 0) {
    failLoadContract(`${source}.remoteGeneratorIds must be a non-empty array`);
  }
  const remoteIds = new Set(probe.remoteGeneratorIds.map((value, index) => (
    cleanLoadString(`${source}.remoteGeneratorIds[${index}]`, value, ID_PATTERN)
  )));
  if (remoteIds.size !== probe.remoteGeneratorIds.length || remoteIds.has(probe.generatorId)) {
    failLoadContract(`${source}.remoteGeneratorIds must be unique and exclude generatorId`);
  }
  loadInteger(`${source}.signalingMessages`, probe.signalingMessages, { min: successfulConnections * 2 });
  const direct = loadInteger(`${source}.clientP2pBytes`, probe.clientP2pBytes, { min: 1 });
  const edge = loadInteger(`${source}.clientEdgeBytes`, probe.clientEdgeBytes, { min: 0 });
  const origin = loadInteger(`${source}.clientBootstrapOriginBytes`, probe.clientBootstrapOriginBytes, { min: 0 });
  const relay = loadInteger(`${source}.clientRelayBytes`, probe.clientRelayBytes, { min: 0 });
  const upload = loadInteger(`${source}.clientUploadBytes`, probe.clientUploadBytes, { min: 1 });
  const sent = loadInteger(`${source}.verifiedPayloadBytesSent`, probe.verifiedPayloadBytesSent, { min: 1 });
  const received = loadInteger(`${source}.verifiedPayloadBytesReceived`, probe.verifiedPayloadBytesReceived, { min: 1 });
  if (upload !== sent) failLoadContract(`${source}.clientUploadBytes must equal verifiedPayloadBytesSent`);
  if (direct + relay > received) {
    failLoadContract(`${source} peer-delivered bytes exceed verifiedPayloadBytesReceived`);
  }
  if (verifiedSendTransfers > successfulConnections || verifiedReceiveTransfers > successfulConnections) {
    failLoadContract(`${source} verified transfers exceed successfulConnections`);
  }
  validateCandidateSelections(`${source}.candidateSelections`, probe.candidateSelections, successfulConnections);
  const playbackSamples = loadInteger(`${source}.playbackSamples`, probe.playbackSamples, { min: assignedPeerCount });
  loadInteger(`${source}.stallEvents`, probe.stallEvents, { min: 0, max: playbackSamples });
  loadNumber(`${source}.startupLatencyMsP95`, probe.startupLatencyMsP95, { min: 0 });
  loadInteger(`${source}.bufferMsMin`, probe.bufferMsMin, { min: 0 });
  loadNumber(`${source}.joinLatencyMsP95`, probe.joinLatencyMsP95, { min: 0 });
  loadNumber(`${source}.channelOpenMsP95`, probe.channelOpenMsP95, { min: 0 });
  loadNumber(`${source}.transferMsP95`, probe.transferMsP95, { min: 0 });
  if (!Array.isArray(probe.trackerCellIds) || probe.trackerCellIds.length === 0) {
    failLoadContract(`${source}.trackerCellIds must be a non-empty array`);
  }
  const trackerCellIds = new Set(probe.trackerCellIds.map((value, index) => (
    cleanLoadString(`${source}.trackerCellIds[${index}]`, value, ID_PATTERN)
  )));
  if (trackerCellIds.size !== probe.trackerCellIds.length) failLoadContract(`${source}.trackerCellIds must be unique`);
  if (!Array.isArray(probe.evidenceMarkers)) failLoadContract(`${source}.evidenceMarkers must be an array`);
  const markers = new Set(probe.evidenceMarkers.map((value, index) => (
    cleanLoadString(`${source}.evidenceMarkers[${index}]`, value, ID_PATTERN)
  )));
  for (const marker of ["webrtc-datachannel", "tracker-signaling-relay", "sha256-verified", "cross-generator-transfer", "per-viewer-auth"]) {
    if (!markers.has(marker)) failLoadContract(`${source}.evidenceMarkers missing ${marker}`);
  }
  return {
    ...probe,
    probeId,
    stageId,
    startedAtMs: startedAt,
    completedAtMs: completedAt,
    crossGeneratorEndpoints,
    assignedPeerCount,
    verifiedSendTransfers,
    verifiedReceiveTransfers,
    deliveryBytes: direct + edge + origin + relay
  };
}

export function validateLoadProbeBundle(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) failLoadContract("probe bundle must be an object");
  for (const key of Object.keys(input)) {
    if (!["schemaVersion", "synthetic", "probes"].includes(key)) {
      failLoadContract(`probe bundle contains unsupported key ${key}`);
    }
  }
  if (input.schemaVersion !== 1) failLoadContract("probe bundle schemaVersion must equal 1");
  if (!Array.isArray(input.probes) || input.probes.length === 0) failLoadContract("probe bundle must contain probes");
  if (input.synthetic === true && !options.allowSynthetic) {
    failLoadContract("synthetic probe bundle requires --allow-synthetic");
  }
  const probes = input.probes.map((probe, index) => validateLoadProbe(probe, {
    ...options,
    source: `probes[${index}]`
  }));
  const ids = new Set();
  for (const probe of probes) {
    if (ids.has(probe.probeId)) failLoadContract(`duplicate probeId ${probe.probeId}`);
    ids.add(probe.probeId);
    if ((probe.synthetic === true) !== (input.synthetic === true)) {
      failLoadContract(`probe ${probe.probeId} synthetic flag does not match its bundle`);
    }
  }
  return { ...input, probes };
}
