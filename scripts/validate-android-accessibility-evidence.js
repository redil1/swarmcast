import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const requiredChecks = [
  "talkback-focus-order",
  "large-font-200",
  "small-screen-layout",
  "media3-controls",
  "p2p-toggle",
  "privacy-dialog",
  "error-states",
  "localization-pseudolocale",
  "touch-targets"
];
const requiredCheckEvidence = {
  "talkback-focus-order": "talkback-focus-order",
  "large-font-200": "large-font-200",
  "small-screen-layout": "small-screen",
  "media3-controls": "media3-controls",
  "p2p-toggle": "p2p-toggle",
  "privacy-dialog": "privacy-dialog",
  "error-states": "error-state",
  "localization-pseudolocale": "pseudolocale",
  "touch-targets": "touch-targets"
};
const sensitiveEvidencePatterns = [
  /token=/i,
  /jwt=/i,
  /bearer\s+/i,
  /sourceurl/i,
  /source_url/i,
  /\.m3u8(?:\?|$)/i,
  /-----BEGIN/i,
  /password=/i,
  /email=/i
];

function fail(message) {
  throw new Error(message);
}

function cleanString(name, value, pattern) {
  if (typeof value !== "string" || value.trim() === "") fail(`${name} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) fail(`${name} has invalid format`);
  return normalized;
}

function parseTime(name, value) {
  const normalized = cleanString(name, value);
  if (Number.isNaN(Date.parse(normalized))) fail(`${name} must be ISO-8601 parseable`);
}

function positiveNumber(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${name} must be a positive number`);
}

function parseScreenDp(name, value) {
  const normalized = cleanString(name, value, /^[0-9]+x[0-9]+dp$/);
  const [width, height] = normalized.replace("dp", "").split("x").map(Number);
  return { width, height };
}

function validateEvidenceList(name, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${name} must include evidence`);
  for (const item of evidence) {
    const value = cleanString(`${name}[]`, item);
    if (sensitiveEvidencePatterns.some((pattern) => pattern.test(value))) {
      fail(`${name} evidence reference looks like it may contain sensitive material`);
    }
  }
}

function validateDevices(record) {
  if (!Array.isArray(record.devices) || record.devices.length === 0) fail("devices must include at least one device");
  const ids = new Set();
  let hasLargeFontDevice = false;
  let hasSmallScreenDevice = false;
  for (const device of record.devices) {
    const id = cleanString("device.id", device.id, /^[a-z0-9-]+$/);
    if (ids.has(id)) fail(`duplicate device ${id}`);
    ids.add(id);
    cleanString(`${id}.name`, device.name);
    cleanString(`${id}.androidVersion`, device.androidVersion, /^[0-9][0-9._-]*$/);
    const screen = parseScreenDp(`${id}.screen`, device.screen);
    positiveNumber(`${id}.fontScale`, device.fontScale);
    if (device.fontScale >= 2) hasLargeFontDevice = true;
    if (screen.width <= 360 && screen.height <= 640) hasSmallScreenDevice = true;
  }
  if (!hasLargeFontDevice) fail("devices must include a 200% font scale device");
  if (!hasSmallScreenDevice) fail("devices must include a small-screen device");
  return ids;
}

function validateChecks(record, deviceIds) {
  if (!Array.isArray(record.checks)) fail("checks must be an array");
  const seen = new Set();
  for (const check of record.checks) {
    const id = cleanString("check.id", check.id, /^[a-z0-9-]+$/);
    if (seen.has(id)) fail(`duplicate accessibility check ${id}`);
    seen.add(id);
    if (check.status !== "pass") fail(`${id}.status must pass before accessibility approval`);
    cleanString(`${id}.owner`, check.owner);
    if (!Array.isArray(check.deviceIds) || check.deviceIds.length === 0) fail(`${id}.deviceIds must include at least one device`);
    for (const deviceId of check.deviceIds) {
      const normalized = cleanString(`${id}.deviceIds[]`, deviceId, /^[a-z0-9-]+$/);
      if (!deviceIds.has(normalized)) fail(`${id} references unknown device ${normalized}`);
    }
    validateEvidenceList(`${id}.evidence`, check.evidence);
    const requiredEvidence = requiredCheckEvidence[id];
    if (requiredEvidence && !check.evidence.join("\n").includes(requiredEvidence)) {
      fail(`${id}.evidence must mention ${requiredEvidence}`);
    }
  }
  for (const id of requiredChecks) {
    if (!seen.has(id)) fail(`missing required accessibility check ${id}`);
  }
}

function validateRecord(record, file) {
  cleanString("reviewId", record.reviewId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  parseTime("testedAt", record.testedAt);
  if (record.synthetic && !allowSynthetic) fail("synthetic Android accessibility evidence requires --allow-synthetic");
  const deviceIds = validateDevices(record);
  validateChecks(record, deviceIds);
  return `${file}: Android accessibility evidence OK: devices=${deviceIds.size}, checks=${requiredChecks.length}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-android-accessibility-evidence.js [--allow-synthetic] <android-accessibility-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Android accessibility evidence validation failed: ${error.message}`);
  process.exit(1);
}
