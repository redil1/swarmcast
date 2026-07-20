import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/android/attestation-evidence-complete.synthetic.json";
const base = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-attestation-evidence-"));

function writeVariant(name, mutate) {
  const record = structuredClone(base);
  mutate(record);
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function validate(file, allowSynthetic = false) {
  const args = ["scripts/validate-android-attestation-evidence.js"];
  if (allowSynthetic) args.push("--allow-synthetic");
  args.push(file);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

const pass = validate(fixture, true);
assert.equal(pass.status, 0, `complete synthetic evidence should pass\n${pass.stdout}\n${pass.stderr}`);

const syntheticDenied = validate(fixture);
assert.notEqual(syntheticDenied.status, 0);
assert.match(`${syntheticDenied.stdout}\n${syntheticDenied.stderr}`, /requires --allow-synthetic/);

const failures = [
  ["console-link", (r) => { r.playConsoleLinked = false; }, /playConsoleLinked must be true/],
  ["certificate", (r) => { r.certificateSha256Digest = "bad"; }, /certificateSha256Digest has invalid format/],
  ["recognition", (r) => { r.verdict.appRecognitionVerdict = "UNRECOGNIZED_VERSION"; }, /PLAY_RECOGNIZED/],
  ["license", (r) => { r.verdict.appLicensingVerdict = "UNLICENSED"; }, /LICENSED/],
  ["device", (r) => { r.verdict.deviceRecognitionVerdict = []; }, /MEETS_DEVICE_INTEGRITY/],
  ["request-hash", (r) => { r.verdict.requestHashMatched = false; }, /requestHashMatched must be true/],
  ["replay", (r) => { r.verdict.replayRejected = false; }, /replayRejected must be true/],
  ["stale", (r) => { r.verdict.timestampAgeSeconds = 121; }, /between 0 and 120/],
  ["raw-token", (r) => { r.verdict.rawIntegrityTokenStored = true; }, /rawIntegrityTokenStored must be false/],
  ["marker", (r) => { r.evidence = r.evidence.filter((value) => !value.includes("request-hash-match")); }, /request-hash-match/],
  ["secret", (r) => { r.evidence.push("integrityToken=secret"); }, /attestation secrets/]
];

for (const [name, mutate, pattern] of failures) {
  const result = validate(writeVariant(name, mutate), true);
  assert.notEqual(result.status, 0, `${name} should fail`);
  assert.match(`${result.stdout}\n${result.stderr}`, pattern);
}

console.log(`Android attestation evidence validation smoke OK: pass=1 failures=${failures.length + 1}`);
