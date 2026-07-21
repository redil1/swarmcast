import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { validateFmp4FixtureManifest } from "./validate-fmp4-fixtures.js";

const repositoryRoot = path.resolve(process.cwd());
const manifest = JSON.parse(readFileSync("test-fixtures/media/fmp4/manifest.json", "utf8"));
const tempRoot = mkdtempSync(path.join(repositoryRoot, ".fmp4-fixture-smoke-"));
const expectedPaths = manifest.files.map((file) => file.path);
let failures = 0;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function resetFixtures() {
  const mediaRoot = path.join(tempRoot, "test-fixtures");
  rmSync(mediaRoot, { recursive: true, force: true });
  for (const relativePath of expectedPaths) {
    const destination = path.join(tempRoot, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(repositoryRoot, relativePath), destination);
  }
}

function file(candidate, id) {
  const value = candidate.files.find((entry) => entry.id === id);
  assert.ok(value, `fixture manifest missing ${id}`);
  return value;
}

function replaceFixture(candidate, id, bytes) {
  const entry = file(candidate, id);
  writeFileSync(path.join(tempRoot, entry.path), bytes);
  entry.size = bytes.length;
  entry.sha256 = sha256(bytes);
}

function expectFailure(label, transform, pattern) {
  resetFixtures();
  const candidate = transform(clone(manifest));
  assert.throws(
    () => validateFmp4FixtureManifest(candidate, { rootDirectory: tempRoot }),
    pattern,
    `${label} should fail`
  );
  failures += 1;
}

resetFixtures();
assert.deepEqual(validateFmp4FixtureManifest(manifest, { rootDirectory: tempRoot }), {
  fileCount: 4,
  totalBytes: 99901,
  trackCount: 2,
  segmentCount: 2
});

expectFailure("customer data flag", (candidate) => {
  candidate.containsCustomerData = true;
  return candidate;
}, /containsCustomerData must be false/);
expectFailure("unsupported manifest field", (candidate) => {
  candidate.validatorCommand = "node attacker.js";
  return candidate;
}, /unsupported or missing fields/);
expectFailure("missing fixture", (candidate) => {
  candidate.files.pop();
  return candidate;
}, /exactly 4 fixtures/);
expectFailure("extra fixture", (candidate) => {
  candidate.files.push({ ...candidate.files[0], id: "extra" });
  return candidate;
}, /exactly 4 fixtures/);
expectFailure("fixture path substitution", (candidate) => {
  file(candidate, "init").path = "test-fixtures/media/fmp4/seg_00000000.m4s";
  return candidate;
}, /init\.path must equal/);
expectFailure("fixture hash mismatch", (candidate) => {
  file(candidate, "segment-0").sha256 = "0".repeat(64);
  return candidate;
}, /SHA-256 does not match manifest/);
expectFailure("fixture size mismatch", (candidate) => {
  file(candidate, "segment-0").size += 1;
  return candidate;
}, /size does not match manifest/);
expectFailure("missing fMP4 generator mode", (candidate) => {
  candidate.generator.command = candidate.generator.command.filter((value) => value !== "-hls_segment_type");
  return candidate;
}, /must contain -hls_segment_type fmp4/);
expectFailure("truncated media fragment", (candidate) => {
  const bytes = readFileSync(path.join(tempRoot, file(candidate, "segment-0").path));
  replaceFixture(candidate, "segment-0", bytes.subarray(0, bytes.length - 1));
  return candidate;
}, /overruns its parent/);
expectFailure("missing moof", (candidate) => {
  const bytes = readFileSync(path.join(tempRoot, file(candidate, "segment-0").path));
  const moofOffset = bytes.indexOf(Buffer.from("moof"));
  assert.ok(moofOffset > 0);
  bytes.write("free", moofOffset, 4, "latin1");
  replaceFixture(candidate, "segment-0", bytes);
  return candidate;
}, /must contain moof/);
expectFailure("unexpected playlist segment", (candidate) => {
  const entry = file(candidate, "playlist");
  const text = readFileSync(path.join(tempRoot, entry.path), "utf8").replace("seg_00000001.m4s", "seg_99999999.m4s");
  replaceFixture(candidate, "playlist", Buffer.from(text));
  return candidate;
}, /exact two committed media segments/);
expectFailure("symlink fixture", (candidate) => {
  const entry = file(candidate, "init");
  const fixturePath = path.join(tempRoot, entry.path);
  const target = path.join(tempRoot, "init-target.mp4");
  copyFileSync(fixturePath, target);
  unlinkSync(fixturePath);
  symlinkSync(target, fixturePath);
  return candidate;
}, /regular non-symlink file/);
expectFailure("symlinked fixture parent", (candidate) => {
  const fixtureRoot = path.join(tempRoot, "test-fixtures/media/fmp4");
  const realRoot = path.join(tempRoot, "real-fmp4");
  renameSync(fixtureRoot, realRoot);
  symlinkSync(realRoot, fixtureRoot, "dir");
  return candidate;
}, /must not traverse symlinks/);

rmSync(tempRoot, { recursive: true, force: true });
console.log(`fMP4 fixture validation smoke OK: pass=1 failures=${failures}`);
