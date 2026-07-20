import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const requiredChecks = ["android", "deployment-shape", "node"];
const requiredMarkers = [
  "branch-protection-enabled",
  "strict-required-checks",
  "pull-request-required",
  "admin-enforcement",
  "force-push-disabled",
  "deletion-disabled",
  "codeowners",
  "dependabot-version-updates",
  "dependabot-security-updates",
  "secret-scanning",
  "push-protection"
];
const sensitivePatterns = [/token=/i, /authorization:/i, /bearer\s+/i, /-----BEGIN/i, /secret=/i];

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

function requireFalse(name, value) {
  if (value !== false) fail(`${name} must be false`);
}

function validateRecord(record, file) {
  cleanString("evidenceId", record.evidenceId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("repository", record.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  if (cleanString("branch", record.branch) !== "main") fail("branch must be main");
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  if (Number.isNaN(Date.parse(cleanString("checkedAt", record.checkedAt)))) fail("checkedAt must be ISO-8601 parseable");
  if (record.synthetic && !allowSynthetic) fail("synthetic repository governance evidence requires --allow-synthetic");

  const protection = record.branchProtection;
  if (!protection || typeof protection !== "object") fail("branchProtection is required");
  requireTrue("branchProtection.enabled", protection.enabled);
  requireTrue("branchProtection.enforceAdmins", protection.enforceAdmins);
  requireTrue("branchProtection.strictRequiredChecks", protection.strictRequiredChecks);
  requireTrue("branchProtection.pullRequestRequired", protection.pullRequestRequired);
  requireTrue("branchProtection.dismissStaleReviews", protection.dismissStaleReviews);
  requireTrue("branchProtection.conversationResolution", protection.conversationResolution);
  requireTrue("branchProtection.linearHistory", protection.linearHistory);
  requireFalse("branchProtection.forcePushesAllowed", protection.forcePushesAllowed);
  requireFalse("branchProtection.deletionsAllowed", protection.deletionsAllowed);
  if (!Number.isInteger(protection.requiredApprovingReviewCount) || protection.requiredApprovingReviewCount < 0) {
    fail("branchProtection.requiredApprovingReviewCount must be a non-negative integer");
  }
  if (!Array.isArray(protection.requiredChecks)) fail("branchProtection.requiredChecks must be an array");
  const checks = [...new Set(protection.requiredChecks)].sort();
  if (checks.join(",") !== requiredChecks.join(",")) {
    fail(`branchProtection.requiredChecks must be exactly ${requiredChecks.join(",")}`);
  }

  const security = record.security;
  if (!security || typeof security !== "object") fail("security is required");
  requireTrue("security.dependabotSecurityUpdates", security.dependabotSecurityUpdates);
  requireTrue("security.secretScanning", security.secretScanning);
  requireTrue("security.pushProtection", security.pushProtection);
  requireTrue("repositoryFiles.codeowners", record.repositoryFiles?.codeowners);
  requireTrue("repositoryFiles.dependabotConfig", record.repositoryFiles?.dependabotConfig);

  if (!Array.isArray(record.evidence) || record.evidence.length === 0) fail("evidence must be a non-empty array");
  const evidence = record.evidence.map((value, index) => cleanString(`evidence[${index}]`, value));
  for (const value of evidence) {
    if (sensitivePatterns.some((pattern) => pattern.test(value))) fail("evidence reference looks like it may contain sensitive material");
  }
  const joined = evidence.join("\n").toLowerCase();
  for (const marker of requiredMarkers) {
    if (!joined.includes(marker)) fail(`evidence must mention ${marker}`);
  }
  return `${file}: Repository governance evidence OK: checks=${checks.join("+")}, status=${record.synthetic ? "synthetic-shape-ready" : "enforced"}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-repository-governance-evidence.js [--allow-synthetic] <repository-governance-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    console.log(validateRecord(JSON.parse(readFileSync(file, "utf8")), file));
  }
} catch (error) {
  console.error(`Repository governance evidence validation failed: ${error.message}`);
  process.exit(1);
}
