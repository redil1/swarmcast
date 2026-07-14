import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/security/secrets-evidence-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-secrets-evidence-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function secret(record, id) {
  const value = record.secrets.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing secret ${id}`);
  return value;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-secrets-evidence.js", "--allow-synthetic", file], {
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

expectPass("complete synthetic secrets evidence", fixture);
expectFailure(
  "raw secret values present",
  writeVariant("raw-values-present", (record) => {
    record.rawSecretValuesPresent = true;
    return record;
  }),
  /rawSecretValuesPresent must be false/
);
expectFailure(
  "secret value exposed",
  writeVariant("value-exposed", (record) => {
    secret(record, "app-api-key").valueExposed = true;
    return record;
  }),
  /app-api-key\.valueExposed must be false/
);
expectFailure(
  "unapproved storage",
  writeVariant("unapproved-storage", (record) => {
    secret(record, "internal-token").storage = "plain-env-file";
    return record;
  }),
  /internal-token\.storage must be an approved storage type/
);
expectFailure(
  "rotation due before latest rotation",
  writeVariant("bad-rotation-window", (record) => {
    secret(record, "auth-signing-key").nextRotationDueAt = "2026-07-04T00:00:00.000Z";
    return record;
  }),
  /auth-signing-key\.nextRotationDueAt must be after rotatedAt/
);
expectFailure(
  "secret material in evidence",
  writeVariant("secret-material-evidence", (record) => {
    secret(record, "retention-store-token").evidence.push("token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    return record;
  }),
  /retention-store-token\.evidence evidence reference looks like it may contain secret material/
);
expectFailure(
  "missing production environment scope",
  writeVariant("missing-production-scope", (record) => {
    delete secret(record, "auth-signing-key").environmentScope;
    return record;
  }),
  /auth-signing-key\.environmentScope must be production/
);
expectFailure(
  "missing required injection target",
  writeVariant("missing-required-injection-target", (record) => {
    secret(record, "internal-token").injectedInto = ["auth", "ingest", "tracker", "control-plane"];
    return record;
  }),
  /internal-token\.injectedInto must include retention-worker/
);
expectFailure(
  "rotation policy too long",
  writeVariant("rotation-policy-too-long", (record) => {
    secret(record, "app-api-key").rotationPolicyDays = 180;
    return record;
  }),
  /app-api-key\.rotationPolicyDays must be an integer between 1 and 92/
);
expectFailure(
  "secret evidence missing secret id",
  writeVariant("secret-evidence-missing-id", (record) => {
    secret(record, "alertmanager-webhook-critical").evidence = ["secrets/prod/alertmanager-critical/metadata-synthetic"];
    return record;
  }),
  /alertmanager-webhook-critical\.evidence must mention alertmanager-webhook-critical/
);
expectFailure(
  "check evidence missing check id",
  writeVariant("check-evidence-missing-id", (record) => {
    const check = record.checks.find((candidate) => candidate.id === "deployment-injection-tested");
    assert.ok(check, "fixture missing deployment-injection-tested");
    check.evidence = ["deploy/prod/secrets-injection-synthetic"];
    return record;
  }),
  /deployment-injection-tested\.evidence must mention deployment-injection-tested/
);

console.log("secrets evidence validation smoke OK: pass=1 failures=10");
