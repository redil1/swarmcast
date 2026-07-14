import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-prometheus-alerts-"));

function alertRule(overrides = {}) {
  const rule = {
    name: "SwarmcastSmokeAlert",
    expr: "up == 0",
    duration: "5m",
    severity: "warning",
    summary: "Smoke alert is firing",
    description: "Synthetic alert used to prove Prometheus rule validation.",
    runbookUrl: "docs/runbooks/app-incident.md",
    ...overrides
  };

  return [
    `      - alert: ${rule.name}`,
    `        expr: ${rule.expr}`,
    `        for: ${rule.duration}`,
    "        labels:",
    `          severity: ${rule.severity}`,
    "        annotations:",
    `          summary: "${rule.summary}"`,
    `          description: "${rule.description}"`,
    `          runbook_url: "${rule.runbookUrl}"`
  ].join("\n");
}

function writeAlerts(name, rules) {
  const file = path.join(tempRoot, `${name}.yml`);
  writeFileSync(file, [
    "groups:",
    "  - name: swarmcast-smoke",
    "    rules:",
    ...rules,
    ""
  ].join("\n"));
  return file;
}

function validate(file, extraArgs = []) {
  return spawnSync(process.execPath, [
    "scripts/validate-prometheus-alerts.js",
    ...extraArgs,
    file
  ], {
    encoding: "utf8"
  });
}

function expectPass(label, file, pattern) {
  const result = validate(file);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  assert.match(result.stdout, pattern, `${label} passed with unexpected output:\n${result.stdout}`);
}

function expectFailure(label, file, pattern, extraArgs = []) {
  const result = validate(file, extraArgs);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass(
  "valid alert",
  writeAlerts("valid", [alertRule()]),
  /Prometheus alert validation OK: 1 alerts, 1 runbooks/
);
expectFailure(
  "non SwarmCast alert name",
  writeAlerts("bad-name", [alertRule({ name: "LowOffloadRatio" })]),
  /alert name must start with Swarmcast/
);
expectFailure(
  "duplicate alert name",
  writeAlerts("duplicate", [alertRule(), alertRule({ expr: "up == 1" })]),
  /duplicate alert name/
);
expectFailure(
  "unbalanced expression",
  writeAlerts("bad-expr", [alertRule({ expr: "sum(rate(foo[5m]) > 1" })]),
  /expr has unbalanced delimiters or quotes/
);
expectFailure(
  "invalid duration",
  writeAlerts("bad-duration", [alertRule({ duration: "15minutes" })]),
  /for duration must use a single Prometheus duration/
);
expectFailure(
  "invalid severity",
  writeAlerts("bad-severity", [alertRule({ severity: "page" })]),
  /severity must be warning or critical/
);
expectFailure(
  "placeholder summary",
  writeAlerts("bad-summary", [alertRule({ summary: "TBD" })]),
  /summary must be complete/
);
expectFailure(
  "traversing runbook link",
  writeAlerts("bad-runbook", [alertRule({ runbookUrl: "docs/runbooks/../secrets.md" })]),
  /runbook_url must not traverse directories/
);
expectFailure(
  "missing launch alert coverage",
  writeAlerts("missing-launch-coverage", [alertRule()]),
  /missing required launch alert SwarmcastLowOffloadRatio/,
  ["--require-launch-coverage"]
);

console.log("prometheus alert validation smoke OK: pass=1 failures=8");
