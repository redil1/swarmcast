import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/android/accessibility-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-android-accessibility-evidence-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function device(record, id) {
  const value = record.devices.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing device ${id}`);
  return value;
}

function check(record, id) {
  const value = record.checks.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing check ${id}`);
  return value;
}

function validate(file, { allowSynthetic = true } = {}) {
  const args = ["scripts/validate-android-accessibility-evidence.js"];
  if (allowSynthetic) args.push("--allow-synthetic");
  args.push(file);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function expectPass(label, file) {
  const result = validate(file);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, file, pattern, options = {}) {
  const result = validate(file, options);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass("complete synthetic Android accessibility evidence", fixture);
expectFailure(
  "synthetic Android accessibility evidence without explicit allow flag",
  fixture,
  /synthetic Android accessibility evidence requires --allow-synthetic/,
  { allowSynthetic: false }
);
expectFailure(
  "missing devices",
  writeVariant("missing-devices", (record) => {
    record.devices = [];
    return record;
  }),
  /devices must include at least one device/
);
expectFailure(
  "duplicate device",
  writeVariant("duplicate-device", (record) => {
    record.devices.push({ ...device(record, "pixel-8") });
    return record;
  }),
  /duplicate device pixel-8/
);
expectFailure(
  "invalid font scale",
  writeVariant("invalid-font-scale", (record) => {
    device(record, "small-phone").fontScale = 0;
    return record;
  }),
  /small-phone\.fontScale must be a positive number/
);
expectFailure(
  "missing 200 percent font device",
  writeVariant("missing-large-font-device", (record) => {
    for (const candidate of record.devices) candidate.fontScale = 1;
    return record;
  }),
  /devices must include a 200% font scale device/
);
expectFailure(
  "missing small screen device",
  writeVariant("missing-small-screen-device", (record) => {
    device(record, "small-phone").screen = "412x915dp";
    return record;
  }),
  /devices must include a small-screen device/
);
expectFailure(
  "missing Media3 controls check",
  writeVariant("missing-media3-controls", (record) => {
    record.checks = record.checks.filter((candidate) => candidate.id !== "media3-controls");
    return record;
  }),
  /missing required accessibility check media3-controls/
);
expectFailure(
  "missing touch targets check",
  writeVariant("missing-touch-targets", (record) => {
    record.checks = record.checks.filter((candidate) => candidate.id !== "touch-targets");
    return record;
  }),
  /missing required accessibility check touch-targets/
);
expectFailure(
  "TalkBack check failed",
  writeVariant("talkback-failed", (record) => {
    check(record, "talkback-focus-order").status = "fail";
    return record;
  }),
  /talkback-focus-order\.status must pass before accessibility approval/
);
expectFailure(
  "duplicate accessibility check",
  writeVariant("duplicate-check", (record) => {
    record.checks.push({ ...check(record, "p2p-toggle") });
    return record;
  }),
  /duplicate accessibility check p2p-toggle/
);
expectFailure(
  "empty device list on check",
  writeVariant("empty-check-devices", (record) => {
    check(record, "privacy-dialog").deviceIds = [];
    return record;
  }),
  /privacy-dialog\.deviceIds must include at least one device/
);
expectFailure(
  "check references unknown device",
  writeVariant("unknown-check-device", (record) => {
    check(record, "large-font-200").deviceIds = ["missing-device"];
    return record;
  }),
  /large-font-200 references unknown device missing-device/
);
expectFailure(
  "missing TalkBack evidence marker",
  writeVariant("missing-talkback-evidence-marker", (record) => {
    check(record, "talkback-focus-order").evidence = ["screenshots/accessibility/focus-order.synthetic.png"];
    return record;
  }),
  /talkback-focus-order\.evidence must mention talkback-focus-order/
);
expectFailure(
  "sensitive check evidence",
  writeVariant("sensitive-evidence", (record) => {
    check(record, "error-states").evidence.push("jwt=synthetic-secret");
    return record;
  }),
  /error-states\.evidence evidence reference looks like it may contain sensitive material/
);

console.log("Android accessibility evidence validation smoke OK: pass=1 failures=14");
