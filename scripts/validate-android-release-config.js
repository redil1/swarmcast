import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { boolEnv, ownedUrlEnv, stringEnv } from "../packages/config/src/env.js";

const requiredKeys = [
  "SWARMCAST_API_BASE",
  "SWARMCAST_TRACKER_WS_URL",
  "SWARMCAST_APP_API_KEY",
  "SWARMCAST_P2P_ENABLED",
  "SWARMCAST_EDGE_ONLY_MODE",
  "SWARMCAST_RLNC_ENABLED",
  "SWARMCAST_PLAY_INTEGRITY_ENABLED",
  "SWARMCAST_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER"
];

const placeholderPattern = /replace-with|change-?me|example\.|localhost|127\.0\.0\.1|0\.0\.0\.0|swarmcast\.local|dev-app-key|todo|tbd|placeholder/i;

const args = process.argv.slice(2);
const rlncDecisionArgIndex = args.indexOf("--rlnc-decision");
const rlncDecisionPath = rlncDecisionArgIndex === -1 ? null : args[rlncDecisionArgIndex + 1];
const files = args.filter((arg, index) => {
  if (arg === "--rlnc-decision") return false;
  if (rlncDecisionArgIndex !== -1 && index === rlncDecisionArgIndex + 1) return false;
  return !arg.startsWith("--");
});

function fail(message) {
  throw new Error(message);
}

function parsePropertiesFile(file) {
  const env = {};
  const text = readFileSync(file, "utf8");
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equals = normalized.indexOf("=");
    if (equals <= 0) fail(`${file}:${index + 1} must be KEY=value`);
    const key = normalized.slice(0, equals).trim();
    let value = normalized.slice(equals + 1).trim();
    if (!/^SWARMCAST_[A-Z0-9_]+$/.test(key)) fail(`${file}:${index + 1} has invalid Android release key ${key}`);
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function requirePresent(env, key) {
  const value = stringEnv(env, key);
  if (!value) fail(`${key} is required`);
  if (placeholderPattern.test(value)) fail(`${key} still contains a placeholder value`);
  return value;
}

function validateOwnedUrl(env, key, protocols) {
  const value = requirePresent(env, key);
  const normalized = ownedUrlEnv(env, key, "", { required: true, protocols });
  const url = new URL(normalized);
  if (url.username || url.password) fail(`${key} must not include URL credentials`);
  if (url.hostname.endsWith(".local")) fail(`${key} must not use a local-only hostname`);
  if (value.includes("?") || value.includes("#")) fail(`${key} must not include query strings or fragments`);
}

function validateAppApiKey(env) {
  const value = requirePresent(env, "SWARMCAST_APP_API_KEY");
  if (!/^[a-f0-9]{64}$/i.test(value)) fail("SWARMCAST_APP_API_KEY must be 64 hex characters");
  if (/^([a-f0-9])\1{63}$/i.test(value)) fail("SWARMCAST_APP_API_KEY must not be a repeated single character");
}

function validateRlncDecision() {
  if (!rlncDecisionPath) fail("SWARMCAST_RLNC_ENABLED requires --rlnc-decision with approved non-synthetic evidence");
  const result = spawnSync(
    process.execPath,
    ["scripts/validate-android-rlnc-decision.js", rlncDecisionPath],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "unknown RLNC decision validation failure").trim();
    fail(`SWARMCAST_RLNC_ENABLED decision evidence failed: ${detail}`);
  }
}

function validateAndroidReleaseConfig(env, file) {
  for (const key of requiredKeys) requirePresent(env, key);
  validateOwnedUrl(env, "SWARMCAST_API_BASE", ["https:"]);
  validateOwnedUrl(env, "SWARMCAST_TRACKER_WS_URL", ["wss:"]);
  validateAppApiKey(env);
  boolEnv(env, "SWARMCAST_P2P_ENABLED", false);
  boolEnv(env, "SWARMCAST_EDGE_ONLY_MODE", false);
  const rlncEnabled = boolEnv(env, "SWARMCAST_RLNC_ENABLED", false);
  if (rlncEnabled) validateRlncDecision();
  if (!boolEnv(env, "SWARMCAST_PLAY_INTEGRITY_ENABLED", false)) {
    fail("SWARMCAST_PLAY_INTEGRITY_ENABLED must be true for release builds");
  }
  const cloudProjectNumber = requirePresent(env, "SWARMCAST_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER");
  if (!/^[1-9]\d{5,19}$/.test(cloudProjectNumber)) {
    fail("SWARMCAST_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER must be a 6-20 digit positive project number");
  }
  return `${file}: Android release config OK: ${requiredKeys.length} required keys, rlnc=${rlncEnabled ? "approved" : "disabled"}, play-integrity=required`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-android-release-config.js [--rlnc-decision android-rlnc-decision.json] <release.properties> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    console.log(validateAndroidReleaseConfig(parsePropertiesFile(file), file));
  }
} catch (error) {
  console.error(`Android release config validation failed: ${error.message}`);
  process.exit(1);
}
