import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/launch/canary-metrics-pass.json";
const baseSnapshot = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-canary-metrics-"));

function cloneSnapshot() {
  return JSON.parse(JSON.stringify(baseSnapshot));
}

function writeVariant(name, transform) {
  const snapshot = transform(cloneSnapshot());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  return file;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-canary-metrics.js", file], {
    encoding: "utf8"
  });
}

function expectPass(label, file) {
  const result = validate(file);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, file, pattern) {
  const result = validate(file);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass("passing canary metrics snapshot", fixture);
expectFailure(
  "crash-free sessions below launch limit",
  writeVariant("crash-free-low", (snapshot) => {
    snapshot.metrics.androidCrashFreeSessions = 0.98;
    return snapshot;
  }),
  /androidCrashFreeSessions 0\.98 is below limit 0\.99/
);
expectFailure(
  "startup latency above launch budget",
  writeVariant("startup-latency-high", (snapshot) => {
    snapshot.metrics.androidStartupLatencyMsP95 = 5100;
    return snapshot;
  }),
  /androidStartupLatencyMsP95 5100 exceeds limit 5000/
);
expectFailure(
  "stall rate above launch budget",
  writeVariant("stall-rate-high", (snapshot) => {
    snapshot.metrics.androidStallRate = 0.02;
    return snapshot;
  }),
  /androidStallRate 0\.02 exceeds limit 0\.01/
);
expectFailure(
  "buffer below launch budget",
  writeVariant("buffer-low", (snapshot) => {
    snapshot.metrics.androidBufferMsMin = 9000;
    return snapshot;
  }),
  /androidBufferMsMin 9000 is below limit 10000/
);
expectFailure(
  "offload ratio below rollout limit",
  writeVariant("offload-low", (snapshot) => {
    snapshot.metrics.offloadRatio5m = 0.85;
    return snapshot;
  }),
  /offloadRatio5m 0\.85 is below limit 0\.9/
);
expectFailure(
  "edge cache hit ratio below launch budget",
  writeVariant("edge-cache-hit-low", (snapshot) => {
    snapshot.metrics.edgeCacheHitRatio = 0.75;
    return snapshot;
  }),
  /edgeCacheHitRatio 0\.75 is below limit 0\.8/
);
expectFailure(
  "peer timeout spike above rollout limit",
  writeVariant("peer-timeout-high", (snapshot) => {
    snapshot.metrics.peerTimeouts5m = 51;
    return snapshot;
  }),
  /peerTimeouts5m 51 exceeds limit 50/
);
expectFailure(
  "peer hash failure observed",
  writeVariant("peer-hash-failure", (snapshot) => {
    snapshot.metrics.peerHashFailures5m = 1;
    return snapshot;
  }),
  /peerHashFailures5m 1 exceeds limit 0/
);
expectFailure(
  "peer disconnect observed",
  writeVariant("peer-disconnect", (snapshot) => {
    snapshot.metrics.peerDisconnects5m = 1;
    return snapshot;
  }),
  /peerDisconnects5m 1 exceeds limit 0/
);

console.log("canary metrics validation smoke OK: pass=1 failures=9");
