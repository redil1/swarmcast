import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  enableStagingTurn,
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
assert.equal(values.TURN_ENABLED, "1");
assert.equal(values.TURN_EXTERNAL_IP, "203.0.113.10");
assert.equal(values.TURN_LISTENING_IP, "203.0.113.10");
assert.equal(values.TURN_RELAY_IP, "203.0.113.10");
assert.equal(values.TURN_REALM, "origin.203.0.113.10.sslip.io");
assert.equal(values.P2P_MIN_SWARM_SIZE, "2");
assert.match(values.TURN_SHARED_SECRET, /^[a-f0-9]{64}$/);
assert.deepEqual(JSON.parse(values.TURN_URLS), [
  "turn:origin.203.0.113.10.sslip.io:3478?transport=udp",
  "turn:origin.203.0.113.10.sslip.io:3478?transport=tcp",
  "turns:origin.203.0.113.10.sslip.io:5349?transport=tcp"
]);
assert.equal(values.TURN_PROMETHEUS_ADDRESS, "127.0.0.1");
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

const originalInternalToken = values.INTERNAL_TOKEN;
const originalTurnSecret = values.TURN_SHARED_SECRET;
assert.doesNotThrow(() => enableStagingTurn({
  publicSuffix: "203.0.113.10.sslip.io",
  catalogPath,
  outputPath: envPath
}));
const migratedValues = parseEnv(readFileSync(envPath, "utf8"));
assert.equal(migratedValues.INTERNAL_TOKEN, originalInternalToken);
assert.equal(migratedValues.TURN_SHARED_SECRET, originalTurnSecret);

const legacyEnvPath = path.join(workDir, ".env.staging-legacy");
const legacyText = readFileSync(envPath, "utf8")
  .replace(/^TURN_ENABLED=.*$/m, "TURN_ENABLED=0")
  .replace(/^TURN_URLS=.*$/m, "TURN_URLS=[]")
  .replace(/^TURN_SHARED_SECRET=.*\n/m, "");
writeFileSync(legacyEnvPath, legacyText, { mode: 0o600 });
enableStagingTurn({
  publicSuffix: "203.0.113.10.sslip.io",
  catalogPath,
  outputPath: legacyEnvPath
});
const upgradedLegacyValues = parseEnv(readFileSync(legacyEnvPath, "utf8"));
assert.equal(upgradedLegacyValues.INTERNAL_TOKEN, originalInternalToken);
assert.equal(upgradedLegacyValues.APP_API_KEY, values.APP_API_KEY);
assert.equal(upgradedLegacyValues.TURN_ENABLED, "1");
assert.match(upgradedLegacyValues.TURN_SHARED_SECRET, /^[a-f0-9]{64}$/);
assert.notEqual(upgradedLegacyValues.TURN_SHARED_SECRET, originalTurnSecret);

assert.throws(() => renderStagingEnv({
  publicSuffix: "staging.example.test",
  catalogPath,
  outputPath: path.join(workDir, "custom-dns-missing-ip.env")
}), /explicit public IPv4/);
const customDnsEnvPath = path.join(workDir, "custom-dns.env");
renderStagingEnv({
  publicSuffix: "staging.example.test",
  catalogPath,
  outputPath: customDnsEnvPath,
  turnExternalIp: "198.51.100.20"
});
assert.equal(parseEnv(readFileSync(customDnsEnvPath, "utf8")).TURN_EXTERNAL_IP, "198.51.100.20");

const malformedPath = path.join(workDir, "malformed.m3u");
writeFileSync(malformedPath, "#EXTM3U\nfile:///private/source.ts\n");
assert.throws(() => renderStagingEnv({
  publicSuffix: "203.0.113.10.sslip.io",
  catalogPath: malformedPath,
  outputPath: path.join(workDir, "bad.env")
}), /not HTTP\(S\)/);

const deployPath = path.resolve("infra/staging-single-host/deploy.sh");
const caddyfile = readFileSync(path.resolve("infra/staging-single-host/Caddyfile"), "utf8");
const compose = readFileSync(path.resolve("infra/staging-single-host/docker-compose.yml"), "utf8");
assert.match(caddyfile, /handle_path \/live\/\*/);
assert.match(caddyfile, /handle_path \/edge\/single-host\/live\/\*/);
assert.match(compose, /turn-cert-init:/);
assert.match(compose, /network_mode: host/);
assert.match(compose, /staging-turn-certs:\/certs:ro/);
assert.match(compose, /TURN_PROMETHEUS_ADDRESS: \$\{TURN_PROMETHEUS_ADDRESS:-127\.0\.0\.1\}/);
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
