import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/config/production.env";
const baseText = readFileSync(fixture, "utf8");
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-prod-env-"));

function writeVariant(name, transform) {
  const file = path.join(tempRoot, `${name}.env`);
  writeFileSync(file, transform(baseText));
  return file;
}

function removeLine(key) {
  return (text) => text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(`${key}=`))
    .join("\n");
}

function replaceLine(key, value) {
  return (text) => text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
}

function appendLine(key, value) {
  return (text) => `${text.trimEnd()}\n${key}=${value}\n`;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-production-env.js", file], {
    encoding: "utf8"
  });
}

function expectPass(label, file) {
  const result = validate(file);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, file, pattern) {
  const result = validate(file);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass("complete production fixture", fixture);
expectFailure(
  "missing auth key path",
  writeVariant("missing-auth-key-path", removeLine("AUTH_KEY_PATH")),
  /AUTH_KEY_PATH is required/
);
expectFailure(
  "temporary catalog database path",
  writeVariant("temporary-catalog-db-path", replaceLine("CATALOG_DB_PATH", "/tmp/catalog.sqlite")),
  /CATALOG_DB_PATH must use persistent storage/
);
expectFailure(
  "missing retention HTTP token",
  writeVariant("missing-retention-http-token", removeLine("RETENTION_STORE_HTTP_TOKEN")),
  /RETENTION_STORE_HTTP_TOKEN is required/
);
expectFailure(
  "missing retention HTTP timeout",
  writeVariant("missing-retention-http-timeout", removeLine("RETENTION_STORE_HTTP_TIMEOUT_MS")),
  /RETENTION_STORE_HTTP_TIMEOUT_MS is required/
);
expectFailure(
  "relative retention store module",
  writeVariant("relative-retention-store-module", replaceLine("RETENTION_STORE_MODULE", "./scripts/retention-http-store.js")),
  /RETENTION_STORE_MODULE must be an absolute path/
);
expectFailure(
  "tag-only infrastructure image",
  writeVariant("tag-only-infrastructure-image", replaceLine("SWARMCAST_PROMETHEUS_IMAGE", "prom/prometheus:v2.53.0")),
  /SWARMCAST_PROMETHEUS_IMAGE must be digest-pinned/
);
expectFailure(
  "missing Alertmanager config path",
  writeVariant("missing-alertmanager-config-path", removeLine("ALERTMANAGER_CONFIG_PATH")),
  /ALERTMANAGER_CONFIG_PATH is required/
);
expectFailure(
  "Play Integrity disabled",
  writeVariant("play-integrity-disabled", replaceLine("AUTH_PLAY_INTEGRITY_ENABLED", "0")),
  /AUTH_PLAY_INTEGRITY_ENABLED must be 1/
);
expectFailure(
  "missing Play Integrity service account path",
  writeVariant("play-integrity-service-account", removeLine("AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH")),
  /AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH is required/
);
expectFailure(
  "invalid Play Integrity certificate digest",
  writeVariant(
    "play-integrity-certificate",
    replaceLine("AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS", '["invalid"]')
  ),
  /base64url SHA-256 digest/
);
expectFailure(
  "weak attestation challenge secret",
  writeVariant("attestation-challenge-secret", replaceLine("AUTH_ATTESTATION_CHALLENGE_SECRET", "short")),
  /AUTH_ATTESTATION_CHALLENGE_SECRET/
);
expectFailure(
  "duplicate previous attestation challenge secret",
  writeVariant(
    "attestation-previous-challenge-secret",
    replaceLine(
      "AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET",
      "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
    )
  ),
  /must differ/
);
expectFailure(
  "TURN disabled",
  writeVariant("turn-disabled", replaceLine("TURN_ENABLED", "0")),
  /TURN_ENABLED must be 1/
);
expectFailure(
  "TURN host outside owned allowlist",
  writeVariant("turn-unowned-host", replaceLine(
    "TURN_URLS",
    '["turn:relay.invalid.test:3478?transport=udp"]'
  )),
  /ICE_SERVER_ALLOWED_HOSTS/
);
expectFailure(
  "TURN missing TLS endpoint",
  writeVariant("turn-missing-tls", replaceLine(
    "TURN_URLS",
    '["turn:turn.swarmcast.tv:3478?transport=udp","turn:turn.swarmcast.tv:3478?transport=tcp"]'
  )),
  /TURN\/TLS endpoint/
);
expectFailure(
  "TURN private peers enabled",
  writeVariant("turn-private-peers", appendLine("TURN_ALLOW_PRIVATE_PEERS", "1")),
  /TURN_ALLOW_PRIVATE_PEERS must be 0/
);
expectFailure(
  "TURN allocation quota exceeds relay ports",
  writeVariant("turn-port-quota", replaceLine("TURN_TOTAL_QUOTA", "20000")),
  /TURN_TOTAL_QUOTA must not exceed the relay port count/
);

console.log("production env validation smoke OK: pass=1 failures=16");
