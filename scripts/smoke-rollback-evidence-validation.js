import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/rollback/rollback-drill-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-rollback-evidence-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function command(record, id) {
  const value = record.commands.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing command ${id}`);
  return value;
}

function postCheck(record, id) {
  const value = record.postRollbackChecks.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing postRollbackChecks ${id}`);
  return value;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-rollback-evidence.js", "--allow-synthetic", file], {
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

expectPass("complete synthetic rollback evidence", fixture);
expectFailure(
  "rollback image matches current image",
  writeVariant("same-rollback-image", (record) => {
    record.rollbackImages.auth = record.currentImages.auth;
    return record;
  }),
  /auth rollback image must differ from current image/
);
expectFailure(
  "rollback command builds images",
  writeVariant("rollback-build-command", (record) => {
    command(record, "up-no-build").command = "docker compose -f infra/docker-compose.yml -f infra/docker-compose.release.yml up -d --build auth";
    return record;
  }),
  /up-no-build command must use up -d --no-build/
);
expectFailure(
  "third-party cdn fallback",
  writeVariant("third-party-cdn-fallback", (record) => {
    record.noThirdPartyCdnFallback = false;
    return record;
  }),
  /noThirdPartyCdnFallback must be true/
);
expectFailure(
  "data loss reported",
  writeVariant("data-loss", (record) => {
    record.dataLoss = true;
    return record;
  }),
  /dataLoss must be false/
);
expectFailure(
  "missing delivery fleet only rollback control",
  writeVariant("missing-delivery-fleet-only", (record) => {
    record.postRollbackChecks = record.postRollbackChecks.filter((check) => check.id !== "app-incident-delivery-fleet-only");
    return record;
  }),
  /missing required postRollbackChecks check app-incident-delivery-fleet-only/
);
expectFailure(
  "sensitive rollback evidence",
  writeVariant("sensitive-evidence", (record) => {
    postCheck(record, "source-preflight").evidence.push("sourceUrl=https://source1.upstream.tv/live/private.m3u8");
    return record;
  }),
  /source-preflight\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("rollback evidence validation smoke OK: pass=1 failures=6");
