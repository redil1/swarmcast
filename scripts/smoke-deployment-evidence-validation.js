import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/deployment/deployment-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-deployment-evidence-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function service(record, name) {
  const value = record.services.find((candidate) => candidate.name === name);
  assert.ok(value, `fixture missing ${name}`);
  return value;
}

function check(record, id) {
  const value = record.checks.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing check ${id}`);
  return value;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-deployment-evidence.js", "--allow-synthetic", file], {
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

expectPass("complete synthetic deployment evidence", fixture);
expectFailure(
  "deployment command missing no-build",
  writeVariant("missing-no-build", (record) => {
    record.commands = record.commands.map((command) => command.replace(" --no-build", ""));
    return record;
  }),
  /commands must include up --no-build/
);
expectFailure(
  "tag-only service image",
  writeVariant("tag-only-auth-image", (record) => {
    service(record, "auth").image = "ghcr.io/example/swarmcast/auth:v0.1.0-rc1";
    return record;
  }),
  /auth\.image has invalid format/
);
expectFailure(
  "deployment commands missing service",
  writeVariant("commands-missing-service", (record) => {
    record.commands = record.commands.map((command) => command.replaceAll(" retention-worker", ""));
    return record;
  }),
  /commands must include service retention-worker/
);
expectFailure(
  "service evidence missing service name",
  writeVariant("service-evidence-missing-name", (record) => {
    service(record, "control-plane").evidence = ["deploy/control/health-synthetic"];
    return record;
  }),
  /control-plane\.evidence must mention control-plane/
);
expectFailure(
  "TURN service missing",
  writeVariant("missing-turn-service", (record) => {
    record.services = record.services.filter((candidate) => candidate.name !== "turn");
    return record;
  }),
  /missing service turn/
);
expectFailure(
  "check evidence missing check id",
  writeVariant("check-evidence-missing-id", (record) => {
    check(record, "rollback-ready").evidence = ["rollback:evidence:validate synthetic-pass"];
    return record;
  }),
  /rollback-ready\.evidence must mention rollback-ready/
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
  "sensitive evidence material",
  writeVariant("sensitive-evidence", (record) => {
    service(record, "tracker").evidence.push("token=synthetic-secret");
    return record;
  }),
  /tracker\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("deployment evidence validation smoke OK: pass=1 failures=8");
