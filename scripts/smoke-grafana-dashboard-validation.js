import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-grafana-dashboard-"));

function panel(overrides = {}) {
  return {
    id: 1,
    title: "Audience",
    type: "timeseries",
    gridPos: { x: 0, y: 0, w: 12, h: 8 },
    targets: [
      {
        expr: "swarmcast_tracker_peers",
        legendFormat: "peers"
      }
    ],
    ...overrides
  };
}

function dashboard(overrides = {}) {
  return {
    uid: "swarmcast-smoke",
    title: "SwarmCast Smoke",
    schemaVersion: 39,
    tags: ["swarmcast", "production"],
    panels: [panel()],
    ...overrides
  };
}

function writeDashboard(name, value) {
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function validate(file) {
  return spawnSync(process.execPath, [
    "scripts/validate-grafana-dashboard.js",
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

function expectFailure(label, file, pattern) {
  const result = validate(file);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass(
  "valid dashboard",
  writeDashboard("valid", dashboard()),
  /Grafana dashboard validation OK: 1 panels, 1 targets/
);
expectFailure(
  "missing production tag",
  writeDashboard("missing-production-tag", dashboard({ tags: ["swarmcast"] })),
  /missing production tag/
);
expectFailure(
  "placeholder title",
  writeDashboard("placeholder-title", dashboard({ title: "TBD" })),
  /title must not contain TBD/
);
expectFailure(
  "duplicate panel id",
  writeDashboard("duplicate-id", dashboard({
    panels: [panel(), panel({ id: 1, title: "Edge", gridPos: { x: 12, y: 0, w: 12, h: 8 } })]
  })),
  /duplicate panel id 1/
);
expectFailure(
  "overlapping panel grid",
  writeDashboard("overlap", dashboard({
    panels: [panel(), panel({ id: 2, title: "Edge", gridPos: { x: 6, y: 0, w: 12, h: 8 } })]
  })),
  /panel 2 overlaps panel 1/
);
expectFailure(
  "unsupported panel type",
  writeDashboard("unsupported-type", dashboard({
    panels: [panel({ type: "heatmap" })]
  })),
  /uses unsupported type heatmap/
);
expectFailure(
  "unbalanced query",
  writeDashboard("unbalanced-query", dashboard({
    panels: [panel({ targets: [{ expr: "sum(rate(foo[5m])", legendFormat: "bad" }] })]
  })),
  /target 0 expr is unbalanced/
);
expectFailure(
  "missing legend",
  writeDashboard("missing-legend", dashboard({
    panels: [panel({ targets: [{ expr: "up", legendFormat: "" }] })]
  })),
  /target 0 legendFormat must not be empty/
);

console.log("grafana dashboard validation smoke OK: pass=1 failures=7");
