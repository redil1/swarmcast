import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseEnv,
  renderStagingEnv,
  validateStagingEnv
} from "./render-staging-single-host-env.js";

const workDir = mkdtempSync(path.join(tmpdir(), "swarmcast-staging-deploy-"));
const catalogPath = path.join(workDir, "source.m3u");
const envPath = path.join(workDir, ".env.staging");
writeFileSync(catalogPath, [
  "#EXTM3U",
  "#EXTINF:-1,One",
  "https://source-a.example/live/one",
  "#EXTINF:-1,Two",
  "http://source-b.example/live/two"
].join("\n"));

const rendered = renderStagingEnv({
  publicSuffix: "203.0.113.10.sslip.io",
  catalogPath,
  outputPath: envPath
});
assert.equal(rendered.entries, 2);
assert.equal(rendered.sourceHosts, 2);
assert.equal(statSync(envPath).mode & 0o777, 0o600);

const values = parseEnv(readFileSync(envPath, "utf8"));
assert.match(values.INTERNAL_TOKEN, /^[a-f0-9]{64}$/);
assert.match(values.APP_API_KEY, /^[a-f0-9]{64}$/);
assert.equal(values.SOURCE_ALLOWED_HOSTS, "source-a.example,source-b.example");
assert.equal(values.SOURCE_ALLOW_PRIVATE_NETWORKS, "0");
assert.equal(values.STAGING_M3U_FILE, catalogPath);
assert.doesNotThrow(() => validateStagingEnv({
  publicSuffix: "203.0.113.10.sslip.io",
  catalogPath,
  envPath
}));
assert.throws(() => renderStagingEnv({
  publicSuffix: "203.0.113.10.sslip.io",
  catalogPath,
  outputPath: envPath
}), /output already exists/);

const malformedPath = path.join(workDir, "malformed.m3u");
writeFileSync(malformedPath, "#EXTM3U\nfile:///private/source.ts\n");
assert.throws(() => renderStagingEnv({
  publicSuffix: "203.0.113.10.sslip.io",
  catalogPath: malformedPath,
  outputPath: path.join(workDir, "bad.env")
}), /not HTTP\(S\)/);

const deployPath = path.resolve("infra/staging-single-host/deploy.sh");
const caddyfile = readFileSync(path.resolve("infra/staging-single-host/Caddyfile"), "utf8");
assert.match(caddyfile, /handle_path \/live\/\*/);
assert.match(caddyfile, /handle_path \/edge\/single-host\/live\/\*/);
const syntax = spawnSync("bash", ["-n", deployPath], { encoding: "utf8" });
assert.equal(syntax.status, 0, syntax.stderr);
const prepared = spawnSync("bash", [
  deployPath,
  "--prepare-only",
  "--public-suffix",
  "203.0.113.10.sslip.io",
  "--catalog",
  catalogPath,
  "--env",
  envPath
], { encoding: "utf8" });
assert.equal(prepared.status, 0, prepared.stderr);
assert.match(prepared.stdout, /Staging preparation validated/);
assert.doesNotMatch(prepared.stdout, /source-a\.example\/live|INTERNAL_TOKEN|APP_API_KEY/);

console.log(JSON.stringify({ ok: true, entries: rendered.entries, sourceHosts: rendered.sourceHosts }));
