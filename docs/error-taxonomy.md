# Error Taxonomy

SwarmCast uses stable lower-snake-case error codes for client-visible responses, internal logs, and operational dashboards.

## Client-Visible Codes

| Code | HTTP | Meaning |
|---|---:|---|
| `capacity` | 503 | Service is temporarily at capacity |
| `not_found` | 404 | Route or resource is not available |
| `unknown_channel` | 404 | Channel ID is not known or not available |
| `unauthorized` | 401 | Token or app credential is missing or invalid |
| `source_unavailable` | 502 | Upstream source cannot currently produce media |
| `edge_unavailable` | 503 | Delivery Fleet edge path is unavailable |
| `tracker_unavailable` | 503 | Tracker or signaling path is unavailable |
| `rate_limited` | 429 | Client or peer exceeded a rate limit |

## Internal-Only Codes

| Code | Meaning |
|---|---|
| `bad_message` | Malformed or oversized tracker message |
| `placement_failed` | Control-plane placement failed |
| `poisoned_segment` | Peer supplied bytes that failed hash verification |
| `config_invalid` | Service startup or runtime configuration is invalid |

## Rules

- Client-visible responses may include only allowlisted codes.
- Internal-only codes must not expose raw exception messages to Android clients.
- Logs should include the code in `error_class`.
- Prometheus counters and alerts should use the same code labels when error-cardinality is bounded.
- Unknown codes must collapse to `config_invalid` or a service-specific internal error before leaving the service.

## Launch Gate

Before production launch, auth, ingest, tracker, control-plane, edge, and Android error paths must either use this taxonomy or have an explicit waiver in `docs/launch-readiness.md`.
