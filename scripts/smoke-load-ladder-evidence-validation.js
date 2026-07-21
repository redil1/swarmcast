import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/load/load-ladder-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const rawFixture = "test-fixtures/load/load-ladder-raw-probes.complete.synthetic.json";
const baseRawBundle = JSON.parse(readFileSync(rawFixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-load-ladder-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  copyFileSync(rawFixture, path.join(tempRoot, "load-ladder-raw-probes.complete.synthetic.json"));
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function writeProbeVariant(name, transformProbeBundle, transformRecord = (record) => record) {
  const rawBundle = transformProbeBundle(JSON.parse(JSON.stringify(baseRawBundle)));
  const rawPath = path.join(tempRoot, `${name}.raw.json`);
  const rawText = `${JSON.stringify(rawBundle, null, 2)}\n`;
  writeFileSync(rawPath, rawText);
  const record = transformRecord(cloneRecord());
  record.probeArtifacts = [{
    path: path.basename(rawPath),
    sha256: createHash("sha256").update(rawText).digest("hex")
  }];
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

expectFailure(
  "missing raw probe artifacts",
  writeVariant("missing-probe-artifacts", (record) => {
    delete record.probeArtifacts;
    return record;
  }),
  /probeArtifacts must include raw distributed load probe bundles/
);
expectFailure(
  "raw probe artifact hash mismatch",
  writeVariant("probe-artifact-hash-mismatch", (record) => {
    record.probeArtifacts[0].sha256 = "0".repeat(64);
    return record;
  }),
  /SHA-256 mismatch/
);
expectFailure(
  "raw probe artifact path traversal",
  writeVariant("probe-artifact-path-traversal", (record) => {
    record.probeArtifacts[0].path = "../load-ladder-raw-probes.complete.synthetic.json";
    return record;
  }),
  /path must stay within the evidence directory/
);
expectFailure(
  "raw probe artifact has an unsupported field",
  writeVariant("probe-artifact-extra-field", (record) => {
    record.probeArtifacts[0].note = "not allowed";
    return record;
  }),
  /must contain only path and sha256/
);
expectFailure(
  "single generator cannot prove a distributed stage",
  writeVariant("single-generator", (record) => {
    stage(record, "1-channel-200-peers").generatorProbeIds = ["p200-a"];
    return record;
  }),
  /must include at least 2 independent generators/
);
expectFailure(
  "generator peer range overlap",
  writeProbeVariant("probe-range-overlap", (bundle) => {
    bundle.probes.find((probe) => probe.probeId === "p200-b").assignedPeerStart = 99;
    return bundle;
  }),
  /peer ranges have a gap or overlap/
);
expectFailure(
  "generator providers are not independent",
  writeProbeVariant("probe-provider-collapse", (bundle) => {
    bundle.probes.find((probe) => probe.probeId === "p200-b").generatorProvider = "provider-a";
    return bundle;
  }),
  /span at least two generator providers/
);
expectFailure(
  "generator egress identity is reused",
  writeProbeVariant("probe-egress-reuse", (bundle) => {
    const first = bundle.probes.find((probe) => probe.probeId === "p200-a");
    bundle.probes.find((probe) => probe.probeId === "p200-b").networkEgressFingerprintSha256 = first.networkEgressFingerprintSha256;
    return bundle;
  }),
  /distinct network egress fingerprints/
);
expectFailure(
  "generator starts are not synchronized",
  writeProbeVariant("probe-start-skew", (bundle) => {
    const probe = bundle.probes.find((candidate) => candidate.probeId === "p200-b");
    probe.startedAt = "2026-07-05T00:10:07.000Z";
    probe.completedAt = "2026-07-05T00:10:17.000Z";
    return bundle;
  }, (record) => {
    stage(record, "1-channel-200-peers").completedAt = "2026-07-05T00:10:17.000Z";
    return record;
  }),
  /generator starts differ by more than five seconds/
);
expectFailure(
  "probe release binding differs from ladder",
  writeProbeVariant("probe-release-mismatch", (bundle) => {
    bundle.probes.find((probe) => probe.probeId === "p200-b").commit = "f".repeat(40);
    return bundle;
  }),
  /release binding mismatch/
);
expectFailure(
  "probe totals do not reconcile to stage bytes",
  writeProbeVariant("probe-byte-drift", (bundle) => {
    bundle.probes.find((probe) => probe.probeId === "p200-b").clientP2pBytes -= 1;
    return bundle;
  }),
  /clientP2pBytes does not equal the raw generator probe total/
);
expectFailure(
  "cross-host transfer coverage is too small",
  writeProbeVariant("probe-cross-host-low", (bundle) => {
    bundle.probes.find((probe) => probe.probeId === "p200-a").crossGeneratorEndpoints = 1;
    bundle.probes.find((probe) => probe.probeId === "p200-b").crossGeneratorEndpoints = 1;
    return bundle;
  }),
  /cross-generator endpoints must be at least 20/
);
expectFailure(
  "verified transfer send and receive totals diverge",
  writeProbeVariant("probe-transfer-drift", (bundle) => {
    bundle.probes.find((probe) => probe.probeId === "p200-a").verifiedSendTransfers = 49;
    return bundle;
  }),
  /verified send\/receive transfers do not reconcile/
);
expectFailure(
  "raw probes miss a tracker cell",
  writeProbeVariant("probe-cell-missing", (bundle) => {
    bundle.probes.find((probe) => probe.probeId === "p1k-b").trackerCellIds = ["cell-1"];
    return bundle;
  }),
  /raw probes observed 1 tracker cells instead of 2/
);
expectFailure(
  "unreferenced raw probe",
  writeProbeVariant("probe-unreferenced", (bundle) => {
    const extra = JSON.parse(JSON.stringify(bundle.probes.find((probe) => probe.probeId === "p200-a")));
    extra.probeId = "unused-probe";
    bundle.probes.push(extra);
    return bundle;
  }),
  /distributed probe unused-probe is not referenced by a stage/
);
expectFailure(
  "unknown selected ICE candidate in raw probe",
  writeProbeVariant("probe-unknown-ice", (bundle) => {
    const probe = bundle.probes.find((candidate) => candidate.probeId === "p200-a");
    probe.candidateSelections.host -= 1;
    probe.candidateSelections.unknown = 1;
    return bundle;
  }),
  /candidateSelections\.unknown must equal 0/
);
expectFailure(
  "selected ICE object has an unsupported field",
  writeProbeVariant("probe-extra-ice-field", (bundle) => {
    bundle.probes.find((candidate) => candidate.probeId === "p200-a").candidateSelections.private = 0;
    return bundle;
  }),
  /candidateSelections contains unsupported candidate fields/
);
expectFailure(
  "cross-generator transfer graph is disconnected",
  writeProbeVariant("probe-disconnected-graph", (bundle) => {
    bundle.probes.find((probe) => probe.probeId === "p100k-d").remoteGeneratorIds = ["load-c"];
    return bundle;
  }),
  /cross-generator transfer graph is disconnected/
);
expectFailure(
  "stage stall rate is not derived from raw probes",
  writeVariant("stage-stall-raw-drift", (record) => {
    stage(record, "1-channel-200-peers").stallRate = 0.004;
    return record;
  }),
  /stallRate does not equal the raw generator probe total/
);
expectFailure(
  "stage startup p95 is not the conservative raw maximum",
  writeVariant("stage-startup-raw-drift", (record) => {
    stage(record, "1-channel-200-peers").startupLatencyMsP95 = 3300;
    return record;
  }),
  /startupLatencyMsP95 must equal the conservative maximum raw probe p95/
);
expectFailure(
  "stage buffer minimum is not derived from raw probes",
  writeVariant("stage-buffer-raw-drift", (record) => {
    stage(record, "1-channel-200-peers").bufferMsMin = 29999;
    return record;
  }),
  /bufferMsMin must equal the minimum raw probe buffer/
);

console.log("load ladder evidence validation smoke OK: pass=1 failures=43");
