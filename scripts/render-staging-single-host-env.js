import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

const REQUIRED_KEYS = Object.freeze([
  "INTERNAL_TOKEN",
  "APP_API_KEY",
  "NATS_INGEST_PASSWORD",
  "NATS_TRACKER_PASSWORD",
  "SWARMCAST_PUBLIC_SUFFIX",
  "ORIGIN_BASE",
  "EDGE_BASE",
  "INGEST_NODES",
  "STAGING_M3U_FILE",
  "SOURCE_ALLOWED_HOSTS",
  "SOURCE_ALLOW_PRIVATE_NETWORKS",
  "TURN_ENABLED",
  "TURN_URLS",
  "TURN_SHARED_SECRET",
  "TURN_REALM",
  "TURN_EXTERNAL_IP"
]);

function safeCatalogPath(catalogPath) {
  const resolved = path.resolve(catalogPath || "");
  if (!path.isAbsolute(catalogPath || "")) throw new Error("catalog path must be absolute");
  const stat = lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("catalog must be a regular non-symlink file");
  return resolved;
}

function normalizeSuffix(value) {
  const suffix = String(value || "").trim().toLowerCase();
  if (!suffix || suffix.includes(":") || suffix.includes("/") || suffix.includes("..")) {
    throw new Error("public suffix must be a DNS suffix without scheme, path, or port");
  }
  const url = new URL(`https://origin.${suffix}`);
  if (url.hostname !== `origin.${suffix}`) throw new Error("public suffix is invalid");
  return suffix;
}

export function inspectCatalog(catalogPath) {
  const resolved = safeCatalogPath(catalogPath);
  const lines = readFileSync(resolved, "utf8").split(/\r?\n/);
  const hosts = new Set();
  let entries = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let source;
    try {
      source = new URL(line);
    } catch {
      throw new Error(`catalog entry ${entries + 1} is not an absolute URL`);
    }
    if (!["http:", "https:"].includes(source.protocol) || !source.hostname) {
      throw new Error(`catalog entry ${entries + 1} is not HTTP(S)`);
    }
    if (source.username || source.password) {
      throw new Error(`catalog entry ${entries + 1} contains URL credentials`);
    }
    hosts.add(source.hostname.toLowerCase());
    entries += 1;
  }

  if (entries === 0) throw new Error("catalog contains no HTTP(S) source entries");
  return { catalogPath: resolved, entries, hosts: [...hosts].sort() };
}

function randomHex() {
  return randomBytes(32).toString("hex");
}

function randomPassword() {
  return randomBytes(32).toString("base64url");
}

function turnExternalIp(publicSuffix, explicitIp = "") {
  const suffixIp = publicSuffix.endsWith(".sslip.io")
    ? publicSuffix.slice(0, -".sslip.io".length)
    : "";
  const value = String(explicitIp || suffixIp).trim();
  if (isIP(value) !== 4) {
    throw new Error("TURN external IP must be an explicit public IPv4 address for non-sslip staging");
  }
  return value;
}

function stagingTurnValues({ suffix, externalIp, sharedSecret = randomHex() }) {
  const realm = `origin.${suffix}`;
  return {
    ICE_SERVER_ALLOWED_HOSTS: `stun.l.google.com,stun.cloudflare.com,${realm}`,
    TURN_ENABLED: "1",
    TURN_URLS: JSON.stringify([
      `turn:${realm}:3478?transport=udp`,
      `turn:${realm}:3478?transport=tcp`,
      `turns:${realm}:5349?transport=tcp`
    ]),
    TURN_SHARED_SECRET: sharedSecret,
    TURN_CREDENTIAL_TTL_SECONDS: "3600",
    TURN_REALM: realm,
    TURN_EXTERNAL_IP: externalIp,
    TURN_LISTENING_IP: externalIp,
    TURN_RELAY_IP: externalIp,
    TURN_LISTENING_PORT: "3478",
    TURN_TLS_LISTENING_PORT: "5349",
    TURN_MIN_PORT: "55000",
    TURN_MAX_PORT: "55999",
    TURN_USER_QUOTA: "12",
    TURN_TOTAL_QUOTA: "1000",
    TURN_MAX_BPS: "1250000",
    TURN_BPS_CAPACITY: "100000000",
    TURN_PROMETHEUS_PORT: "9641",
    TURN_PROMETHEUS_ADDRESS: "127.0.0.1",
    TURN_ALLOW_PRIVATE_PEERS: "0"
  };
}

export function stagingEnvValues({ publicSuffix, catalogPath, turnExternalIp: explicitTurnIp = "" }) {
  const suffix = normalizeSuffix(publicSuffix);
  const catalog = inspectCatalog(catalogPath);
  const originBase = `https://origin.${suffix}`;
  const externalIp = turnExternalIp(suffix, explicitTurnIp);

  return {
    INTERNAL_TOKEN: randomHex(),
    APP_API_KEY: randomHex(),
    NATS_INGEST_PASSWORD: randomPassword(),
    NATS_TRACKER_PASSWORD: randomPassword(),
    SWARMCAST_PUBLIC_SUFFIX: suffix,
    ORIGIN_BASE: originBase,
    EDGE_BASE: originBase,
    API_BASE: `https://api.${suffix}`,
    TRACKER_BASE: `wss://tracker.${suffix}/ws`,
    INGEST_NODES: JSON.stringify([{ id: "single-host", baseUrl: originBase, ingestUrl: "http://ingest:7001" }]),
    STAGING_M3U_FILE: catalog.catalogPath,
    SOURCE_ALLOWED_HOSTS: catalog.hosts.join(","),
    SOURCE_ALLOW_PRIVATE_NETWORKS: "0",
    ICE_STUN_URLS: JSON.stringify(["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"]),
    ...stagingTurnValues({ suffix, externalIp }),
    AUTH_PLAY_INTEGRITY_ENABLED: "0",
    SEGMENT_BUS_ENABLED: "1",
    SEGMENT_BUS_SERVERS: JSON.stringify(["nats://segment-bus:4222"]),
    SEGMENT_BUS_TLS_REQUIRED: "0",
    SEGMENT_BUS_MANAGE_STREAM: "1",
    SEGMENT_BUS_REPLICAS: "1",
    CATALOG_DB_PATH: "/data/catalog.sqlite",
    CATALOG_SNAPSHOT_PATH: "/data/catalog-snapshot.json",
    PLACEMENT_DB_PATH: "/data/placements.sqlite",
    RETENTION_EXECUTE: "0",
    RETENTION_RECORDS_FILE: "/data/retention-records.jsonl",
    ALERTMANAGER_CONFIG_PATH: "./monitoring/alertmanager.yml",
    TURN_TARGETS_DIR: "./monitoring/turn-targets",
    TAIL_DOWNSCALE_ENABLED: "1"
  };
}

function serializeEnv(values) {
  return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

function writeSecureAtomic(outputPath, contents, { force = false } = {}) {
  const resolved = path.resolve(outputPath);
  if (!force && existsSync(resolved)) {
    throw new Error(`output already exists: ${resolved}; pass --force to rotate all staging secrets`);
  }
  const tempPath = `${resolved}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    writeFileSync(tempPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, resolved);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

export function parseEnv(text) {
  const values = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`invalid env line ${index + 1}`);
    const key = line.slice(0, separator);
    if (Object.hasOwn(values, key)) throw new Error(`duplicate env key: ${key}`);
    values[key] = line.slice(separator + 1);
  }
  return values;
}

export function validateStagingEnv({ publicSuffix, catalogPath, envPath, turnExternalIp: explicitTurnIp = "" }) {
  const suffix = normalizeSuffix(publicSuffix);
  const catalog = inspectCatalog(catalogPath);
  const resolvedEnv = path.resolve(envPath);
  const stat = lstatSync(resolvedEnv);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("staging env must be a regular non-symlink file");
  if ((stat.mode & 0o077) !== 0) throw new Error("staging env permissions must be 0600");
  const values = parseEnv(readFileSync(resolvedEnv, "utf8"));

  for (const key of REQUIRED_KEYS) {
    if (!values[key]) throw new Error(`staging env is missing ${key}`);
  }
  if (!/^[a-f0-9]{64}$/.test(values.INTERNAL_TOKEN)) throw new Error("INTERNAL_TOKEN must be 64 lowercase hex characters");
  if (!/^[a-f0-9]{64}$/.test(values.APP_API_KEY)) throw new Error("APP_API_KEY must be 64 lowercase hex characters");
  if (values.NATS_INGEST_PASSWORD.length < 32 || values.NATS_TRACKER_PASSWORD.length < 32) {
    throw new Error("segment-bus passwords must contain at least 32 characters");
  }
  if (values.SWARMCAST_PUBLIC_SUFFIX !== suffix) throw new Error("staging suffix does not match requested suffix");
  if (values.STAGING_M3U_FILE !== catalog.catalogPath) throw new Error("staging catalog path does not match requested catalog");
  if (values.SOURCE_ALLOWED_HOSTS !== catalog.hosts.join(",")) throw new Error("source allowlist does not match catalog hosts");
  if (values.SOURCE_ALLOW_PRIVATE_NETWORKS !== "0") throw new Error("real-catalog staging must reject private source networks");
  if (values.ORIGIN_BASE !== `https://origin.${suffix}` || values.EDGE_BASE !== values.ORIGIN_BASE) {
    throw new Error("origin or edge base does not match public suffix");
  }
  if (values.API_BASE && values.API_BASE !== `https://api.${suffix}`) throw new Error("API base does not match public suffix");
  if (values.TRACKER_BASE && values.TRACKER_BASE !== `wss://tracker.${suffix}/ws`) {
    throw new Error("tracker base does not match public suffix");
  }
  const expectedTurn = stagingTurnValues({
    suffix,
    externalIp: turnExternalIp(suffix, explicitTurnIp || values.TURN_EXTERNAL_IP),
    sharedSecret: values.TURN_SHARED_SECRET
  });
  if (!/^[a-f0-9]{64}$/.test(values.TURN_SHARED_SECRET)) {
    throw new Error("TURN_SHARED_SECRET must be 64 lowercase hex characters");
  }
  for (const [key, expected] of Object.entries(expectedTurn)) {
    if (values[key] !== expected) throw new Error(`${key} does not match single-host TURN staging`);
  }
  const nodes = JSON.parse(values.INGEST_NODES);
  if (nodes.length !== 1 || nodes[0].baseUrl !== values.ORIGIN_BASE || nodes[0].ingestUrl !== "http://ingest:7001") {
    throw new Error("single-host ingest placement is invalid");
  }

  return { envPath: resolvedEnv, entries: catalog.entries, sourceHosts: catalog.hosts.length };
}

export function renderStagingEnv({
  publicSuffix,
  catalogPath,
  outputPath,
  force = false,
  turnExternalIp: explicitTurnIp = ""
}) {
  const values = stagingEnvValues({ publicSuffix, catalogPath, turnExternalIp: explicitTurnIp });
  writeSecureAtomic(outputPath, serializeEnv(values), { force });
  return validateStagingEnv({
    publicSuffix,
    catalogPath,
    envPath: outputPath,
    turnExternalIp: explicitTurnIp
  });
}

export function enableStagingTurn({ publicSuffix, catalogPath, outputPath, turnExternalIp: explicitTurnIp = "" }) {
  const suffix = normalizeSuffix(publicSuffix);
  const resolvedEnv = path.resolve(outputPath);
  const stat = lstatSync(resolvedEnv);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("staging env must be a regular non-symlink file");
  if ((stat.mode & 0o077) !== 0) throw new Error("staging env permissions must be 0600");
  const values = parseEnv(readFileSync(resolvedEnv, "utf8"));
  const sharedSecret = /^[a-f0-9]{64}$/.test(values.TURN_SHARED_SECRET || "")
    ? values.TURN_SHARED_SECRET
    : randomHex();
  Object.assign(values, stagingTurnValues({
    suffix,
    externalIp: turnExternalIp(suffix, explicitTurnIp || values.TURN_EXTERNAL_IP),
    sharedSecret
  }));
  writeSecureAtomic(resolvedEnv, serializeEnv(values), { force: true });
  return validateStagingEnv({
    publicSuffix,
    catalogPath,
    envPath: resolvedEnv,
    turnExternalIp: explicitTurnIp
  });
}

function optionsFrom(argv) {
  const options = { force: false, check: false, enableTurn: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force" || arg === "--check") {
      options[arg.slice(2)] = true;
      continue;
    }
    if (arg === "--enable-turn") {
      options.enableTurn = true;
      continue;
    }
    const key = {
      "--public-suffix": "publicSuffix",
      "--catalog": "catalogPath",
      "--output": "outputPath",
      "--turn-external-ip": "turnExternalIp"
    }[arg];
    if (!key || !argv[index + 1]) throw new Error(`unknown or incomplete argument: ${arg}`);
    options[key] = argv[index + 1];
    index += 1;
  }
  if (!options.publicSuffix || !options.catalogPath || !options.outputPath) {
    throw new Error("--public-suffix, --catalog, and --output are required");
  }
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = optionsFrom(process.argv.slice(2));
    const result = options.enableTurn
      ? enableStagingTurn(options)
      : options.check
        ? validateStagingEnv({
          publicSuffix: options.publicSuffix,
          catalogPath: options.catalogPath,
          envPath: options.outputPath,
          turnExternalIp: options.turnExternalIp
        })
        : renderStagingEnv(options);
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
