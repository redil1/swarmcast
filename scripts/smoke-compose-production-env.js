import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8" });
}

function dockerComposeAvailable() {
  return run("docker", ["compose", "version"]).status === 0;
}

function renderCompose(args, files = ["infra/docker-compose.yml"]) {
  const composeFiles = files.flatMap((file) => ["-f", file]);
  const result = run("docker", ["compose", ...args, ...composeFiles, "config"]);
  assert.equal(result.status, 0, `docker compose config failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result.stdout;
}

if (!dockerComposeAvailable()) {
  console.log("Docker Compose not available; skipping production compose env smoke");
  process.exit(0);
}

const defaultConfig = renderCompose([]);
for (const required of [
  "M3U_PATH: /config/source.m3u",
  "INGEST_NODES: '[{\"id\":\"origin\",\"baseUrl\":\"https://origin.example.tv\",\"ingestUrl\":\"http://ingest:7001\"}]'",
  "CATALOG_DB_PATH: /data/catalog.sqlite",
  "PLACEMENT_DB_PATH: /data/placements.sqlite",
  "RETENTION_RECORDS_FILE: /data/retention-records.jsonl",
  "SEGMENT_BUS_SERVERS: '[\"nats://segment-bus:4222\"]'",
  "target: /etc/alertmanager/alertmanager.yml"
]) {
  assert.ok(defaultConfig.includes(required), `default compose render missing ${required}`);
}

const productionConfig = renderCompose(["--env-file", "test-fixtures/config/production.env"]);
for (const required of [
  "AUTH_KEY_PATH: /data/es256.pem",
  "TURN_ENABLED: \"1\"",
  "TURN_CREDENTIAL_TTL_SECONDS: \"3600\"",
  "SEGMENT_BUS_SERVERS: '[\"tls://segment-bus-a.swarmcast.tv:4222\",\"tls://segment-bus-b.swarmcast.tv:4222\",\"tls://segment-bus-c.swarmcast.tv:4222\"]'",
  "SEGMENT_BUS_REPLICAS: \"3\"",
  "M3U_PATH: /config/source.m3u",
  "INGEST_NODES: '[{\"id\":\"origin-a\",\"baseUrl\":\"https://origin.swarmcast.tv\",\"ingestUrl\":\"https://origin.swarmcast.tv\"}]'",
  "CATALOG_DB_PATH: /data/catalog.sqlite",
  "PLACEMENT_DB_PATH: /data/placements.sqlite",
  "RETENTION_STORE_MODULE: /app/scripts/retention-http-store.js",
  "RETENTION_RECORDS_FILE: /data/retention-records.jsonl",
  "RETENTION_STORE_HTTP_TIMEOUT_MS: \"10000\"",
  "RETENTION_STORE_HTTP_TOKEN: 89abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
  "source: /etc/swarmcast/alertmanager.yml"
]) {
  assert.ok(productionConfig.includes(required), `production compose render missing ${required}`);
}
for (const required of [
  "image: nginx:1.27@sha256:1111111111111111111111111111111111111111111111111111111111111111",
  "image: prom/prometheus:v2.53.0@sha256:2222222222222222222222222222222222222222222222222222222222222222",
  "image: prom/alertmanager:v0.27.0@sha256:3333333333333333333333333333333333333333333333333333333333333333",
  "image: grafana/grafana:11.1.0@sha256:4444444444444444444444444444444444444444444444444444444444444444",
  "image: nats:2.12.1-alpine@sha256:9999999999999999999999999999999999999999999999999999999999999999",
  "image: natsio/prometheus-nats-exporter:0.17.3@sha256:0000000000000000000000000000000000000000000000000000000000000000"
]) {
  assert.ok(productionConfig.includes(required), `production compose render missing infrastructure image ${required}`);
}

const releaseConfig = renderCompose(["--env-file", "test-fixtures/config/production.env"], [
  "infra/docker-compose.yml",
  "infra/docker-compose.release.yml"
]);
for (const required of [
  "image: ghcr.io/aziz/ads/auth@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "image: ghcr.io/aziz/ads/ingest@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "image: ghcr.io/aziz/ads/tracker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "image: ghcr.io/aziz/ads/control-plane@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "image: ghcr.io/aziz/ads/retention-worker@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "image: nats:2.12.1-alpine@sha256:9999999999999999999999999999999999999999999999999999999999999999",
  "image: natsio/prometheus-nats-exporter:0.17.3@sha256:0000000000000000000000000000000000000000000000000000000000000000"
]) {
  assert.ok(releaseConfig.includes(required), `production release compose render missing ${required}`);
}

const edgeConfig = renderCompose(["--env-file", "test-fixtures/config/production.env"], [
  "infra/edge/docker-compose.yml"
]);
for (const required of [
  "image: nginx:1.27@sha256:5555555555555555555555555555555555555555555555555555555555555555",
  "image: node:22-slim@sha256:6666666666666666666666666666666666666666666666666666666666666666",
  "image: prom/node-exporter:v1.8.0@sha256:7777777777777777777777777777777777777777777777777777777777777777"
]) {
  assert.ok(edgeConfig.includes(required), `production edge compose render missing ${required}`);
}

const turnConfig = renderCompose(["--env-file", "test-fixtures/config/production.env"], [
  "infra/turn/docker-compose.yml"
]);
for (const required of [
  "image: ghcr.io/aziz/ads/turn@sha256:8888888888888888888888888888888888888888888888888888888888888888",
  "TURN_REALM: turn.swarmcast.tv",
  "TURN_BPS_CAPACITY: \"100000000\"",
  "TURN_MIN_PORT: \"49152\"",
  "TURN_MAX_PORT: \"65535\"",
  "network_mode: host",
  "NET_BIND_SERVICE"
]) {
  assert.ok(turnConfig.includes(required), `production TURN compose render missing ${required}`);
}

console.log("production compose env smoke OK: default=pass production=pass release=pass edge=pass turn=pass");
