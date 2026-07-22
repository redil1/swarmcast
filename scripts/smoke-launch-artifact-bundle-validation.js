import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";
import {
  sha256LaunchArtifact,
  validateLaunchArtifactBundle
} from "./launch-evidence-artifact-contract.js";

const root = path.resolve(process.cwd());
const bundle = JSON.parse(readFileSync("test-fixtures/launch/evidence-artifacts.complete.synthetic.json", "utf8"));
const launchRecord = JSON.parse(readFileSync("test-fixtures/launch/evidence-complete.synthetic.json", "utf8"));
let failures = 0;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validate(candidate, record = launchRecord, options = {}) {
  return validateLaunchArtifactBundle(candidate, record, {
    allowSynthetic: true,
    rootDirectory: root,
    executeValidators: false,
    ...options
  });
}

function expectFailure(label, transform, pattern, recordTransform = (record) => record, options = {}) {
  const candidate = transform(clone(bundle));
  const record = recordTransform(clone(launchRecord));
  assert.throws(() => validate(candidate, record, options), pattern, `${label} should fail`);
  failures += 1;
}

const result = validate(bundle);
assert.deepEqual(
  { artifacts: result.artifactCount, gates: result.gateCount, validators: result.validatorCount },
  { artifacts: 53, gates: 34, validators: 38 }
);
const scrubbedEnvironmentResult = validate(bundle, launchRecord, {
  executeValidators: true,
  env: { ...process.env, NODE_OPTIONS: "--definitely-invalid-node-option" }
});
assert.equal(scrubbedEnvironmentResult.validatorCount, 38, "validator subprocesses must ignore inherited NODE_OPTIONS");

expectFailure("missing artifact", (candidate) => {
  candidate.artifacts.pop();
  return candidate;
}, /references missing artifact|fixed validator inventory/);
expectFailure("extra artifact", (candidate) => {
  const extraPath = "test-fixtures/launch/evidence-artifact-inventory.complete.synthetic.json";
  candidate.artifacts.push({
    id: "unexpected-artifact",
    path: extraPath,
    sha256: sha256LaunchArtifact(path.join(root, extraPath))
  });
  return candidate;
}, /unused artifacts|fixed validator inventory/);
expectFailure("duplicate artifact ID", (candidate) => {
  candidate.artifacts[1].id = candidate.artifacts[0].id;
  return candidate;
}, /duplicate launch artifact/);
expectFailure("aliased artifact path", (candidate) => {
  candidate.artifacts[1].path = candidate.artifacts[0].path;
  candidate.artifacts[1].sha256 = candidate.artifacts[0].sha256;
  return candidate;
}, /assigned to more than one artifact/);
expectFailure("artifact hash mismatch", (candidate) => {
  candidate.artifacts[0].sha256 = "0".repeat(64);
  return candidate;
}, /SHA-256 mismatch/);
expectFailure("artifact path traversal", (candidate) => {
  candidate.artifacts[0].path = "../outside.json";
  return candidate;
}, /without traversal/);
expectFailure("artifact command injection", (candidate) => {
  candidate.artifacts[0].command = "node attacker.js";
  return candidate;
}, /unsupported or missing fields/);
expectFailure("missing gate", (candidate) => {
  candidate.gates.pop();
  return candidate;
}, /does not cover every launch gate/);
expectFailure("unexpected gate", (candidate) => {
  candidate.gates[0].id = "unexpected-gate";
  return candidate;
}, /unexpected artifact gate/);
expectFailure("incomplete gate artifact set", (candidate) => {
  const gate = candidate.gates.find((value) => value.id === "capacity-load-ladder");
  gate.artifactIds.pop();
  return candidate;
}, /exact required artifact set/);
expectFailure("duplicate gate artifact", (candidate) => {
  const gate = candidate.gates.find((value) => value.id === "capacity-load-ladder");
  gate.artifactIds[1] = gate.artifactIds[0];
  return candidate;
}, /exact required artifact set/);
expectFailure("bundle release drift", (candidate) => {
  candidate.releaseVersion = "v9.9.9";
  return candidate;
}, /release binding does not match/);
expectFailure("bundle commit drift", (candidate) => {
  candidate.commit = "fedcba9876543210fedcba9876543210fedcba98";
  return candidate;
}, /release binding does not match/);
expectFailure("non-boolean bundle synthetic mode", (candidate) => {
  candidate.synthetic = "false";
  return candidate;
}, /synthetic must be a boolean/);
expectFailure("synthetic bundle without explicit allowance", (candidate) => candidate, /requires --allow-synthetic/, (record) => record, {
  allowSynthetic: false
});
expectFailure("non-synthetic fixture artifact", (candidate) => {
  candidate.synthetic = false;
  return candidate;
}, /synthetic flag does not match|cannot come from test-fixtures/, (record) => {
  record.synthetic = false;
  return record;
});

const tempRoot = mkdtempSync(path.join(root, ".launch-artifact-smoke-"));
try {
  const target = path.join(root, bundle.artifacts[0].path);
  const symlink = path.join(tempRoot, "artifact.json");
  symlinkSync(target, symlink);
  expectFailure("symlink artifact", (candidate) => {
    candidate.artifacts[0].path = path.relative(root, symlink);
    candidate.artifacts[0].sha256 = sha256LaunchArtifact(target);
    return candidate;
  }, /regular non-symlink file/);
  const artifactDirectoryLink = path.join(tempRoot, "artifact-directory-link");
  symlinkSync(path.dirname(target), artifactDirectoryLink, "dir");
  expectFailure("symlinked artifact parent", (candidate) => {
    candidate.artifacts[0].path = path.relative(root, path.join(artifactDirectoryLink, path.basename(target)));
    candidate.artifacts[0].sha256 = sha256LaunchArtifact(target);
    return candidate;
  }, /must not traverse symlinks/);

  const generatedOutput = path.join(tempRoot, "generated-bundle.json");
  const generatedRelativePath = path.relative(root, generatedOutput);
  const generatorArgs = [
    "scripts/generate-launch-artifact-bundle.js",
    "--allow-synthetic",
    "--inventory", "test-fixtures/launch/evidence-artifact-inventory.complete.synthetic.json",
    "--output", generatedRelativePath
  ];
  const generated = spawnSync(process.execPath, generatorArgs, { encoding: "utf8" });
  assert.equal(generated.status, 0, `bundle generator should pass\n${generated.stdout}\n${generated.stderr}`);
  assert.equal(statSync(generatedOutput).mode & 0o777, 0o600, "generated bundle must use mode 0600");
  assert.deepEqual(JSON.parse(readFileSync(generatedOutput, "utf8")), bundle, "generated bundle must be deterministic");

  const overwrite = spawnSync(process.execPath, generatorArgs, { encoding: "utf8" });
  assert.notEqual(overwrite.status, 0, "bundle generator must not overwrite an existing bundle");
  assert.match(`${overwrite.stdout}\n${overwrite.stderr}`, /EEXIST/);
  failures += 1;

  const realOutputDirectory = path.join(tempRoot, "real-output");
  const outputDirectoryLink = path.join(tempRoot, "output-directory-link");
  mkdirSync(realOutputDirectory);
  symlinkSync(realOutputDirectory, outputDirectoryLink, "dir");
  const linkedOutput = path.relative(root, path.join(outputDirectoryLink, "bundle.json"));
  const linkedGenerator = spawnSync(process.execPath, [
    ...generatorArgs.slice(0, -1),
    linkedOutput
  ], { encoding: "utf8" });
  assert.notEqual(linkedGenerator.status, 0, "bundle generator must reject a symlinked output parent");
  assert.match(`${linkedGenerator.stdout}\n${linkedGenerator.stderr}`, /must not traverse symlinks/);
  failures += 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`launch artifact bundle validation smoke OK: pass=3 failures=${failures}`);
