import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { validatePerformanceBudgets } from "../packages/config/src/performanceBudgets.js";
import {
  LOAD_STAGE_EXPECTATIONS,
  sha256File,
  validateLoadProbeBundle
} from "./load-ladder-contract.js";

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
const stageExpectations = LOAD_STAGE_EXPECTATIONS;
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

function assertReconciled(name, clientBytes, accessLogBytes, tolerance) {
  const denominator = Math.max(clientBytes, accessLogBytes, 1);
  const delta = Math.abs(clientBytes - accessLogBytes) / denominator;
  if (delta > tolerance) fail(`${name} differs by ${delta.toFixed(4)}, above tolerance ${tolerance}`);
}

function loadProbeArtifacts(record, evidenceFile) {
  if (!Array.isArray(record.probeArtifacts) || record.probeArtifacts.length === 0) {
    fail("probeArtifacts must include raw distributed load probe bundles");
  }
  const evidenceDirectory = path.dirname(path.resolve(evidenceFile));
  const probes = new Map();
  const artifactPaths = new Set();
  for (const [index, artifact] of record.probeArtifacts.entries()) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      fail(`probeArtifacts[${index}] must be an object`);
    }
    if (Object.keys(artifact).length !== 2 || Object.keys(artifact).some((key) => !["path", "sha256"].includes(key))) {
      fail(`probeArtifacts[${index}] must contain only path and sha256`);
    }
    const relativePath = cleanString(`probeArtifacts[${index}].path`, artifact.path, /^[A-Za-z0-9._/-]+\.json$/);
    if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
      fail(`probeArtifacts[${index}].path must stay within the evidence directory`);
    }
    if (artifactPaths.has(relativePath)) fail(`duplicate probe artifact path ${relativePath}`);
    artifactPaths.add(relativePath);
    const expectedSha256 = cleanString(`probeArtifacts[${index}].sha256`, artifact.sha256, /^[a-f0-9]{64}$/);
    const resolved = path.resolve(evidenceDirectory, relativePath);
    if (resolved !== evidenceDirectory && !resolved.startsWith(`${evidenceDirectory}${path.sep}`)) {
      fail(`probeArtifacts[${index}].path escapes the evidence directory`);
    }
    let bundle;
    try {
      const stat = lstatSync(resolved);
      if (!stat.isFile() || stat.isSymbolicLink()) fail(`probe artifact ${relativePath} must be a regular file`);
      if (stat.size <= 0 || stat.size > 64 * 1024 * 1024) fail(`probe artifact ${relativePath} has invalid size`);
      if (!record.synthetic && (stat.mode & 0o777) !== 0o600) {
        fail(`probe artifact ${relativePath} must use mode 0600`);
      }
      const actualSha256 = sha256File(resolved);
      if (actualSha256 !== expectedSha256) fail(`probe artifact ${relativePath} SHA-256 mismatch`);
      bundle = validateLoadProbeBundle(JSON.parse(readFileSync(resolved, "utf8")), { allowSynthetic });
    } catch (error) {
      fail(`probe artifact ${relativePath} is invalid: ${error.message}`);
    }
    for (const probe of bundle.probes) {
      if (probes.has(probe.probeId)) fail(`duplicate distributed probe ${probe.probeId}`);
      probes.set(probe.probeId, { ...probe, artifactPath: relativePath });
    }
  }
  return probes;
}

function validateDistributedStage(stage, id, expected, record, probeStore) {
  if (!Array.isArray(stage.generatorProbeIds) || stage.generatorProbeIds.length < expected.minGenerators) {
    fail(`${id}.generatorProbeIds must include at least ${expected.minGenerators} independent generators`);
  }
  const probeIds = new Set(stage.generatorProbeIds.map((value, index) => (
    cleanString(`${id}.generatorProbeIds[${index}]`, value, /^[a-z0-9][a-z0-9._-]*$/)
  )));
  if (probeIds.size !== stage.generatorProbeIds.length) fail(`${id}.generatorProbeIds must be unique`);
  const probes = [...probeIds].map((probeId) => {
    const probe = probeStore.get(probeId);
    if (!probe) fail(`${id}.generatorProbeIds references missing probe ${probeId}`);
    if (probe.usedByStage) fail(`distributed probe ${probeId} is referenced by multiple stages`);
    probe.usedByStage = id;
    return probe;
  });
  const runId = cleanString(`${id}.runId`, stage.runId, /^[a-z0-9][a-z0-9._-]*$/);
  const startedAt = parseTime(`${id}.startedAt`, stage.startedAt);
  const completedAt = parseTime(`${id}.completedAt`, stage.completedAt);
  if (completedAt <= startedAt) fail(`${id}.completedAt must be after startedAt`);
  const minimumDuration = record.synthetic ? 1 : expected.minDurationSeconds;
  if ((completedAt - startedAt) / 1000 < minimumDuration) {
    fail(`${id} duration must be at least ${minimumDuration} seconds`);
  }
  const providers = new Set();
  const failureDomains = new Set();
  const egressFingerprints = new Set();
  const generatorIds = new Set();
  const targetIds = new Set();
  const driverHashes = new Set();
  const driverImages = new Set();
  const cellIds = new Set();
  let crossGeneratorEndpoints = 0;
  let sentTransfers = 0;
  let receivedTransfers = 0;
  let direct = 0;
  let edge = 0;
  let origin = 0;
  let relay = 0;
  let upload = 0;
  let playbackSamples = 0;
  let stallEvents = 0;
  let startupLatencyMsP95 = 0;
  let bufferMsMin = Number.POSITIVE_INFINITY;
  const ranges = [];
  const starts = [];
  for (const probe of probes) {
    if (probe.runId !== runId || probe.stageId !== id) fail(`${id} probe ${probe.probeId} run/stage binding mismatch`);
    if (probe.environment !== record.environment || probe.commit !== record.commit || probe.releaseVersion !== record.releaseVersion) {
      fail(`${id} probe ${probe.probeId} release binding mismatch`);
    }
    if ((probe.synthetic === true) !== (record.synthetic === true)) fail(`${id} probe ${probe.probeId} synthetic flag mismatch`);
    if (probe.startedAtMs < startedAt - 5_000 || probe.completedAtMs > completedAt + 5_000) {
      fail(`${id} probe ${probe.probeId} falls outside the stage time window`);
    }
    providers.add(probe.generatorProvider);
    failureDomains.add(probe.generatorFailureDomain);
    if (egressFingerprints.has(probe.networkEgressFingerprintSha256)) {
      fail(`${id} generators must have distinct network egress fingerprints`);
    }
    egressFingerprints.add(probe.networkEgressFingerprintSha256);
    if (generatorIds.has(probe.generatorId)) fail(`${id} duplicate generatorId ${probe.generatorId}`);
    generatorIds.add(probe.generatorId);
    targetIds.add(probe.targetId);
    driverHashes.add(probe.driverSha256);
    driverImages.add(probe.driverImageDigest);
    probe.trackerCellIds.forEach((cellId) => cellIds.add(cellId));
    ranges.push({ start: probe.assignedPeerStart, count: probe.assignedPeerCount, probeId: probe.probeId });
    starts.push(probe.startedAtMs);
    crossGeneratorEndpoints += probe.crossGeneratorEndpoints;
    sentTransfers += probe.verifiedSendTransfers;
    receivedTransfers += probe.verifiedReceiveTransfers;
    direct += probe.clientP2pBytes;
    edge += probe.clientEdgeBytes;
    origin += probe.clientBootstrapOriginBytes;
    relay += probe.clientRelayBytes;
    upload += probe.clientUploadBytes;
    playbackSamples += probe.playbackSamples;
    stallEvents += probe.stallEvents;
    startupLatencyMsP95 = Math.max(startupLatencyMsP95, probe.startupLatencyMsP95);
    bufferMsMin = Math.min(bufferMsMin, probe.bufferMsMin);
  }
  if (providers.size < 2) fail(`${id} probes must span at least two generator providers`);
  if (failureDomains.size < 2) fail(`${id} probes must span at least two generator failure domains`);
  if (targetIds.size !== 1) fail(`${id} probes must target one staging deployment`);
  if (driverHashes.size !== 1 || driverImages.size !== 1) fail(`${id} probes must use one immutable load-driver build`);
  if (Math.max(...starts) - Math.min(...starts) > 5_000) fail(`${id} generator starts differ by more than five seconds`);
  const sortedRanges = ranges.sort((left, right) => left.start - right.start);
  let nextPeer = 0;
  for (const range of sortedRanges) {
    if (range.start !== nextPeer) fail(`${id} generator peer ranges have a gap or overlap at ${nextPeer}`);
    nextPeer += range.count;
  }
  if (nextPeer !== stage.peerCount) fail(`${id} generator peer ranges do not cover peerCount`);
  const requiredCrossHostEndpoints = Math.max(2, Math.ceil(stage.peerCount * 0.1));
  if (crossGeneratorEndpoints < requiredCrossHostEndpoints) {
    fail(`${id} cross-generator endpoints must be at least ${requiredCrossHostEndpoints}`);
  }
  for (const probe of probes) {
    for (const remoteId of probe.remoteGeneratorIds) {
      if (!generatorIds.has(remoteId)) fail(`${id} probe ${probe.probeId} references generator outside the stage`);
    }
  }
  const graph = new Map([...generatorIds].map((generatorId) => [generatorId, new Set()]));
  for (const probe of probes) {
    for (const remoteId of probe.remoteGeneratorIds) {
      graph.get(probe.generatorId).add(remoteId);
      graph.get(remoteId).add(probe.generatorId);
    }
  }
  const visited = new Set();
  const queue = [probes[0].generatorId];
  while (queue.length > 0) {
    const generatorId = queue.shift();
    if (visited.has(generatorId)) continue;
    visited.add(generatorId);
    graph.get(generatorId).forEach((remoteId) => queue.push(remoteId));
  }
  if (visited.size !== generatorIds.size) fail(`${id} cross-generator transfer graph is disconnected`);
  if (sentTransfers !== receivedTransfers || receivedTransfers < Math.floor(stage.peerCount / 2)) {
    fail(`${id} verified send/receive transfers do not reconcile to at least one transfer per peer pair`);
  }
  const clientUploadBytes = integerField(`${id}.clientUploadBytes`, stage.clientUploadBytes, { min: 1 });
  for (const [name, measured, reported] of [
    ["clientP2pBytes", direct, stage.clientP2pBytes],
    ["clientEdgeBytes", edge, stage.clientEdgeBytes],
    ["clientBootstrapOriginBytes", origin, stage.clientBootstrapOriginBytes],
    ["clientRelayBytes", relay, stage.clientRelayBytes],
    ["clientUploadBytes", upload, clientUploadBytes]
  ]) {
    if (measured !== reported) fail(`${id}.${name} does not equal the raw generator probe total`);
  }
  const rawStallRate = stallEvents / playbackSamples;
  if (Math.abs(rawStallRate - stage.stallRate) > 0.000001) {
    fail(`${id}.stallRate does not equal the raw generator probe total`);
  }
  if (startupLatencyMsP95 !== stage.startupLatencyMsP95) {
    fail(`${id}.startupLatencyMsP95 must equal the conservative maximum raw probe p95`);
  }
  if (bufferMsMin !== stage.bufferMsMin) {
    fail(`${id}.bufferMsMin must equal the minimum raw probe buffer`);
  }
  if (expected.minCells && cellIds.size !== stage.trackerCellCount) {
    fail(`${id} raw probes observed ${cellIds.size} tracker cells instead of ${stage.trackerCellCount}`);
  }
}

function validateStage(stage, record, probeStore) {
  const id = cleanString("stage.id", stage.id, /^[a-z0-9-]+$/);
  const expected = stageExpectations.get(id);
  if (!expected) fail(`unexpected load ladder stage ${id}`);
  if (stage.status !== "pass") fail(`${id}.status must pass`);
  cleanString(`${id}.command`, stage.command);
  cleanString(`${id}.hostShape`, stage.hostShape);
  cleanString(`${id}.transport`, stage.transport, /^webrtc-datachannel$/);
  cleanString(`${id}.signalingPath`, stage.signalingPath, /^tracker-signaling-relay$/);
  if (stage.dataChannelTransfer !== true) fail(`${id}.dataChannelTransfer must be true`);
  integerField(`${id}.channelCount`, stage.channelCount, { min: expected.channels });
  integerField(`${id}.peerCount`, stage.peerCount, { min: expected.peers });
  numberField(`${id}.wifiFraction`, stage.wifiFraction, { min: 0, max: 1 });
  numberField(`${id}.superPeerFraction`, stage.superPeerFraction, { min: 0, max: 1 });
  const offloadRatio = numberField(`${id}.offloadRatio`, stage.offloadRatio, { min: expected.offload, max: 1 });
  const clientP2pBytes = integerField(`${id}.clientP2pBytes`, stage.clientP2pBytes, { min: 1 });
  const clientEdgeBytes = integerField(`${id}.clientEdgeBytes`, stage.clientEdgeBytes, { min: 0 });
  const clientBootstrapOriginBytes = integerField(`${id}.clientBootstrapOriginBytes`, stage.clientBootstrapOriginBytes, { min: 0 });
  const clientRelayBytes = integerField(`${id}.clientRelayBytes`, stage.clientRelayBytes, { min: 0 });
  const edgeAccessEgressBytes = integerField(`${id}.edgeAccessEgressBytes`, stage.edgeAccessEgressBytes, { min: 0 });
  const originAccessBootstrapBytes = integerField(`${id}.originAccessBootstrapBytes`, stage.originAccessBootstrapBytes, { min: 0 });
  const relayAccessEgressBytes = integerField(`${id}.relayAccessEgressBytes`, stage.relayAccessEgressBytes, { min: 0 });
  const reconciliationTolerance = numberField(`${id}.reconciliationTolerance`, stage.reconciliationTolerance, { min: 0, max: 0.05 });
  const totalClientDelivery = clientP2pBytes + clientEdgeBytes + clientBootstrapOriginBytes + clientRelayBytes;
  const computedOffload = clientP2pBytes / totalClientDelivery;
  if (Math.abs(computedOffload - offloadRatio) > 0.001) {
    fail(`${id}.offloadRatio does not match direct P2P over all delivery bytes`);
  }
  assertReconciled(`${id}.edge egress`, clientEdgeBytes, edgeAccessEgressBytes, reconciliationTolerance);
  assertReconciled(`${id}.origin bootstrap`, clientBootstrapOriginBytes, originAccessBootstrapBytes, reconciliationTolerance);
  assertReconciled(`${id}.relay egress`, clientRelayBytes, relayAccessEgressBytes, reconciliationTolerance);
  numberField(`${id}.stallRate`, stage.stallRate, { min: 0, max: budgets.androidStallRateMax });
  numberField(`${id}.startupLatencyMsP95`, stage.startupLatencyMsP95, { min: 0, max: budgets.androidStartupLatencyMsP95 });
  numberField(`${id}.bufferMsMin`, stage.bufferMsMin, { min: budgets.androidBufferMsMin });
  numberField(`${id}.trackerCpuMsP95`, stage.trackerCpuMsP95, { min: 0, max: budgets.trackerCpuMsPerMessageP95 });
  numberField(`${id}.trackerMemoryBytesPerPeer`, stage.trackerMemoryBytesPerPeer, { min: 1, max: budgets.trackerMemoryBytesPerPeer });
  numberField(`${id}.edgeCacheHitRatio`, stage.edgeCacheHitRatio, { min: budgets.edgeCacheHitRatioMin, max: 1 });
  numberField(`${id}.edgeEgressMbps`, stage.edgeEgressMbps, { min: 0 });
  numberField(`${id}.originEgressMbps`, stage.originEgressMbps, { min: 0 });
  cleanString(`${id}.alertState`, stage.alertState, /^clear$/);
  validateEvidenceList(`${id}.evidence`, stage.evidence);
  const joinedEvidence = stage.evidence.join("\n");
  for (const marker of ["webrtc-datachannel", "tracker-signaling-relay", "edge-access-reconciled"]) {
    if (!joinedEvidence.includes(marker)) fail(`${id}.evidence must include ${marker}`);
  }
  if (expected.minCells) {
    if (stage.channelCount !== 1) fail(`${id}.channelCount must equal 1 for a single-channel cell stage`);
    const trackerCellCount = integerField(`${id}.trackerCellCount`, stage.trackerCellCount, { min: expected.minCells });
    integerField(`${id}.trackerProcessCount`, stage.trackerProcessCount, { min: trackerCellCount });
    const configuredCellMaxPeers = integerField(`${id}.configuredCellMaxPeers`, stage.configuredCellMaxPeers, { min: 2, max: 20000 });
    if (!Array.isArray(stage.cellPeerCounts) || stage.cellPeerCounts.length !== trackerCellCount) {
      fail(`${id}.cellPeerCounts must contain one count per tracker cell`);
    }
    const assignedPeers = stage.cellPeerCounts.reduce((total, value, index) => (
      total + integerField(`${id}.cellPeerCounts[${index}]`, value, { min: 1, max: configuredCellMaxPeers })
    ), 0);
    if (assignedPeers !== stage.peerCount) fail(`${id}.cellPeerCounts must sum to peerCount`);
    integerField(`${id}.segmentFanoutCells`, stage.segmentFanoutCells, { min: trackerCellCount, max: trackerCellCount });
    integerField(`${id}.backpressureDrops`, stage.backpressureDrops, { min: 0, max: 0 });
    integerField(`${id}.cellCapacityRejections`, stage.cellCapacityRejections, { min: 0, max: 0 });
    integerField(`${id}.sameCellSignalViolations`, stage.sameCellSignalViolations, { min: 0, max: 0 });
    const segmentAnnouncements = integerField(`${id}.segmentAnnouncements`, stage.segmentAnnouncements, { min: 1 });
    const segmentCodingRank = integerField(`${id}.segmentCodingRank`, stage.segmentCodingRank, { min: 1, max: 255 });
    const helpersPerCell = Math.max(2, Math.ceil(segmentCodingRank / 12));
    integerField(`${id}.originBootstrapCellCount`, stage.originBootstrapCellCount, { min: 1, max: 1 });
    integerField(`${id}.originSeedAssignments`, stage.originSeedAssignments, {
      min: segmentAnnouncements,
      max: segmentAnnouncements * helpersPerCell
    });
    integerField(`${id}.edgeBootstrapCellCount`, stage.edgeBootstrapCellCount, {
      min: trackerCellCount - 1,
      max: trackerCellCount - 1
    });
    integerField(`${id}.edgeSeedAssignments`, stage.edgeSeedAssignments, {
      min: segmentAnnouncements * (trackerCellCount - 1),
      max: segmentAnnouncements * (trackerCellCount - 1) * helpersPerCell
    });
    if (stage.cellFailureEdgeFallback !== true) fail(`${id}.cellFailureEdgeFallback must be true`);
    if (stage.cellFailureRejoin !== true) fail(`${id}.cellFailureRejoin must be true`);
    numberField(`${id}.cellFailureRecoveryMsP95`, stage.cellFailureRecoveryMsP95, { min: 0, max: 30000 });
    for (const marker of ["tracker-cells", "segment-fanout-all-cells", "global-origin-bootstrap", "edge-bootstrap-secondary-cells", "cell-failure-edge-fallback", "cell-rejoin", "same-cell-signaling"]) {
      if (!joinedEvidence.includes(marker)) fail(`${id}.evidence must include ${marker}`);
    }
  }
  if (expected.distributed) validateDistributedStage(stage, id, expected, record, probeStore);
  return id;
}

function fractionKey(value) {
  return value.toFixed(2);
}

function validateSelfSustainingSweep(sweep) {
  if (!sweep || typeof sweep !== "object") fail("selfSustainingSweep is required");
  const command = cleanString("selfSustainingSweep.command", sweep.command);
  if (!command.includes("smoke:headless-super-peer-sweep")) {
    fail("selfSustainingSweep.command must run smoke:headless-super-peer-sweep");
  }
  integerField("selfSustainingSweep.peerCount", sweep.peerCount, { min: 500 });
  const codingRank = integerField("selfSustainingSweep.codingRank", sweep.codingRank, { min: 1 });
  integerField("selfSustainingSweep.uploadPacketsPerSuperPeer", sweep.uploadPacketsPerSuperPeer, { min: 1 });
  cleanString("selfSustainingSweep.bootstrapAccounting", sweep.bootstrapAccounting, /^all-preloaded-helpers$/);

  if (!Array.isArray(sweep.fractions) || sweep.fractions.length === 0) {
    fail("selfSustainingSweep.fractions must be a non-empty array");
  }
  const fractionKeys = new Set(sweep.fractions.map((value, index) => {
    const fraction = numberField(`selfSustainingSweep.fractions[${index}]`, value, { min: 0.01, max: 1 });
    return fractionKey(fraction);
  }));
  for (const required of [0.05, 0.10, 0.15, 0.20, 0.25]) {
    if (!fractionKeys.has(fractionKey(required))) {
      fail(`selfSustainingSweep.fractions missing ${fractionKey(required)}`);
    }
  }

  const flatten = numberField("selfSustainingSweep.flattenSuperPeerFraction", sweep.flattenSuperPeerFraction, { min: 0.05, max: 0.25 });
  const flattenKey = fractionKey(flatten);
  if (!fractionKeys.has(flattenKey)) {
    fail("selfSustainingSweep.flattenSuperPeerFraction must match a tested fraction");
  }
  const reportedBestOffload = numberField("selfSustainingSweep.bestOffloadRatio", sweep.bestOffloadRatio, { min: 0, max: 1 });
  const reportedFlattenOffload = numberField("selfSustainingSweep.flattenOffloadRatio", sweep.flattenOffloadRatio, { min: 0, max: 1 });

  if (!Array.isArray(sweep.edgeFallbackPackets) || sweep.edgeFallbackPackets.length === 0) {
    fail("selfSustainingSweep.edgeFallbackPackets must be a non-empty array");
  }
  let sawFlattenZero = false;
  let bestOffload = 0;
  for (const [index, row] of sweep.edgeFallbackPackets.entries()) {
    if (!row || typeof row !== "object") fail(`selfSustainingSweep.edgeFallbackPackets[${index}] must be an object`);
    const fraction = numberField(`selfSustainingSweep.edgeFallbackPackets[${index}].superPeerFraction`, row.superPeerFraction, { min: 0.01, max: 1 });
    const key = fractionKey(fraction);
    if (!fractionKeys.has(key)) fail(`selfSustainingSweep.edgeFallbackPackets[${index}].superPeerFraction was not tested`);
    const edgeFallbackPackets = integerField(`selfSustainingSweep.edgeFallbackPackets[${index}].edgeFallbackPackets`, row.edgeFallbackPackets, { min: 0 });
    const edgeBootstrapPackets = integerField(`selfSustainingSweep.edgeFallbackPackets[${index}].edgeBootstrapPackets`, row.edgeBootstrapPackets, { min: 1 });
    const p2pPackets = integerField(`selfSustainingSweep.edgeFallbackPackets[${index}].p2pPackets`, row.p2pPackets, { min: 0 });
    const offloadRatio = numberField(`selfSustainingSweep.edgeFallbackPackets[${index}].offloadRatio`, row.offloadRatio, { min: 0, max: 1 });
    const superPeerCount = Math.round(sweep.peerCount * fraction);
    const expectedBootstrapPackets = superPeerCount * codingRank;
    if (edgeBootstrapPackets !== expectedBootstrapPackets) {
      fail(`selfSustainingSweep.edgeFallbackPackets[${index}] does not charge every preloaded helper`);
    }
    const expectedViewerPackets = (sweep.peerCount - superPeerCount) * codingRank;
    if (p2pPackets + edgeFallbackPackets !== expectedViewerPackets) {
      fail(`selfSustainingSweep.edgeFallbackPackets[${index}] viewer packet accounting is inconsistent`);
    }
    const computedOffload = p2pPackets / (p2pPackets + edgeFallbackPackets + edgeBootstrapPackets);
    if (Math.abs(computedOffload - offloadRatio) > 0.001) {
      fail(`selfSustainingSweep.edgeFallbackPackets[${index}].offloadRatio is inconsistent`);
    }
    bestOffload = Math.max(bestOffload, computedOffload);
    if (fraction >= flatten && row.edgeFallbackPackets !== 0) {
      fail("selfSustainingSweep.edgeFallbackPackets must be zero at and after flattenSuperPeerFraction");
    }
    if (key === flattenKey && row.edgeFallbackPackets === 0) sawFlattenZero = true;
  }
  if (!sawFlattenZero) {
    fail("selfSustainingSweep must include zero edge fallback at flattenSuperPeerFraction");
  }
  const flattenRow = sweep.edgeFallbackPackets.find((row) => fractionKey(row.superPeerFraction) === flattenKey);
  if (Math.abs(bestOffload - reportedBestOffload) > 0.001) fail("selfSustainingSweep.bestOffloadRatio is inconsistent");
  if (Math.abs(flattenRow.offloadRatio - reportedFlattenOffload) > 0.001) fail("selfSustainingSweep.flattenOffloadRatio is inconsistent");

  validateEvidenceList("selfSustainingSweep.evidence", sweep.evidence);
  return flatten;
}

function validateRecord(record, file) {
  cleanString("ladderId", record.ladderId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  const startedAt = parseTime("startedAt", record.startedAt);
  const completedAt = parseTime("completedAt", record.completedAt);
  if (completedAt <= startedAt) fail("completedAt must be after startedAt");
  if (record.synthetic && !allowSynthetic) fail("synthetic load ladder evidence requires --allow-synthetic");
  const probeStore = loadProbeArtifacts(record, file);
  if (!Array.isArray(record.stages)) fail("stages must be an array");
  const seen = new Set();
  for (const stage of record.stages) {
    const id = validateStage(stage, record, probeStore);
    if (seen.has(id)) fail(`duplicate load ladder stage ${id}`);
    seen.add(id);
  }
  for (const id of stageExpectations.keys()) {
    if (!seen.has(id)) fail(`missing required load ladder stage ${id}`);
  }
  for (const probe of probeStore.values()) {
    if (!probe.usedByStage) fail(`distributed probe ${probe.probeId} is not referenced by a stage`);
  }
  const flatten = validateSelfSustainingSweep(record.selfSustainingSweep);
  return `${file}: Load ladder evidence OK: stages=${seen.size}, maxPeers=${Math.max(...record.stages.map((stage) => stage.peerCount))}, selfSustainingFlatten=${flatten.toFixed(2)}`;
}

if (!budgetPath || files.length === 0) {
  console.error("Usage: node scripts/validate-load-ladder-evidence.js [--allow-synthetic] [--budgets config/performance-budgets.json] <load-ladder-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Load ladder evidence validation failed: ${error.message}`);
  process.exit(1);
}
