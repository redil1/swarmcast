import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const defaultFiles = ["infra/monitoring/grafana/dashboards/swarmcast-overview.json"];
const files = process.argv.slice(2);
const targetFiles = files.length > 0 ? files : defaultFiles;

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

function assertString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim(), `${label} must not be empty`);
  assert.ok(!/TBD/i.test(value), `${label} must not contain TBD`);
}

function rectanglesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

let totalPanels = 0;
let totalTargets = 0;
for (const file of targetFiles) {
  const dashboard = JSON.parse(readFileSync(file, "utf8"));
  assertString(dashboard.uid, `${file}: uid`);
  assertString(dashboard.title, `${file}: title`);
  assert.ok(Number.isInteger(dashboard.schemaVersion), `${file}: schemaVersion must be an integer`);
  assert.ok(Array.isArray(dashboard.tags), `${file}: tags must be an array`);
  assert.ok(dashboard.tags.includes("swarmcast"), `${file}: missing swarmcast tag`);
  assert.ok(dashboard.tags.includes("production"), `${file}: missing production tag`);
  assert.ok(Array.isArray(dashboard.panels), `${file}: panels must be an array`);
  assert.ok(dashboard.panels.length > 0, `${file}: panels must not be empty`);

  const ids = new Set();
  const titles = new Set();
  const grid = [];

  for (const panel of dashboard.panels) {
    assert.ok(Number.isInteger(panel.id), `${file}: panel id must be an integer`);
    assert.ok(!ids.has(panel.id), `${file}: duplicate panel id ${panel.id}`);
    ids.add(panel.id);

    assertString(panel.title, `${file}: panel ${panel.id} title`);
    assert.ok(!titles.has(panel.title), `${file}: duplicate panel title ${panel.title}`);
    titles.add(panel.title);

    assertString(panel.type, `${file}: panel ${panel.id} type`);
    assert.ok(["stat", "gauge", "timeseries", "table"].includes(panel.type), `${file}: panel ${panel.id} uses unsupported type ${panel.type}`);

    const pos = panel.gridPos;
    assert.ok(pos && typeof pos === "object", `${file}: panel ${panel.id} missing gridPos`);
    for (const key of ["x", "y", "w", "h"]) {
      assert.ok(Number.isInteger(pos[key]), `${file}: panel ${panel.id} gridPos.${key} must be an integer`);
    }
    assert.ok(pos.x >= 0 && pos.x < 24, `${file}: panel ${panel.id} gridPos.x out of range`);
    assert.ok(pos.y >= 0, `${file}: panel ${panel.id} gridPos.y out of range`);
    assert.ok(pos.w > 0 && pos.x + pos.w <= 24, `${file}: panel ${panel.id} gridPos.w out of range`);
    assert.ok(pos.h > 0, `${file}: panel ${panel.id} gridPos.h out of range`);

    for (const existing of grid) {
      assert.ok(!rectanglesOverlap(pos, existing.pos), `${file}: panel ${panel.id} overlaps panel ${existing.id}`);
    }
    grid.push({ id: panel.id, pos });

    assert.ok(Array.isArray(panel.targets), `${file}: panel ${panel.id} targets must be an array`);
    assert.ok(panel.targets.length > 0, `${file}: panel ${panel.id} targets must not be empty`);
    for (const [index, target] of panel.targets.entries()) {
      assertString(target.expr, `${file}: panel ${panel.id} target ${index} expr`);
      assert.ok(balancedExpression(target.expr), `${file}: panel ${panel.id} target ${index} expr is unbalanced`);
      assertString(target.legendFormat, `${file}: panel ${panel.id} target ${index} legendFormat`);
      totalTargets += 1;
    }

    totalPanels += 1;
  }
}

console.log(`Grafana dashboard validation OK: ${totalPanels} panels, ${totalTargets} targets`);
