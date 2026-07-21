import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/config/production.env";
const requiredImages = [
  "segment-bus",
  "segment-bus-exporter",
  "auth",
  "ingest",
  "tracker",
  "control-plane",
  "retention-worker",
  "nginx",
  "prometheus",
  "alertmanager",
  "grafana",
  "edge-nginx",
  "edge-metrics",
  "node-exporter",
  "turn"
];

function parseEnvFile(file) {
  const env = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    env[line.slice(0, equals)] = line.slice(equals + 1);
  }
  return env;
}

function runScript(script, args, env) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  assert.equal(result.status, 0, `${script} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-release-manifest-"));
const output = path.join(tempRoot, "manifest.json");
const env = parseEnvFile(fixture);

runScript("scripts/validate-release-images.js", [], env);
runScript("scripts/generate-release-manifest.js", [
  "--version", "v0.1.0-rc1",
  "--environment", "production",
  "--commit", "0123456789abcdef0123456789abcdef01234567",
  "--repository", "Aziz/Ads",
  "--require-digests",
  "--output", output
], env);
runScript("scripts/generate-release-manifest.js", ["--input", output, "--check"], env);

const manifest = JSON.parse(readFileSync(output, "utf8"));
assert.equal(manifest.environment, "production");
assert.equal(manifest.images.length, requiredImages.length);
assert.equal(manifest.artifacts.expectedImageScans.length, requiredImages.length);

for (const image of requiredImages) {
  const entry = manifest.images.find((candidate) => candidate.service === image);
  assert.ok(entry, `manifest missing ${image}`);
  assert.match(entry.image, /@sha256:[a-f0-9]{64}$/i, `${image} must be digest-pinned`);
  assert.ok(
    manifest.artifacts.expectedImageScans.includes(`var/scans/${image}.trivy.json`),
    `manifest missing expected scan path for ${image}`
  );
}

console.log(`production release manifest smoke OK: images=${manifest.images.length} scans=${manifest.artifacts.expectedImageScans.length}`);
