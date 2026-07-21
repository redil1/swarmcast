import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import {
  boolEnv,
  intEnv,
  jsonEnv,
  jwtClaimEnv,
  keyIdEnv,
  loadAuthConfig,
  ownedUrlEnv,
  segmentBusConfigFromEnv,
  sourcePolicyFromEnv,
  stringEnv,
  validateIngestNodes
} from "../packages/config/src/env.js";

const requiredProductionKeys = [
  "INTERNAL_TOKEN",
  "APP_API_KEY",
  "ORIGIN_BASE",
  "EDGE_BASE",
  "API_BASE",
  "TRACKER_BASE",
  "AUTH_KEY_ID",
  "AUTH_KEY_PATH",
  "AUTH_JWT_AUDIENCE",
  "AUTH_JWT_ISSUER",
  "AUTH_TOKEN_TTL_SECONDS",
  "AUTH_PLAY_INTEGRITY_ENABLED",
  "AUTH_PLAY_INTEGRITY_PACKAGE_NAME",
  "AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH",
  "AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS",
  "AUTH_PLAY_INTEGRITY_MAX_TOKEN_AGE_SECONDS",
  "AUTH_ATTESTATION_CHALLENGE_SECRET",
  "AUTH_ATTESTATION_CHALLENGE_TTL_SECONDS",
  "ICE_SERVER_ALLOWED_HOSTS",
  "ICE_STUN_URLS",
  "TURN_ENABLED",
  "TURN_URLS",
  "TURN_SHARED_SECRET",
  "TURN_CREDENTIAL_TTL_SECONDS",
  "TURN_REALM",
  "TURN_EXTERNAL_IP",
  "TURN_CERT_DIR",
  "TURN_LISTENING_PORT",
  "TURN_TLS_LISTENING_PORT",
  "TURN_MIN_PORT",
  "TURN_MAX_PORT",
  "TURN_USER_QUOTA",
  "TURN_TOTAL_QUOTA",
  "TURN_MAX_BPS",
  "TURN_BPS_CAPACITY",
  "TURN_PROMETHEUS_PORT",
  "TURN_TARGETS_DIR",
  "SEGMENT_BUS_ENABLED",
  "SEGMENT_BUS_SERVERS",
  "SEGMENT_BUS_TLS_REQUIRED",
  "SEGMENT_BUS_TLS_CA_FILE",
  "SEGMENT_BUS_MANAGE_STREAM",
  "SEGMENT_BUS_REPLICAS",
  "NATS_INGEST_USER",
  "NATS_INGEST_PASSWORD",
  "NATS_INGEST_PASSWORD_HASH",
  "NATS_TRACKER_USER",
  "NATS_TRACKER_PASSWORD",
  "NATS_TRACKER_PASSWORD_HASH",
  "NATS_ADMIN_USER",
  "NATS_ADMIN_PASSWORD",
  "NATS_ADMIN_PASSWORD_HASH",
  "INGEST_NODES",
  "CATALOG_DB_PATH",
  "PLACEMENT_DB_PATH",
  "SOURCE_ALLOWED_HOSTS",
  "SOURCE_ALLOW_PRIVATE_NETWORKS",
  "TRACKER_MAX_CONNECTIONS",
  "TRACKER_MAX_PAYLOAD_BYTES",
  "TRACKER_MAX_BACKPRESSURE_BYTES",
  "TRACKER_IDLE_TIMEOUT_SECONDS",
  "TRACKER_DEMAND_HEARTBEAT_SECONDS",
  "TRACKER_RATE_LIMIT_CAPACITY",
  "TRACKER_RATE_LIMIT_REFILL_PER_SECOND",
  "RETENTION_EXECUTE",
  "RETENTION_STORE_MODULE",
  "ALERTMANAGER_CONFIG_PATH",
  "SWARMCAST_AUTH_IMAGE",
  "SWARMCAST_INGEST_IMAGE",
  "SWARMCAST_TRACKER_IMAGE",
  "SWARMCAST_CONTROL_PLANE_IMAGE",
  "SWARMCAST_RETENTION_WORKER_IMAGE",
  "SWARMCAST_NGINX_IMAGE",
  "SWARMCAST_PROMETHEUS_IMAGE",
  "SWARMCAST_ALERTMANAGER_IMAGE",
  "SWARMCAST_GRAFANA_IMAGE",
  "SWARMCAST_EDGE_NGINX_IMAGE",
  "SWARMCAST_EDGE_METRICS_IMAGE",
  "SWARMCAST_NODE_EXPORTER_IMAGE",
  "SWARMCAST_TURN_IMAGE",
  "SWARMCAST_NATS_IMAGE",
  "SWARMCAST_NATS_EXPORTER_IMAGE"
];

const releaseImageKeys = [
  "SWARMCAST_AUTH_IMAGE",
  "SWARMCAST_INGEST_IMAGE",
  "SWARMCAST_TRACKER_IMAGE",
  "SWARMCAST_CONTROL_PLANE_IMAGE",
  "SWARMCAST_RETENTION_WORKER_IMAGE"
];

const infrastructureImageKeys = [
  "SWARMCAST_NGINX_IMAGE",
  "SWARMCAST_PROMETHEUS_IMAGE",
  "SWARMCAST_ALERTMANAGER_IMAGE",
  "SWARMCAST_GRAFANA_IMAGE",
  "SWARMCAST_EDGE_NGINX_IMAGE",
  "SWARMCAST_EDGE_METRICS_IMAGE",
  "SWARMCAST_NODE_EXPORTER_IMAGE",
  "SWARMCAST_TURN_IMAGE",
  "SWARMCAST_NATS_IMAGE",
  "SWARMCAST_NATS_EXPORTER_IMAGE"
];

const productionImageKeys = [
  ...releaseImageKeys,
  ...infrastructureImageKeys
];

const placeholderPattern = /replace-with|change-?me|example\.|localhost|127\.0\.0\.1|0\.0\.0\.0|todo|tbd|placeholder/i;
const digestPattern = /@sha256:[a-f0-9]{64}$/i;

const args = process.argv.slice(2);
const allowExample = args.includes("--allow-example");
const files = args.filter((arg) => !arg.startsWith("--"));

function fail(message) {
  throw new Error(message);
}

function parseEnvFile(file) {
  const env = {};
  const text = readFileSync(file, "utf8");
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equals = normalized.indexOf("=");
    if (equals <= 0) fail(`${file}:${index + 1} must be KEY=value`);
    const key = normalized.slice(0, equals).trim();
    let value = normalized.slice(equals + 1).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) fail(`${file}:${index + 1} has invalid key ${key}`);
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function requirePresent(env, key) {
  const value = stringEnv(env, key);
  if (!value) fail(`${key} is required`);
  if (!allowExample && placeholderPattern.test(value)) fail(`${key} still contains a placeholder value`);
  return value;
}

function requireHexSecret(env, key) {
  const value = requirePresent(env, key);
  if (!/^[a-f0-9]{64}$/i.test(value)) fail(`${key} must be 64 hex characters`);
  if (/^([a-f0-9])\1{63}$/i.test(value)) fail(`${key} must not be a repeated single character`);
}

function requireNatsBcryptConfigValue(env, key) {
  const value = requirePresent(env, key);
  let hash;
  try {
    hash = JSON.parse(value);
  } catch {
    fail(`${key} must be a JSON-quoted bcrypt config value`);
  }
  if (typeof hash !== "string" || !/^\$2a\$11\$[./A-Za-z0-9]{53}$/.test(hash)) {
    fail(`${key} must be a cost-11 bcrypt value generated by the NATS CLI and wrapped in JSON quotes`);
  }
  return hash;
}

function requireSqlitePath(env, key) {
  const value = requirePresent(env, key);
  if (!value.startsWith("/")) fail(`${key} must be an absolute path`);
  if (value.includes("..")) fail(`${key} must not traverse directories`);
  if (/^\/(?:tmp|var\/tmp|run|var\/run|dev\/shm)(?:\/|$)/.test(value)) {
    fail(`${key} must use persistent storage, not a temporary runtime path`);
  }
  if (!/\.(?:sqlite|sqlite3|db)$/i.test(value)) {
    fail(`${key} must point to a SQLite database file`);
  }
  return value;
}

function requirePersistentFilePath(env, key, extensionPattern) {
  const value = requirePresent(env, key);
  if (!value.startsWith("/")) fail(`${key} must be an absolute path`);
  if (value.includes("..")) fail(`${key} must not traverse directories`);
  if (/^\/(?:tmp|var\/tmp|run|var\/run|dev\/shm)(?:\/|$)/.test(value)) {
    fail(`${key} must use persistent storage, not a temporary runtime path`);
  }
  if (!extensionPattern.test(value)) fail(`${key} has an unsupported file extension`);
  return value;
}

function validateProductionImages(env) {
  for (const key of productionImageKeys) {
    const image = requirePresent(env, key);
    if (/\s/.test(image)) fail(`${key} must not contain whitespace`);
    if (!digestPattern.test(image)) fail(`${key} must be digest-pinned with @sha256:<64 hex chars>`);
  }
}

function validateProductionEnv(env, file) {
  for (const key of requiredProductionKeys) requirePresent(env, key);
  requireHexSecret(env, "INTERNAL_TOKEN");
  requireHexSecret(env, "APP_API_KEY");

  ownedUrlEnv(env, "ORIGIN_BASE", "", { required: true, protocols: ["https:"] });
  ownedUrlEnv(env, "EDGE_BASE", "", { required: true, protocols: ["https:"] });
  ownedUrlEnv(env, "API_BASE", "", { required: true, protocols: ["https:"] });
  ownedUrlEnv(env, "TRACKER_BASE", "", { required: true, protocols: ["wss:"] });

  keyIdEnv(env);
  requirePersistentFilePath(env, "AUTH_KEY_PATH", /\.pem$/i);
  const previousJwksPath = stringEnv(env, "AUTH_PREVIOUS_JWKS_PATH").trim();
  if (previousJwksPath) {
    requirePersistentFilePath(env, "AUTH_PREVIOUS_JWKS_PATH", /\.json$/i);
  }
  jwtClaimEnv(env, "AUTH_JWT_AUDIENCE", "");
  jwtClaimEnv(env, "AUTH_JWT_ISSUER", "");
  intEnv(env, "AUTH_TOKEN_TTL_SECONDS", 21_600, { min: 300, max: 86_400 });
  const authConfig = loadAuthConfig(env, { requireSecrets: true });
  if (!authConfig.playIntegrityEnabled) fail("AUTH_PLAY_INTEGRITY_ENABLED must be 1 for production token issuance");
  const serviceAccountPath = requirePresent(env, "AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH");
  if (!serviceAccountPath.startsWith("/") || serviceAccountPath.includes("..") || !serviceAccountPath.endsWith(".json")) {
    fail("AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH must be an absolute non-traversing JSON path");
  }
  requireHexSecret(env, "AUTH_ATTESTATION_CHALLENGE_SECRET");
  const previousChallengeSecret = stringEnv(env, "AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET").trim();
  if (previousChallengeSecret) {
    requireHexSecret(env, "AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET");
    if (previousChallengeSecret === authConfig.attestationChallengeSecret) {
      fail("AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET must differ from AUTH_ATTESTATION_CHALLENGE_SECRET");
    }
  }
  if (!authConfig.turnEnabled) fail("TURN_ENABLED must be 1 for production mobile reachability");
  if (boolEnv(env, "TURN_ALLOW_PRIVATE_PEERS", false)) fail("TURN_ALLOW_PRIVATE_PEERS must be 0 for production");
  requireHexSecret(env, "TURN_SHARED_SECRET");
  if (!authConfig.turnUrls.some((url) => url.startsWith("turn:") && url.endsWith("transport=udp"))) {
    fail("TURN_URLS must include a TURN/UDP endpoint");
  }
  if (!authConfig.turnUrls.some((url) => url.startsWith("turn:") && url.endsWith("transport=tcp"))) {
    fail("TURN_URLS must include a TURN/TCP endpoint");
  }
  if (!authConfig.turnUrls.some((url) => url.startsWith("turns:") && url.endsWith("transport=tcp"))) {
    fail("TURN_URLS must include a TURN/TLS endpoint");
  }
  const turnRealm = requirePresent(env, "TURN_REALM");
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(turnRealm)) fail("TURN_REALM must be a valid DNS name");
  if (isIP(requirePresent(env, "TURN_EXTERNAL_IP")) === 0) fail("TURN_EXTERNAL_IP must be an IP address");
  const turnCertDir = requirePresent(env, "TURN_CERT_DIR");
  if (!turnCertDir.startsWith("/") || turnCertDir.includes("..")) {
    fail("TURN_CERT_DIR must be an absolute non-traversing path");
  }
  intEnv(env, "TURN_LISTENING_PORT", 3478, { min: 1, max: 65_535 });
  intEnv(env, "TURN_TLS_LISTENING_PORT", 5349, { min: 1, max: 65_535 });
  const turnMinPort = intEnv(env, "TURN_MIN_PORT", 49_152, { min: 1024, max: 65_535 });
  const turnMaxPort = intEnv(env, "TURN_MAX_PORT", 65_535, { min: 1024, max: 65_535 });
  if (turnMaxPort < turnMinPort || turnMaxPort - turnMinPort + 1 < 100) {
    fail("TURN relay port range must contain at least 100 ports");
  }
  intEnv(env, "TURN_USER_QUOTA", 12, { min: 1, max: 100 });
  const turnTotalQuota = intEnv(env, "TURN_TOTAL_QUOTA", 10_000, { min: 1, max: 1_000_000 });
  if (turnTotalQuota > turnMaxPort - turnMinPort + 1) fail("TURN_TOTAL_QUOTA must not exceed the relay port count");
  intEnv(env, "TURN_MAX_BPS", 1_250_000, { min: 100_000, max: 125_000_000 });
  intEnv(env, "TURN_BPS_CAPACITY", 100_000_000, { min: 1_000_000, max: 12_500_000_000 });
  intEnv(env, "TURN_PROMETHEUS_PORT", 9641, { min: 1, max: 65_535 });
  const turnTargetsDir = requirePresent(env, "TURN_TARGETS_DIR");
  if (!turnTargetsDir.startsWith("/") || turnTargetsDir.includes("..")) {
    fail("TURN_TARGETS_DIR must be an absolute non-traversing path");
  }
  const previousTurnSecret = stringEnv(env, "TURN_PREVIOUS_SHARED_SECRET").trim();
  if (previousTurnSecret) {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(previousTurnSecret)) fail("TURN_PREVIOUS_SHARED_SECRET is invalid");
    if (previousTurnSecret === authConfig.turnSharedSecret) fail("TURN_PREVIOUS_SHARED_SECRET must differ from TURN_SHARED_SECRET");
  }

  const segmentBus = segmentBusConfigFromEnv({
    ...env,
    SEGMENT_BUS_USER: env.NATS_INGEST_USER,
    SEGMENT_BUS_PASSWORD: env.NATS_INGEST_PASSWORD
  }, { requireEnabled: true });
  segmentBusConfigFromEnv({
    ...env,
    SEGMENT_BUS_USER: env.NATS_TRACKER_USER,
    SEGMENT_BUS_PASSWORD: env.NATS_TRACKER_PASSWORD
  }, { requireEnabled: true });
  segmentBusConfigFromEnv({
    ...env,
    SEGMENT_BUS_USER: env.NATS_ADMIN_USER,
    SEGMENT_BUS_PASSWORD: env.NATS_ADMIN_PASSWORD
  }, { requireEnabled: true });
  if (!segmentBus.tlsRequired) fail("SEGMENT_BUS_TLS_REQUIRED must be 1 for production");
  if (segmentBus.manageStream) fail("SEGMENT_BUS_MANAGE_STREAM must be 0 for production runtime credentials");
  if (segmentBus.servers.length < 3) fail("SEGMENT_BUS_SERVERS must include at least three cluster endpoints");
  if (segmentBus.replicas !== 3) fail("SEGMENT_BUS_REPLICAS must be 3 for production");
  if (env.NATS_INGEST_USER === env.NATS_TRACKER_USER) fail("NATS ingest and tracker users must be distinct");
  if (env.NATS_INGEST_PASSWORD === env.NATS_TRACKER_PASSWORD) fail("NATS ingest and tracker passwords must be distinct");
  if (new Set([env.NATS_INGEST_USER, env.NATS_TRACKER_USER, env.NATS_ADMIN_USER]).size !== 3) {
    fail("NATS ingest, tracker, and admin users must be distinct");
  }
  if (new Set([env.NATS_INGEST_PASSWORD, env.NATS_TRACKER_PASSWORD, env.NATS_ADMIN_PASSWORD]).size !== 3) {
    fail("NATS ingest, tracker, and admin passwords must be distinct");
  }
  const passwordHashes = [
    requireNatsBcryptConfigValue(env, "NATS_INGEST_PASSWORD_HASH"),
    requireNatsBcryptConfigValue(env, "NATS_TRACKER_PASSWORD_HASH"),
    requireNatsBcryptConfigValue(env, "NATS_ADMIN_PASSWORD_HASH")
  ];
  if (new Set(passwordHashes).size !== 3) fail("NATS ingest, tracker, and admin password hashes must be distinct");

  validateIngestNodes(jsonEnv(env, "INGEST_NODES", []));
  requireSqlitePath(env, "CATALOG_DB_PATH");
  requireSqlitePath(env, "PLACEMENT_DB_PATH");
  const sourcePolicy = sourcePolicyFromEnv(env, { requireAllowedHosts: true });
  if (sourcePolicy.allowPrivateNetworks) fail("SOURCE_ALLOW_PRIVATE_NETWORKS must be 0 for production");
  if (sourcePolicy.allowedHosts.some((host) => host === "*" || host === "*.")) {
    fail("SOURCE_ALLOWED_HOSTS must not use a catch-all wildcard");
  }

  intEnv(env, "TRACKER_MAX_CONNECTIONS", 100_000, { min: 1, max: 1_000_000 });
  intEnv(env, "TRACKER_MAX_PAYLOAD_BYTES", 16_384, { min: 1024, max: 1_048_576 });
  intEnv(env, "TRACKER_MAX_BACKPRESSURE_BYTES", 262_144, { min: 16_384, max: 16_777_216 });
  intEnv(env, "TRACKER_IDLE_TIMEOUT_SECONDS", 120, { min: 9, max: 3600 });
  intEnv(env, "TRACKER_DEMAND_HEARTBEAT_SECONDS", 30, { min: 5, max: 300 });
  intEnv(env, "TRACKER_RATE_LIMIT_CAPACITY", 50, { min: 1, max: 10_000 });
  intEnv(env, "TRACKER_RATE_LIMIT_REFILL_PER_SECOND", 50, { min: 1, max: 10_000 });

  const retentionExecute = boolEnv(env, "RETENTION_EXECUTE", false);
  if (!retentionExecute) fail("RETENTION_EXECUTE must be 1 for production after approval");
  const retentionStoreModule = requirePersistentFilePath(env, "RETENTION_STORE_MODULE", /\.m?js$/i);
  if (retentionStoreModule.includes("retention-http-store")) {
    ownedUrlEnv(env, "RETENTION_STORE_HTTP_BASE_URL", "", { required: true, protocols: ["https:"] });
    requireHexSecret(env, "RETENTION_STORE_HTTP_TOKEN");
    requirePresent(env, "RETENTION_STORE_HTTP_TIMEOUT_MS");
    intEnv(env, "RETENTION_STORE_HTTP_TIMEOUT_MS", 10_000, { min: 100, max: 120_000 });
  }

  requirePersistentFilePath(env, "ALERTMANAGER_CONFIG_PATH", /\.ya?ml$/i);
  validateProductionImages(env);
  return `${file}: Production env OK: ${requiredProductionKeys.length} required keys, ${productionImageKeys.length} digest-pinned images`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-production-env.js [--allow-example] <env-file> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    console.log(validateProductionEnv(parseEnvFile(file), file));
  }
} catch (error) {
  console.error(`Production env validation failed: ${error.message}`);
  process.exit(1);
}
