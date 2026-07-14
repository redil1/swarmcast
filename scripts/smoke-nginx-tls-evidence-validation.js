import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/launch/nginx-tls-smoke-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-nginx-tls-evidence-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function validate(file, { allowIncomplete = false, allowSynthetic = true } = {}) {
  const args = ["scripts/validate-nginx-tls-evidence.js"];
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

expectPass("complete synthetic nginx/TLS evidence", fixture);
expectPass(
  "explicit incomplete staging shape-only evidence",
  writeVariant("allow-incomplete-staging", (record) => {
    record.synthetic = false;
    return record;
  }),
  { allowIncomplete: true, allowSynthetic: false }
);
expectFailure(
  "synthetic nginx/TLS evidence without explicit allow flag",
  fixture,
  /synthetic nginx\/TLS evidence requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "staging evidence is incomplete for launch without explicit allowance",
  writeVariant("incomplete-staging", (record) => {
    record.synthetic = false;
    return record;
  }),
  /nginx\/TLS evidence is incomplete for launch: environment/,
  { allowSynthetic: false }
);
expectFailure(
  "placeholder origin host",
  writeVariant("placeholder-origin-host", (record) => {
    record.origin.host = "localhost";
    return record;
  }),
  /origin\.host has invalid format/
);
expectFailure(
  "local origin smoke missing",
  writeVariant("origin-smoke-missing", (record) => {
    record.localOriginSmokePassed = false;
    return record;
  }),
  /localOriginSmokePassed must be true/
);
expectFailure(
  "origin certificate invalid",
  writeVariant("origin-cert-invalid", (record) => {
    record.origin.tls.validCertificate = false;
    return record;
  }),
  /origin\.tls\.validCertificate must be true/
);
expectFailure(
  "origin certificate evidence missing hostname verification",
  writeVariant("origin-cert-evidence-missing-hostname", (record) => {
    record.origin.tls.evidence = ["nginx-tls/origin/valid-certificate synthetic"];
    return record;
  }),
  /origin\.tls\.evidence evidence must mention hostname-verified/
);
expectFailure(
  "origin auth gate drifted",
  writeVariant("origin-auth-open", (record) => {
    record.origin.unauthorizedPlaylistStatus = 200;
    return record;
  }),
  /origin\.unauthorizedPlaylistStatus must be 401/
);
expectFailure(
  "origin evidence missing source redaction",
  writeVariant("origin-evidence-missing-redaction", (record) => {
    record.origin.evidence = ["origin-auth-401 origin-playlist-200 origin-segment-200 playlist-no-cache segment-immutable-cache synthetic"];
    return record;
  }),
  /origin\.evidence evidence must mention source-url-redaction/
);
expectFailure(
  "origin source URL leaked",
  writeVariant("origin-source-leaked", (record) => {
    record.origin.sourceUrlLeaked = true;
    return record;
  }),
  /origin\.sourceUrlLeaked must be false/
);
expectFailure(
  "edge first cache status wrong",
  writeVariant("edge-first-cache-hit", (record) => {
    record.edge.firstCacheStatus = "HIT";
    return record;
  }),
  /edge\.firstCacheStatus has invalid format/
);
expectFailure(
  "edge cross-token hit missing",
  writeVariant("edge-cross-token-missing", (record) => {
    record.edge.crossTokenHit = false;
    return record;
  }),
  /edge\.crossTokenHit must be true/
);
expectFailure(
  "edge evidence missing cross-token marker",
  writeVariant("edge-evidence-missing-cross-token", (record) => {
    record.edge.evidence = ["edge-auth-401 edge-cache-miss edge-cache-hit origin-fills=1 no-third-party-cdn cache-key-redaction synthetic"];
    return record;
  }),
  /edge\.evidence evidence must mention cross-token-hit/
);
expectFailure(
  "edge origin fill count changed",
  writeVariant("edge-origin-fills", (record) => {
    record.edge.originFills = 2;
    return record;
  }),
  /edge\.originFills must be 1/
);
expectFailure(
  "third-party CDN used",
  writeVariant("third-party-cdn", (record) => {
    record.edge.thirdPartyCdnUsed = true;
    return record;
  }),
  /edge\.thirdPartyCdnUsed must be false/
);
expectFailure(
  "token leaked in cache key",
  writeVariant("token-cache-key-leak", (record) => {
    record.edge.tokenLeakedInCacheKey = true;
    return record;
  }),
  /edge\.tokenLeakedInCacheKey must be false/
);
expectFailure(
  "sensitive edge evidence",
  writeVariant("sensitive-edge-evidence", (record) => {
    record.edge.evidence.push("https://edge.swarmcast.tv/live/segment.m4s?token=synthetic");
    return record;
  }),
  /edge\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("nginx/TLS evidence validation smoke OK: pass=2 failures=16");
