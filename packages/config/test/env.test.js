import test from "node:test";
import assert from "node:assert/strict";
import {
  ConfigError,
  boolEnv,
  intEnv,
  loadAuthConfig,
  loadControlPlaneConfig,
  loadIngestConfig,
  loadRetentionWorkerConfig,
  loadTrackerConfig,
  missingRequiredEnvExampleKeys,
  ownedUrlEnv,
  parseSourceAllowedHosts,
  sourcePolicyFromEnv,
  validateIceServerUrls,
  validateTrackerShards,
  validateSourceUrl,
  urlEnv
} from "../src/env.js";

test("missingRequiredEnvExampleKeys validates env example coverage", () => {
  const text = [
    "INTERNAL_TOKEN=x",
    "APP_API_KEY=x",
    "ORIGIN_BASE=https://origin.example.tv",
    "EDGE_BASE=https://edge.example.tv",
    "API_BASE=https://api.example.tv",
    "TRACKER_BASE=wss://tracker.example.tv/ws"
  ].join("\n");

  assert.deepEqual(missingRequiredEnvExampleKeys(text), []);
  assert.deepEqual(missingRequiredEnvExampleKeys("INTERNAL_TOKEN=x"), [
    "APP_API_KEY",
    "ORIGIN_BASE",
    "EDGE_BASE",
    "API_BASE",
    "TRACKER_BASE"
  ]);
});

test("intEnv rejects invalid ports", () => {
  assert.equal(intEnv({ PORT: "7000" }, "PORT", 1, { min: 1, max: 65535 }), 7000);
  assert.throws(() => intEnv({ PORT: "abc" }, "PORT", 1), ConfigError);
  assert.throws(() => intEnv({ PORT: "99999" }, "PORT", 1, { min: 1, max: 65535 }), ConfigError);
});

test("urlEnv trims trailing slashes and validates protocol", () => {
  assert.equal(urlEnv({ EDGE_BASE: "https://edge.example.tv///" }, "EDGE_BASE", ""), "https://edge.example.tv");
  assert.throws(() => urlEnv({ EDGE_BASE: "ftp://edge.example.tv" }, "EDGE_BASE", ""), ConfigError);
  assert.throws(() => urlEnv({ EDGE_BASE: "not-a-url" }, "EDGE_BASE", ""), ConfigError);
});

test("ownedUrlEnv rejects known third-party CDN hosts", () => {
  assert.equal(ownedUrlEnv({ EDGE_BASE: "https://edge.example.tv/" }, "EDGE_BASE", ""), "https://edge.example.tv");
  assert.throws(() => ownedUrlEnv({ EDGE_BASE: "https://d123.cloudfront.net" }, "EDGE_BASE", ""), /third-party CDN/);
  assert.throws(() => ownedUrlEnv({ ORIGIN_BASE: "https://video.akamaihd.net" }, "ORIGIN_BASE", ""), /third-party CDN/);
  assert.throws(() => ownedUrlEnv({ ORIGIN_BASE: "https://stream.global.fastly.net" }, "ORIGIN_BASE", ""), /third-party CDN/);
});

test("boolEnv parses explicit booleans", () => {
  assert.equal(boolEnv({ ENABLED: "1" }, "ENABLED", false), true);
  assert.equal(boolEnv({ ENABLED: "false" }, "ENABLED", true), false);
  assert.throws(() => boolEnv({ ENABLED: "sometimes" }, "ENABLED", false), ConfigError);
});

test("service config loaders preserve current defaults", () => {
  assert.equal(loadAuthConfig().port, 7003);
  assert.equal(loadAuthConfig().keyId, "swarmcast-1");
  assert.equal(loadAuthConfig().previousJwksPath, "");
  assert.equal(loadAuthConfig().jwtAudience, "swarmcast");
  assert.equal(loadAuthConfig().jwtIssuer, "swarmcast-auth");
  assert.equal(loadAuthConfig().tokenTtlSeconds, 21_600);
  assert.equal(loadAuthConfig().playIntegrityEnabled, false);
  assert.equal(loadAuthConfig().playIntegrityPackageName, "tv.swarmcast");
  assert.deepEqual(loadAuthConfig().playIntegrityCertificateDigests, []);
  assert.equal(loadAuthConfig().attestationChallengeTtlSeconds, 120);
  assert.deepEqual(loadAuthConfig().stunUrls, [
    "stun:stun.l.google.com:19302",
    "stun:stun.cloudflare.com:3478"
  ]);
  assert.equal(loadAuthConfig().turnEnabled, false);
  assert.deepEqual(loadAuthConfig().turnUrls, []);
  assert.equal(loadAuthConfig().turnCredentialTtlSeconds, 3_600);
  assert.equal(loadIngestConfig().trackerInternalUrl, "http://tracker:7002");
  assert.deepEqual(loadIngestConfig().trackerInternalUrls, ["http://tracker:7002"]);
  assert.equal(loadIngestConfig().idleTeardownMs, 60_000);
  assert.equal(loadIngestConfig().tailSwarmThreshold, 5);
  assert.equal(loadIngestConfig().tailAdmissionMaxChannels, 0);
  assert.equal(loadIngestConfig().tailDownscaleEnabled, false);
  assert.equal(loadIngestConfig().tailDownscaleVideoKbps, 900);
  assert.equal(loadIngestConfig().tailDownscaleAudioKbps, 64);
  assert.equal(loadIngestConfig().rlncK, 32);
  assert.deepEqual(loadIngestConfig().sourcePolicy, { allowedHosts: [], allowPrivateNetworks: false });
  assert.equal(loadTrackerConfig().authJwksUrl, "http://auth:7003/jwks");
  assert.equal(loadTrackerConfig().authJwtAudience, "swarmcast");
  assert.equal(loadTrackerConfig().authJwtIssuer, "swarmcast-auth");
  assert.equal(loadTrackerConfig().maxPayloadBytes, 16 * 1024);
  assert.equal(loadTrackerConfig().maxConnections, 100_000);
  assert.equal(loadTrackerConfig().cellMaxPeers, 20_000);
  assert.equal(loadTrackerConfig().idleTimeoutSeconds, 120);
  assert.equal(loadTrackerConfig().demandHeartbeatSeconds, 30);
  assert.equal(loadTrackerConfig().trackerShardId, "");
  assert.deepEqual(loadTrackerConfig().trackerShards, []);
  assert.deepEqual(loadControlPlaneConfig().ingestNodes, [{ id: "origin", baseUrl: "https://origin.example.tv" }]);
  assert.equal(loadControlPlaneConfig().catalogDbPath, "");
  assert.equal(loadControlPlaneConfig().catalogSnapshotPath, "");
  assert.equal(loadControlPlaneConfig().placementDbPath, "");
  assert.equal(loadControlPlaneConfig().placementPath, "");
  assert.equal(loadRetentionWorkerConfig().port, 7020);
  assert.equal(loadRetentionWorkerConfig().intervalMs, 86_400_000);
  assert.equal(loadRetentionWorkerConfig().dryRun, true);
});

test("source URL policy validates upstream hosts before ingest", () => {
  assert.deepEqual(parseSourceAllowedHosts("source.example.tv, *.trusted.example"), [
    "source.example.tv",
    "*.trusted.example"
  ]);
  const policy = sourcePolicyFromEnv({
    SOURCE_ALLOWED_HOSTS: "source.example.tv,*.trusted.example"
  });
  assert.deepEqual(policy, {
    allowedHosts: ["source.example.tv", "*.trusted.example"],
    allowPrivateNetworks: false
  });

  assert.equal(validateSourceUrl("https://source.example.tv/live.m3u8", policy), "https://source.example.tv/live.m3u8");
  assert.equal(validateSourceUrl("https://cdn.trusted.example/live.m3u8", policy), "https://cdn.trusted.example/live.m3u8");
  assert.throws(() => validateSourceUrl("https://evil.example/live.m3u8", policy), /SOURCE_ALLOWED_HOSTS/);
  assert.throws(() => validateSourceUrl("http://127.0.0.1/live.m3u8", {}), /private or loopback/);
  assert.throws(() => validateSourceUrl("file:///etc/passwd", {}), /http or https/);
  assert.throws(() => validateSourceUrl("https://user:pass@source.example.tv/live.m3u8", policy), /URL credentials/);
  assert.equal(loadIngestConfig({
    SOURCE_ALLOWED_HOSTS: "source.example.tv",
    SOURCE_ALLOW_PRIVATE_NETWORKS: "1"
  }).sourcePolicy.allowPrivateNetworks, true);
  assert.equal(loadIngestConfig({
    TAIL_DOWNSCALE_ENABLED: "1",
    TAIL_ADMISSION_MAX_CHANNELS: "3",
    TAIL_DOWNSCALE_VIDEO_KBPS: "700",
    TAIL_DOWNSCALE_AUDIO_KBPS: "48"
  }).tailDownscaleEnabled, true);
  assert.equal(loadIngestConfig({
    TAIL_ADMISSION_MAX_CHANNELS: "3"
  }).tailAdmissionMaxChannels, 3);
  assert.throws(() => loadIngestConfig({
    TAIL_ADMISSION_MAX_CHANNELS: "-1"
  }), /TAIL_ADMISSION_MAX_CHANNELS/);
  assert.throws(() => loadIngestConfig({
    TAIL_DOWNSCALE_VIDEO_KBPS: "20"
  }), /TAIL_DOWNSCALE_VIDEO_KBPS/);
  assert.throws(() => loadIngestConfig({
    TAIL_DOWNSCALE_AUDIO_KBPS: "8"
  }), /TAIL_DOWNSCALE_AUDIO_KBPS/);
});

test("production source URL policy requires an explicit allowlist", () => {
  assert.throws(() => sourcePolicyFromEnv({}, { requireAllowedHosts: true }), /SOURCE_ALLOWED_HOSTS is required/);
  assert.throws(() => loadIngestConfig({
    INTERNAL_TOKEN: "secret"
  }, { requireSecrets: true }), /SOURCE_ALLOWED_HOSTS is required/);
  assert.throws(() => loadControlPlaneConfig({
    INTERNAL_TOKEN: "secret",
    INGEST_NODES: '[{"id":"origin","baseUrl":"https://origin.example.tv"}]'
  }, { requireSecrets: true }), /SOURCE_ALLOWED_HOSTS is required/);

  assert.deepEqual(loadIngestConfig({
    INTERNAL_TOKEN: "secret",
    SOURCE_ALLOWED_HOSTS: "source.example.tv"
  }, { requireSecrets: true }).sourcePolicy.allowedHosts, ["source.example.tv"]);
  assert.deepEqual(loadControlPlaneConfig({
    INTERNAL_TOKEN: "secret",
    SOURCE_ALLOWED_HOSTS: "source.example.tv",
    INGEST_NODES: '[{"id":"origin","baseUrl":"https://origin.example.tv"}]'
  }, { requireSecrets: true }).sourcePolicy.allowedHosts, ["source.example.tv"]);
});

test("service config loaders enforce secrets when required", () => {
  assert.throws(() => loadAuthConfig({}, { requireSecrets: true }), /APP_API_KEY is required/);
  assert.throws(() => loadTrackerConfig({}, { requireSecrets: true }), /INTERNAL_TOKEN is required/);
  assert.throws(() => loadIngestConfig({}, { requireSecrets: true }), /INTERNAL_TOKEN is required/);
  assert.throws(() => loadControlPlaneConfig({}, { requireSecrets: true }), /INTERNAL_TOKEN is required/);
});

test("auth key rotation config is validated", () => {
  const cfg = loadAuthConfig({
    AUTH_KEY_ID: "swarmcast-2026-07",
    AUTH_PREVIOUS_JWKS_PATH: "/data/previous-jwks.json",
    AUTH_JWT_AUDIENCE: "swarmcast-viewers",
    AUTH_JWT_ISSUER: "swarmcast-auth-prod",
    AUTH_TOKEN_TTL_SECONDS: "1800"
  });
  assert.equal(cfg.keyId, "swarmcast-2026-07");
  assert.equal(cfg.previousJwksPath, "/data/previous-jwks.json");
  assert.equal(cfg.jwtAudience, "swarmcast-viewers");
  assert.equal(cfg.jwtIssuer, "swarmcast-auth-prod");
  assert.equal(cfg.tokenTtlSeconds, 1800);
  assert.throws(() => loadAuthConfig({ AUTH_KEY_ID: " bad key " }), /AUTH_KEY_ID/);
  assert.throws(() => loadAuthConfig({ AUTH_JWT_ISSUER: "bad issuer" }), /AUTH_JWT_ISSUER/);
  assert.throws(() => loadAuthConfig({ AUTH_TOKEN_TTL_SECONDS: "60" }), /AUTH_TOKEN_TTL_SECONDS/);
});

test("Play Integrity config is complete and fail-closed when enabled", () => {
  const env = {
    AUTH_PLAY_INTEGRITY_ENABLED: "1",
    AUTH_PLAY_INTEGRITY_PACKAGE_NAME: "tv.swarmcast",
    AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH: "/run/secrets/play-integrity.json",
    AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS: '["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]',
    AUTH_PLAY_INTEGRITY_MAX_TOKEN_AGE_SECONDS: "120",
    AUTH_ATTESTATION_CHALLENGE_SECRET: "0123456789abcdef0123456789abcdef",
    AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET: "abcdef0123456789abcdef0123456789",
    AUTH_ATTESTATION_CHALLENGE_TTL_SECONDS: "90"
  };
  const config = loadAuthConfig(env);
  assert.equal(config.playIntegrityEnabled, true);
  assert.equal(config.playIntegrityPackageName, "tv.swarmcast");
  assert.equal(config.playIntegrityServiceAccountPath, "/run/secrets/play-integrity.json");
  assert.deepEqual(config.playIntegrityCertificateDigests, ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
  assert.equal(config.playIntegrityMaxTokenAgeSeconds, 120);
  assert.equal(config.attestationPreviousChallengeSecret, "abcdef0123456789abcdef0123456789");
  assert.equal(config.attestationChallengeTtlSeconds, 90);

  assert.throws(() => loadAuthConfig({ ...env, AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH: "" }), /SERVICE_ACCOUNT_PATH/);
  assert.throws(() => loadAuthConfig({ ...env, AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS: "[]" }), /must not be empty/);
  assert.throws(() => loadAuthConfig({ ...env, AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS: '["not-a-digest"]' }), /base64url/);
  assert.throws(() => loadAuthConfig({ ...env, AUTH_ATTESTATION_CHALLENGE_SECRET: "short" }), /CHALLENGE_SECRET/);
  assert.throws(() => loadAuthConfig({ ...env, AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET: "short" }), /PREVIOUS_CHALLENGE_SECRET/);
  assert.throws(() => loadAuthConfig({
    ...env,
    AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET: env.AUTH_ATTESTATION_CHALLENGE_SECRET
  }), /must differ/);
  assert.throws(() => loadAuthConfig({ ...env, AUTH_ATTESTATION_CHALLENGE_TTL_SECONDS: "121" }), /must not exceed/);
});

test("ICE and TURN config validates owned hosts and short-lived credentials", () => {
  const env = {
    APP_API_KEY: "app-key",
    AUTH_TOKEN_TTL_SECONDS: "7200",
    ICE_SERVER_ALLOWED_HOSTS: "stun.swarmcast.tv,turn.swarmcast.tv",
    ICE_STUN_URLS: '["stun:stun.swarmcast.tv:3478"]',
    TURN_ENABLED: "1",
    TURN_URLS: '["turn:turn.swarmcast.tv:3478?transport=udp","turns:turn.swarmcast.tv:443?transport=tcp"]',
    TURN_SHARED_SECRET: "0123456789abcdef0123456789abcdef",
    TURN_CREDENTIAL_TTL_SECONDS: "3600"
  };
  const config = loadAuthConfig(env, { requireSecrets: true });
  assert.deepEqual(config.stunUrls, ["stun:stun.swarmcast.tv:3478"]);
  assert.equal(config.turnEnabled, true);
  assert.deepEqual(config.turnUrls, [
    "turn:turn.swarmcast.tv:3478?transport=udp",
    "turns:turn.swarmcast.tv:443?transport=tcp"
  ]);
  assert.equal(config.turnCredentialTtlSeconds, 3600);

  assert.throws(() => loadAuthConfig({ ...env, TURN_SHARED_SECRET: "short" }), /TURN_SHARED_SECRET/);
  assert.throws(() => loadAuthConfig({ ...env, TURN_URLS: "[]" }), /TURN_URLS must be a non-empty/);
  assert.throws(() => loadAuthConfig({ ...env, TURN_CREDENTIAL_TTL_SECONDS: "7201" }), /must not exceed/);
  assert.throws(() => loadAuthConfig({ ...env, TURN_URLS: '["turn:evil.example:3478"]' }), /ICE_SERVER_ALLOWED_HOSTS/);
  assert.throws(() => loadAuthConfig({ ...env, TURN_URLS: '["turn:user:password@turn.swarmcast.tv"]' }), /without credentials/);
  assert.throws(() => loadAuthConfig({ ...env, TURN_URLS: '["turns:turn.swarmcast.tv:443?transport=udp"]' }), /cannot use UDP/);
  assert.throws(() => loadAuthConfig({ ...env, TURN_URLS: '["turn:turn.swarmcast.tv:70000"]' }), /invalid port/);
  assert.throws(() => loadAuthConfig({ ...env, ICE_SERVER_ALLOWED_HOSTS: "" }, { requireSecrets: true }), /ICE_SERVER_ALLOWED_HOSTS is required/);

  assert.deepEqual(validateIceServerUrls(
    ["STUN:STUN.SWARMCAST.TV:3478"],
    "ICE_STUN_URLS",
    { allowedSchemes: ["stun"], allowedHosts: ["*.swarmcast.tv"] }
  ), ["stun:stun.swarmcast.tv:3478"]);
});

test("control-plane ingest node JSON is parsed and validated", () => {
  const cfg = loadControlPlaneConfig({
    INGEST_NODES: '[{"id":"n1","baseUrl":"https://n1.example.tv/","ingestUrl":"http://n1:7001/"}]'
  });

  assert.deepEqual(cfg.ingestNodes, [{ id: "n1", baseUrl: "https://n1.example.tv", ingestUrl: "http://n1:7001" }]);
  assert.equal(loadControlPlaneConfig({ CATALOG_DB_PATH: "/data/catalog.sqlite" }).catalogDbPath, "/data/catalog.sqlite");
  assert.equal(loadControlPlaneConfig({ PLACEMENT_DB_PATH: "/data/placements.sqlite" }).placementDbPath, "/data/placements.sqlite");
  assert.equal(loadControlPlaneConfig({ PLACEMENT_PATH: "/data/placements.json" }).placementPath, "/data/placements.json");
  assert.throws(() => loadControlPlaneConfig({ INGEST_NODES: "nope" }), /INGEST_NODES must contain valid JSON/);
  assert.throws(() => loadControlPlaneConfig({ INGEST_NODES: "[]" }), /INGEST_NODES must be a non-empty array/);
  assert.throws(() => loadControlPlaneConfig({
    INGEST_NODES: '[{"id":"n1","baseUrl":"https://n1.example.tv"},{"id":"n1","baseUrl":"https://n2.example.tv"}]'
  }), /duplicate node id/);
  assert.throws(() => loadControlPlaneConfig({
    INGEST_NODES: '[{"id":"bad node","baseUrl":"https://n1.example.tv"}]'
  }), /INGEST_NODES\[0\]\.id/);
  assert.throws(() => loadControlPlaneConfig({
    INGEST_NODES: '[{"id":"n1","baseUrl":"not-a-url"}]'
  }), /INGEST_NODES\[0\]\.baseUrl must be a valid URL/);
  assert.throws(() => loadControlPlaneConfig({
    INGEST_NODES: '[{"id":"n1","baseUrl":"https://n1.example.tv","ingestUrl":"ftp://n1"}]'
  }), /INGEST_NODES\[0\]\.ingestUrl must use one of/);
  assert.throws(() => loadControlPlaneConfig({
    INGEST_NODES: '[{"id":"n1","baseUrl":"https://d123.cloudfront.net"}]'
  }), /third-party CDN/);
});

test("retention worker blocks destructive mode without store module", () => {
  assert.throws(() => loadRetentionWorkerConfig({
    RETENTION_EXECUTE: "1"
  }), /RETENTION_STORE_MODULE is required/);
  assert.equal(loadRetentionWorkerConfig({
    RETENTION_EXECUTE: "1",
    RETENTION_STORE_MODULE: "./store.js"
  }).dryRun, false);
});

test("tracker runtime limits are configurable", () => {
  const cfg = loadTrackerConfig({
    TRACKER_MAX_PAYLOAD_BYTES: "32768",
    TRACKER_MAX_BACKPRESSURE_BYTES: "524288",
    TRACKER_CELL_MAX_PEERS: "250",
    TRACKER_MAX_CONNECTIONS: "500",
    TRACKER_IDLE_TIMEOUT_SECONDS: "60",
    TRACKER_DEMAND_HEARTBEAT_SECONDS: "5",
    TRACKER_RATE_LIMIT_CAPACITY: "100",
    TRACKER_RATE_LIMIT_REFILL_PER_SECOND: "75",
    TRACKER_SHARD_ID: "tracker-a",
    TRACKER_SHARDS: '[{"id":"tracker-a","wsUrl":"wss://tracker-a.example.tv/ws/","internalUrl":"https://tracker-a-internal.example.tv/","region":"EU"},{"id":"tracker-b","wsUrl":"wss://tracker-b.example.tv/ws"}]',
    AUTH_JWT_AUDIENCE: "swarmcast-viewers",
    AUTH_JWT_ISSUER: "swarmcast-auth-prod"
  });

  assert.equal(cfg.maxPayloadBytes, 32768);
  assert.equal(cfg.maxBackpressureBytes, 524288);
  assert.equal(cfg.cellMaxPeers, 250);
  assert.equal(cfg.maxConnections, 500);
  assert.equal(cfg.idleTimeoutSeconds, 60);
  assert.equal(cfg.demandHeartbeatSeconds, 5);
  assert.equal(cfg.rateLimitCapacity, 100);
  assert.equal(cfg.rateLimitRefillPerSecond, 75);
  assert.equal(cfg.trackerShardId, "tracker-a");
  assert.deepEqual(cfg.trackerShards, [
    { id: "tracker-a", wsUrl: "wss://tracker-a.example.tv/ws", internalUrl: "https://tracker-a-internal.example.tv", region: "eu" },
    { id: "tracker-b", wsUrl: "wss://tracker-b.example.tv/ws" }
  ]);
  assert.equal(cfg.authJwtAudience, "swarmcast-viewers");
  assert.equal(cfg.authJwtIssuer, "swarmcast-auth-prod");
  assert.throws(() => loadTrackerConfig({
    TRACKER_IDLE_TIMEOUT_SECONDS: "2"
  }), /TRACKER_IDLE_TIMEOUT_SECONDS must be 0 or greater than 8/);
  assert.throws(() => loadTrackerConfig({
    EDGE_BASE: "https://edge.global.fastly.net"
  }), /third-party CDN/);
  assert.throws(() => loadTrackerConfig({
    TRACKER_SHARD_ID: "tracker-c",
    TRACKER_SHARDS: '[{"id":"tracker-a","wsUrl":"wss://tracker-a.example.tv/ws"}]'
  }), /TRACKER_SHARD_ID must match/);
  assert.throws(() => validateTrackerShards([
    { id: "tracker-a", wsUrl: "wss://tracker-a.example.tv/ws" },
    { id: "tracker-a", wsUrl: "wss://tracker-a.example.tv/ws" }
  ]), /duplicate shard id/);
  assert.throws(() => validateTrackerShards([
    { id: "bad shard", wsUrl: "wss://tracker-a.example.tv/ws" }
  ]), /TRACKER_SHARDS\[0\]\.id/);
  assert.throws(() => validateTrackerShards([
    { id: "tracker-a", wsUrl: "https://tracker-a.example.tv/ws" }
  ]), /TRACKER_SHARDS\[0\]\.wsUrl must use one of/);
  assert.throws(() => validateTrackerShards([
    { id: "tracker-a", wsUrl: "wss://d123.cloudfront.net/ws" }
  ]), /third-party CDN/);
  assert.throws(() => validateTrackerShards([
    { id: "tracker-a", wsUrl: "wss://tracker-a.example.tv/ws", region: "bad region" }
  ]), /valid region identifier/);
});

test("ingest tracker fanout endpoints are normalized and deduplicated", () => {
  const cfg = loadIngestConfig({
    TRACKER_INTERNAL_URLS: '["https://tracker-a.example.tv/","https://tracker-a.example.tv","https://tracker-b.example.tv"]'
  });
  assert.deepEqual(cfg.trackerInternalUrls, [
    "https://tracker-a.example.tv",
    "https://tracker-b.example.tv"
  ]);
  assert.throws(() => loadIngestConfig({ TRACKER_INTERNAL_URLS: '{}' }), /must be a JSON array/);
  assert.throws(() => loadIngestConfig({ TRACKER_INTERNAL_URLS: '["ftp://tracker.example.tv"]' }), /must use one of/);
});
