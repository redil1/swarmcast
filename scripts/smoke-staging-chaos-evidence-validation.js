import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/chaos/staging-chaos-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-staging-chaos-"));
const peerHealthRunbookEvidence = "docs/runbooks/peer-health.md";

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function drill(record, id) {
  const value = record.drills.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing drill ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-staging-chaos-evidence.js"];
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

expectPass("complete synthetic staging chaos evidence", fixture);
expectFailure(
  "synthetic evidence without explicit allow flag",
  fixture,
  /synthetic staging chaos evidence requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "missing required drill",
  writeVariant("missing-edge-failover", (record) => {
    record.drills = record.drills.filter((candidate) => candidate.id !== "edge-node-failover");
    return record;
  }),
  /missing required staging chaos drill edge-node-failover/
);
expectFailure(
  "alert not observed",
  writeVariant("alert-not-observed", (record) => {
    drill(record, "tracker-restart-android-playback").alertObserved = false;
    return record;
  }),
  /tracker-restart-android-playback\.alertObserved must be true/
);
expectFailure(
  "service did not recover",
  writeVariant("not-recovered", (record) => {
    drill(record, "ffmpeg-worker-crash").recovered = false;
    return record;
  }),
  /ffmpeg-worker-crash\.recovered must be true/
);
expectFailure(
  "cascade detected",
  writeVariant("cascade-detected", (record) => {
    drill(record, "ingest-node-failover").noCascade = false;
    return record;
  }),
  /ingest-node-failover\.noCascade must be true/
);
expectFailure(
  "third-party cdn fallback",
  writeVariant("third-party-cdn", (record) => {
    drill(record, "edge-node-failover").thirdPartyCdnUsed = true;
    return record;
  }),
  /edge-node-failover\.thirdPartyCdnUsed must be false/
);
expectFailure(
  "missing Android playback continuity",
  writeVariant("missing-playback-continuity", (record) => {
    const edgeFailover = drill(record, "edge-node-failover");
    edgeFailover.evidence = edgeFailover.evidence.filter((evidence) => !evidence.includes("android-playback-continuity"));
    return record;
  }),
  /edge-node-failover\.evidence must include android-playback-continuity/
);
expectFailure(
  "data loss detected",
  writeVariant("data-loss", (record) => {
    drill(record, "control-plane-restart").dataLoss = true;
    return record;
  }),
  /control-plane-restart\.dataLoss must be false/
);
expectFailure(
  "sensitive evidence reference",
  writeVariant("sensitive-evidence", (record) => {
    drill(record, "multi-service-recovery").evidence.push("jwt=synthetic-secret");
    return record;
  }),
  /multi-service-recovery\.evidence evidence reference looks like it may contain sensitive material/
);
expectFailure(
  "missing peer health runbook evidence",
  writeVariant("missing-peer-health-runbook", (record) => {
    drill(record, "peer-health-incident").evidence = [
      "chaos/peer-health-incident.synthetic.json",
      "SwarmcastPeerHashFailures alert observed and resolved"
    ];
    return record;
  }),
  /peer-health-incident\.evidence must include docs\/runbooks\/peer-health\.md/
);

console.log("staging chaos evidence validation smoke OK: pass=1 failures=10");
