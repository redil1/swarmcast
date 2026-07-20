import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/security/repository-governance-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-repository-governance-"));

function writeVariant(name, transform) {
  const record = transform(structuredClone(baseRecord));
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function validate(file, allowSynthetic = true) {
  const args = ["scripts/validate-repository-governance-evidence.js"];
  if (allowSynthetic) args.push("--allow-synthetic");
  args.push(file);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function expectFailure(label, file, pattern, allowSynthetic = true) {
  const result = validate(file, allowSynthetic);
  assert.notEqual(result.status, 0, `${label} should fail`);
  assert.match(`${result.stdout}\n${result.stderr}`, pattern);
}

assert.equal(validate(fixture).status, 0, "complete synthetic repository governance evidence should pass");
expectFailure("synthetic without opt-in", fixture, /requires --allow-synthetic/, false);
expectFailure("admin bypass", writeVariant("admin-bypass", (record) => {
  record.branchProtection.enforceAdmins = false;
  return record;
}), /enforceAdmins must be true/);
expectFailure("non-strict checks", writeVariant("non-strict", (record) => {
  record.branchProtection.strictRequiredChecks = false;
  return record;
}), /strictRequiredChecks must be true/);
expectFailure("missing required check", writeVariant("missing-check", (record) => {
  record.branchProtection.requiredChecks = ["android", "node"];
  return record;
}), /requiredChecks must be exactly/);
expectFailure("direct pushes allowed", writeVariant("no-pr", (record) => {
  record.branchProtection.pullRequestRequired = false;
  return record;
}), /pullRequestRequired must be true/);
expectFailure("force pushes allowed", writeVariant("force-push", (record) => {
  record.branchProtection.forcePushesAllowed = true;
  return record;
}), /forcePushesAllowed must be false/);
expectFailure("secret scanning disabled", writeVariant("secret-scanning", (record) => {
  record.security.secretScanning = false;
  return record;
}), /secretScanning must be true/);
expectFailure("push protection disabled", writeVariant("push-protection", (record) => {
  record.security.pushProtection = false;
  return record;
}), /pushProtection must be true/);
expectFailure("missing code owners", writeVariant("codeowners", (record) => {
  record.repositoryFiles.codeowners = false;
  return record;
}), /codeowners must be true/);
expectFailure("missing evidence marker", writeVariant("missing-marker", (record) => {
  record.evidence = record.evidence.map((value) => value.replace("admin-enforcement", "admin-policy-missing"));
  return record;
}), /evidence must mention admin-enforcement/);
expectFailure("sensitive evidence", writeVariant("sensitive", (record) => {
  record.evidence.push("token=synthetic-secret");
  return record;
}), /sensitive material/);

console.log("repository governance evidence validation smoke OK: pass=1 failures=11");
