import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const defaultFiles = ["infra/monitoring/alerts.yml"];
const args = process.argv.slice(2);
const requireLaunchCoverage = args.includes("--require-launch-coverage");
const files = args.filter((arg) => arg !== "--require-launch-coverage");
const targetFiles = files.length > 0 ? files : defaultFiles;
const enforceLaunchCoverage = files.length === 0 || requireLaunchCoverage;
const requiredLaunchAlerts = [
  "SwarmcastLowOffloadRatio",
  "SwarmcastLowSuperPeerFraction",
  "SwarmcastTrackerPeerDrops",
  "SwarmcastTrackerCellSpilloverRate",
  "SwarmcastTrackerCellCapacityExhausted",
  "SwarmcastPeerHashFailures",
  "SwarmcastPeerDisconnectSpike",
  "SwarmcastPeerTimeoutSpike",
  "SwarmcastHighPlaybackStallRate",
  "SwarmcastHighStartupLatency",
  "SwarmcastLowPlaybackBuffer",
  "SwarmcastLowEdgeCacheHitRatio",
  "SwarmcastHighEdgeEgressRate",
  "SwarmcastHighEdgeOriginFillRate",
  "SwarmcastHighEdgeErrorRate",
  "SwarmcastIngestDegradedChannels",
  "SwarmcastIngestStaleSegments",
  "SwarmcastFfmpegFailureSpike",
  "SwarmcastAuthVerifyFailures",
  "SwarmcastAppAttestationFailures",
  "SwarmcastServiceTargetDown",
  "SwarmcastControlPlaneCatalogNotDurable",
  "SwarmcastControlPlanePlacementNotDurable",
  "SwarmcastRetentionJobFailures",
  "SwarmcastRetentionJobStale"
];

function stripScalar(value = "") {
  return value.trim().replace(/^["']|["']$/g, "");
}

function balancedExpression(expr) {
  const pairs = new Map([
    [")", "("],
    ["}", "{"],
    ["]", "["]
  ]);
  const opens = new Set(["(", "{", "["]);
  const stack = [];
  let quote = "";
  let escaped = false;

  for (const char of expr) {
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (opens.has(char)) {
      stack.push(char);
    } else if (pairs.has(char)) {
      if (stack.pop() !== pairs.get(char)) return false;
    }
  }

  return stack.length === 0 && quote === "";
}

function parseAlerts(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const alerts = [];
  let current = null;

  for (const raw of lines) {
    const alert = raw.match(/^\s*-\s+alert:\s*([A-Za-z][A-Za-z0-9_]*)\s*$/);
    if (alert) {
      if (current) alerts.push(current);
      current = {
        file,
        name: alert[1],
        expr: "",
        duration: "",
        severity: "",
        annotations: {
          summary: "",
          description: "",
          runbookUrl: ""
        }
      };
      continue;
    }

    if (!current) continue;

    const expr = raw.match(/^\s*expr:\s*(.+)$/);
    if (expr) current.expr = stripScalar(expr[1]);

    const duration = raw.match(/^\s*for:\s*(.+)$/);
    if (duration) current.duration = stripScalar(duration[1]);

    const severity = raw.match(/^\s*severity:\s*(.+)$/);
    if (severity) current.severity = stripScalar(severity[1]);

    const summary = raw.match(/^\s*summary:\s*(.+)$/);
    if (summary) current.annotations.summary = stripScalar(summary[1]);

    const description = raw.match(/^\s*description:\s*(.+)$/);
    if (description) current.annotations.description = stripScalar(description[1]);

    const runbookUrl = raw.match(/^\s*runbook_url:\s*(.+)$/);
    if (runbookUrl) current.annotations.runbookUrl = stripScalar(runbookUrl[1]);
  }

  if (current) alerts.push(current);
  return alerts;
}

function fail(alert, message) {
  throw new Error(`${alert.file}: ${alert.name}: ${message}`);
}

const allAlerts = [];
for (const file of targetFiles) {
  assert.ok(existsSync(file), `${file}: file does not exist`);
  const alerts = parseAlerts(file);
  assert.ok(alerts.length > 0, `${file}: no alert rules found`);
  allAlerts.push(...alerts);
}

const names = new Set();
const runbooks = new Set();
let warningAlerts = 0;
let criticalAlerts = 0;
for (const alert of allAlerts) {
  if (names.has(alert.name)) fail(alert, "duplicate alert name");
  names.add(alert.name);

  if (!alert.name.startsWith("Swarmcast")) fail(alert, "alert name must start with Swarmcast");
  if (!alert.expr) fail(alert, "missing expr");
  if (!balancedExpression(alert.expr)) fail(alert, "expr has unbalanced delimiters or quotes");
  if (!/^\d+[smhd]$/.test(alert.duration)) fail(alert, "for duration must use a single Prometheus duration");
  if (!["warning", "critical"].includes(alert.severity)) fail(alert, "severity must be warning or critical");
  if (alert.severity === "warning") warningAlerts += 1;
  if (alert.severity === "critical") criticalAlerts += 1;

  const { summary, description, runbookUrl } = alert.annotations;
  if (!summary || /TBD/i.test(summary)) fail(alert, "summary must be complete");
  if (!description || /TBD/i.test(description)) fail(alert, "description must be complete");
  if (!runbookUrl.startsWith("docs/runbooks/")) fail(alert, "runbook_url must point to docs/runbooks");
  if (runbookUrl.includes("..")) fail(alert, "runbook_url must not traverse directories");
  if (!existsSync(path.resolve(runbookUrl))) fail(alert, `runbook does not exist: ${runbookUrl}`);
  runbooks.add(runbookUrl);
}

if (enforceLaunchCoverage) {
  for (const alertName of requiredLaunchAlerts) {
    assert.ok(names.has(alertName), `infra/monitoring/alerts.yml: missing required launch alert ${alertName}`);
  }
  assert.ok(warningAlerts > 0, "infra/monitoring/alerts.yml: launch alerts must include warning severity");
  assert.ok(criticalAlerts > 0, "infra/monitoring/alerts.yml: launch alerts must include critical severity");
}

console.log(`Prometheus alert validation OK: ${allAlerts.length} alerts, ${runbooks.size} runbooks`);
