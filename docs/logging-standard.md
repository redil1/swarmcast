# Structured Logging Standard

All production services should emit newline-delimited JSON logs. Human-readable strings are allowed only as the `msg` field.

## Required Fields

| Field | Description |
|---|---|
| `ts` | ISO-8601 timestamp |
| `level` | `debug`, `info`, `warn`, or `error` |
| `service` | `auth`, `ingest`, `tracker`, `control-plane`, `retention-worker`, `edge`, or `android` |
| `event` | Stable event name |
| `request_id` | Request or workflow correlation ID |
| `channel_id` | Channel ID when known |
| `peer_id` | Tracker peer ID when known |
| `segment_seq` | HLS segment sequence when known |
| `node_id` | Edge or ingest node ID when known |
| `swarm_id` | Channel swarm ID when known |
| `error_class` | Stable error class for failures |
| `msg` | Short operator-readable message |

## Event Names

Use stable lower-snake-case names, for example:

- `auth_token_issued`
- `auth_verify_failed`
- `channel_demand_started`
- `ffmpeg_worker_failed`
- `tracker_joined`
- `tracker_signal_relayed`
- `tracker_peer_dropped`
- `tracker_idle_peers_closed`
- `segment_announced`
- `retention_job_completed`
- `retention_job_failed`
- `edge_cache_miss`
- `edge_cache_hit`

## Redaction Rules

- Never log JWTs, app API keys, auth signing keys, or upstream source credentials.
- Never log upstream source URLs in public or client-facing paths.
- Log peer IP addresses only when needed for abuse/security triage and apply retention limits.
- Prefer stable error classes over raw exception messages when messages may include secrets.

## Shared Runtime

Node services use `@swarmcast/config/logging` for newline-delimited JSON logs. The shared `createLogger` helper enforces service names, log levels, stable event names, required context fields, and redaction for tokens, keys, secrets, and upstream source URLs.

HTTP services use `logHttpRequest` to emit `http_request_completed` records with `request_id`, method, sanitized path, status code, duration, and client/server error class. Query strings are not logged.

Initial runtime events include:

- `service_started`
- `auth_token_issued`
- `auth_verify_failed`
- `channel_demand_started`
- `ffmpeg_worker_failed`
- `tracker_joined`
- `tracker_signal_relayed`
- `tracker_peer_dropped`
- `tracker_idle_peers_closed`
- `segment_announced`
- `retention_job_completed`
- `retention_job_failed`

## Launch Gate

Before production launch, each service must either emit this schema or have an explicit launch waiver in `docs/launch-readiness.md`.
