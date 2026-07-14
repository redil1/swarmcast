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
  /devices must include at least two devices/
);
expectFailure(
  "missing cellular device",
  writeVariant("missing-cellular-device", (record) => {
    record.devices = record.devices.map((device) => ({ ...device, network: "wifi" }));
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
  /transfer\.verifiedSegments must be between 1 and Infinity/
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
    record.transfer.offloadRatio = 0;
    return record;
  }),
  /transfer\.offloadRatio must be between 0.01 and 1/
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
  "sensitive transfer evidence",
  writeVariant("sensitive-transfer-evidence", (record) => {
    record.transfer.evidence.push("sourceUrl=https://upstream.example/live/channel.m3u8?token=synthetic");
    return record;
  }),
  /transfer\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("Android P2P evidence validation smoke OK: pass=1 failures=21");
