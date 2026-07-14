import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/launch/source-allowlist-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-source-allowlist-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-source-allowlist-evidence.js", "--allow-synthetic", file], {
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

expectPass("complete synthetic source allowlist evidence", fixture);
expectFailure(
  "placeholder approved host",
  writeVariant("placeholder-host", (record) => {
    record.approvedHosts = ["source1.upstream.tv", "example.com"];
    return record;
  }),
  /approvedHosts\[\] contains placeholder or local host example\.com/
);
expectFailure(
  "private networks allowed",
  writeVariant("private-networks-allowed", (record) => {
    record.privateNetworksAllowed = true;
    return record;
  }),
  /privateNetworksAllowed must be false/
);
expectFailure(
  "raw source urls exposed",
  writeVariant("raw-source-urls-exposed", (record) => {
    record.sourcePreflight.rawSourceUrlsExposed = true;
    return record;
  }),
  /sourcePreflight\.rawSourceUrlsExposed must be false/
);
expectFailure(
  "private source rejection missing",
  writeVariant("private-source-rejection-missing", (record) => {
    record.sourcePreflight.privateNetworkSourcesRejected = false;
    return record;
  }),
  /sourcePreflight\.privateNetworkSourcesRejected must be true/
);
expectFailure(
  "public catalog exposes source urls",
  writeVariant("catalog-source-urls", (record) => {
    record.catalogImport.publicCatalogStripsSourceUrls = false;
    return record;
  }),
  /catalogImport\.publicCatalogStripsSourceUrls must be true/
);
expectFailure(
  "sensitive source evidence",
  writeVariant("sensitive-source-evidence", (record) => {
    record.sourcePreflight.evidence.push("source_url=https://source1.upstream.tv/live/private.m3u8");
    return record;
  }),
  /sourcePreflight\.evidence evidence reference looks like it may contain sensitive source or token material/
);

console.log("source allowlist evidence validation smoke OK: pass=1 failures=6");
