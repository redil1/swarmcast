import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/config/production.env";

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

function validate(env, args = []) {
  return spawnSync(process.execPath, ["scripts/validate-release-images.js", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function expectPass(label, env, args = []) {
  const result = validate(env, args);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, env, pattern) {
  const result = validate(env);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

function variant(transform) {
  const env = { ...baseEnv };
  transform(env);
  return env;
}

const baseEnv = parseEnvFile(fixture);

expectPass("complete production release image refs", baseEnv);
expectFailure(
  "missing service image ref",
  variant((env) => {
    env.SWARMCAST_AUTH_IMAGE = "";
  }),
  /SWARMCAST_AUTH_IMAGE is required for auth/
);
expectFailure(
  "tag-only infrastructure image ref",
  variant((env) => {
    env.SWARMCAST_PROMETHEUS_IMAGE = "prom/prometheus:v2.53.0";
  }),
  /SWARMCAST_PROMETHEUS_IMAGE must be digest-pinned/
);
expectFailure(
  "image ref with whitespace",
  variant((env) => {
    env.SWARMCAST_EDGE_METRICS_IMAGE = "node:22-slim @sha256:6666666666666666666666666666666666666666666666666666666666666666";
  }),
  /SWARMCAST_EDGE_METRICS_IMAGE contains whitespace/
);

console.log("release image validation smoke OK: pass=1 failures=3");
