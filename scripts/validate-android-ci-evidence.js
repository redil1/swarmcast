import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const requiredSteps = [
  "checkout",
  "setup-java",
  "setup-android",
  "setup-gradle",
  "testDebugUnitTest",
  "assembleDebug",
  "assembleRelease",
  "computeApkChecksums",
  "uploadDebugArtifact",
  "uploadReleaseArtifact"
];
const requiredArtifacts = ["debug", "release"];
const requiredArtifactEvidence = {
  debug: ["actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", "swarmcast-android-debug-apk", ".sha256"],
  release: ["actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", "swarmcast-android-release-unsigned-apk", ".sha256"]
};
const sensitiveEvidencePatterns = [
  /token=/i,
  /jwt=/i,
  /bearer\s+/i,
  /sourceurl/i,
  /source_url/i,
  /\.m3u8(?:\?|$)/i,
  /-----BEGIN/i,
  /password=/i
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
  const time = Date.parse(normalized);
  if (Number.isNaN(time)) fail(`${name} must be ISO-8601 parseable`);
  return time;
}

function positiveNumber(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${name} must be a positive number`);
  }
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

function validateToolchain(record) {
  const toolchain = record.toolchain;
  if (!toolchain || typeof toolchain !== "object") fail("toolchain is required");
  cleanString("toolchain.javaDistribution", toolchain.javaDistribution, /^[a-z0-9._-]+$/);
  cleanString("toolchain.javaVersion", toolchain.javaVersion, /^[0-9][0-9._-]*$/);
  cleanString("toolchain.gradleVersion", toolchain.gradleVersion, /^[0-9][0-9._-]*$/);
  cleanString("toolchain.androidPlatform", toolchain.androidPlatform, /^android-[0-9]+$/);
  cleanString("toolchain.buildTools", toolchain.buildTools, /^[0-9][0-9._-]*$/);
}

function validateSteps(record) {
  if (!Array.isArray(record.steps)) fail("steps must be an array");
  const seen = new Set();
  for (const step of record.steps) {
    const id = cleanString("step.id", step.id, /^[A-Za-z0-9-]+$/);
    if (seen.has(id)) fail(`duplicate step ${id}`);
    seen.add(id);
    if (step.status !== "pass") fail(`${id}.status must be pass`);
    validateEvidenceList(`${id}.evidence`, step.evidence);
  }
  for (const id of requiredSteps) {
    if (!seen.has(id)) fail(`missing required Android CI step ${id}`);
  }
}

function validateArtifacts(record) {
  if (!Array.isArray(record.artifacts)) fail("artifacts must be an array");
  const byVariant = new Map();
  for (const artifact of record.artifacts) {
    const variant = cleanString("artifact.variant", artifact.variant, /^(debug|release)$/);
    if (byVariant.has(variant)) fail(`duplicate artifact ${variant}`);
    byVariant.set(variant, artifact);
    cleanString(`${variant}.name`, artifact.name);
    cleanString(`${variant}.path`, artifact.path, /^android\/.+\.(apk|aab)$/);
    cleanString(`${variant}.sha256`, artifact.sha256, /^sha256:[a-fA-F0-9]{64}$/);
    positiveNumber(`${variant}.sizeBytes`, artifact.sizeBytes);
    validateEvidenceList(`${variant}.evidence`, artifact.evidence);
    const joinedEvidence = artifact.evidence.join("\n");
    for (const required of requiredArtifactEvidence[variant]) {
      if (!joinedEvidence.includes(required)) fail(`${variant}.evidence must mention ${required}`);
    }
  }
  for (const variant of requiredArtifacts) {
    if (!byVariant.has(variant)) fail(`missing required Android CI artifact ${variant}`);
  }
}

function validateRecord(record, file) {
  cleanString("buildId", record.buildId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^github-actions$/);
  cleanString("workflow", record.workflow, /^CI$/);
  cleanString("job", record.job, /^android$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("runUrl", record.runUrl, /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[0-9]+$/);
  const startedAt = parseTime("startedAt", record.startedAt);
  const completedAt = parseTime("completedAt", record.completedAt);
  if (completedAt <= startedAt) fail("completedAt must be after startedAt");
  if (record.synthetic && !allowSynthetic) fail("synthetic Android CI evidence requires --allow-synthetic");
  validateToolchain(record);
  validateSteps(record);
  validateArtifacts(record);
  return `${file}: Android CI evidence OK: steps=${requiredSteps.length}, artifacts=${requiredArtifacts.length}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-android-ci-evidence.js [--allow-synthetic] <android-ci-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Android CI evidence validation failed: ${error.message}`);
  process.exit(1);
}
