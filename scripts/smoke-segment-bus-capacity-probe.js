import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validatePerformanceBudgets } from "../packages/config/src/performanceBudgets.js";
import { validateSegmentBusCapacityProbe } from "./segment-bus-capacity-contract.js";
import {
  runSegmentBusCapacityProbe,
  validateSegmentBusCapacityManifest
} from "./segment-bus-capacity-probe-runner.js";

const root = process.cwd();
const capacityPlan = JSON.parse(readFileSync("config/capacity-plan.json", "utf8"));
const budgets = validatePerformanceBudgets(JSON.parse(readFileSync("config/performance-budgets.json", "utf8")));
const rawFixture = JSON.parse(readFileSync("test-fixtures/segment-bus/segment-bus-capacity-raw.complete.synthetic.json", "utf8"));
const temp = mkdtempSync(path.join(tmpdir(), "segment-bus-capacity-probe-"));
const driverPath = path.join(temp, "driver.mjs");
const manifestPath = path.join(temp, "manifest.json");
const outputPath = path.join(temp, "raw.json");

const driverSource = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const fixture = JSON.parse(readFileSync(${JSON.stringify(path.join(root, "test-fixtures/segment-bus/segment-bus-capacity-raw.complete.synthetic.json"))}, "utf8"));
const started = new Date(request.startAt);
const at = (seconds) => new Date(started.getTime() + seconds * 1000).toISOString();
const output = {
  startedAt: started.toISOString(),
  completedAt: at(request.durationSeconds),
  observedNodes: fixture.topology.map((node) => ({
    nodeId: node.nodeId,
    endpointHost: node.endpointHost,
    observedServerName: node.serverName,
    serverVersion: node.serverVersion,
    serverImageDigest: node.serverImageDigest,
    certificateSha256: node.certificateSha256,
    storageVolumeFingerprintSha256: node.storageVolumeFingerprintSha256,
    monitoringFingerprintSha256: node.monitoringFingerprintSha256
  })),
  transport: fixture.transport,
  stream: fixture.stream,
  load: fixture.load,
  failover: {
    ...fixture.failover,
    nodeStoppedAt: at(0.2),
    newLeaderElectedAt: at(1.2),
    publishRecoveredAt: at(1.7),
    nodeRejoinedAt: at(1.8)
  },
  recovery: {
    ...fixture.recovery,
    restartAt: at(1.8),
    replayedAt: at(1.9)
  },
  permissions: fixture.permissions,
  credentialRotation: fixture.credentialRotation,
  monitoring: fixture.monitoring,
  evidenceMarkers: fixture.evidenceMarkers
};
output.recovery.recoveryMs = 100;
output.load.attemptedMessages = request.capacityProfile.targetMessagesPerSecond * request.durationSeconds;
output.load.acknowledgedMessages = output.load.attemptedMessages;
output.load.expectedDeliveries = output.load.acknowledgedMessages * output.load.subscriberCount;
output.load.receivedDeliveries = output.load.expectedDeliveries;
output.load.publishBytes = output.load.acknowledgedMessages * 200;
output.load.deliveredBytes = output.load.publishBytes * output.load.subscriberCount;
output.load.achievedMessagesPerSecond = request.capacityProfile.targetMessagesPerSecond;
process.stdout.write(JSON.stringify(output));
`;
writeFileSync(driverPath, driverSource, { mode: 0o700 });
chmodSync(driverPath, 0o700);
const driverHash = createHash("sha256").update(readFileSync(driverPath)).digest("hex");
const startAt = new Date(Date.now() + 250).toISOString();
const manifest = {
  schemaVersion: 1,
  synthetic: true,
  evidenceId: rawFixture.evidenceId,
  environment: rawFixture.environment,
  commit: rawFixture.commit,
  releaseVersion: rawFixture.releaseVersion,
  clusterId: rawFixture.clusterId,
  startAt,
  durationSeconds: 2,
  capacityProfile: rawFixture.capacityProfile,
  topology: rawFixture.topology.map((node) => ({
    nodeId: node.nodeId,
    provider: node.provider,
    region: node.region,
    failureDomain: node.failureDomain,
    serverName: node.serverName,
    endpoint: `tls://${node.endpointHost}:4222`,
    serverImageDigest: node.serverImageDigest
  })),
  driver: { sha256: driverHash, imageDigest: rawFixture.driverImageDigest }
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const positive = spawnSync(process.execPath, [
  "scripts/run-segment-bus-capacity-probe.js",
  "--acknowledge-staging-disruption",
  "--allow-synthetic",
  "--manifest", manifestPath,
  "--driver", driverPath,
  "--output", outputPath
], { cwd: root, encoding: "utf8" });
if (positive.status !== 0 || !positive.stdout.includes("Segment bus capacity probe OK")) {
  throw new Error(`positive probe failed: ${positive.stderr || positive.stdout}`);
}
if ((statSync(outputPath).mode & 0o777) !== 0o600) throw new Error("probe output is not mode 0600");

let failures = 0;
async function expectFailure(name, action) {
  try {
    await action();
  } catch {
    failures += 1;
    return;
  }
  throw new Error(`${name} unexpectedly passed`);
}

const clone = (value) => structuredClone(value);
const noAck = spawnSync(process.execPath, [
  "scripts/run-segment-bus-capacity-probe.js", "--allow-synthetic", "--manifest", manifestPath,
  "--driver", driverPath, "--output", path.join(temp, "no-ack.json")
], { cwd: root, encoding: "utf8" });
if (noAck.status === 0) throw new Error("missing disruption acknowledgement unexpectedly passed");
failures += 1;
const overwrite = spawnSync(process.execPath, [
  "scripts/run-segment-bus-capacity-probe.js", "--acknowledge-staging-disruption", "--allow-synthetic",
  "--manifest", manifestPath, "--driver", driverPath, "--output", outputPath
], { cwd: root, encoding: "utf8" });
if (overwrite.status === 0) throw new Error("existing evidence overwrite unexpectedly passed");
failures += 1;

await expectFailure("synthetic allowance", () => validateSegmentBusCapacityManifest(manifest, { capacityPlan }));
await expectFailure("unsupported manifest field", () => {
  const value = clone(manifest); value.extra = true;
  return validateSegmentBusCapacityManifest(value, { allowSynthetic: true, capacityPlan });
});
await expectFailure("capacity profile drift", () => {
  const value = clone(manifest); value.capacityProfile.targetMessagesPerSecond -= 1;
  return validateSegmentBusCapacityManifest(value, { allowSynthetic: true, capacityPlan });
});
await expectFailure("plaintext endpoint", () => {
  const value = clone(manifest); value.topology[0].endpoint = "nats://bus-1.staging.swarmcast.test:4222";
  return validateSegmentBusCapacityManifest(value, { allowSynthetic: true, capacityPlan });
});
await expectFailure("IP endpoint", () => {
  const value = clone(manifest); value.topology[0].endpoint = "tls://192.0.2.10:4222";
  return validateSegmentBusCapacityManifest(value, { allowSynthetic: true, capacityPlan });
});
await expectFailure("failure-domain collapse", () => {
  const value = clone(manifest); value.topology[1].failureDomain = value.topology[0].failureDomain;
  return validateSegmentBusCapacityManifest(value, { allowSynthetic: true, capacityPlan });
});
await expectFailure("provider collapse", () => {
  const value = clone(manifest); value.topology.forEach((node) => { node.provider = "provider-a"; });
  return validateSegmentBusCapacityManifest(value, { allowSynthetic: true, capacityPlan });
});
await expectFailure("duplicate endpoint", () => {
  const value = clone(manifest); value.topology[1].endpoint = value.topology[0].endpoint;
  return validateSegmentBusCapacityManifest(value, { allowSynthetic: true, capacityPlan });
});
await expectFailure("driver hash", () => runSegmentBusCapacityProbe({
  manifest: { ...clone(manifest), driver: { ...manifest.driver, sha256: "0".repeat(64) } },
  driverPath, capacityPlan, budgets, allowSynthetic: true, now: () => Date.parse(startAt), sleep: async () => {}
}));

const outputFromFixture = () => {
  const value = JSON.parse(readFileSync(outputPath, "utf8"));
  const { schemaVersion, synthetic, evidenceId, environment, commit, releaseVersion, clusterId, driverSha256,
    driverImageDigest, durationSeconds, capacityProfile, topology, ...driver } = value;
  driver.observedNodes = topology.map((node) => ({
    nodeId: node.nodeId,
    endpointHost: node.endpointHost,
    observedServerName: node.serverName,
    serverVersion: node.serverVersion,
    serverImageDigest: node.serverImageDigest,
    certificateSha256: node.certificateSha256,
    storageVolumeFingerprintSha256: node.storageVolumeFingerprintSha256,
    monitoringFingerprintSha256: node.monitoringFingerprintSha256
  }));
  return driver;
};
async function runnerFailure(name, mutate, env = {}) {
  await expectFailure(name, () => runSegmentBusCapacityProbe({
    manifest,
    driverPath,
    capacityPlan,
    budgets,
    allowSynthetic: true,
    env,
    now: () => Date.parse(startAt),
    sleep: async () => {},
    executeDriver: async () => {
      const value = outputFromFixture();
      mutate(value);
      return value;
    }
  }));
}
await runnerFailure("unsupported driver output", (value) => { value.extra = true; });
await runnerFailure("observed topology drift", (value) => { value.observedNodes[0].endpointHost = "wrong.staging.swarmcast.test"; });
await runnerFailure("start skew", (value) => { value.startedAt = new Date(Date.parse(startAt) + 2_000).toISOString(); });
await runnerFailure("duration drift", (value) => { value.completedAt = new Date(Date.parse(startAt) + 8_000).toISOString(); });
await runnerFailure("secret output", (value) => { value.observedNodes[0].observedServerName = "driver-secret-value"; }, {
  SWARMCAST_SEGMENT_BUS_DRIVER_TOKEN: "driver-secret-value"
});

function contractFailure(name, mutate) {
  return expectFailure(name, () => {
    const value = clone(rawFixture);
    mutate(value);
    return validateSegmentBusCapacityProbe(value, { allowSynthetic: true, capacityPlan, budgets });
  });
}
await contractFailure("throughput shortfall", (value) => { value.load.achievedMessagesPerSecond = 324; });
await contractFailure("delivery loss", (value) => { value.load.receivedDeliveries -= 1; });
await contractFailure("latency budget", (value) => { value.load.publishAckLatencyMs.p99 = 101; });
await contractFailure("leader loss", (value) => { value.failover.failedNodeWasLeader = false; });
await contractFailure("failover message loss", (value) => { value.failover.lostMessages = 1; });
await contractFailure("replay corruption", (value) => { value.recovery.latestHashAfterReplay = "0".repeat(64); });
await contractFailure("monitoring mismatch", (value) => { value.monitoring.storageGrowthBytes += 1; });
await contractFailure("missing evidence marker", (value) => { value.evidenceMarkers.pop(); });

console.log(`segment bus capacity probe smoke OK: pass=1 failures=${failures}`);
