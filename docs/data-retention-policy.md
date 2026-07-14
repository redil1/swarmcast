# Data Retention Policy

Review date: 2026-07-05

The canonical machine-readable retention map is `config/data-retention.json`. Production launch is blocked until privacy/legal review approves this policy and the service logging implementation matches it.

## Principles

- Collect only operational data needed for playback reliability, abuse defense, legal compliance, and capacity planning.
- Never log JWTs, app API keys, private signing keys, upstream source URLs, or precise user location.
- Treat peer IDs, IP-related logs, and WebRTC operational metadata as sensitive operational data.
- Prefer short raw retention and longer aggregate retention.
- Preserve raw data beyond the normal window only for a documented security incident with an owner and expiry.

## Retention Classes

| Class | Raw Retention | Aggregate Retention | Notes |
|---|---:|---:|---|
| Peer stats | 14 days | 180 days | Peer IDs, channel IDs, network class, peer bytes, edge bytes, and stall counts are used for reliability, offload measurement, and abuse defense. |
| IP-related logs | 7 days | 90 days | Edge access IPs, tracker connection IPs, and auth request IPs are kept briefly for abuse defense and incident response. |
| Auth logs | 30 days | 365 days | Token issuance/rejection and JWKS activity may keep outcome, key id, and rate-limit state, but never token values or private key material. |
| Playback errors | 30 days | 180 days | Startup failures, stalls, segment fetch failures, and decoder failures are aggregated by app version, network class, device class, and channel group. |
| Metrics | 30 days | 395 days | High-cardinality raw metrics stay short-lived; aggregate service and channel-health metrics may be retained for planning and retrospectives. |

## Required Controls

- Structured logging must omit prohibited fields listed in `config/data-retention.json`.
- Public catalog responses must not include upstream source URLs.
- Client telemetry must not send full JWTs, app API keys, contact data, or precise location.
- P2P telemetry must avoid durable user identity and use ephemeral peer IDs.
- Deletion or aggregation jobs must have monitored success/failure metrics before production launch.
- Incident holds must record owner, scope, reason, start date, expiry, and approval.

## Implementation Scaffold

- `@swarmcast/config/retention` validates the machine-readable policy and maps records to retention actions.
- `npm run retention:job` runs the shared retention job in non-destructive dry-run mode against a retention store adapter.
- `npm run smoke:retention-execute` proves execute mode refuses to run without `RETENTION_EXECUTE=1`, then runs against a temporary JSONL store and verifies the retention action log.
- `npm run smoke:retention-redaction` runs the retention job against synthetic sensitive records and proves dry-run JSON, Prometheus metrics, and execute-mode action logs do not emit JWTs, upstream source URLs, IP addresses, emails, or API keys.
- `npm run smoke:retention-http-store` proves the built-in HTTP retention store module can list records from an internal datastore API, skip apply calls in dry-run mode, and send only minimal action payloads in execute mode.
- The `retention-worker` service schedules the same job, exposes `/health`, and exports the retention metrics on `/metrics`.
- Production retention stores must be provided with `RETENTION_STORE_MODULE`; the module must export `createRetentionStore`, returning `listRetentionRecords` and `applyRetentionAction`.
- The built-in module `scripts/retention-http-store.js` uses `RETENTION_STORE_HTTP_BASE_URL`, `RETENTION_STORE_HTTP_TOKEN`, and `RETENTION_STORE_HTTP_TIMEOUT_MS`; production containers can set `RETENTION_STORE_MODULE=/app/scripts/retention-http-store.js`, and production env validation requires a 64-hex-character bearer token for this adapter.
- Production compose defaults `RETENTION_RECORDS_FILE` to `/data/retention-records.jsonl` for JSONL adapter drills so the retention worker does not carry test fixture paths into a production render.
- Destructive execution requires both `RETENTION_EXECUTE=1` and `--execute`.
- `npm run retention:dry-run` produces a sample deletion/aggregation summary without deleting data.
- `npm run retention:dry-run -- --prometheus` emits `swarmcast_retention_records_total`, `swarmcast_retention_failures_total`, and `swarmcast_retention_last_success_timestamp_seconds`.
- Retention actions are `keep_raw`, `aggregate_then_delete_raw`, and `delete_aggregate`.
- The local JSONL adapter uses `test-fixtures/retention/records.jsonl` for verification only; production jobs must replace it with real peer stats, IP-related logs, auth logs, playback errors, and metrics stores.
- The redaction fixture `test-fixtures/retention/sensitive-records.jsonl` contains synthetic sentinel values only; it must not contain real secrets, real customer data, or private upstream URLs.

## Launch Gates

- Privacy/store copy must disclose peer IP visibility and upload behavior.
- Data deletion or aggregation jobs must be implemented for peer stats, IP-related logs, auth logs, playback errors, and metrics.
- Log redaction tests must prove JWTs, source URLs, IP addresses, contact data, and secrets are not emitted.
- Retention settings must be included in backup/restore and incident-response procedures.
- Any exception must be recorded in `docs/launch-readiness.md` with an owner and expiry.
- Data retention approval evidence must pass validation before launch:

```bash
npm run retention:approval:validate -- path/to/retention-approval.json
npm run retention:execution:evidence:validate -- path/to/retention-execution-evidence.json
```

Synthetic fixtures must be validated explicitly:

```bash
npm run retention:approval:validate -- --allow-synthetic test-fixtures/retention/retention-approval-complete.synthetic.json
npm run retention:execution:evidence:validate -- --allow-synthetic test-fixtures/retention/retention-execution-complete.synthetic.json
```

`npm run smoke:retention-approval-validation` must stay in `npm run check` to protect approver roles, policy class coverage, retention-window matches, operational controls, waiver metadata, evidence redaction, and synthetic-fixture handling.

`npm run smoke:retention-execution-evidence-validation` must stay in `npm run check` to protect scoped credentials, destructive guard proof, policy-date matching, dry-run and execute-mode evidence, per-class zero-failure checks, redaction, and synthetic-fixture handling.
