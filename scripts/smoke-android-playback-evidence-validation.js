import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/android/playback-delivery-fleet-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-android-playback-evidence-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function session(record, id) {
  const value = record.sessions.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing session ${id}`);
  return value;
}

function device(record, id) {
  const value = record.devices.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing device ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-android-playback-evidence.js"];
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

expectPass("complete synthetic Android playback evidence", fixture);
expectFailure(
  "synthetic Android playback evidence without explicit allow flag",
  fixture,
  /synthetic Android playback evidence requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "duplicate device",
  writeVariant("duplicate-device", (record) => {
    record.devices.push({ ...device(record, "pixel-8") });
    return record;
  }),
  /duplicate device pixel-8/
);
expectFailure(
  "session references unknown device",
  writeVariant("unknown-device", (record) => {
    session(record, "wifi-edge-soak").deviceId = "missing-device";
    return record;
  }),
  /wifi-edge-soak references unknown device missing-device/
);
expectFailure(
  "duplicate playback session",
  writeVariant("duplicate-session", (record) => {
    record.sessions.push({ ...session(record, "wifi-edge-soak") });
    return record;
  }),
  /duplicate playback session wifi-edge-soak/
);
expectFailure(
  "missing cellular playback session",
  writeVariant("missing-cellular-session", (record) => {
    record.sessions = record.sessions.filter((candidate) => candidate.id !== "cellular-edge-soak");
    return record;
  }),
  /playback sessions must include cellular device evidence/
);
expectFailure(
  "P2P accidentally enabled",
  writeVariant("p2p-enabled", (record) => {
    session(record, "wifi-edge-soak").p2pEnabled = true;
    return record;
  }),
  /wifi-edge-soak\.p2pEnabled must be false/
);
expectFailure(
  "session unauthenticated",
  writeVariant("unauthenticated", (record) => {
    session(record, "wifi-edge-soak").authenticated = false;
    return record;
  }),
  /wifi-edge-soak\.authenticated must be true/
);
expectFailure(
  "session crashed",
  writeVariant("crashed", (record) => {
    session(record, "wifi-edge-soak").crashFree = false;
    return record;
  }),
  /wifi-edge-soak\.crashFree must be true/
);
expectFailure(
  "soak too short",
  writeVariant("short-soak", (record) => {
    session(record, "wifi-edge-soak").durationSeconds = 1200;
    return record;
  }),
  /wifi-edge-soak\.durationSeconds must be between 1800 and Infinity/
);
expectFailure(
  "startup latency above budget",
  writeVariant("slow-startup", (record) => {
    session(record, "wifi-edge-soak").startupLatencyMsP95 = 5001;
    return record;
  }),
  /wifi-edge-soak\.startupLatencyMsP95 must be between 0 and 5000/
);
expectFailure(
  "stall rate above budget",
  writeVariant("high-stall-rate", (record) => {
    session(record, "wifi-edge-soak").stallRate = 0.02;
    return record;
  }),
  /wifi-edge-soak\.stallRate must be between 0 and 0.01/
);
expectFailure(
  "buffer below budget",
  writeVariant("low-buffer", (record) => {
    session(record, "wifi-edge-soak").bufferMsMin = 9999;
    return record;
  }),
  /wifi-edge-soak\.bufferMsMin must be between 10000 and Infinity/
);
expectFailure(
  "edge cache below budget",
  writeVariant("low-edge-cache", (record) => {
    session(record, "wifi-edge-soak").edgeCacheHitRatio = 0.7;
    return record;
  }),
  /wifi-edge-soak\.edgeCacheHitRatio must be between 0.8 and 1/
);
expectFailure(
  "battery drain above budget",
  writeVariant("high-battery-drain", (record) => {
    session(record, "wifi-edge-soak").batteryDrainPctPerHour = 9;
    return record;
  }),
  /wifi-edge-soak\.batteryDrainPctPerHour must be between 0 and 8/
);
expectFailure(
  "missing edge cache evidence marker",
  writeVariant("missing-edge-cache-evidence", (record) => {
    session(record, "wifi-edge-soak").evidence = session(record, "wifi-edge-soak").evidence.filter((item) => !item.includes("edge-cache-hit"));
    return record;
  }),
  /wifi-edge-soak\.evidence must mention edge-cache-hit/
);
expectFailure(
  "sensitive playback evidence",
  writeVariant("sensitive-evidence", (record) => {
    session(record, "wifi-edge-soak").evidence.push("sourceUrl=https://upstream.example/live/channel.m3u8?token=synthetic");
    return record;
  }),
  /wifi-edge-soak\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("Android playback evidence validation smoke OK: pass=1 failures=16");
