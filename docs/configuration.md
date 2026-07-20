# Configuration Standard

SwarmCast services use explicit environment variables and startup validation. Required launch secrets and public bases are listed in `.env.example`; service-specific defaults live in `packages/config`.

## Required Launch Values

- `INTERNAL_TOKEN`
- `APP_API_KEY`
- `ORIGIN_BASE`
- `EDGE_BASE`
- `API_BASE`
- `TRACKER_BASE`

## Service Defaults

| Service | Variable | Default |
|---|---|---|
| auth | `AUTH_PORT` | `7003` |
| auth | `AUTH_KEY_PATH` | `/data/es256.pem` |
| auth | `AUTH_KEY_ID` | `swarmcast-1` |
| auth | `AUTH_PREVIOUS_JWKS_PATH` | empty |
| auth/tracker | `AUTH_JWT_AUDIENCE` | `swarmcast` |
| auth/tracker | `AUTH_JWT_ISSUER` | `swarmcast-auth` |
| auth | `AUTH_TOKEN_TTL_SECONDS` | `21600` |
| ingest | `INGEST_PORT` | `7001` |
| ingest | `TRACKER_INTERNAL_URL` | `http://tracker:7002` |
| ingest | `TRACKER_INTERNAL_URLS` | `[]` (JSON list; falls back to `TRACKER_INTERNAL_URL`) |
| tracker | `TRACKER_CELL_MAX_PEERS` | `20000` |
| ingest | `HLS_ROOT` | `/var/hls` |
| ingest | `MAX_CHANNELS` | `140` |
| ingest | `IDLE_TEARDOWN_MS` | `60000` |
| ingest | `TAIL_IDLE_TEARDOWN_MS` | `15000` |
| ingest | `TAIL_SWARM_THRESHOLD` | `5` |
| ingest | `TAIL_ADMISSION_MAX_CHANNELS` | `0` |
| ingest | `TAIL_DOWNSCALE_ENABLED` | `false` |
| ingest | `TAIL_DOWNSCALE_VIDEO_KBPS` | `900` |
| ingest | `TAIL_DOWNSCALE_AUDIO_KBPS` | `64` |
| ingest | `SEGMENT_SECONDS` | `2` |
| ingest | `WINDOW_SEGMENTS` | `30` |
| ingest | `FFMPEG_BIN` | `ffmpeg` |
| ingest | `RLNC_K` | `32` |
| ingest/control-plane | `SOURCE_ALLOWED_HOSTS` | empty |
| ingest/control-plane | `SOURCE_ALLOW_PRIVATE_NETWORKS` | `false` |
| tracker | `TRACKER_PORT` | `7000` |
| tracker | `TRACKER_INTERNAL_PORT` | `7002` |
| tracker | `AUTH_JWKS_URL` | `http://auth:7003/jwks` |
| tracker | `INGEST_URL` | `http://ingest:7001` |
| tracker | `TRACKER_MAX_CONNECTIONS` | `100000` |
| tracker | `TRACKER_MAX_PAYLOAD_BYTES` | `16384` |
| tracker | `TRACKER_MAX_BACKPRESSURE_BYTES` | `262144` |
| tracker | `TRACKER_IDLE_TIMEOUT_SECONDS` | `120` |
| tracker | `TRACKER_DEMAND_HEARTBEAT_SECONDS` | `30` |
| tracker | `TRACKER_RATE_LIMIT_CAPACITY` | `50` |
| tracker | `TRACKER_RATE_LIMIT_REFILL_PER_SECOND` | `50` |
| tracker | `TRACKER_SHARD_ID` | empty |
| tracker | `TRACKER_SHARDS` | `[]` |
| control-plane | `CONTROL_PLANE_PORT` | `7010` |
| control-plane | `M3U_PATH` | `/config/source.m3u` |
| control-plane | `CATALOG_DB_PATH` | empty |
| control-plane | `CATALOG_SNAPSHOT_PATH` | empty |
| control-plane | `PLACEMENT_DB_PATH` | empty |
| control-plane | `PLACEMENT_PATH` | empty |
| control-plane | `INGEST_NODES` | `[{"id":"origin","baseUrl":"https://origin.example.tv"}]` |
| retention-worker | `RETENTION_WORKER_PORT` | `7020` |
| retention-worker | `RETENTION_INTERVAL_MS` | `86400000` |
| retention-worker | `RETENTION_RUN_ON_START` | `true` |
| retention-worker | `RETENTION_POLICY_FILE` | `config/data-retention.json` |
| retention-worker | `RETENTION_EXECUTE` | `false` |
| retention-worker | `RETENTION_STORE_MODULE` | empty |
| retention-worker | `RETENTION_STORE_HTTP_BASE_URL` | empty |
| retention-worker | `RETENTION_STORE_HTTP_TOKEN` | empty |
| retention-worker | `RETENTION_STORE_HTTP_TIMEOUT_MS` | `10000` |
| retention-worker | `RETENTION_RECORDS_FILE` | `test-fixtures/retention/records.jsonl` locally; `/data/retention-records.jsonl` in compose |
| monitoring | `ALERTMANAGER_CONFIG_PATH` | `./monitoring/alertmanager.yml` |
| retention-worker | `RETENTION_ACTION_LOG` | `var/retention-actions.jsonl` |

## Validation Rules

- Required secrets fail startup when production validation is enabled.
- Production deployment env files must pass `npm run env:production:validate -- path/to/production.env` before rollout; this rejects placeholders, non-HTTPS public bases, unsafe source allowlists, missing persistent auth key paths, missing durable control-plane SQLite paths, tag-only service or infrastructure images, missing retention HTTP store credentials/timeouts, missing retention execution settings, missing production Alertmanager config paths, and weak launch secrets.
- `npm run smoke:compose-production-env` renders the base compose file and the release compose overlay with the production env file, proving service env passthrough plus digest-pinned release images before deploy.
- Android release Gradle properties must pass `npm run android:release-config:validate -- path/to/release.properties`; this rejects local placeholders, non-HTTPS API URLs, non-WSS tracker URLs, weak app keys, and third-party CDN hosts. When `SWARMCAST_RLNC_ENABLED=1`, pass the real decision as `npm run android:release-config:validate -- --rlnc-decision path/to/android-rlnc-decision.json path/to/release.properties`; synthetic or invalid decision evidence cannot enable release RLNC.
- Ingest and control-plane production startup requires `SOURCE_ALLOWED_HOSTS`; containers must refuse startup when the catalog source allowlist is empty.
- Port values must be valid TCP ports.
- URL values must parse as `http`, `https`, `ws`, or `wss` as appropriate.
- Runtime media base URLs reject known third-party CDN provider hostnames such as CloudFront, Akamai, and Fastly.
- Auth `AUTH_KEY_ID` must be a safe JWT `kid`; `AUTH_PREVIOUS_JWKS_PATH` can publish previous public keys during a rotation overlap.
- Auth and tracker must share `AUTH_JWT_AUDIENCE` and `AUTH_JWT_ISSUER`; `AUTH_TOKEN_TTL_SECONDS` must be between 300 and 86400 seconds.
- Tracker `TRACKER_IDLE_TIMEOUT_SECONDS` must be `0` or greater than `8` for `uWebSockets.js` compatibility.
- If `TRACKER_SHARDS` is set, each entry must have a unique safe `id` and owned `ws` or `wss` `wsUrl`, and `TRACKER_SHARD_ID` must match one declared shard.
- Tail admission stays disabled when `TAIL_ADMISSION_MAX_CHANNELS=0`; when set, new below-threshold tail channels are rejected before ffmpeg starts once the tail budget is full.
- Tail downscale stays disabled by default; when `TAIL_DOWNSCALE_ENABLED=1`, demanded channels below `TAIL_SWARM_THRESHOLD` are packaged with `TAIL_DOWNSCALE_VIDEO_KBPS` and `TAIL_DOWNSCALE_AUDIO_KBPS`, then restarted back to source-copy when demand rises.
- Retention execute mode requires `RETENTION_EXECUTE=1` plus a production absolute `.js` `RETENTION_STORE_MODULE`; the built-in HTTP adapter runs at `/app/scripts/retention-http-store.js` in the container and requires `RETENTION_STORE_HTTP_BASE_URL`, a 64-hex-character `RETENTION_STORE_HTTP_TOKEN`, and explicit `RETENTION_STORE_HTTP_TIMEOUT_MS` in production env validation.
- Production Alertmanager deployments must set `ALERTMANAGER_CONFIG_PATH` to an absolute persistent `.yml` or `.yaml` file and validate that file with `npm run alertmanager:receivers:validate -- path/to/alertmanager.yml`.
- `INGEST_NODES` must be a non-empty JSON array of objects with unique safe `id` values, valid `http` or `https` `baseUrl`, and optional `http` or `https` `ingestUrl`.
- Catalog source URLs must satisfy `docs/source-url-policy.md`; private networks are rejected by default and `SOURCE_ALLOWED_HOSTS` restricts production upstream hosts.
- Control-plane can write a SQLite-backed catalog database with `CATALOG_DB_PATH`; the database stores sanitized channel fields, indexes group/name lookups, and can be loaded when the configured M3U file is unavailable.
- Control-plane can write a sanitized catalog snapshot with `CATALOG_SNAPSHOT_PATH`; snapshots must not contain source URLs, must be backed by `npm run catalog:import:validate -- path/to/catalog-import-evidence.json`, and the local evidence guard is `npm run smoke:catalog-import-validation`. Snapshots are used only when the configured M3U file and catalog database are unavailable.
- Control-plane can store channel placement state in a SQLite-backed placement registry with `PLACEMENT_DB_PATH`; `PLACEMENT_PATH` remains available for local JSON file persistence.
- Media playback and seed URL templates must use the shared `@swarmcast/config/media-urls` builder documented in `docs/media-url-contract.md`.
- `.env.example` must include every required launch value.

## Production Environment File Gate

`npm run env:production:validate -- path/to/production.env` checks the operator env file used with `infra/docker-compose.release.yml`.

The production file must include:

- 64-hex-character `INTERNAL_TOKEN` and `APP_API_KEY` values.
- Absolute persistent `AUTH_KEY_PATH` ending in `.pem`; optional `AUTH_PREVIOUS_JWKS_PATH` must be an absolute `.json` path when set.
- `https` origin, edge, API, and retention store URLs plus `wss` tracker URL.
- Non-empty `SOURCE_ALLOWED_HOSTS` with private networks disabled.
- Non-empty `INGEST_NODES` with owned origin URLs.
- Absolute persistent `CATALOG_DB_PATH` and `PLACEMENT_DB_PATH` values ending in `.sqlite`, `.sqlite3`, or `.db`.
- Digest-pinned `SWARMCAST_*_IMAGE` values for every service and production infrastructure container, including nginx, Prometheus, Alertmanager, Grafana, edge metrics, and node exporter.
- Approved retention execute settings with a production store module.
- For the built-in HTTP retention store, `RETENTION_STORE_HTTP_BASE_URL`, a 64-hex-character `RETENTION_STORE_HTTP_TOKEN`, and `RETENTION_STORE_HTTP_TIMEOUT_MS`.
- Secret provisioning evidence that passes `npm run secrets:evidence:validate -- path/to/secrets-evidence.json`; evidence must reference production scope, purpose, storage, rotation policy, runtime injection, access review, backup/restore, and redaction proof without raw secret values.

The synthetic fixture at `test-fixtures/config/production.env` is only for local validation coverage.

## Android Release Properties

The Android release properties file must include:

- `SWARMCAST_API_BASE` using an owned `https` API URL.
- `SWARMCAST_TRACKER_WS_URL` using an owned `wss` tracker URL.
- `SWARMCAST_APP_API_KEY` as a 64-hex-character non-placeholder app key.
- Explicit `SWARMCAST_P2P_ENABLED`, `SWARMCAST_EDGE_ONLY_MODE`, and `SWARMCAST_RLNC_ENABLED=0` flags.

Local guard coverage:

```bash
npm run smoke:android-release-config-validation
```

## Follow-Up

The shared config package is the canonical contract. Runtime Node services now consume the shared loaders for startup defaults, required-secret validation, and media URL template generation. Android release property shape is now validated separately; remaining work is to extend the same contract to any future autoscaling workers.
