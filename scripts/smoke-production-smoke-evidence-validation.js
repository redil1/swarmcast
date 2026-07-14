import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/launch/production-smokes-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-production-smokes-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function check(record, id) {
  const value = record.checks.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing check ${id}`);
  return value;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-production-smoke-evidence.js", "--allow-synthetic", file], {
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

expectPass("complete synthetic production smoke evidence", fixture);
expectFailure(
  "third-party cdn used",
  writeVariant("third-party-cdn", (record) => {
    record.thirdPartyCdnUsed = true;
    return record;
  }),
  /thirdPartyCdnUsed must be false/
);
expectFailure(
  "source urls exposed",
  writeVariant("source-urls-exposed", (record) => {
    record.sourceUrlsExposed = true;
    return record;
  }),
  /sourceUrlsExposed must be false/
);
expectFailure(
  "tokens exposed",
  writeVariant("tokens-exposed", (record) => {
    record.tokensExposed = true;
    return record;
  }),
  /tokensExposed must be false/
);
expectFailure(
  "missing required smoke",
  writeVariant("missing-edge-cache", (record) => {
    record.checks = record.checks.filter((candidate) => candidate.id !== "edge-cache-miss-hit");
    return record;
  }),
  /missing required production smoke check edge-cache-miss-hit/
);
expectFailure(
  "sensitive smoke evidence",
  writeVariant("sensitive-evidence", (record) => {
    check(record, "source-preflight").evidence.push("sourceUrl=https://source1.upstream.tv/live/private.m3u8");
    return record;
  }),
  /source-preflight\.evidence evidence reference looks like it may contain sensitive source, token, or personal material/
);

console.log("production smoke evidence validation smoke OK: pass=1 failures=5");
