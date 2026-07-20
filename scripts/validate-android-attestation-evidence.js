import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const requiredMarkers = [
  "play-console-linked",
  "play-integrity-api-enabled",
  "request-hash-match",
  "automatic-replay-protection",
  "play-recognized",
  "licensed",
  "meets-device-integrity",
  "auth-token-issued",
  "no-raw-integrity-token"
];
const sensitivePatterns = [/integrityToken/i, /authorization:/i, /bearer\s+/i, /private[_-]?key/i, /-----BEGIN/i];

function fail(message) {
  throw new Error(message);
}

function cleanString(name, value, pattern) {
  if (typeof value !== "string" || value.trim() === "") fail(`${name} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) fail(`${name} has invalid format`);
  return normalized;
}

function requireTrue(name, value) {
  if (value !== true) fail(`${name} must be true`);
}

function validateRecord(record, file) {
  cleanString("reviewId", record.reviewId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("appVersion", record.appVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  if (Number.isNaN(Date.parse(cleanString("testedAt", record.testedAt)))) fail("testedAt must be ISO-8601 parseable");
  if (record.synthetic && !allowSynthetic) fail("synthetic Android attestation evidence requires --allow-synthetic");

  cleanString("packageName", record.packageName, /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/);
  cleanString("cloudProjectNumber", record.cloudProjectNumber, /^[1-9]\d{5,19}$/);
  cleanString("certificateSha256Digest", record.certificateSha256Digest, /^[A-Za-z0-9_-]{43}$/);
  requireTrue("playConsoleLinked", record.playConsoleLinked);
  requireTrue("apiEnabled", record.apiEnabled);
  requireTrue("serviceAccountAuthorized", record.serviceAccountAuthorized);

  const verdict = record.verdict;
  if (!verdict || typeof verdict !== "object") fail("verdict is required");
  if (verdict.appRecognitionVerdict !== "PLAY_RECOGNIZED") fail("verdict.appRecognitionVerdict must be PLAY_RECOGNIZED");
  if (verdict.appLicensingVerdict !== "LICENSED") fail("verdict.appLicensingVerdict must be LICENSED");
  if (!Array.isArray(verdict.deviceRecognitionVerdict) || !verdict.deviceRecognitionVerdict.includes("MEETS_DEVICE_INTEGRITY")) {
    fail("verdict.deviceRecognitionVerdict must include MEETS_DEVICE_INTEGRITY");
  }
  requireTrue("verdict.packageMatched", verdict.packageMatched);
  requireTrue("verdict.certificateMatched", verdict.certificateMatched);
  requireTrue("verdict.requestHashMatched", verdict.requestHashMatched);
  requireTrue("verdict.replayRejected", verdict.replayRejected);
  requireTrue("verdict.authTokenIssued", verdict.authTokenIssued);
  if (verdict.rawIntegrityTokenStored !== false) fail("verdict.rawIntegrityTokenStored must be false");
  if (!Number.isInteger(verdict.timestampAgeSeconds) || verdict.timestampAgeSeconds < 0 || verdict.timestampAgeSeconds > 120) {
    fail("verdict.timestampAgeSeconds must be between 0 and 120");
  }

  if (!Array.isArray(record.evidence) || record.evidence.length === 0) fail("evidence must not be empty");
  const evidence = record.evidence.map((value, index) => cleanString(`evidence[${index}]`, value));
  for (const value of evidence) {
    if (sensitivePatterns.some((pattern) => pattern.test(value))) fail("evidence reference looks like it may contain attestation secrets");
  }
  const joined = evidence.join("\n").toLowerCase();
  for (const marker of requiredMarkers) {
    if (!joined.includes(marker)) fail(`evidence must mention ${marker}`);
  }
  return `${file}: Android attestation evidence OK: package=${record.packageName}, device=${verdict.deviceRecognitionVerdict.join("+")}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-android-attestation-evidence.js [--allow-synthetic] <android-attestation-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Android attestation evidence validation failed: ${error.message}`);
  process.exit(1);
}
