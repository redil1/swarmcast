import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/catalog/catalog-import-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-catalog-import-"));

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

function validate(file, { allowIncomplete = false, allowSynthetic = true } = {}) {
  const args = ["scripts/validate-catalog-import.js"];
  if (allowIncomplete) args.push("--allow-incomplete");
  if (allowSynthetic) args.push("--allow-synthetic");
  args.push(file);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function expectPass(label, file, options = {}) {
  const result = validate(file, options);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, file, pattern, options = {}) {
  const result = validate(file, options);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass("complete synthetic catalog import evidence", fixture);
expectPass(
  "explicit incomplete staging shape-only evidence",
  writeVariant("allow-incomplete-staging", (record) => {
    record.synthetic = false;
    return record;
  }),
  { allowIncomplete: true, allowSynthetic: false }
);
expectFailure(
  "synthetic catalog import evidence without explicit allow flag",
  fixture,
  /synthetic catalog import evidence requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "staging evidence is incomplete for launch without explicit allowance",
  writeVariant("incomplete-staging", (record) => {
    record.synthetic = false;
    return record;
  }),
  /catalog import evidence is incomplete for launch: environment/,
  { allowSynthetic: false }
);
expectFailure(
  "raw source URL flag present",
  writeVariant("raw-source-urls-present", (record) => {
    record.rawSourceUrlsPresent = true;
    return record;
  }),
  /rawSourceUrlsPresent must be false/
);
expectFailure(
  "preflight command missing",
  writeVariant("bad-preflight-command", (record) => {
    record.sourcePreflightEvidence.command = "node scripts/source-preflight.js";
    return record;
  }),
  /sourcePreflightEvidence\.command must include source:preflight/
);
expectFailure(
  "preflight totals inconsistent",
  writeVariant("bad-preflight-total", (record) => {
    record.sourcePreflightEvidence.healthy = 19998;
    record.sourcePreflightEvidence.failed = 1;
    return record;
  }),
  /sourcePreflightEvidence healthy \+ failed must equal total/
);
expectFailure(
  "preflight exposes raw URLs",
  writeVariant("preflight-raw-urls", (record) => {
    record.sourcePreflightEvidence.rawSourceUrlsExposed = true;
    return record;
  }),
  /sourcePreflightEvidence\.rawSourceUrlsExposed must be false/
);
expectFailure(
  "snapshot path is upstream URL",
  writeVariant("snapshot-url", (record) => {
    record.snapshot.path = "https://source.example/live/catalog.m3u8";
    return record;
  }),
  /snapshot\.path looks like it may contain sensitive source or token material/
);
expectFailure(
  "snapshot source URLs not stripped",
  writeVariant("snapshot-not-sanitized", (record) => {
    record.snapshot.sourceUrlsStripped = false;
    return record;
  }),
  /snapshot\.sourceUrlsStripped must be true/
);
expectFailure(
  "snapshot channel count mismatch",
  writeVariant("channel-count-mismatch", (record) => {
    record.snapshot.channelCount = 19999;
    return record;
  }),
  /snapshot\.channelCount must equal sourcePreflightEvidence\.total/
);
expectFailure(
  "bad snapshot checksum",
  writeVariant("bad-sha", (record) => {
    record.snapshot.sha256 = "not-a-sha";
    return record;
  }),
  /snapshot\.sha256 has invalid format/
);
expectFailure(
  "bad signature algorithm",
  writeVariant("bad-signature", (record) => {
    record.signature.algorithm = "none";
    return record;
  }),
  /signature\.algorithm must be minisign, cosign, or gpg/
);
expectFailure(
  "missing required check",
  writeVariant("missing-sanitized-check", (record) => {
    record.checks = record.checks.filter((candidate) => candidate.id !== "snapshot-sanitized");
    return record;
  }),
  /missing required catalog import check snapshot-sanitized/
);
expectFailure(
  "duplicate check",
  writeVariant("duplicate-check", (record) => {
    record.checks.push({ ...check(record, "public-catalog-smoke") });
    return record;
  }),
  /duplicate catalog import check public-catalog-smoke/
);
expectFailure(
  "sensitive check evidence",
  writeVariant("sensitive-evidence", (record) => {
    check(record, "source-preflight-passed").evidence.push("sourceUrl=https://source.example/live/private.m3u8?token=synthetic");
    return record;
  }),
  /source-preflight-passed\.evidence\[\] looks like it may contain sensitive source or token material/
);

console.log("catalog import validation smoke OK: pass=2 failures=14");
