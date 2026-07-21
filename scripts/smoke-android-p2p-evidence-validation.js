import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/android/p2p-transfer-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-android-p2p-evidence-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function check(record, id) {
  const value = record.checks.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing check ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-android-p2p-evidence.js"];
  if (allowSynthetic) args.push("--allow-synthetic");
  args.push(file);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function expectPass(label, file) {
  const result = validate(file);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, file, pattern, options = {}) {
  const result = validate(file, options);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass("complete synthetic Android P2P evidence", fixture);
expectFailure(
  "synthetic Android P2P evidence without explicit allow flag",
  fixture,
  /synthetic Android P2P evidence requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "not enough devices",
  writeVariant("one-device", (record) => {
    record.devices = record.devices.slice(0, 1);
    return record;
  }),
  /devices must include at least four physical devices/
);
expectFailure(
  "missing cellular device",
  writeVariant("missing-cellular-device", (record) => {
    record.devices = record.devices.map((device, index) => {
      const updated = { ...device, network: "wifi", wifiNetworkId: `wifi-${index}`, measuredUploadBytes: Math.max(1, device.measuredUploadBytes) };
      delete updated.carrierId;
      return updated;
    });
    return record;
  }),
  /devices must include cellular Android P2P evidence/
);
expectFailure(
  "missing DataChannel check",
  writeVariant("missing-datachannel", (record) => {
    record.checks = record.checks.filter((candidate) => candidate.id !== "datachannel-open");
    return record;
  }),
  /missing required Android P2P check datachannel-open/
);
expectFailure(
  "missing cellular receive-only check",
  writeVariant("missing-cellular-receive-only", (record) => {
    record.checks = record.checks.filter((candidate) => candidate.id !== "cellular-receive-only");
    return record;
  }),
  /missing required Android P2P check cellular-receive-only/
);
expectFailure(
  "missing relay accounting check",
  writeVariant("missing-relay-accounting", (record) => {
    record.checks = record.checks.filter((candidate) => candidate.id !== "relay-accounting");
    return record;
  }),
  /missing required Android P2P check relay-accounting/
);
expectFailure(
  "ICE check failed",
  writeVariant("ice-failed", (record) => {
    check(record, "ice-connected").status = "fail";
    return record;
  }),
  /ice-connected\.status must pass before Android P2P approval/
);
expectFailure(
  "check references unknown device",
  writeVariant("unknown-check-device", (record) => {
    check(record, "webrtc-offer-answer").deviceIds[1] = "missing-device";
    return record;
  }),
  /webrtc-offer-answer references unknown device missing-device/
);
expectFailure(
  "duplicate P2P check",
  writeVariant("duplicate-check", (record) => {
    record.checks.push({ ...check(record, "tracker-stats") });
    return record;
  }),
  /duplicate P2P check tracker-stats/
);
expectFailure(
  "sensitive check evidence",
  writeVariant("sensitive-check-evidence", (record) => {
    check(record, "tracker-stats").evidence.push("jwt=synthetic-secret");
    return record;
  }),
  /tracker-stats\.evidence evidence reference looks like it may contain sensitive material/
);
expectFailure(
  "P2P disabled in transfer",
  writeVariant("p2p-disabled", (record) => {
    record.transfer.p2pEnabled = false;
    return record;
  }),
  /transfer\.p2pEnabled must be true/
);
expectFailure(
  "edge fallback not verified",
  writeVariant("edge-fallback-missing", (record) => {
    record.transfer.edgeFallbackVerified = false;
    return record;
  }),
  /transfer\.edgeFallbackVerified must be true/
);
expectFailure(
  "source and sink are same",
  writeVariant("same-source-sink", (record) => {
    record.transfer.sinkDeviceId = record.transfer.sourceDeviceId;
    return record;
  }),
  /transfer source and sink devices must differ/
);
expectFailure(
  "cellular upload source",
  writeVariant("cellular-upload-source", (record) => {
    record.transfer.sourceDeviceId = "pixel-8-b";
    record.transfer.sinkDeviceId = "pixel-8-a";
    return record;
  }),
  /transfer source device must be wifi for upload evidence/
);
expectFailure(
  "no verified segments",
  writeVariant("no-verified-segments", (record) => {
    record.transfer.verifiedSegments = 0;
    return record;
  }),
  /transfer\.verifiedSegments must be between 100 and Infinity/
);
expectFailure(
  "hash failure observed",
  writeVariant("hash-failure", (record) => {
    record.transfer.hashFailures = 1;
    return record;
  }),
  /transfer\.hashFailures must be between 0 and 0/
);
expectFailure(
  "disconnect observed",
  writeVariant("disconnect", (record) => {
    record.transfer.disconnects = 1;
    return record;
  }),
  /transfer\.disconnects must be between 0 and 0/
);
expectFailure(
  "offload ratio too low",
  writeVariant("low-offload", (record) => {
    record.transfer.offloadRatio = 0.89;
    return record;
  }),
  /transfer\.offloadRatio must be between 0.9 and 1/
);
expectFailure(
  "missing direct P2P bytes",
  writeVariant("missing-direct-p2p-bytes", (record) => {
    delete record.transfer.directP2pBytes;
    return record;
  }),
  /transfer\.directP2pBytes must be an integer/
);
expectFailure(
  "offload ratio inconsistent with delivery categories",
  writeVariant("offload-category-mismatch", (record) => {
    record.transfer.offloadRatio = 0.91;
    return record;
  }),
  /transfer\.offloadRatio does not match direct P2P over all delivery bytes/
);
expectFailure(
  "relay egress does not reconcile",
  writeVariant("relay-egress-mismatch", (record) => {
    record.transfer.relayAccessEgressBytes = 100000;
    return record;
  }),
  /transfer relay egress is not reconciled within tolerance/
);
expectFailure(
  "stall rate above budget",
  writeVariant("high-stall-rate", (record) => {
    record.transfer.stallRate = 0.02;
    return record;
  }),
  /transfer\.stallRate must be between 0 and 0.01/
);
expectFailure(
  "buffer below budget",
  writeVariant("low-buffer", (record) => {
    record.transfer.bufferMsMin = 9999;
    return record;
  }),
  /transfer\.bufferMsMin must be between 10000 and Infinity/
);
expectFailure(
  "missing DataChannel transfer evidence",
  writeVariant("missing-datachannel-transfer-evidence", (record) => {
    record.transfer.evidence = record.transfer.evidence.filter((item) => !item.includes("webrtc-datachannel"));
    return record;
  }),
  /transfer\.evidence must mention webrtc-datachannel/
);
expectFailure(
  "missing direct relay attribution evidence",
  writeVariant("missing-direct-relay-attribution", (record) => {
    record.transfer.evidence = record.transfer.evidence.filter((item) => !item.includes("direct-relay-payload-attribution"));
    return record;
  }),
  /transfer\.evidence must mention direct-relay-payload-attribution/
);
expectFailure(
  "sensitive transfer evidence",
  writeVariant("sensitive-transfer-evidence", (record) => {
    record.transfer.evidence.push("sourceUrl=https://upstream.example/live/channel.m3u8?token=synthetic");
    return record;
  }),
  /transfer\.evidence evidence reference looks like it may contain sensitive material/
);
expectFailure(
  "missing cellular ICE outcomes",
  writeVariant("missing-cellular-ice", (record) => {
    record.connectivity.devices = record.connectivity.devices.filter((row) => row.deviceId !== "pixel-8-b");
    return record;
  }),
  /connectivity must include device pixel-8-b/
);
expectFailure(
  "ICE outcomes exceed attempts",
  writeVariant("ice-outcomes-over-attempts", (record) => {
    record.connectivity.devices[0].failures = 2;
    return record;
  }),
  /connectivity\.pixel-8-a outcomes must equal attempts/
);
expectFailure(
  "selected ICE candidates do not reconcile",
  writeVariant("ice-candidate-mismatch", (record) => {
    record.connectivity.devices[1].selectedCandidates.srflx = 2;
    return record;
  }),
  /connectivity\.pixel-8-b selected candidates must sum to successes/
);
expectFailure(
  "missing selected candidate evidence",
  writeVariant("missing-selected-candidate-evidence", (record) => {
    record.connectivity.evidence = ["tracker-metrics/ice-network-class.synthetic.prom"];
    return record;
  }),
  /connectivity\.evidence must mention ice-selected-candidate-type/
);

expectFailure(
  "emulator marked as physical evidence",
  writeVariant("non-physical-device", (record) => {
    record.devices[0].physical = false;
    return record;
  }),
  /pixel-8-a\.physical must be true/
);
expectFailure(
  "duplicate physical device fingerprint",
  writeVariant("duplicate-device-fingerprint", (record) => {
    record.devices[1].deviceFingerprintSha256 = record.devices[0].deviceFingerprintSha256;
    return record;
  }),
  /duplicate physical device fingerprint for pixel-8-b/
);
expectFailure(
  "single WiFi failure domain",
  writeVariant("single-wifi-domain", (record) => {
    record.devices.find((device) => device.id === "pixel-8-c").wifiNetworkId = "wifi-lab-a";
    return record;
  }),
  /at least two WiFi network failure domains/
);
expectFailure(
  "single cellular carrier domain",
  writeVariant("single-carrier-domain", (record) => {
    record.devices.find((device) => device.id === "pixel-8-d").carrierId = "carrier-lab-a";
    return record;
  }),
  /at least two cellular carrier failure domains/
);
expectFailure(
  "non-Play installation",
  writeVariant("non-play-install", (record) => {
    record.devices[0].installationSource = "sideload";
    return record;
  }),
  /pixel-8-a\.installationSource has invalid format/
);
expectFailure(
  "device APK does not match release",
  writeVariant("apk-mismatch", (record) => {
    record.devices[0].apkSha256 = "b".repeat(64);
    return record;
  }),
  /pixel-8-a\.apkSha256 must match releaseApkSha256/
);
expectFailure(
  "second WiFi device has no useful upload",
  writeVariant("wifi-device-no-upload", (record) => {
    record.devices.find((device) => device.id === "pixel-8-c").measuredUploadBytes = 0;
    return record;
  }),
  /pixel-8-c\.measuredUploadBytes must prove useful WiFi upload/
);
expectFailure(
  "second carrier device uploaded payload",
  writeVariant("second-cellular-device-upload", (record) => {
    record.devices.find((device) => device.id === "pixel-8-d").measuredUploadBytes = 1;
    return record;
  }),
  /pixel-8-d\.measuredUploadBytes must be zero on cellular/
);
expectFailure(
  "physical transfer soak too short",
  writeVariant("short-transfer-soak", (record) => {
    record.transfer.durationSeconds = 1799;
    return record;
  }),
  /transfer\.durationSeconds must be between 1800 and Infinity/
);
expectFailure(
  "insufficient device samples",
  writeVariant("insufficient-samples", (record) => {
    record.transfer.sampleCount = 59;
    return record;
  }),
  /transfer\.sampleCount must be between 60 and Infinity/
);
expectFailure(
  "source upload does not cover peer delivery",
  writeVariant("source-upload-too-low", (record) => {
    record.transfer.sourceUploadBytes = 8000000;
    record.transfer.trackerUploadBytes = 8000000;
    record.devices.find((device) => device.id === "pixel-8-a").measuredUploadBytes = 4000000;
    record.devices.find((device) => device.id === "pixel-8-c").measuredUploadBytes = 4000000;
    return record;
  }),
  /sourceUploadBytes must cover direct and relayed peer payload/
);
expectFailure(
  "cellular sink uploaded payload",
  writeVariant("cellular-upload-observed", (record) => {
    record.transfer.sinkUploadBytes = 1;
    return record;
  }),
  /transfer\.sinkUploadBytes must be between 0 and 0/
);
expectFailure(
  "edge egress does not reconcile",
  writeVariant("edge-egress-mismatch", (record) => {
    record.transfer.edgeAccessEgressBytes = 100000;
    return record;
  }),
  /transfer edge egress is not reconciled within tolerance/
);
expectFailure(
  "origin bootstrap does not reconcile",
  writeVariant("origin-bootstrap-mismatch", (record) => {
    record.transfer.originAccessBootstrapBytes = 100000;
    return record;
  }),
  /transfer origin bootstrap is not reconciled within tolerance/
);
expectFailure(
  "tracker direct P2P does not reconcile",
  writeVariant("tracker-p2p-mismatch", (record) => {
    record.transfer.trackerP2pDownloadBytes = 8000000;
    return record;
  }),
  /transfer tracker direct P2P is not reconciled within tolerance/
);
expectFailure(
  "battery drain above P2P budget",
  writeVariant("p2p-battery-high", (record) => {
    record.transfer.batteryDrainPctPerHour = 9;
    return record;
  }),
  /transfer\.batteryDrainPctPerHour must be between 0 and 8/
);
expectFailure(
  "unknown selected ICE candidate",
  writeVariant("unknown-ice-candidate", (record) => {
    record.connectivity.devices[1].selectedCandidates.srflx -= 1;
    record.connectivity.devices[1].selectedCandidates.unknown = 1;
    return record;
  }),
  /connectivity\.pixel-8-b selected candidates must not be unknown/
);
expectFailure(
  "cellular check misses second carrier",
  writeVariant("cellular-check-carrier-missing", (record) => {
    check(record, "cellular-receive-only").deviceIds = ["pixel-8-a", "pixel-8-b"];
    return record;
  }),
  /cellular-receive-only check must cover every cellular carrier device/
);
expectFailure(
  "P2P disable leaves active links",
  writeVariant("p2p-disable-active-links", (record) => {
    record.transfer.p2pDisabledActiveLinks = 1;
    return record;
  }),
  /transfer\.p2pDisabledActiveLinks must be between 0 and 0/
);
expectFailure(
  "P2P disable does not prove edge fallback bytes",
  writeVariant("p2p-disable-no-edge", (record) => {
    record.transfer.p2pDisabledEdgeBytes = 0;
    return record;
  }),
  /transfer\.p2pDisabledEdgeBytes must be between 1 and Infinity/
);

console.log("Android P2P evidence validation smoke OK: pass=1 failures=50");
