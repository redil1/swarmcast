import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/monitoring/alertmanager-fire-drill-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-alertmanager-fire-drill-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function notification(record, id) {
  const value = record.notifications.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing notification ${id}`);
  return value;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-alertmanager-fire-drill.js", "--allow-synthetic", file], {
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

expectPass("complete synthetic Alertmanager fire-drill evidence", fixture);
expectFailure(
  "critical alert routed to default receiver",
  writeVariant("wrong-critical-receiver", (record) => {
    notification(record, "critical-firing").observedReceiver = "oncall-default";
    return record;
  }),
  /critical-firing\.observedReceiver must be oncall-critical/
);
expectFailure(
  "notification not observed",
  writeVariant("notification-not-observed", (record) => {
    notification(record, "warning-firing").notificationObserved = false;
    return record;
  }),
  /warning-firing\.notificationObserved must be true/
);
expectFailure(
  "notification evidence missing receiver",
  writeVariant("notification-evidence-missing-receiver", (record) => {
    notification(record, "critical-firing").evidence = ["critical-firing acknowledged alertmanager/fire-drill/critical-firing-notification-synthetic"];
    return record;
  }),
  /critical-firing\.evidence evidence must mention oncall-critical/
);
expectFailure(
  "notification evidence missing acknowledgment",
  writeVariant("notification-evidence-missing-acknowledgment", (record) => {
    notification(record, "warning-firing").evidence = ["warning-firing oncall-default alertmanager/fire-drill/default-warning-notification-synthetic"];
    return record;
  }),
  /warning-firing\.evidence evidence must mention acknowledged/
);
expectFailure(
  "missing resolved notification",
  writeVariant("missing-resolved", (record) => {
    record.notifications = record.notifications.filter((candidate) => candidate.id !== "critical-resolved");
    return record;
  }),
  /missing required fire-drill notification critical-resolved/
);
expectFailure(
  "sensitive webhook evidence",
  writeVariant("sensitive-webhook", (record) => {
    notification(record, "critical-resolved").evidence.push("https://hooks.example.invalid/webhook/token-secret");
    return record;
  }),
  /critical-resolved\.evidence evidence reference looks like it may contain sensitive material/
);
expectFailure(
  "routing smoke command missing",
  writeVariant("missing-routing-smoke-command", (record) => {
    record.routingSmoke.command = "npm run check";
    return record;
  }),
  /routingSmoke\.command must include smoke:alertmanager-routing/
);
expectFailure(
  "receiver validation evidence missing command marker",
  writeVariant("receiver-validation-evidence-missing-marker", (record) => {
    record.receiverValidation.evidence = ["alertmanager/fire-drill/receiver-validation-synthetic"];
    return record;
  }),
  /receiverValidation\.evidence evidence must mention alertmanager:receivers:validate/
);

console.log("Alertmanager fire-drill validation smoke OK: pass=1 failures=8");
