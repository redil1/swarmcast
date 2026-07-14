import { readFileSync } from "node:fs";
import {
  boolEnv,
  intEnv,
  jsonEnv,
  jwtClaimEnv,
  keyIdEnv,
  ownedUrlEnv,
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
  "SWARMCAST_NODE_EXPORTER_IMAGE"
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
  "SWARMCAST_NODE_EXPORTER_IMAGE"
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
