import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/infra/host-provisioning-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-host-provisioning-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function host(record, id) {
  const value = record.hosts.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing host ${id}`);
  return value;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-host-provisioning-evidence.js", "--allow-synthetic", file], {
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

expectPass("complete synthetic host provisioning evidence", fixture);
expectFailure(
  "unexpected public port",
  writeVariant("unexpected-public-port", (record) => {
    record.publicTcpPorts = [80, 443, 22];
    return record;
  }),
  /publicTcpPorts must be exactly \[80,443\]/
);
expectFailure(
  "missing denied internal port",
  writeVariant("missing-denied-internal-port", (record) => {
    record.deniedInternalTcpPorts = record.deniedInternalTcpPorts.filter((port) => port !== 9101);
    return record;
  }),
  /deniedInternalTcpPorts must include 9101/
);
expectFailure(
  "invalid public hostname",
  writeVariant("invalid-hostname", (record) => {
    host(record, "edge-1").publicHostnames = ["localhost"];
    return record;
  }),
  /edge-1\.publicHostnames\[\] has invalid format/
);
expectFailure(
  "missing monitoring host",
  writeVariant("missing-monitoring-host", (record) => {
    record.hosts = record.hosts.filter((candidate) => candidate.role !== "monitoring");
    return record;
  }),
  /hosts must include monitoring/
);
expectFailure(
  "duplicate host",
  writeVariant("duplicate-host", (record) => {
    record.hosts.push({ ...host(record, "origin-1") });
    return record;
  }),
  /duplicate host origin-1/
);
expectFailure(
  "missing sysctl evidence marker",
  writeVariant("missing-sysctl-marker", (record) => {
    const check = record.checks.find((candidate) => candidate.id === "sysctl-applied");
    check.evidence = ["host-provisioning/sysctl-synthetic"];
    return record;
  }),
  /sysctl-applied\.evidence must mention sysctl-applied/
);
expectFailure(
  "third-party cdn used",
  writeVariant("third-party-cdn", (record) => {
    record.thirdPartyCdnUsed = true;
    return record;
  }),
  /thirdPartyCdnUsed must be false/
);
expectFailure(
  "sensitive host evidence",
  writeVariant("sensitive-evidence", (record) => {
    host(record, "origin-1").evidence.push("bearer synthetic-token");
    return record;
  }),
  /origin-1\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("host provisioning evidence validation smoke OK: pass=1 failures=8");
