import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/android/release-config.complete.properties";
const baseText = readFileSync(fixture, "utf8");
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-android-release-config-"));

function writeVariant(name, transform) {
  const file = path.join(tempRoot, `${name}.properties`);
  writeFileSync(file, transform(baseText));
  return file;
}

function removeLine(key) {
  return (text) => text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(`${key}=`))
    .join("\n");
}

function replaceLine(key, value) {
  return (text) => text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-android-release-config.js", file], {
    encoding: "utf8"
  });
}

function validateWithDecision(file, decision) {
  return spawnSync(
    process.execPath,
    ["scripts/validate-android-release-config.js", "--rlnc-decision", decision, file],
    { encoding: "utf8" }
  );
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

expectPass("complete Android release config", fixture);
expectFailure(
  "missing API base",
  writeVariant("missing-api-base", removeLine("SWARMCAST_API_BASE")),
  /SWARMCAST_API_BASE is required/
);
expectFailure(
  "HTTP API base",
  writeVariant("http-api-base", replaceLine("SWARMCAST_API_BASE", "http://api.swarmcast.tv")),
  /SWARMCAST_API_BASE must use one of: https:/
);
expectFailure(
  "plain WebSocket tracker URL",
  writeVariant("plain-ws-tracker", replaceLine("SWARMCAST_TRACKER_WS_URL", "ws://tracker.swarmcast.tv/ws")),
  /SWARMCAST_TRACKER_WS_URL must use one of: wss:/
);
expectFailure(
  "default dev app key",
  writeVariant("dev-app-key", replaceLine("SWARMCAST_APP_API_KEY", "dev-app-key")),
  /SWARMCAST_APP_API_KEY still contains a placeholder value/
);
expectFailure(
  "invalid app key",
  writeVariant("short-app-key", replaceLine("SWARMCAST_APP_API_KEY", "abcdef")),
  /SWARMCAST_APP_API_KEY must be 64 hex characters/
);
expectFailure(
  "missing Play Integrity flag",
  writeVariant("missing-play-integrity", removeLine("SWARMCAST_PLAY_INTEGRITY_ENABLED")),
  /SWARMCAST_PLAY_INTEGRITY_ENABLED is required/
);
expectFailure(
  "Play Integrity disabled",
  writeVariant("play-integrity-disabled", replaceLine("SWARMCAST_PLAY_INTEGRITY_ENABLED", "false")),
  /SWARMCAST_PLAY_INTEGRITY_ENABLED must be true/
);
expectFailure(
  "invalid Play Integrity project number",
  writeVariant("play-integrity-project", replaceLine("SWARMCAST_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER", "123")),
  /must be a 6-20 digit positive project number/
);
expectFailure(
  "RLNC enabled without approval",
  writeVariant("rlnc-enabled", replaceLine("SWARMCAST_RLNC_ENABLED", "true")),
  /SWARMCAST_RLNC_ENABLED requires --rlnc-decision/
);
const rlncEnabled = writeVariant("rlnc-enabled-synthetic-decision", replaceLine("SWARMCAST_RLNC_ENABLED", "true"));
const syntheticDecisionResult = validateWithDecision(
  rlncEnabled,
  "test-fixtures/android/rlnc-decision-complete.synthetic.json"
);
assert.notEqual(syntheticDecisionResult.status, 0, "synthetic RLNC decision must not enable release config");
assert.match(
  `${syntheticDecisionResult.stdout}\n${syntheticDecisionResult.stderr}`,
  /synthetic Android RLNC decision requires --allow-synthetic/
);
expectFailure(
  "third-party CDN API host",
  writeVariant("cdn-api-host", replaceLine("SWARMCAST_API_BASE", "https://d111111abcdef8.cloudfront.net")),
  /SWARMCAST_API_BASE must not point to a third-party CDN provider/
);

console.log("Android release config validation smoke OK: pass=1 failures=11");
