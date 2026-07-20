import { loadFeatureFlags } from "./flags.js";

export const REQUIRED_ENV_VARS = Object.freeze([
  "INTERNAL_TOKEN",
  "APP_API_KEY",
  "ORIGIN_BASE",
  "EDGE_BASE",
  "API_BASE",
  "TRACKER_BASE"
]);

export const ENV_DEFAULTS = Object.freeze({
  AUTH_KEY_PATH: "/data/es256.pem",
  AUTH_KEY_ID: "swarmcast-1",
  AUTH_PREVIOUS_JWKS_PATH: "",
  AUTH_JWT_AUDIENCE: "swarmcast",
  AUTH_JWT_ISSUER: "swarmcast-auth",
  AUTH_TOKEN_TTL_SECONDS: 21_600,
  AUTH_PLAY_INTEGRITY_ENABLED: false,
  AUTH_PLAY_INTEGRITY_PACKAGE_NAME: "tv.swarmcast",
  AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH: "",
  AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS: [],
  AUTH_PLAY_INTEGRITY_MAX_TOKEN_AGE_SECONDS: 120,
  AUTH_ATTESTATION_CHALLENGE_SECRET: "",
  AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET: "",
  AUTH_ATTESTATION_CHALLENGE_TTL_SECONDS: 120,
  ICE_STUN_URLS: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"],
  ICE_SERVER_ALLOWED_HOSTS: "",
  TURN_ENABLED: false,
  TURN_URLS: [],
  TURN_SHARED_SECRET: "",
  TURN_CREDENTIAL_TTL_SECONDS: 3_600,
  AUTH_PORT: 7003,
  CONTROL_PLANE_PORT: 7010,
  CATALOG_DB_PATH: "",
  CATALOG_SNAPSHOT_PATH: "",
  EDGE_BASE: "https://edge.example.tv",
  FFMPEG_BIN: "ffmpeg",
  HLS_ROOT: "/var/hls",
  IDLE_TEARDOWN_MS: 60_000,
  INGEST_NODES: [{ id: "origin", baseUrl: "https://origin.example.tv" }],
  INGEST_PORT: 7001,
  INGEST_URL: "http://ingest:7001",
  M3U_PATH: "/config/source.m3u",
  MAX_CHANNELS: 140,
  ORIGIN_BASE: "https://origin.example.tv",
  PLACEMENT_DB_PATH: "",
  PLACEMENT_PATH: "",
  RETENTION_ACTION_LOG: "var/retention-actions.jsonl",
  RETENTION_INTERVAL_MS: 86_400_000,
  RETENTION_POLICY_FILE: "config/data-retention.json",
  RETENTION_RECORDS_FILE: "test-fixtures/retention/records.jsonl",
  RETENTION_RUN_ON_START: true,
  RETENTION_WORKER_PORT: 7020,
  RESTART_BACKOFF_MS: [1000, 2000, 5000, 10000, 30000],
  RLNC_K: 32,
  SEGMENT_SECONDS: 2,
  SOURCE_ALLOWED_HOSTS: "",
  SOURCE_ALLOW_PRIVATE_NETWORKS: false,
  TAIL_IDLE_TEARDOWN_MS: 15_000,
  TAIL_ADMISSION_MAX_CHANNELS: 0,
  TAIL_DOWNSCALE_AUDIO_KBPS: 64,
  TAIL_DOWNSCALE_VIDEO_KBPS: 900,
  TAIL_SWARM_THRESHOLD: 5,
  TRACKER_DEMAND_HEARTBEAT_SECONDS: 30,
  TRACKER_INTERNAL_PORT: 7002,
  TRACKER_INTERNAL_URL: "http://tracker:7002",
  TRACKER_INTERNAL_URLS: [],
  TRACKER_IDLE_TIMEOUT_SECONDS: 120,
  TRACKER_MAX_BACKPRESSURE_BYTES: 256 * 1024,
  TRACKER_CELL_MAX_PEERS: 20_000,
  TRACKER_MAX_CONNECTIONS: 100_000,
  TRACKER_MAX_PAYLOAD_BYTES: 16 * 1024,
  TRACKER_PORT: 7000,
  TRACKER_RATE_LIMIT_CAPACITY: 50,
  TRACKER_RATE_LIMIT_REFILL_PER_SECOND: 50,
  TRACKER_SHARD_ID: "",
  TRACKER_SHARDS: [],
  AUTH_JWKS_URL: "http://auth:7003/jwks",
  WINDOW_SEGMENTS: 30
});

const FORBIDDEN_CDN_HOST_PARTS = Object.freeze(["cloudfront", "akamai", "fastly"]);

export class ConfigError extends Error {
  constructor(message, { key } = {}) {
    super(message);
    this.name = "ConfigError";
    this.key = key;
  }
}

export function stringEnv(env, key, fallback = "") {
  const value = env[key];
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return String(value);
}

export function requiredEnv(env, key) {
  const value = stringEnv(env, key);
  if (!value) throw new ConfigError(`${key} is required`, { key });
  return value;
}

export function intEnv(env, key, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = stringEnv(env, key, String(fallback));
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${key} must be an integer between ${min} and ${max}`, { key });
  }
  return value;
}

export function boolEnv(env, key, fallback) {
  const raw = stringEnv(env, key);
  if (!raw) return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  throw new ConfigError(`${key} must be 1, 0, true, or false`, { key });
}

export function urlEnv(env, key, fallback, { required = false, protocols = ["http:", "https:", "ws:", "wss:"] } = {}) {
  const raw = required ? requiredEnv(env, key) : stringEnv(env, key, fallback);
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError(`${key} must be a valid URL`, { key });
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new ConfigError(`${key} must use one of: ${protocols.join(", ")}`, { key });
  }
  return raw.replace(/\/+$/, "");
}

export function jsonEnv(env, key, fallback) {
  const raw = stringEnv(env, key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ConfigError(`${key} must contain valid JSON`, { key });
  }
}

export function keyIdEnv(env, key = "AUTH_KEY_ID", fallback = ENV_DEFAULTS.AUTH_KEY_ID) {
  const value = stringEnv(env, key, fallback).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new ConfigError(`${key} must be 1-128 characters of letters, numbers, dot, underscore, colon, or hyphen and start with a letter or number`, { key });
  }
  return value;
}

export function jwtClaimEnv(env, key, fallback) {
  const value = stringEnv(env, key, fallback).trim();
  if (!value || value.length > 256 || /\s/.test(value)) {
    throw new ConfigError(`${key} must be a non-empty JWT claim string without whitespace`, { key });
  }
  return value;
}

function assertNoThirdPartyCdnHost(value, key) {
  const hostname = new URL(value).hostname.toLowerCase();
  const provider = FORBIDDEN_CDN_HOST_PARTS.find((part) => hostname.includes(part));
  if (provider) {
    throw new ConfigError(`${key} must not point to a third-party CDN provider`, { key });
  }
  return value;
}

function normalizedUrlValue(value, key, { protocols = ["http:", "https:"], rejectThirdPartyCdn = false } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${key} must be a non-empty URL`, { key });
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`${key} must be a valid URL`, { key });
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new ConfigError(`${key} must use one of: ${protocols.join(", ")}`, { key });
  }
  const normalized = value.replace(/\/+$/, "");
  return rejectThirdPartyCdn ? assertNoThirdPartyCdnHost(normalized, key) : normalized;
}

export function ownedUrlEnv(env, key, fallback, options = {}) {
  const raw = options.required ? requiredEnv(env, key) : stringEnv(env, key, fallback);
  if (!raw) return "";
  return normalizedUrlValue(raw, key, { ...options, rejectThirdPartyCdn: true });
}

export function parseSourceAllowedHosts(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => item.replace(/^\*\./, "*."));
}

function parseIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((part, index) => !/^\d+$/.test(parts[index]) || part < 0 || part > 255)) return null;
  return octets;
}

function isPrivateSourceHostname(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;

  const ipv4 = parseIpv4(host);
  if (!ipv4) return false;
  const [a, b] = ipv4;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127);
}

function sourceHostAllowed(hostname, allowedHosts) {
  if (!allowedHosts.length) return true;
  const host = hostname.toLowerCase();
  return allowedHosts.some((pattern) => {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === pattern;
  });
}

export function validateIceServerUrls(urls, key, {
  allowedSchemes,
  allowedHosts = []
} = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new ConfigError(`${key} must be a non-empty JSON array`, { key });
  }
  const schemes = new Set(allowedSchemes || ["stun", "stuns", "turn", "turns"]);
  const seen = new Set();

  return urls.map((value, index) => {
    const itemKey = `${key}[${index}]`;
    if (typeof value !== "string" || value.trim() !== value || value.length > 512) {
      throw new ConfigError(`${itemKey} must be a trimmed ICE server URL`, { key });
    }
    const match = value.match(/^([a-z]+):(\[[^\]]+\]|[^/?#:@]+)(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/i);
    if (!match) {
      throw new ConfigError(`${itemKey} must be a valid STUN or TURN URL without credentials, path, or fragment`, { key });
    }
    const [, rawScheme, rawHost, rawPort, rawTransport] = match;
    const scheme = rawScheme.toLowerCase();
    const transport = rawTransport?.toLowerCase();
    if (!schemes.has(scheme)) {
      throw new ConfigError(`${itemKey} must use one of: ${[...schemes].join(", ")}`, { key });
    }
    if ((scheme === "stuns" || scheme === "turns") && transport === "udp") {
      throw new ConfigError(`${itemKey} cannot use UDP transport with ${scheme}`, { key });
    }
    if (rawPort) {
      const port = Number.parseInt(rawPort, 10);
      if (port < 1 || port > 65_535) throw new ConfigError(`${itemKey} has an invalid port`, { key });
    }
    const hostname = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
    if (!hostname || !sourceHostAllowed(hostname, allowedHosts)) {
      throw new ConfigError(`${itemKey} host is not in ICE_SERVER_ALLOWED_HOSTS`, { key });
    }
    const normalizedHost = rawHost.startsWith("[") ? `[${hostname}]` : hostname;
    const normalized = `${scheme}:${normalizedHost}${rawPort ? `:${rawPort}` : ""}${transport ? `?transport=${transport}` : ""}`;
    if (seen.has(normalized)) throw new ConfigError(`${key} contains duplicate URL ${normalized}`, { key });
    seen.add(normalized);
    return normalized;
  });
}

export function sourcePolicyFromEnv(env = process.env, { requireAllowedHosts = false } = {}) {
  const allowedHosts = parseSourceAllowedHosts(stringEnv(env, "SOURCE_ALLOWED_HOSTS", ENV_DEFAULTS.SOURCE_ALLOWED_HOSTS));
  if (requireAllowedHosts && allowedHosts.length === 0) {
    throw new ConfigError("SOURCE_ALLOWED_HOSTS is required when production validation is enabled", { key: "SOURCE_ALLOWED_HOSTS" });
  }
  return {
    allowedHosts,
    allowPrivateNetworks: boolEnv(env, "SOURCE_ALLOW_PRIVATE_NETWORKS", ENV_DEFAULTS.SOURCE_ALLOW_PRIVATE_NETWORKS)
  };
}

export function validateSourceUrl(sourceUrl, policy = {}, key = "SOURCE_URL") {
  const raw = String(sourceUrl || "").trim();
  if (!raw) throw new ConfigError(`${key} must be a non-empty URL`, { key });

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError(`${key} must be a valid URL`, { key });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ConfigError(`${key} must use http or https`, { key });
  }
  if (parsed.username || parsed.password) {
    throw new ConfigError(`${key} must not include URL credentials`, { key });
  }

  const allowedHosts = Array.isArray(policy.allowedHosts) ? policy.allowedHosts : [];
  const allowPrivateNetworks = Boolean(policy.allowPrivateNetworks);
  if (!allowPrivateNetworks && isPrivateSourceHostname(parsed.hostname)) {
    throw new ConfigError(`${key} must not point to a private or loopback network`, { key });
  }
  if (!sourceHostAllowed(parsed.hostname, allowedHosts)) {
    throw new ConfigError(`${key} host is not in SOURCE_ALLOWED_HOSTS`, { key });
  }

  return raw;
}

export function validateIngestNodes(nodes, key = "INGEST_NODES") {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new ConfigError(`${key} must be a non-empty array`, { key });
  }

  const ids = new Set();
  return nodes.map((node, index) => {
    const idKey = `${key}[${index}].id`;
    const baseUrlKey = `${key}[${index}].baseUrl`;
    const ingestUrlKey = `${key}[${index}].ingestUrl`;
    const id = typeof node?.id === "string" ? node.id.trim() : "";

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
      throw new ConfigError(`${idKey} must be 1-64 characters of letters, numbers, dot, underscore, or hyphen and start with a letter or number`, { key: idKey });
    }
    if (ids.has(id)) throw new ConfigError(`${key} contains duplicate node id: ${id}`, { key });
    ids.add(id);

    const normalized = {
      id,
      baseUrl: normalizedUrlValue(node.baseUrl, baseUrlKey, { rejectThirdPartyCdn: true })
    };

    if (node.ingestUrl !== undefined && node.ingestUrl !== null && String(node.ingestUrl).trim() !== "") {
      normalized.ingestUrl = normalizedUrlValue(node.ingestUrl, ingestUrlKey);
    }

    return normalized;
  });
}

export function validateTrackerShardId(value, key = "TRACKER_SHARD_ID") {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new ConfigError(`${key} must be 1-64 characters of letters, numbers, dot, underscore, or hyphen and start with a letter or number`, { key });
  }
  return id;
}

export function validateTrackerShards(shards, key = "TRACKER_SHARDS") {
  if (!Array.isArray(shards)) {
    throw new ConfigError(`${key} must be an array`, { key });
  }

  const ids = new Set();
  return shards.map((shard, index) => {
    const idKey = `${key}[${index}].id`;
    const wsUrlKey = `${key}[${index}].wsUrl`;
    const id = validateTrackerShardId(shard?.id, idKey);
    if (ids.has(id)) throw new ConfigError(`${key} contains duplicate shard id: ${id}`, { key });
    ids.add(id);

    const normalized = {
      id,
      wsUrl: normalizedUrlValue(shard?.wsUrl, wsUrlKey, {
        protocols: ["ws:", "wss:"],
        rejectThirdPartyCdn: true
      })
    };
    if (shard?.internalUrl) {
      normalized.internalUrl = normalizedUrlValue(shard.internalUrl, `${key}[${index}].internalUrl`, {
        protocols: ["http:", "https:"],
        rejectThirdPartyCdn: true
      });
    }
    if (shard?.region) {
      const region = String(shard.region).trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(region)) {
        throw new ConfigError(`${key}[${index}].region must be a valid region identifier`, { key });
      }
      normalized.region = region;
    }
    return normalized;
  });
}

export function parseDotEnvExample(text) {
  const values = new Set();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=/);
    if (match) values.add(match[1]);
  }
  return values;
}

export function missingRequiredEnvExampleKeys(text, requiredKeys = REQUIRED_ENV_VARS) {
  const keys = parseDotEnvExample(text);
  return requiredKeys.filter((key) => !keys.has(key));
}

export function loadAuthConfig(env = process.env, { requireSecrets = false } = {}) {
  const appApiKey = requireSecrets ? requiredEnv(env, "APP_API_KEY") : stringEnv(env, "APP_API_KEY");
  const tokenTtlSeconds = intEnv(env, "AUTH_TOKEN_TTL_SECONDS", ENV_DEFAULTS.AUTH_TOKEN_TTL_SECONDS, { min: 300, max: 86_400 });
  const playIntegrityEnabled = boolEnv(env, "AUTH_PLAY_INTEGRITY_ENABLED", ENV_DEFAULTS.AUTH_PLAY_INTEGRITY_ENABLED);
  const playIntegrityPackageName = stringEnv(
    env,
    "AUTH_PLAY_INTEGRITY_PACKAGE_NAME",
    ENV_DEFAULTS.AUTH_PLAY_INTEGRITY_PACKAGE_NAME
  ).trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(playIntegrityPackageName)) {
    throw new ConfigError("AUTH_PLAY_INTEGRITY_PACKAGE_NAME must be a valid Android package name", {
      key: "AUTH_PLAY_INTEGRITY_PACKAGE_NAME"
    });
  }
  const playIntegrityServiceAccountPath = playIntegrityEnabled
    ? requiredEnv(env, "AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH").trim()
    : stringEnv(env, "AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH").trim();
  const playIntegrityCertificateDigestsInput = jsonEnv(
    env,
    "AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS",
    ENV_DEFAULTS.AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS
  );
  if (!Array.isArray(playIntegrityCertificateDigestsInput)) {
    throw new ConfigError("AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS must be a JSON array", {
      key: "AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS"
    });
  }
  const playIntegrityCertificateDigests = [...new Set(playIntegrityCertificateDigestsInput.map((value, index) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
      throw new ConfigError(`AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS[${index}] must be an unpadded base64url SHA-256 digest`, {
        key: "AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS"
      });
    }
    return value;
  }))];
  if (playIntegrityEnabled && playIntegrityCertificateDigests.length === 0) {
    throw new ConfigError("AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS must not be empty when Play Integrity is enabled", {
      key: "AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS"
    });
  }
  const playIntegrityMaxTokenAgeSeconds = intEnv(
    env,
    "AUTH_PLAY_INTEGRITY_MAX_TOKEN_AGE_SECONDS",
    ENV_DEFAULTS.AUTH_PLAY_INTEGRITY_MAX_TOKEN_AGE_SECONDS,
    { min: 30, max: 300 }
  );
  const attestationChallengeSecret = playIntegrityEnabled
    ? requiredEnv(env, "AUTH_ATTESTATION_CHALLENGE_SECRET").trim()
    : stringEnv(env, "AUTH_ATTESTATION_CHALLENGE_SECRET").trim();
  if (playIntegrityEnabled && !/^[A-Za-z0-9_-]{32,256}$/.test(attestationChallengeSecret)) {
    throw new ConfigError("AUTH_ATTESTATION_CHALLENGE_SECRET must be 32-256 URL-safe characters", {
      key: "AUTH_ATTESTATION_CHALLENGE_SECRET"
    });
  }
  const attestationPreviousChallengeSecret = stringEnv(
    env,
    "AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET",
    ENV_DEFAULTS.AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET
  ).trim();
  if (attestationPreviousChallengeSecret && !/^[A-Za-z0-9_-]{32,256}$/.test(attestationPreviousChallengeSecret)) {
    throw new ConfigError("AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET must be 32-256 URL-safe characters", {
      key: "AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET"
    });
  }
  if (attestationPreviousChallengeSecret && attestationPreviousChallengeSecret === attestationChallengeSecret) {
    throw new ConfigError("AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET must differ from the current secret", {
      key: "AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET"
    });
  }
  const attestationChallengeTtlSeconds = intEnv(
    env,
    "AUTH_ATTESTATION_CHALLENGE_TTL_SECONDS",
    ENV_DEFAULTS.AUTH_ATTESTATION_CHALLENGE_TTL_SECONDS,
    { min: 30, max: 300 }
  );
  if (playIntegrityEnabled && attestationChallengeTtlSeconds > playIntegrityMaxTokenAgeSeconds) {
    throw new ConfigError(
      "AUTH_ATTESTATION_CHALLENGE_TTL_SECONDS must not exceed AUTH_PLAY_INTEGRITY_MAX_TOKEN_AGE_SECONDS",
      { key: "AUTH_ATTESTATION_CHALLENGE_TTL_SECONDS" }
    );
  }
  const iceServerAllowedHosts = parseSourceAllowedHosts(stringEnv(env, "ICE_SERVER_ALLOWED_HOSTS", ENV_DEFAULTS.ICE_SERVER_ALLOWED_HOSTS));
  if (requireSecrets && iceServerAllowedHosts.length === 0) {
    throw new ConfigError("ICE_SERVER_ALLOWED_HOSTS is required when production validation is enabled", { key: "ICE_SERVER_ALLOWED_HOSTS" });
  }
  const stunUrls = validateIceServerUrls(
    jsonEnv(env, "ICE_STUN_URLS", ENV_DEFAULTS.ICE_STUN_URLS),
    "ICE_STUN_URLS",
    { allowedSchemes: ["stun", "stuns"], allowedHosts: iceServerAllowedHosts }
  );
  const turnEnabled = boolEnv(env, "TURN_ENABLED", ENV_DEFAULTS.TURN_ENABLED);
  const turnUrlsInput = jsonEnv(env, "TURN_URLS", ENV_DEFAULTS.TURN_URLS);
  const turnUrls = turnEnabled
    ? validateIceServerUrls(turnUrlsInput, "TURN_URLS", {
      allowedSchemes: ["turn", "turns"],
      allowedHosts: iceServerAllowedHosts
    })
    : [];
  const turnSharedSecret = turnEnabled
    ? requiredEnv(env, "TURN_SHARED_SECRET").trim()
    : stringEnv(env, "TURN_SHARED_SECRET").trim();
  if (turnEnabled && !/^[A-Za-z0-9_-]{32,256}$/.test(turnSharedSecret)) {
    throw new ConfigError("TURN_SHARED_SECRET must be 32-256 URL-safe characters", { key: "TURN_SHARED_SECRET" });
  }
  const turnCredentialTtlSeconds = intEnv(
    env,
    "TURN_CREDENTIAL_TTL_SECONDS",
    ENV_DEFAULTS.TURN_CREDENTIAL_TTL_SECONDS,
    { min: 300, max: 86_400 }
  );
  if (turnEnabled && turnCredentialTtlSeconds > tokenTtlSeconds) {
    throw new ConfigError("TURN_CREDENTIAL_TTL_SECONDS must not exceed AUTH_TOKEN_TTL_SECONDS", { key: "TURN_CREDENTIAL_TTL_SECONDS" });
  }
  return {
    keyPath: stringEnv(env, "AUTH_KEY_PATH", ENV_DEFAULTS.AUTH_KEY_PATH),
    keyId: keyIdEnv(env, "AUTH_KEY_ID", ENV_DEFAULTS.AUTH_KEY_ID),
    previousJwksPath: stringEnv(env, "AUTH_PREVIOUS_JWKS_PATH", ENV_DEFAULTS.AUTH_PREVIOUS_JWKS_PATH),
    jwtAudience: jwtClaimEnv(env, "AUTH_JWT_AUDIENCE", ENV_DEFAULTS.AUTH_JWT_AUDIENCE),
    jwtIssuer: jwtClaimEnv(env, "AUTH_JWT_ISSUER", ENV_DEFAULTS.AUTH_JWT_ISSUER),
    tokenTtlSeconds,
    playIntegrityEnabled,
    playIntegrityPackageName,
    playIntegrityServiceAccountPath,
    playIntegrityCertificateDigests,
    playIntegrityMaxTokenAgeSeconds,
    attestationChallengeSecret,
    attestationPreviousChallengeSecret,
    attestationChallengeTtlSeconds,
    stunUrls,
    iceServerAllowedHosts,
    turnEnabled,
    turnUrls,
    turnSharedSecret,
    turnCredentialTtlSeconds,
    appApiKey,
    port: intEnv(env, "AUTH_PORT", ENV_DEFAULTS.AUTH_PORT, { min: 1, max: 65535 })
  };
}

export function loadIngestConfig(env = process.env, { requireSecrets = false } = {}) {
  const internalToken = requireSecrets ? requiredEnv(env, "INTERNAL_TOKEN") : stringEnv(env, "INTERNAL_TOKEN");
  const flags = loadFeatureFlags(env);
  const trackerInternalUrl = urlEnv(env, "TRACKER_INTERNAL_URL", ENV_DEFAULTS.TRACKER_INTERNAL_URL, { protocols: ["http:", "https:"] });
  const trackerInternalUrlsInput = jsonEnv(env, "TRACKER_INTERNAL_URLS", ENV_DEFAULTS.TRACKER_INTERNAL_URLS);
  if (!Array.isArray(trackerInternalUrlsInput)) {
    throw new ConfigError("TRACKER_INTERNAL_URLS must be a JSON array", { key: "TRACKER_INTERNAL_URLS" });
  }
  const trackerInternalUrls = trackerInternalUrlsInput.length > 0
    ? [...new Set(trackerInternalUrlsInput.map((value, index) => normalizedUrlValue(
      value,
      `TRACKER_INTERNAL_URLS[${index}]`,
      { protocols: ["http:", "https:"], rejectThirdPartyCdn: true }
    )))]
    : [trackerInternalUrl];
  return {
    m3uPath: stringEnv(env, "M3U_PATH", ENV_DEFAULTS.M3U_PATH),
    hlsRoot: stringEnv(env, "HLS_ROOT", ENV_DEFAULTS.HLS_ROOT),
    maxChannels: intEnv(env, "MAX_CHANNELS", ENV_DEFAULTS.MAX_CHANNELS, { min: 1, max: 10000 }),
    idleTeardownMs: intEnv(env, "IDLE_TEARDOWN_MS", ENV_DEFAULTS.IDLE_TEARDOWN_MS, { min: 1 }),
    tailIdleTeardownMs: intEnv(env, "TAIL_IDLE_TEARDOWN_MS", ENV_DEFAULTS.TAIL_IDLE_TEARDOWN_MS, { min: 1 }),
    tailSwarmThreshold: intEnv(env, "TAIL_SWARM_THRESHOLD", ENV_DEFAULTS.TAIL_SWARM_THRESHOLD, { min: 1 }),
    tailAdmissionMaxChannels: intEnv(env, "TAIL_ADMISSION_MAX_CHANNELS", ENV_DEFAULTS.TAIL_ADMISSION_MAX_CHANNELS, { min: 0, max: 10000 }),
    tailDownscaleEnabled: flags.tailDownscaleEnabled,
    tailDownscaleVideoKbps: intEnv(env, "TAIL_DOWNSCALE_VIDEO_KBPS", ENV_DEFAULTS.TAIL_DOWNSCALE_VIDEO_KBPS, { min: 100, max: 10000 }),
    tailDownscaleAudioKbps: intEnv(env, "TAIL_DOWNSCALE_AUDIO_KBPS", ENV_DEFAULTS.TAIL_DOWNSCALE_AUDIO_KBPS, { min: 16, max: 512 }),
    segmentSeconds: intEnv(env, "SEGMENT_SECONDS", ENV_DEFAULTS.SEGMENT_SECONDS, { min: 1 }),
    windowSegments: intEnv(env, "WINDOW_SEGMENTS", ENV_DEFAULTS.WINDOW_SEGMENTS, { min: 1 }),
    sourcePolicy: sourcePolicyFromEnv(env, { requireAllowedHosts: requireSecrets }),
    restApiPort: intEnv(env, "INGEST_PORT", ENV_DEFAULTS.INGEST_PORT, { min: 1, max: 65535 }),
    trackerInternalUrl,
    trackerInternalUrls,
    internalToken,
    ffmpegBin: stringEnv(env, "FFMPEG_BIN", ENV_DEFAULTS.FFMPEG_BIN),
    restartBackoffMs: ENV_DEFAULTS.RESTART_BACKOFF_MS,
    rlncK: intEnv(env, "RLNC_K", ENV_DEFAULTS.RLNC_K, { min: 1, max: 255 })
  };
}

export function loadTrackerConfig(env = process.env, { requireSecrets = false } = {}) {
  const idleTimeoutSeconds = intEnv(env, "TRACKER_IDLE_TIMEOUT_SECONDS", ENV_DEFAULTS.TRACKER_IDLE_TIMEOUT_SECONDS, { min: 0 });
  if (idleTimeoutSeconds !== 0 && idleTimeoutSeconds <= 8) {
    throw new ConfigError("TRACKER_IDLE_TIMEOUT_SECONDS must be 0 or greater than 8", { key: "TRACKER_IDLE_TIMEOUT_SECONDS" });
  }
  const trackerShards = validateTrackerShards(jsonEnv(env, "TRACKER_SHARDS", ENV_DEFAULTS.TRACKER_SHARDS));
  const trackerShardId = stringEnv(env, "TRACKER_SHARD_ID", ENV_DEFAULTS.TRACKER_SHARD_ID).trim();
  if (trackerShards.length > 0) {
    const normalizedShardId = validateTrackerShardId(trackerShardId);
    if (!trackerShards.some((shard) => shard.id === normalizedShardId)) {
      throw new ConfigError("TRACKER_SHARD_ID must match one of TRACKER_SHARDS", { key: "TRACKER_SHARD_ID" });
    }
  } else if (trackerShardId) {
    validateTrackerShardId(trackerShardId);
  }

  return {
    port: intEnv(env, "TRACKER_PORT", ENV_DEFAULTS.TRACKER_PORT, { min: 1, max: 65535 }),
    internalPort: intEnv(env, "TRACKER_INTERNAL_PORT", ENV_DEFAULTS.TRACKER_INTERNAL_PORT, { min: 1, max: 65535 }),
    internalToken: requireSecrets ? requiredEnv(env, "INTERNAL_TOKEN") : stringEnv(env, "INTERNAL_TOKEN"),
    ingestUrl: urlEnv(env, "INGEST_URL", ENV_DEFAULTS.INGEST_URL, { protocols: ["http:", "https:"] }),
    authJwksUrl: urlEnv(env, "AUTH_JWKS_URL", ENV_DEFAULTS.AUTH_JWKS_URL, { protocols: ["http:", "https:"] }),
    authJwtAudience: jwtClaimEnv(env, "AUTH_JWT_AUDIENCE", ENV_DEFAULTS.AUTH_JWT_AUDIENCE),
    authJwtIssuer: jwtClaimEnv(env, "AUTH_JWT_ISSUER", ENV_DEFAULTS.AUTH_JWT_ISSUER),
    originBase: ownedUrlEnv(env, "ORIGIN_BASE", ENV_DEFAULTS.ORIGIN_BASE, { protocols: ["http:", "https:"] }),
    edgeBase: ownedUrlEnv(env, "EDGE_BASE", ENV_DEFAULTS.EDGE_BASE, { protocols: ["http:", "https:"] }),
    controlPlaneUrl: urlEnv(env, "CONTROL_PLANE_URL", "", { protocols: ["http:", "https:"] }),
    maxPayloadBytes: intEnv(env, "TRACKER_MAX_PAYLOAD_BYTES", ENV_DEFAULTS.TRACKER_MAX_PAYLOAD_BYTES, { min: 1024 }),
    maxBackpressureBytes: intEnv(env, "TRACKER_MAX_BACKPRESSURE_BYTES", ENV_DEFAULTS.TRACKER_MAX_BACKPRESSURE_BYTES, { min: 1024 }),
    cellMaxPeers: intEnv(env, "TRACKER_CELL_MAX_PEERS", ENV_DEFAULTS.TRACKER_CELL_MAX_PEERS, { min: 2 }),
    maxConnections: intEnv(env, "TRACKER_MAX_CONNECTIONS", ENV_DEFAULTS.TRACKER_MAX_CONNECTIONS, { min: 1 }),
    idleTimeoutSeconds,
    demandHeartbeatSeconds: intEnv(env, "TRACKER_DEMAND_HEARTBEAT_SECONDS", ENV_DEFAULTS.TRACKER_DEMAND_HEARTBEAT_SECONDS, { min: 1 }),
    rateLimitCapacity: intEnv(env, "TRACKER_RATE_LIMIT_CAPACITY", ENV_DEFAULTS.TRACKER_RATE_LIMIT_CAPACITY, { min: 1 }),
    rateLimitRefillPerSecond: intEnv(env, "TRACKER_RATE_LIMIT_REFILL_PER_SECOND", ENV_DEFAULTS.TRACKER_RATE_LIMIT_REFILL_PER_SECOND, { min: 1 }),
    trackerShardId,
    trackerShards
  };
}

export function loadControlPlaneConfig(env = process.env, { requireSecrets = false } = {}) {
  const internalToken = requireSecrets ? requiredEnv(env, "INTERNAL_TOKEN") : stringEnv(env, "INTERNAL_TOKEN");
  return {
    port: intEnv(env, "CONTROL_PLANE_PORT", ENV_DEFAULTS.CONTROL_PLANE_PORT, { min: 1, max: 65535 }),
    m3uPath: stringEnv(env, "M3U_PATH", ENV_DEFAULTS.M3U_PATH),
    catalogDbPath: stringEnv(env, "CATALOG_DB_PATH", ENV_DEFAULTS.CATALOG_DB_PATH),
    catalogSnapshotPath: stringEnv(env, "CATALOG_SNAPSHOT_PATH", ENV_DEFAULTS.CATALOG_SNAPSHOT_PATH),
    internalToken,
    placementPath: stringEnv(env, "PLACEMENT_PATH", ENV_DEFAULTS.PLACEMENT_PATH),
    placementDbPath: stringEnv(env, "PLACEMENT_DB_PATH", ENV_DEFAULTS.PLACEMENT_DB_PATH),
    ingestNodes: validateIngestNodes(jsonEnv(env, "INGEST_NODES", ENV_DEFAULTS.INGEST_NODES)),
    sourcePolicy: sourcePolicyFromEnv(env, { requireAllowedHosts: requireSecrets })
  };
}

export function loadRetentionWorkerConfig(env = process.env) {
  const execute = env.RETENTION_EXECUTE === "1";
  const storeModule = stringEnv(env, "RETENTION_STORE_MODULE");
  if (execute && !storeModule) {
    throw new ConfigError("RETENTION_STORE_MODULE is required when RETENTION_EXECUTE=1", { key: "RETENTION_STORE_MODULE" });
  }

  return {
    port: intEnv(env, "RETENTION_WORKER_PORT", ENV_DEFAULTS.RETENTION_WORKER_PORT, { min: 1, max: 65535 }),
    intervalMs: intEnv(env, "RETENTION_INTERVAL_MS", ENV_DEFAULTS.RETENTION_INTERVAL_MS, { min: 1000 }),
    runOnStart: boolEnv(env, "RETENTION_RUN_ON_START", ENV_DEFAULTS.RETENTION_RUN_ON_START),
    policyFile: stringEnv(env, "RETENTION_POLICY_FILE", ENV_DEFAULTS.RETENTION_POLICY_FILE),
    storeModule,
    recordsFile: stringEnv(env, "RETENTION_RECORDS_FILE", ENV_DEFAULTS.RETENTION_RECORDS_FILE),
    actionLogFile: stringEnv(env, "RETENTION_ACTION_LOG", ENV_DEFAULTS.RETENTION_ACTION_LOG),
    dryRun: !execute
  };
}
