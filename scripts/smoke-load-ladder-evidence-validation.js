import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/load/load-ladder-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-load-ladder-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function stage(record, id) {
  const value = record.stages.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing stage ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-load-ladder-evidence.js"];
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

expectPass("complete synthetic load ladder evidence", fixture);
expectFailure(
  "synthetic evidence without explicit allow flag",
  fixture,
  /synthetic load ladder evidence requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "missing required stage",
  writeVariant("missing-zipf", (record) => {
    record.stages = record.stages.filter((candidate) => candidate.id !== "zipf-catalog");
    return record;
  }),
  /missing required load ladder stage zipf-catalog/
);
expectFailure(
  "missing self sustaining sweep",
  writeVariant("missing-self-sustaining-sweep", (record) => {
    delete record.selfSustainingSweep;
    return record;
  }),
  /selfSustainingSweep is required/
);
expectFailure(
  "edge fallback after flatten",
  writeVariant("edge-fallback-after-flatten", (record) => {
    record.selfSustainingSweep.edgeFallbackPackets.find((row) => row.superPeerFraction === 0.2).edgeFallbackPackets = 1;
    return record;
  }),
  /selfSustainingSweep\.edgeFallbackPackets must be zero at and after flattenSuperPeerFraction/
);
expectFailure(
  "offload below required threshold",
  writeVariant("offload-low", (record) => {
    stage(record, "50-channels-2000-peers").offloadRatio = 0.89;
    return record;
  }),
  /50-channels-2000-peers\.offloadRatio must be between 0\.9 and 1/
);
expectFailure(
  "stall rate above budget",
  writeVariant("stall-rate-high", (record) => {
    stage(record, "1-channel-200-peers").stallRate = 0.02;
    return record;
  }),
  /1-channel-200-peers\.stallRate must be between 0 and 0\.01/
);
expectFailure(
  "tracker cpu above budget",
  writeVariant("tracker-cpu-high", (record) => {
    stage(record, "zipf-catalog").trackerCpuMsP95 = 3;
    return record;
  }),
  /zipf-catalog\.trackerCpuMsP95 must be between 0 and 2/
);
expectFailure(
  "missing WebRTC DataChannel transfer",
  writeVariant("missing-datachannel-transfer", (record) => {
    stage(record, "1-channel-200-peers").dataChannelTransfer = false;
    return record;
  }),
  /1-channel-200-peers\.dataChannelTransfer must be true/
);
expectFailure(
  "alert not clear",
  writeVariant("alert-firing", (record) => {
    stage(record, "1-channel-3-devices").alertState = "firing";
    return record;
  }),
  /1-channel-3-devices\.alertState has invalid format/
);
expectFailure(
  "sensitive evidence reference",
  writeVariant("sensitive-evidence", (record) => {
    stage(record, "1-channel-200-peers").evidence.push("token=synthetic-secret");
    return record;
  }),
  /1-channel-200-peers\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("load ladder evidence validation smoke OK: pass=1 failures=10");
