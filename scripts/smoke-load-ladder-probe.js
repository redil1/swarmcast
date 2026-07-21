import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runLoadLadderProbe, validateLoadProbeManifest } from "./load-ladder-probe-runner.js";
import { sha256File } from "./load-ladder-contract.js";

const root = mkdtempSync(path.join(tmpdir(), "swarmcast-load-probe-"));
const driverPath = path.join(root, "synthetic-driver.js");
const manifestPath = path.join(root, "manifest.json");
const outputPath = path.join(root, "raw.json");
const startedAt = new Date(Date.now() + 500).toISOString();
const driverSource = `#!/usr/bin/env node
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  const started = Date.parse(request.startAt);
  const peers = request.assignment.peerCount;
  const bytes = peers * 65536;
  process.stdout.write(JSON.stringify({
    startedAt: new Date(started).toISOString(),
    completedAt: new Date(started + request.durationSeconds * 1000).toISOString(),
    joinedPeers: peers,
    joinFailures: 0,
    dataChannelEndpoints: peers,
    successfulConnections: peers,
    failedConnections: 0,
    verifiedSendTransfers: peers / 2,
    verifiedReceiveTransfers: peers / 2,
    failedTransfers: 0,
    crossGeneratorEndpoints: Math.ceil(peers * 0.2),
    remoteGeneratorIds: ["load-b"],
    signalingMessages: peers * 3,
    clientP2pBytes: bytes,
    clientEdgeBytes: 0,
    clientBootstrapOriginBytes: 0,
    clientRelayBytes: 0,
    clientUploadBytes: bytes,
    verifiedPayloadBytesSent: bytes,
    verifiedPayloadBytesReceived: bytes,
    candidateSelections: { host: peers, srflx: 0, prflx: 0, relay: 0, unknown: 0 },
    playbackSamples: peers,
    stallEvents: 0,
    startupLatencyMsP95: 1000,
    bufferMsMin: 30000,
    joinLatencyMsP95: 100,
    channelOpenMsP95: 200,
    transferMsP95: 50,
    trackerCellIds: ["cell-a"],
    evidenceMarkers: ["webrtc-datachannel", "tracker-signaling-relay", "sha256-verified", "cross-generator-transfer", "per-viewer-auth"]
  }));
});
`;
writeFileSync(driverPath, driverSource);
chmodSync(driverPath, 0o700);
const driverSha256 = sha256File(driverPath);

function manifest(overrides = {}) {
  const base = {
    schemaVersion: 1,
    synthetic: true,
    probeId: "probe-a",
    runId: "run-200",
    stageId: "1-channel-200-peers",
    environment: "staging",
    commit: "0123456789abcdef0123456789abcdef01234567",
    releaseVersion: "v0.1.0-rc1",
    startAt: startedAt,
    durationSeconds: 2,
    target: { id: "staging-a", trackerUrl: "ws://127.0.0.1:8080/ws", channelId: "load-channel" },
    generator: {
      id: "load-a",
      provider: "provider-a",
      region: "eu-west",
      failureDomain: "provider-a-eu",
      networkEgressFingerprintSha256: "a".repeat(64)
    },
    assignment: { peerStart: 0, peerCount: 100 },
    driver: { sha256: driverSha256, imageDigest: `sha256:${"e".repeat(64)}` }
  };
  return { ...base, ...overrides };
}

writeFileSync(manifestPath, `${JSON.stringify(manifest(), null, 2)}\n`);
const result = spawnSync(process.execPath, [
  "scripts/run-load-ladder-probe.js",
  "--acknowledge-staging-load",
  "--allow-synthetic",
  "--manifest", manifestPath,
  "--driver", driverPath,
  "--output", outputPath
], { cwd: process.cwd(), encoding: "utf8" });
assert.equal(result.status, 0, `synthetic probe should pass\n${result.stdout}\n${result.stderr}`);
const bundle = JSON.parse(readFileSync(outputPath, "utf8"));
assert.equal(bundle.probes.length, 1);
assert.equal(bundle.probes[0].joinedPeers, 100);
assert.equal(bundle.probes[0].crossGeneratorEndpoints, 20);
assert.equal(bundle.probes[0].startedAtMs, undefined);
assert.equal(statSync(outputPath).mode & 0o777, 0o600, "probe output permissions are not 0600");
assert.doesNotMatch(JSON.stringify(bundle), /trackerUrl|127\.0\.0\.1|token|secret/i);

let failures = 0;
async function expectFailure(label, operation, pattern) {
  await assert.rejects(operation, pattern, label);
  failures += 1;
}

const noAck = spawnSync(process.execPath, [
  "scripts/run-load-ladder-probe.js",
  "--allow-synthetic",
  "--manifest", manifestPath,
  "--driver", driverPath,
  "--output", outputPath
], { cwd: process.cwd(), encoding: "utf8" });
assert.notEqual(noAck.status, 0);
assert.match(noAck.stderr, /--acknowledge-staging-load is required/);
failures += 1;

await expectFailure("synthetic probe requires explicit allowance", async () => {
  validateLoadProbeManifest(manifest());
}, /synthetic load probes require --allow-synthetic/);
await expectFailure("unsupported stage", async () => {
  validateLoadProbeManifest(manifest({ stageId: "1-channel-3-devices" }), { allowSynthetic: true });
}, /distributed load stage/);
await expectFailure("tracker URL query is forbidden", async () => {
  validateLoadProbeManifest(manifest({ target: { id: "staging-a", trackerUrl: "ws://127.0.0.1:8080/ws?token=x", channelId: "load-channel" } }), { allowSynthetic: true });
}, /must not contain credentials, query parameters, or fragments/);
await expectFailure("peer range overflow", async () => {
  validateLoadProbeManifest(manifest({ assignment: { peerStart: 150, peerCount: 100 } }), { allowSynthetic: true });
}, /peer range exceeds/);
await expectFailure("driver hash mismatch", async () => {
  await runLoadLadderProbe({ manifest: manifest({ driver: { sha256: "f".repeat(64), imageDigest: `sha256:${"e".repeat(64)}` } }), driverPath, allowSynthetic: true });
}, /driver SHA-256 does not match/);
await expectFailure("private production target", async () => {
  const production = manifest({
    synthetic: false,
    startAt: new Date(Date.now() + 20_000).toISOString(),
    durationSeconds: 300,
    target: { id: "staging-a", trackerUrl: "wss://tracker.example.test/ws", channelId: "load-channel" }
  });
  await runLoadLadderProbe({
    manifest: production,
    driverPath,
    resolveHost: async () => [{ address: "10.0.0.1" }]
  });
}, /resolve only to public addresses/);

function driverOutput(transform = (value) => value) {
  const peers = 100;
  const start = Date.parse(startedAt);
  return transform({
    startedAt,
    completedAt: new Date(start + 2_000).toISOString(),
    joinedPeers: peers,
    joinFailures: 0,
    dataChannelEndpoints: peers,
    successfulConnections: peers,
    failedConnections: 0,
    verifiedSendTransfers: 50,
    verifiedReceiveTransfers: 50,
    failedTransfers: 0,
    crossGeneratorEndpoints: 20,
    remoteGeneratorIds: ["load-b"],
    signalingMessages: 300,
    clientP2pBytes: 6553600,
    clientEdgeBytes: 0,
    clientBootstrapOriginBytes: 0,
    clientRelayBytes: 0,
    clientUploadBytes: 6553600,
    verifiedPayloadBytesSent: 6553600,
    verifiedPayloadBytesReceived: 6553600,
    candidateSelections: { host: 100, srflx: 0, prflx: 0, relay: 0, unknown: 0 },
    playbackSamples: 100,
    stallEvents: 0,
    startupLatencyMsP95: 1000,
    bufferMsMin: 30000,
    joinLatencyMsP95: 100,
    channelOpenMsP95: 200,
    transferMsP95: 50,
    trackerCellIds: ["cell-a"],
    evidenceMarkers: ["webrtc-datachannel", "tracker-signaling-relay", "sha256-verified", "cross-generator-transfer", "per-viewer-auth"]
  });
}

async function runWithOutput(output) {
  return runLoadLadderProbe({
    manifest: manifest(),
    driverPath,
    allowSynthetic: true,
    now: () => Date.parse(startedAt),
    sleep: async () => {},
    executeDriver: async () => output
  });
}

await expectFailure("driver start skew", () => runWithOutput(driverOutput((value) => ({ ...value, startedAt: new Date(Date.parse(startedAt) + 2_000).toISOString(), completedAt: new Date(Date.parse(startedAt) + 4_000).toISOString() }))), /start differs/);
await expectFailure("driver duration mismatch", () => runWithOutput(driverOutput((value) => ({ ...value, completedAt: new Date(Date.parse(startedAt) + 5_000).toISOString() }))), /duration does not match the manifest/);
await expectFailure("unsupported driver output", () => runWithOutput(driverOutput((value) => ({ ...value, debugLog: "not allowed" }))), /unsupported key debugLog/);
await expectFailure("join failures", () => runWithOutput(driverOutput((value) => ({ ...value, joinFailures: 1 }))), /joinFailures must be an integer between 0 and 0/);
await expectFailure("unknown ICE candidate", () => runWithOutput(driverOutput((value) => ({ ...value, candidateSelections: { host: 99, srflx: 0, prflx: 0, relay: 0, unknown: 1 } }))), /unknown must equal 0/);
await expectFailure("missing cross-host endpoint", () => runWithOutput(driverOutput((value) => ({ ...value, crossGeneratorEndpoints: 0 }))), /crossGeneratorEndpoints must be an integer between 1 and 100/);
await expectFailure("sensitive driver output key", () => runWithOutput(driverOutput((value) => ({ ...value, authToken: "sensitive" }))), /unsupported key authToken/);
await expectFailure("payload byte mismatch", () => runWithOutput(driverOutput((value) => ({ ...value, clientUploadBytes: 1 }))), /clientUploadBytes must equal verifiedPayloadBytesSent/);
await expectFailure("missing evidence marker", () => runWithOutput(driverOutput((value) => ({ ...value, evidenceMarkers: value.evidenceMarkers.filter((marker) => marker !== "sha256-verified") }))), /missing sha256-verified/);

console.log(`load ladder probe smoke OK: pass=1 failures=${failures} peers=${bundle.probes[0].joinedPeers}`);
