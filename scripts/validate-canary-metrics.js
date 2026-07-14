import { readFileSync } from "node:fs";
import { validatePerformanceBudgets } from "../packages/config/src/performanceBudgets.js";

const args = process.argv.slice(2);
const files = args.filter((arg) => !arg.startsWith("--"));
const budgetPath = argValue("--budgets") || "config/performance-budgets.json";
const budgets = JSON.parse(readFileSync(budgetPath, "utf8"));
validatePerformanceBudgets(budgets);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function fail(message) {
  throw new Error(message);
}

function numberField(object, key, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const value = object?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${key} must be a finite number`);
  if (value < min || value > max) fail(`${key} must be between ${min} and ${max}`);
  return value;
}

function requireCleanString(object, key, pattern) {
  const value = object?.[key];
  if (typeof value !== "string" || value.trim() === "") fail(`${key} is required`);
  if (pattern && !pattern.test(value.trim())) fail(`${key} has invalid format`);
  return value.trim();
}

function assertMax(metrics, key, limit) {
  const value = numberField(metrics, key);
  if (value > limit) fail(`${key} ${value} exceeds limit ${limit}`);
}

function assertMin(metrics, key, limit) {
  const value = numberField(metrics, key);
  if (value < limit) fail(`${key} ${value} is below limit ${limit}`);
}

function validateCanarySnapshot(file) {
  const snapshot = JSON.parse(readFileSync(file, "utf8"));
  requireCleanString(snapshot, "releaseVersion", /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  requireCleanString(snapshot, "environment", /^(staging|production)$/);
  requireCleanString(snapshot, "window", /^[0-9]+[mh]$/);
  const measuredAt = requireCleanString(snapshot, "measuredAt");
  if (Number.isNaN(Date.parse(measuredAt))) fail("measuredAt must be ISO-8601 parseable");

  const metrics = snapshot.metrics;
  const limits = snapshot.limits;
  if (!metrics || typeof metrics !== "object") fail("metrics object is required");
  if (!limits || typeof limits !== "object") fail("limits object is required");

  assertMin(metrics, "androidCrashFreeSessions", numberField(limits, "androidCrashFreeSessionsMin", { min: 0, max: 1 }));
  assertMax(metrics, "androidStartupLatencyMsP95", budgets.androidStartupLatencyMsP95);
  assertMax(metrics, "androidStallRate", budgets.androidStallRateMax);
  assertMin(metrics, "androidBufferMsMin", budgets.androidBufferMsMin);
  assertMin(metrics, "offloadRatio5m", numberField(limits, "offloadRatio5mMin", { min: 0, max: 1 }));
  assertMin(metrics, "edgeCacheHitRatio", budgets.edgeCacheHitRatioMin);
  assertMax(metrics, "edgeEgressBytesPerSecond", numberField(limits, "edgeEgressBytesPerSecondMax", { min: 1 }));
  assertMax(metrics, "originEgressBytesPerSecond", numberField(limits, "originEgressBytesPerSecondMax", { min: 1 }));
  assertMax(metrics, "authVerifyFailureRate", numberField(limits, "authVerifyFailureRateMax", { min: 0, max: 1 }));
  assertMax(metrics, "trackerPeerDropRate", numberField(limits, "trackerPeerDropRateMax", { min: 0, max: 1 }));
  assertMax(metrics, "peerTimeouts5m", numberField(limits, "peerTimeouts5mMax", { min: 0 }));
  assertMax(metrics, "peerHashFailures5m", numberField(limits, "peerHashFailures5mMax", { min: 0 }));
  assertMax(metrics, "peerDisconnects5m", numberField(limits, "peerDisconnects5mMax", { min: 0 }));

  return `${file}: Canary metrics OK: window=${snapshot.window}, rho=${metrics.offloadRatio5m.toFixed(3)}, stall=${metrics.androidStallRate.toFixed(3)}, peerHashFailures=${metrics.peerHashFailures5m}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-canary-metrics.js [--budgets config/performance-budgets.json] <canary-metrics.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    console.log(validateCanarySnapshot(file));
  }
} catch (error) {
  console.error(`Canary metrics validation failed: ${error.message}`);
  process.exit(1);
}
