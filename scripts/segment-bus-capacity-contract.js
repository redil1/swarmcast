const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const DNS_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const FORBIDDEN_VALUE = /(?:bearer\s+[A-Za-z0-9._~-]+|-----BEGIN|(?:token|secret|password|authorization|cookie)=)/i;

const PROBE_KEYS = new Set([
  "schemaVersion", "synthetic", "evidenceId", "environment", "commit", "releaseVersion", "clusterId",
  "driverSha256", "driverImageDigest", "startedAt", "completedAt", "durationSeconds", "capacityProfile",
  "topology", "transport", "stream", "load", "failover", "recovery", "permissions", "credentialRotation",
  "monitoring", "evidenceMarkers"
]);
const PROFILE_KEYS = new Set([
  "activeChannelsPeak", "segmentDurationSeconds", "projectedMessagesPerSecond", "headroomRatio",
  "targetMessagesPerSecond"
]);
const NODE_KEYS = new Set([
  "nodeId", "provider", "region", "failureDomain", "serverName", "endpointHost", "serverVersion",
  "serverImageDigest", "certificateSha256", "storageVolumeFingerprintSha256", "monitoringFingerprintSha256"
]);
const TRANSPORT_KEYS = new Set(["clientTlsHostnameVerified", "routeMutualTlsVerified", "plaintextListenersDisabled"]);
const STREAM_KEYS = new Set([
  "name", "replicas", "storage", "subjects", "maxMessageBytes", "runtimeManageStream",
  "currentReplicasBefore", "currentReplicasAfter"
]);
const LOAD_KEYS = new Set([
  "subscriberCount", "attemptedMessages", "acknowledgedMessages", "failedPublishes", "duplicateAcks",
  "expectedDeliveries", "receivedDeliveries", "missingDeliveries", "invalidDeliveries", "outOfOrderDeliveries",
  "publishBytes", "deliveredBytes", "achievedMessagesPerSecond", "publishAckLatencyMs",
  "endToEndDeliveryLatencyMs", "nodeMetrics"
]);
const LATENCY_KEYS = new Set(["p50", "p95", "p99", "max"]);
const NODE_METRIC_KEYS = new Set([
  "nodeId", "cpuPctP95", "memoryPctP95", "diskWriteMsP95", "storageUsedPctMax", "storageBytesBefore",
  "storageBytesAfter", "apiErrorsDelta", "slowConsumersMax", "restarts", "oomKills", "filesystemErrors"
]);
const FAILOVER_KEYS = new Set([
  "failedNodeId", "failedNodeWasLeader", "nodeStoppedAt", "newLeaderElectedAt", "publishRecoveredAt",
  "nodeRejoinedAt", "leaderElectionMs", "publishRecoveryMs", "replicasDuringFailure", "replicasAfterRecovery",
  "acknowledgedDuringFailure", "deliveriesDuringFailure", "failedPublishesDuringFailure", "lostMessages"
]);
const RECOVERY_KEYS = new Set([
  "fullClusterRestarted", "restartAt", "replayedAt", "recoveryMs", "latestSequenceBeforeRestart",
  "latestSequenceAfterReplay", "latestHashBeforeRestart", "latestHashAfterReplay", "storageRecovered"
]);
const PERMISSION_KEYS = new Set(["ingestStreamManagementDenied", "trackerPublishDenied", "adminOnlyProvisioning"]);
const ROTATION_KEYS = new Set([
  "ingestRotated", "trackerRotated", "oldIngestRejected", "oldTrackerRejected", "quorumMaintained",
  "plaintextPasswordWarnings"
]);
const MONITORING_KEYS = new Set([
  "allNodesScraped", "samplesPerNode", "exporterTargetUpMin", "clusterApiErrorsDelta", "storageGrowthBytes"
]);
const REVIEWER_KEYS = new Set(["role", "reviewerId", "status", "reviewedAt"]);

export function failSegmentBusCapacity(message) {
  throw new Error(message);
}

function exactObject(name, value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) failSegmentBusCapacity(`${name} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.size || actual.some((key) => !keys.has(key))) {
    failSegmentBusCapacity(`${name} has unsupported or missing fields`);
  }
  return value;
}

function cleanString(name, value, pattern = null) {
  if (typeof value !== "string" || value.trim() === "") failSegmentBusCapacity(`${name} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) failSegmentBusCapacity(`${name} has invalid format`);
  if (FORBIDDEN_VALUE.test(normalized)) failSegmentBusCapacity(`${name} contains sensitive material`);
  return normalized;
}

function integer(name, value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    failSegmentBusCapacity(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function number(name, value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    failSegmentBusCapacity(`${name} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function time(name, value) {
  const normalized = cleanString(name, value);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) failSegmentBusCapacity(`${name} must be ISO-8601 parseable`);
  return parsed;
}

function requiredBoolean(name, value) {
  if (value !== true) failSegmentBusCapacity(`${name} must be true`);
}

function validateLatency(name, value, budget) {
  exactObject(name, value, LATENCY_KEYS);
  const p50 = number(`${name}.p50`, value.p50, { min: 0 });
  const p95 = number(`${name}.p95`, value.p95, { min: p50 });
  const p99 = number(`${name}.p99`, value.p99, { min: p95, max: budget });
  number(`${name}.max`, value.max, { min: p99 });
}

export function expectedSegmentBusCapacityProfile(plan) {
  const activeChannelsPeak = integer("capacityPlan.activeChannelsPeak", plan.activeChannelsPeak, { min: 1 });
  const segmentDurationSeconds = integer("capacityPlan.segmentDurationSeconds", plan.segmentDurationSeconds, { min: 1, max: 30 });
  const headroomRatio = number("capacityPlan.headroomRatio", plan.headroomRatio, { min: 0.3, max: 2 });
  const projectedMessagesPerSecond = Math.ceil(activeChannelsPeak / segmentDurationSeconds);
  const minimumTarget = Math.ceil(projectedMessagesPerSecond * (1 + headroomRatio));
  const targetMessagesPerSecond = integer("capacityPlan.segmentBusTargetMessagesPerSecond", plan.segmentBusTargetMessagesPerSecond, { min: minimumTarget });
  return { activeChannelsPeak, segmentDurationSeconds, projectedMessagesPerSecond, headroomRatio, targetMessagesPerSecond };
}

function validateProfile(value, capacityPlan) {
  exactObject("capacityProfile", value, PROFILE_KEYS);
  const expected = expectedSegmentBusCapacityProfile(capacityPlan);
  for (const key of ["activeChannelsPeak", "segmentDurationSeconds", "projectedMessagesPerSecond", "targetMessagesPerSecond"]) {
    if (value[key] !== expected[key]) failSegmentBusCapacity(`capacityProfile.${key} does not match the capacity plan`);
  }
  if (value.headroomRatio !== expected.headroomRatio) {
    failSegmentBusCapacity("capacityProfile.headroomRatio does not match the capacity plan");
  }
  return expected;
}

function validateTopology(value) {
  if (!Array.isArray(value) || value.length !== 3) failSegmentBusCapacity("topology must contain exactly three broker nodes");
  const ids = new Set();
  const providers = new Set();
  const failureDomains = new Set();
  const names = new Set();
  const hosts = new Set();
  const certificates = new Set();
  const volumes = new Set();
  const monitors = new Set();
  for (const [index, node] of value.entries()) {
    const name = `topology[${index}]`;
    exactObject(name, node, NODE_KEYS);
    const nodeId = cleanString(`${name}.nodeId`, node.nodeId, ID_PATTERN);
    const provider = cleanString(`${name}.provider`, node.provider, ID_PATTERN);
    cleanString(`${name}.region`, node.region, ID_PATTERN);
    const failureDomain = cleanString(`${name}.failureDomain`, node.failureDomain, ID_PATTERN);
    const serverName = cleanString(`${name}.serverName`, node.serverName, ID_PATTERN);
    const endpointHost = cleanString(`${name}.endpointHost`, node.endpointHost, DNS_PATTERN);
    cleanString(`${name}.serverVersion`, node.serverVersion, /^2\.[0-9]+\.[0-9]+$/);
    cleanString(`${name}.serverImageDigest`, node.serverImageDigest, IMAGE_DIGEST_PATTERN);
    const certificate = cleanString(`${name}.certificateSha256`, node.certificateSha256, HASH_PATTERN);
    const volume = cleanString(`${name}.storageVolumeFingerprintSha256`, node.storageVolumeFingerprintSha256, HASH_PATTERN);
    const monitor = cleanString(`${name}.monitoringFingerprintSha256`, node.monitoringFingerprintSha256, HASH_PATTERN);
    for (const [set, item, label] of [
      [ids, nodeId, "nodeId"], [names, serverName, "serverName"], [hosts, endpointHost, "endpointHost"],
      [certificates, certificate, "certificateSha256"], [volumes, volume, "storageVolumeFingerprintSha256"],
      [monitors, monitor, "monitoringFingerprintSha256"]
    ]) {
      if (set.has(item)) failSegmentBusCapacity(`topology has duplicate ${label}`);
      set.add(item);
    }
    providers.add(provider);
    failureDomains.add(failureDomain);
  }
  if (providers.size < 2) failSegmentBusCapacity("topology must span at least two providers");
  if (failureDomains.size !== 3) failSegmentBusCapacity("topology must span exactly three failure domains");
  return ids;
}

function validateNodeMetrics(value, nodeIds, budgets, durationSeconds, synthetic) {
  if (!Array.isArray(value) || value.length !== 3) failSegmentBusCapacity("load.nodeMetrics must contain exactly three nodes");
  const seen = new Set();
  let storageGrowth = 0;
  for (const [index, metric] of value.entries()) {
    const name = `load.nodeMetrics[${index}]`;
    exactObject(name, metric, NODE_METRIC_KEYS);
    const nodeId = cleanString(`${name}.nodeId`, metric.nodeId, ID_PATTERN);
    if (!nodeIds.has(nodeId) || seen.has(nodeId)) failSegmentBusCapacity(`${name}.nodeId is missing, duplicate, or outside topology`);
    seen.add(nodeId);
    number(`${name}.cpuPctP95`, metric.cpuPctP95, { min: 0, max: budgets.segmentBusCpuPctP95Max });
    number(`${name}.memoryPctP95`, metric.memoryPctP95, { min: 0, max: budgets.segmentBusMemoryPctP95Max });
    number(`${name}.diskWriteMsP95`, metric.diskWriteMsP95, { min: 0, max: budgets.segmentBusDiskWriteMsP95 });
    number(`${name}.storageUsedPctMax`, metric.storageUsedPctMax, { min: 0, max: budgets.segmentBusStoragePctMax });
    const before = integer(`${name}.storageBytesBefore`, metric.storageBytesBefore, { min: 0 });
    const after = integer(`${name}.storageBytesAfter`, metric.storageBytesAfter, { min: before });
    storageGrowth += after - before;
    integer(`${name}.apiErrorsDelta`, metric.apiErrorsDelta, { min: 0, max: 0 });
    integer(`${name}.slowConsumersMax`, metric.slowConsumersMax, { min: 0, max: 0 });
    integer(`${name}.restarts`, metric.restarts, { min: synthetic ? 0 : 1, max: 8 });
    integer(`${name}.oomKills`, metric.oomKills, { min: 0, max: 0 });
    integer(`${name}.filesystemErrors`, metric.filesystemErrors, { min: 0, max: 0 });
  }
  const minimumSamples = synthetic ? 1 : Math.ceil(durationSeconds / 30);
  return { storageGrowth, minimumSamples };
}

export function validateSegmentBusCapacityProbe(input, {
  allowSynthetic = false,
  capacityPlan,
  budgets,
  source = "segment bus capacity probe"
} = {}) {
  exactObject(source, input, PROBE_KEYS);
  if (input.schemaVersion !== 1) failSegmentBusCapacity("schemaVersion must equal 1");
  const synthetic = input.synthetic === true;
  if (synthetic && !allowSynthetic) failSegmentBusCapacity("synthetic segment bus capacity probe requires --allow-synthetic");
  if (!capacityPlan || !budgets) failSegmentBusCapacity("capacity plan and performance budgets are required");
  cleanString("evidenceId", input.evidenceId, ID_PATTERN);
  const environment = cleanString("environment", input.environment, /^(staging|production)$/);
  if (!synthetic && environment !== "staging") failSegmentBusCapacity("non-synthetic segment bus capacity probe must run in staging");
  cleanString("commit", input.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", input.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("clusterId", input.clusterId, ID_PATTERN);
  cleanString("driverSha256", input.driverSha256, HASH_PATTERN);
  cleanString("driverImageDigest", input.driverImageDigest, IMAGE_DIGEST_PATTERN);
  const startedAt = time("startedAt", input.startedAt);
  const completedAt = time("completedAt", input.completedAt);
  if (completedAt <= startedAt) failSegmentBusCapacity("completedAt must be after startedAt");
  const durationSeconds = integer("durationSeconds", input.durationSeconds, { min: synthetic ? 1 : 900, max: 7200 });
  if (Math.abs((completedAt - startedAt) / 1000 - durationSeconds) > 2) {
    failSegmentBusCapacity("durationSeconds does not match evidence timestamps");
  }
  const profile = validateProfile(input.capacityProfile, capacityPlan);
  const nodeIds = validateTopology(input.topology);

  exactObject("transport", input.transport, TRANSPORT_KEYS);
  requiredBoolean("transport.clientTlsHostnameVerified", input.transport.clientTlsHostnameVerified);
  requiredBoolean("transport.routeMutualTlsVerified", input.transport.routeMutualTlsVerified);
  requiredBoolean("transport.plaintextListenersDisabled", input.transport.plaintextListenersDisabled);

  exactObject("stream", input.stream, STREAM_KEYS);
  cleanString("stream.name", input.stream.name, /^SWARMCAST_SEGMENTS$/);
  integer("stream.replicas", input.stream.replicas, { min: 3, max: 3 });
  cleanString("stream.storage", input.stream.storage, /^file$/);
  if (!Array.isArray(input.stream.subjects) || input.stream.subjects.length !== 1 || input.stream.subjects[0] !== "swarmcast.segment.>") {
    failSegmentBusCapacity("stream.subjects must equal swarmcast.segment.>");
  }
  integer("stream.maxMessageBytes", input.stream.maxMessageBytes, { min: 1, max: 4096 });
  if (input.stream.runtimeManageStream !== false) failSegmentBusCapacity("stream.runtimeManageStream must be false");
  integer("stream.currentReplicasBefore", input.stream.currentReplicasBefore, { min: 3, max: 3 });
  integer("stream.currentReplicasAfter", input.stream.currentReplicasAfter, { min: 3, max: 3 });

  exactObject("load", input.load, LOAD_KEYS);
  const subscribers = integer("load.subscriberCount", input.load.subscriberCount, { min: 2, max: 100 });
  const attempted = integer("load.attemptedMessages", input.load.attemptedMessages, { min: 1 });
  const acknowledged = integer("load.acknowledgedMessages", input.load.acknowledgedMessages, { min: attempted, max: attempted });
  integer("load.failedPublishes", input.load.failedPublishes, { min: 0, max: 0 });
  integer("load.duplicateAcks", input.load.duplicateAcks, { min: 0, max: 0 });
  const expectedDeliveries = integer("load.expectedDeliveries", input.load.expectedDeliveries, { min: acknowledged * subscribers, max: acknowledged * subscribers });
  integer("load.receivedDeliveries", input.load.receivedDeliveries, { min: expectedDeliveries, max: expectedDeliveries });
  integer("load.missingDeliveries", input.load.missingDeliveries, { min: 0, max: 0 });
  integer("load.invalidDeliveries", input.load.invalidDeliveries, { min: 0, max: 0 });
  integer("load.outOfOrderDeliveries", input.load.outOfOrderDeliveries, { min: 0, max: 0 });
  const publishBytes = integer("load.publishBytes", input.load.publishBytes, { min: acknowledged });
  integer("load.deliveredBytes", input.load.deliveredBytes, { min: publishBytes * subscribers, max: publishBytes * subscribers });
  const achievedRate = number("load.achievedMessagesPerSecond", input.load.achievedMessagesPerSecond, { min: profile.targetMessagesPerSecond });
  const derivedRate = acknowledged / durationSeconds;
  if (Math.abs(derivedRate - achievedRate) / Math.max(derivedRate, 1) > 0.005) {
    failSegmentBusCapacity("load.achievedMessagesPerSecond is not derived from acknowledged messages and duration");
  }
  validateLatency("load.publishAckLatencyMs", input.load.publishAckLatencyMs, budgets.segmentBusPublishAckMsP99);
  validateLatency("load.endToEndDeliveryLatencyMs", input.load.endToEndDeliveryLatencyMs, budgets.segmentBusDeliveryMsP99);
  const metrics = validateNodeMetrics(input.load.nodeMetrics, nodeIds, budgets, durationSeconds, synthetic);

  exactObject("failover", input.failover, FAILOVER_KEYS);
  const failedNodeId = cleanString("failover.failedNodeId", input.failover.failedNodeId, ID_PATTERN);
  if (!nodeIds.has(failedNodeId)) failSegmentBusCapacity("failover.failedNodeId must identify a topology node");
  requiredBoolean("failover.failedNodeWasLeader", input.failover.failedNodeWasLeader);
  const nodeStoppedAt = time("failover.nodeStoppedAt", input.failover.nodeStoppedAt);
  const leaderElectedAt = time("failover.newLeaderElectedAt", input.failover.newLeaderElectedAt);
  const publishRecoveredAt = time("failover.publishRecoveredAt", input.failover.publishRecoveredAt);
  const nodeRejoinedAt = time("failover.nodeRejoinedAt", input.failover.nodeRejoinedAt);
  if (nodeStoppedAt < startedAt || nodeRejoinedAt > completedAt || !(nodeStoppedAt < leaderElectedAt && leaderElectedAt <= publishRecoveredAt && publishRecoveredAt < nodeRejoinedAt)) {
    failSegmentBusCapacity("failover timestamps are outside the run or out of order");
  }
  const electionMs = number("failover.leaderElectionMs", input.failover.leaderElectionMs, { min: 0, max: budgets.segmentBusLeaderElectionMsMax });
  const recoveryMs = number("failover.publishRecoveryMs", input.failover.publishRecoveryMs, { min: electionMs, max: budgets.segmentBusPublishRecoveryMsMax });
  if (Math.abs(leaderElectedAt - nodeStoppedAt - electionMs) > 100 || Math.abs(publishRecoveredAt - nodeStoppedAt - recoveryMs) > 100) {
    failSegmentBusCapacity("failover latency fields do not match timestamps");
  }
  integer("failover.replicasDuringFailure", input.failover.replicasDuringFailure, { min: 2, max: 2 });
  integer("failover.replicasAfterRecovery", input.failover.replicasAfterRecovery, { min: 3, max: 3 });
  const acknowledgedDuringFailure = integer("failover.acknowledgedDuringFailure", input.failover.acknowledgedDuringFailure, { min: profile.targetMessagesPerSecond });
  integer("failover.deliveriesDuringFailure", input.failover.deliveriesDuringFailure, {
    min: acknowledgedDuringFailure * subscribers,
    max: acknowledgedDuringFailure * subscribers
  });
  integer("failover.failedPublishesDuringFailure", input.failover.failedPublishesDuringFailure, { min: 0, max: 0 });
  integer("failover.lostMessages", input.failover.lostMessages, { min: 0, max: 0 });

  exactObject("recovery", input.recovery, RECOVERY_KEYS);
  requiredBoolean("recovery.fullClusterRestarted", input.recovery.fullClusterRestarted);
  const restartAt = time("recovery.restartAt", input.recovery.restartAt);
  const replayedAt = time("recovery.replayedAt", input.recovery.replayedAt);
  if (restartAt < startedAt || replayedAt > completedAt || replayedAt <= restartAt) {
    failSegmentBusCapacity("recovery timestamps are outside the run or out of order");
  }
  const fullRecoveryMs = number("recovery.recoveryMs", input.recovery.recoveryMs, { min: 0, max: 60_000 });
  if (Math.abs(replayedAt - restartAt - fullRecoveryMs) > 100) failSegmentBusCapacity("recovery.recoveryMs does not match timestamps");
  const beforeSequence = integer("recovery.latestSequenceBeforeRestart", input.recovery.latestSequenceBeforeRestart, { min: 1 });
  integer("recovery.latestSequenceAfterReplay", input.recovery.latestSequenceAfterReplay, { min: beforeSequence, max: beforeSequence });
  const beforeHash = cleanString("recovery.latestHashBeforeRestart", input.recovery.latestHashBeforeRestart, HASH_PATTERN);
  const afterHash = cleanString("recovery.latestHashAfterReplay", input.recovery.latestHashAfterReplay, HASH_PATTERN);
  if (beforeHash !== afterHash) failSegmentBusCapacity("recovery latest replay hash does not match the persisted value");
  requiredBoolean("recovery.storageRecovered", input.recovery.storageRecovered);

  exactObject("permissions", input.permissions, PERMISSION_KEYS);
  for (const key of PERMISSION_KEYS) requiredBoolean(`permissions.${key}`, input.permissions[key]);
  exactObject("credentialRotation", input.credentialRotation, ROTATION_KEYS);
  for (const key of ["ingestRotated", "trackerRotated", "oldIngestRejected", "oldTrackerRejected", "quorumMaintained"]) {
    requiredBoolean(`credentialRotation.${key}`, input.credentialRotation[key]);
  }
  integer("credentialRotation.plaintextPasswordWarnings", input.credentialRotation.plaintextPasswordWarnings, { min: 0, max: 0 });

  exactObject("monitoring", input.monitoring, MONITORING_KEYS);
  requiredBoolean("monitoring.allNodesScraped", input.monitoring.allNodesScraped);
  integer("monitoring.samplesPerNode", input.monitoring.samplesPerNode, { min: metrics.minimumSamples });
  number("monitoring.exporterTargetUpMin", input.monitoring.exporterTargetUpMin, { min: 1, max: 1 });
  integer("monitoring.clusterApiErrorsDelta", input.monitoring.clusterApiErrorsDelta, { min: 0, max: 0 });
  integer("monitoring.storageGrowthBytes", input.monitoring.storageGrowthBytes, { min: metrics.storageGrowth, max: metrics.storageGrowth });

  if (!Array.isArray(input.evidenceMarkers)) failSegmentBusCapacity("evidenceMarkers must be an array");
  const markers = new Set(input.evidenceMarkers.map((value, index) => cleanString(`evidenceMarkers[${index}]`, value, ID_PATTERN)));
  for (const marker of [
    "three-failure-domain-cluster", "projected-peak-sustained", "publish-delivery-reconciled", "leader-loss-quorum",
    "persistent-latest-replay", "credential-rotation", "subject-permission-denial", "hostname-verified-tls",
    "mutual-route-tls", "storage-recovery", "monitoring-reconciled"
  ]) {
    if (!markers.has(marker)) failSegmentBusCapacity(`evidenceMarkers missing ${marker}`);
  }
  return structuredClone(input);
}

export function validateSegmentBusCapacityReviewers(input, completedAtValue) {
  if (!Array.isArray(input) || input.length !== 3) failSegmentBusCapacity("reviewers must contain platform, performance, and security approvals");
  const completedAt = time("completedAt", completedAtValue);
  const roles = new Set();
  const reviewerIds = new Set();
  for (const [index, reviewer] of input.entries()) {
    const name = `reviewers[${index}]`;
    exactObject(name, reviewer, REVIEWER_KEYS);
    const role = cleanString(`${name}.role`, reviewer.role, /^(platform|performance|security)$/);
    const reviewerId = cleanString(`${name}.reviewerId`, reviewer.reviewerId, ID_PATTERN);
    cleanString(`${name}.status`, reviewer.status, /^approved$/);
    const reviewedAt = time(`${name}.reviewedAt`, reviewer.reviewedAt);
    if (reviewedAt < completedAt) failSegmentBusCapacity(`${name}.reviewedAt must be at or after run completion`);
    if (roles.has(role) || reviewerIds.has(reviewerId)) failSegmentBusCapacity("reviewer roles and identities must be distinct");
    roles.add(role);
    reviewerIds.add(reviewerId);
  }
  if (!["platform", "performance", "security"].every((role) => roles.has(role))) {
    failSegmentBusCapacity("reviewers must include platform, performance, and security");
  }
  return structuredClone(input);
}
