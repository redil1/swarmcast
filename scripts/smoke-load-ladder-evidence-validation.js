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
  "missing 100K single-channel cell stage",
  writeVariant("missing-100k-cell-stage", (record) => {
    record.stages = record.stages.filter((candidate) => candidate.id !== "1-channel-100000-cell-peers");
    return record;
  }),
  /missing required load ladder stage 1-channel-100000-cell-peers/
);
expectFailure(
  "cell exceeds configured ceiling",
  writeVariant("cell-over-ceiling", (record) => {
    const value = stage(record, "1-channel-100000-cell-peers");
    value.cellPeerCounts = [20001, 19999, 20000, 20000, 20000];
    return record;
  }),
  /cellPeerCounts\[0\] must be between 1 and 20000/
);
expectFailure(
  "cell peer totals do not reconcile",
  writeVariant("cell-peer-total-drift", (record) => {
    stage(record, "1-channel-1000-cell-peers").cellPeerCounts = [499, 500];
    return record;
  }),
  /cellPeerCounts must sum to peerCount/
);
expectFailure(
  "segment fanout misses a cell",
  writeVariant("cell-fanout-missing", (record) => {
    stage(record, "1-channel-100000-cell-peers").segmentFanoutCells = 4;
    return record;
  }),
  /segmentFanoutCells must be between 5 and 5/
);
expectFailure(
  "cell failure does not retain edge fallback",
  writeVariant("cell-failure-no-edge", (record) => {
    stage(record, "1-channel-10000-cell-peers").cellFailureEdgeFallback = false;
    return record;
  }),
  /cellFailureEdgeFallback must be true/
);
expectFailure(
  "cell backpressure drops present",
  writeVariant("cell-backpressure-drops", (record) => {
    stage(record, "1-channel-10000-cell-peers").backpressureDrops = 1;
    return record;
  }),
  /backpressureDrops must be between 0 and 0/
);
expectFailure(
  "multiple origin bootstrap cells",
  writeVariant("multiple-origin-bootstrap-cells", (record) => {
    stage(record, "1-channel-1000-cell-peers").originBootstrapCellCount = 2;
    return record;
  }),
  /originBootstrapCellCount must be between 1 and 1/
);
expectFailure(
  "origin seed assignments exceed the per-channel bound",
  writeVariant("origin-bootstrap-unbounded", (record) => {
    stage(record, "1-channel-1000-cell-peers").originSeedAssignments = 201;
    return record;
  }),
  /originSeedAssignments must be between 100 and 200/
);
expectFailure(
  "secondary cell lacks edge bootstrap",
  writeVariant("edge-bootstrap-cell-missing", (record) => {
    stage(record, "1-channel-100000-cell-peers").edgeBootstrapCellCount = 3;
    return record;
  }),
  /edgeBootstrapCellCount must be between 4 and 4/
);
expectFailure(
  "bootstrap evidence marker missing",
  writeVariant("bootstrap-marker-missing", (record) => {
    const value = stage(record, "1-channel-10000-cell-peers");
    value.evidence = value.evidence.map((item) => item.replace("global-origin-bootstrap", ""));
    return record;
  }),
  /evidence must include global-origin-bootstrap/
);
expectFailure(
  "edge fallback after flatten",
  writeVariant("edge-fallback-after-flatten", (record) => {
    const row = record.selfSustainingSweep.edgeFallbackPackets.find((candidate) => candidate.superPeerFraction === 0.2);
    row.edgeFallbackPackets = 1;
    row.p2pPackets -= 1;
    return record;
  }),
  /selfSustainingSweep\.edgeFallbackPackets must be zero at and after flattenSuperPeerFraction/
);
expectFailure(
  "missing helper bootstrap accounting",
  writeVariant("missing-helper-bootstrap", (record) => {
    record.selfSustainingSweep.edgeFallbackPackets[2].edgeBootstrapPackets = 20;
    return record;
  }),
  /does not charge every preloaded helper/
);
expectFailure(
  "edge access reconciliation drift",
  writeVariant("edge-reconciliation-drift", (record) => {
    stage(record, "1-channel-200-peers").edgeAccessEgressBytes = 100000;
    return record;
  }),
  /edge egress differs by 0\.3000, above tolerance 0\.05/
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

console.log("load ladder evidence validation smoke OK: pass=1 failures=22");
