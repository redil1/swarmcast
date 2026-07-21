import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const unknownOption = args.find((arg) => arg.startsWith("--") && arg !== "--allow-synthetic");
if (unknownOption) {
  console.error(`Unknown option: ${unknownOption}`);
  process.exit(2);
}
if (args.filter((arg) => arg === "--allow-synthetic").length > 1) {
  console.error("--allow-synthetic may be supplied only once");
  process.exit(2);
}
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const requiredTransports = ["udp", "tls"];
const sensitivePatterns = [
  /token=/i,
  /jwt=/i,
  /bearer\s+/i,
  /password=/i,
  /shared[_-]?secret/i,
  /-----BEGIN/i,
  /\.m3u8(?:\?|$)/i,
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

function finiteNumber(name, value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function integer(name, value, options = {}) {
  const parsed = finiteNumber(name, value, options);
  if (!Number.isInteger(parsed)) fail(`${name} must be an integer`);
  return parsed;
}

function parseTime(name, value) {
  const normalized = cleanString(name, value);
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) fail(`${name} must be ISO-8601 parseable`);
  return parsed;
}

function validateEvidence(name, evidence, requiredMarkers = []) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${name} must include evidence`);
  for (const item of evidence) {
    const normalized = cleanString(`${name}[]`, item);
    if (sensitivePatterns.some((pattern) => pattern.test(normalized))) {
      fail(`${name} reference looks like it may contain sensitive material`);
    }
  }
  const joined = evidence.join("\n");
  for (const marker of requiredMarkers) {
    if (!joined.includes(marker)) fail(`${name} must include ${marker}`);
  }
}

function assertReconciled(name, expected, observed, tolerance) {
  if (expected <= 0 || observed <= 0) fail(`${name} counters must be positive`);
  const difference = Math.abs(expected - observed) / Math.max(expected, observed);
  if (difference > tolerance) fail(`${name} does not reconcile within ${(tolerance * 100).toFixed(1)}%`);
}

function validateLoadGenerators(loadGenerators) {
  if (!Array.isArray(loadGenerators) || loadGenerators.length < 2) {
    fail("loadGenerators must include at least two independent hosts");
  }
  const hosts = new Map();
  const failureDomains = new Set();
  const providers = new Set();
  for (const [index, generator] of loadGenerators.entries()) {
    const prefix = `loadGenerators[${index}]`;
    const hostId = cleanString(`${prefix}.hostId`, generator.hostId, /^[a-z0-9][a-z0-9._-]*$/);
    if (hosts.has(hostId)) fail(`duplicate load generator hostId ${hostId}`);
    const failureDomain = cleanString(`${prefix}.failureDomain`, generator.failureDomain, /^[a-z0-9][a-z0-9._-]*$/);
    const provider = cleanString(`${prefix}.provider`, generator.provider);
    failureDomains.add(failureDomain);
    providers.add(provider);
    hosts.set(hostId, { failureDomain, provider });
    cleanString(`${prefix}.region`, generator.region);
    if (generator.independentNetworkPath !== true) fail(`${prefix}.independentNetworkPath must be true`);
  }
  if (failureDomains.size < 2) fail("loadGenerators must span at least two failure domains");
  if (providers.size < 2) fail("loadGenerators must span at least two providers");
  return hosts;
}

function validateServerHosts(serverHosts) {
  if (!Array.isArray(serverHosts) || serverHosts.length < 2) {
    fail("turnFleet.serverHosts must include at least two hosts");
  }
  const hosts = new Map();
  const failureDomains = new Set();
  for (const [index, host] of serverHosts.entries()) {
    const prefix = `turnFleet.serverHosts[${index}]`;
    const hostId = cleanString(`${prefix}.hostId`, host.hostId, /^[a-z0-9][a-z0-9._-]*$/);
    if (hosts.has(hostId)) fail(`duplicate TURN hostId ${hostId}`);
    failureDomains.add(cleanString(`${prefix}.failureDomain`, host.failureDomain, /^[a-z0-9][a-z0-9._-]*$/));
    cleanString(`${prefix}.region`, host.region);
    cleanString(`${prefix}.instanceType`, host.instanceType);
    const linkCapacityMbps = finiteNumber(`${prefix}.linkCapacityMbps`, host.linkCapacityMbps, { min: 100 });
    hosts.set(hostId, { linkCapacityMbps });
  }
  if (failureDomains.size < 2) fail("TURN hosts must span at least two failure domains");
  return hosts;
}

function validateProfile(profile, index, serverHosts, loadGeneratorIds, tolerance, headroomRatio) {
  const prefix = `profiles[${index}]`;
  const id = cleanString(`${prefix}.id`, profile.id, /^[a-z0-9][a-z0-9._-]*$/);
  const transport = cleanString(`${prefix}.transport`, profile.transport, /^(udp|tls)$/);
  const serverHostId = cleanString(`${prefix}.serverHostId`, profile.serverHostId, /^[a-z0-9][a-z0-9._-]*$/);
  const serverHost = serverHosts.get(serverHostId);
  if (!serverHost) fail(`${id}.serverHostId is not in turnFleet.serverHosts`);
  if (profile.status !== "pass") fail(`${id}.status must pass`);
  if (!Array.isArray(profile.loadGeneratorHostIds) || profile.loadGeneratorHostIds.length < 2) {
    fail(`${id}.loadGeneratorHostIds must include at least two hosts`);
  }
  const generators = new Set(profile.loadGeneratorHostIds);
  if (generators.size !== profile.loadGeneratorHostIds.length) fail(`${id}.loadGeneratorHostIds contains duplicates`);
  for (const hostId of generators) {
    if (!loadGeneratorIds.has(hostId)) fail(`${id}.loadGeneratorHostIds references unknown host ${hostId}`);
  }
  const selectedFailureDomains = new Set([...generators].map((hostId) => loadGeneratorIds.get(hostId).failureDomain));
  const selectedProviders = new Set([...generators].map((hostId) => loadGeneratorIds.get(hostId).provider));
  if (selectedFailureDomains.size < 2 || selectedProviders.size < 2) {
    fail(`${id}.loadGeneratorHostIds must span two providers and failure domains`);
  }
  const startedAt = parseTime(`${id}.startedAt`, profile.startedAt);
  const completedAt = parseTime(`${id}.completedAt`, profile.completedAt);
  if (completedAt <= startedAt) fail(`${id}.completedAt must be after startedAt`);
  const warmupSeconds = integer(`${id}.warmupSeconds`, profile.warmupSeconds, { min: 60 });
  const sustainedSeconds = integer(`${id}.sustainedSeconds`, profile.sustainedSeconds, { min: 300 });
  if ((completedAt - startedAt) / 1000 < warmupSeconds + sustainedSeconds) {
    fail(`${id} wall duration is shorter than warm-up plus sustained duration`);
  }
  if (!Array.isArray(profile.rawProbes) || profile.rawProbes.length !== generators.size) {
    fail(`${id}.rawProbes must include exactly one probe per load generator`);
  }
  const rawProbeGenerators = new Set();
  const rawProbeCompletedTimes = [];
  const rawProbeRunIds = [];
  const rawProbeStartTimes = [];
  for (const [probeIndex, rawProbe] of profile.rawProbes.entries()) {
    const probePrefix = `${id}.rawProbes[${probeIndex}]`;
    const loadGeneratorHostId = cleanString(
      `${probePrefix}.loadGeneratorHostId`,
      rawProbe.loadGeneratorHostId,
      /^[a-z0-9][a-z0-9._-]*$/
    );
    if (!generators.has(loadGeneratorHostId)) fail(`${probePrefix} references an unassigned load generator`);
    if (rawProbeGenerators.has(loadGeneratorHostId)) fail(`${id}.rawProbes contains duplicate generator ${loadGeneratorHostId}`);
    rawProbeGenerators.add(loadGeneratorHostId);
    const rawProbeRunId = cleanString(`${probePrefix}.runId`, rawProbe.runId, /^[a-z0-9][a-z0-9._-]*$/);
    rawProbeRunIds.push(rawProbeRunId);
    if (rawProbe.result !== "pass") fail(`${probePrefix}.result must pass`);
    const rawStartedAt = parseTime(`${probePrefix}.startedAt`, rawProbe.startedAt);
    const rawCompletedAt = parseTime(`${probePrefix}.completedAt`, rawProbe.completedAt);
    if (rawCompletedAt - rawStartedAt < (warmupSeconds + sustainedSeconds) * 1000) {
      fail(`${probePrefix} wall duration is shorter than the profile duration`);
    }
    rawProbeStartTimes.push(rawStartedAt);
    rawProbeCompletedTimes.push(rawCompletedAt);
    validateEvidence(`${probePrefix}.evidence`, rawProbe.evidence, ["turn-capacity-raw-probe"]);
  }
  if (Math.max(...rawProbeStartTimes) - Math.min(...rawProbeStartTimes) > 5000) {
    fail(`${id}.rawProbes start more than five seconds apart`);
  }
  if (Math.abs(Math.min(...rawProbeStartTimes) - startedAt) > 5000 ||
      Math.abs(Math.max(...rawProbeCompletedTimes) - completedAt) > 5000) {
    fail(`${id} timestamps must match the synchronized raw probe envelope`);
  }

  const concurrentAllocations = integer(`${id}.concurrentAllocations`, profile.concurrentAllocations, { min: 2 });
  const peakAllocations = integer(`${id}.peakAllocations`, profile.peakAllocations, { min: concurrentAllocations });
  const successfulAllocations = integer(`${id}.successfulAllocations`, profile.successfulAllocations, { min: concurrentAllocations });
  const allocationFailures = integer(`${id}.allocationFailures`, profile.allocationFailures, { min: 0 });
  const approvedConcurrentAllocations = integer(
    `${id}.approvedConcurrentAllocations`,
    profile.approvedConcurrentAllocations,
    { min: 1 }
  );
  if (allocationFailures / (successfulAllocations + allocationFailures) > 0.01) {
    fail(`${id}.allocation failure ratio exceeds 1%`);
  }
  if (approvedConcurrentAllocations * (1 + headroomRatio) > concurrentAllocations) {
    fail(`${id}.approvedConcurrentAllocations does not preserve required headroom`);
  }

  const applicationPayloadBytes = finiteNumber(`${id}.applicationPayloadBytes`, profile.applicationPayloadBytes, { min: 1 });
  const coturnIngressBytes = finiteNumber(`${id}.coturnIngressBytes`, profile.coturnIngressBytes, { min: 1 });
  const coturnEgressBytes = finiteNumber(`${id}.coturnEgressBytes`, profile.coturnEgressBytes, { min: 1 });
  const hostNicIngressBytes = finiteNumber(`${id}.hostNicIngressBytes`, profile.hostNicIngressBytes, { min: 1 });
  const hostNicEgressBytes = finiteNumber(`${id}.hostNicEgressBytes`, profile.hostNicEgressBytes, { min: 1 });
  const providerIngressBytes = finiteNumber(`${id}.providerIngressBytes`, profile.providerIngressBytes, { min: 1 });
  const providerEgressBytes = finiteNumber(`${id}.providerEgressBytes`, profile.providerEgressBytes, { min: 1 });
  if (coturnIngressBytes < applicationPayloadBytes * 2 || coturnEgressBytes < applicationPayloadBytes * 2) {
    fail(`${id}.coturn traffic must cover both relay legs`);
  }
  assertReconciled(`${id} coturn/host ingress`, coturnIngressBytes, hostNicIngressBytes, tolerance);
  assertReconciled(`${id} coturn/provider ingress`, coturnIngressBytes, providerIngressBytes, tolerance);
  assertReconciled(`${id} coturn/host egress`, coturnEgressBytes, hostNicEgressBytes, tolerance);
  assertReconciled(`${id} coturn/provider egress`, coturnEgressBytes, providerEgressBytes, tolerance);

  const measuredSustainedEgressMbps = finiteNumber(
    `${id}.measuredSustainedEgressMbps`,
    profile.measuredSustainedEgressMbps,
    { min: 1 }
  );
  const counterDerivedEgressMbps = providerEgressBytes * 8 / sustainedSeconds / 1_000_000;
  const throughputToleranceMbps = Math.max(counterDerivedEgressMbps * tolerance, 0.1);
  if (Math.abs(measuredSustainedEgressMbps - counterDerivedEgressMbps) > throughputToleranceMbps) {
    fail(`${id}.measuredSustainedEgressMbps is inconsistent with sustained provider egress`);
  }
  if (measuredSustainedEgressMbps > serverHost.linkCapacityMbps) {
    fail(`${id}.measuredSustainedEgressMbps exceeds the declared host link capacity`);
  }
  const approvedSustainedEgressMbps = finiteNumber(
    `${id}.approvedSustainedEgressMbps`,
    profile.approvedSustainedEgressMbps,
    { min: 1 }
  );
  if (approvedSustainedEgressMbps * (1 + headroomRatio) > measuredSustainedEgressMbps) {
    fail(`${id}.approvedSustainedEgressMbps does not preserve required headroom`);
  }
  finiteNumber(`${id}.packetLossRatio`, profile.packetLossRatio, { min: 0, max: 0.01 });
  finiteNumber(`${id}.p95RttMs`, profile.p95RttMs, { min: 0, max: 250 });
  finiteNumber(`${id}.cpuP95Ratio`, profile.cpuP95Ratio, { min: 0, max: 0.7 });
  finiteNumber(`${id}.memoryP95Ratio`, profile.memoryP95Ratio, { min: 0, max: 0.8 });
  for (const field of ["restarts", "oomKills", "quotaRejections", "bandwidthRejections"]) {
    if (integer(`${id}.${field}`, profile[field], { min: 0, max: 0 }) !== 0) fail(`${id}.${field} must be zero`);
  }
  if (profile.allocationsReturnedToZero !== true) fail(`${id}.allocationsReturnedToZero must be true`);
  validateEvidence(`${id}.evidence`, profile.evidence, [
    "turnutils-uclient",
    "coturn-prometheus",
    "host-nic-counters",
    "provider-egress-export",
    "cpu-memory"
  ]);
  return { id, transport, serverHostId, measuredSustainedEgressMbps, peakAllocations, rawProbeRunIds };
}

function validateRecord(record, file) {
  if (record.schemaVersion !== 1) fail("schemaVersion must be 1");
  cleanString("runId", record.runId, /^[a-z0-9][a-z0-9._-]*$/);
  if (record.environment !== "staging") fail("environment must be staging");
  cleanString("commit", record.commit, /^[a-fA-F0-9]{40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v[0-9A-Za-z][0-9A-Za-z._-]*$/);
  if (typeof record.synthetic !== "boolean") fail("synthetic must be explicitly true or false");
  if (record.synthetic && !allowSynthetic) fail("synthetic TURN capacity evidence requires --allow-synthetic");
  const headroomRatio = finiteNumber("headroomRatio", record.headroomRatio, { min: 0.3, max: 1 });
  const tolerance = finiteNumber("reconciliationTolerance", record.reconciliationTolerance, { min: 0, max: 0.05 });

  const turnFleet = record.turnFleet || {};
  cleanString("turnFleet.provider", turnFleet.provider);
  cleanString("turnFleet.imageDigest", turnFleet.imageDigest, /^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/);
  if (turnFleet.providerTrafficTermsApproved !== true) fail("turnFleet.providerTrafficTermsApproved must be true");
  validateEvidence("turnFleet.providerTrafficTermsEvidence", turnFleet.providerTrafficTermsEvidence, ["provider-traffic-terms"]);
  if (turnFleet.privatePeerDenied !== true) fail("turnFleet.privatePeerDenied must be true");
  if (turnFleet.prometheusScraped !== true) fail("turnFleet.prometheusScraped must be true");
  const serverHosts = validateServerHosts(turnFleet.serverHosts);
  const loadGeneratorIds = validateLoadGenerators(record.loadGenerators);

  if (!Array.isArray(record.profiles) || record.profiles.length === 0) fail("profiles must be a non-empty array");
  const seenIds = new Set();
  const seenRawProbeRunIds = new Set();
  const coverage = new Set();
  let minimumMeasuredMbps = Number.POSITIVE_INFINITY;
  let minimumPeakAllocations = Number.POSITIVE_INFINITY;
  for (const [index, profile] of record.profiles.entries()) {
    const result = validateProfile(profile, index, serverHosts, loadGeneratorIds, tolerance, headroomRatio);
    if (seenIds.has(result.id)) fail(`duplicate profile ${result.id}`);
    seenIds.add(result.id);
    for (const rawProbeRunId of result.rawProbeRunIds) {
      if (seenRawProbeRunIds.has(rawProbeRunId)) fail(`duplicate raw probe runId ${rawProbeRunId}`);
      seenRawProbeRunIds.add(rawProbeRunId);
    }
    const coverageKey = `${result.serverHostId}:${result.transport}`;
    if (coverage.has(coverageKey)) fail(`duplicate ${result.transport} capacity profile for TURN host ${result.serverHostId}`);
    coverage.add(coverageKey);
    minimumMeasuredMbps = Math.min(minimumMeasuredMbps, result.measuredSustainedEgressMbps);
    minimumPeakAllocations = Math.min(minimumPeakAllocations, result.peakAllocations);
  }
  for (const hostId of serverHosts.keys()) {
    for (const transport of requiredTransports) {
      if (!coverage.has(`${hostId}:${transport}`)) fail(`missing ${transport} capacity profile for TURN host ${hostId}`);
    }
  }

  if (!Array.isArray(record.approvals) || record.approvals.length < 3) fail("approvals must include operations, performance, and security");
  const roles = new Set();
  const reviewers = new Set();
  for (const [index, approval] of record.approvals.entries()) {
    const role = cleanString(`approvals[${index}].role`, approval.role, /^(operations|performance|security)$/);
    if (roles.has(role)) fail(`duplicate approval role ${role}`);
    roles.add(role);
    const reviewer = cleanString(`approvals[${index}].reviewer`, approval.reviewer);
    if (reviewers.has(reviewer)) fail(`approval reviewers must be distinct; duplicate ${reviewer}`);
    reviewers.add(reviewer);
    parseTime(`approvals[${index}].approvedAt`, approval.approvedAt);
    if (approval.status !== "approved") fail(`${role} approval status must be approved`);
    validateEvidence(`${role}.evidence`, approval.evidence);
  }
  for (const role of ["operations", "performance", "security"]) {
    if (!roles.has(role)) fail(`missing ${role} approval`);
  }
  return `${file}: TURN capacity evidence OK: hosts=${serverHosts.size} profiles=${seenIds.size} ` +
    `minMeasuredMbps=${minimumMeasuredMbps} minPeakAllocations=${minimumPeakAllocations}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-turn-capacity-evidence.js [--allow-synthetic] <turn-capacity-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`TURN capacity evidence validation failed: ${error.message}`);
  process.exit(1);
}
