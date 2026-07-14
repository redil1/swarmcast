# Production Environment Inventory

This template records the production deployment shape. Fill every value before launch and attach it to the launch readiness record.

## Core Services

| Service | Host/Node | Image Ref/Digest | Port | Health Check | Owner |
|---|---|---|---|---|---|
| auth | TBD | TBD | 7003 | `/metrics` and `/jwks` | TBD |
| ingest | TBD | TBD | 7001 | `/metrics` | TBD |
| tracker | TBD | TBD | 7000/7002 | `/metrics` | TBD |
| control-plane | TBD | TBD | 7010 | `/metrics` | TBD |
| retention-worker | TBD | TBD | 7020 | `/health` and `/metrics` | TBD |
| prometheus | TBD | TBD | 9090 | `/-/ready` | TBD |
| alertmanager | TBD | TBD | 9093 | `/-/ready` | TBD |
| grafana | TBD | TBD | 3000 | `/api/health` | TBD |
| edge-metrics | TBD | TBD | 9101 | `/health` and `/metrics` | TBD |

## Edge Nodes

| Node ID | Region | Public Base URL | Origin Route | Cache Path | Capacity | Status |
|---|---|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD | TBD | Planned |

## Durable Control-Plane State

Production environment files must set persistent mounted SQLite paths for `CATALOG_DB_PATH` and `PLACEMENT_DB_PATH`. These paths are validated by `npm run env:production:validate -- path/to/production.env` and must be included in backup and restore evidence.

## Required Secrets

- `INTERNAL_TOKEN`
- auth signing key material and persistent `AUTH_KEY_PATH`
- app API key
- TLS certificate paths
- Alertmanager receiver endpoints
- retention datastore credentials or `RETENTION_STORE_MODULE` deployment config
- `RETENTION_STORE_HTTP_TOKEN` when using the built-in HTTP retention store
- production catalog source credentials if applicable

## Launch Evidence

- immutable image tags and digest-pinned image refs
- host provisioning evidence that passes `npm run host:provisioning:evidence:validate -- path/to/host-provisioning-evidence.json`
- production secrets evidence that passes `npm run secrets:evidence:validate -- path/to/secrets-evidence.json`, including secret purpose, production scope, storage, rotation policy, runtime injection, access-review, backup/restore, redaction-proof, and no-raw-secret evidence
- deployment execution evidence that passes `npm run deployment:evidence:validate -- path/to/deployment-evidence.json`, with service command coverage, digest-pinned pulls, `up --no-build`, service health, post-deploy smokes, rollback readiness, and exact evidence markers
- production smoke evidence that passes `npm run production:smoke:evidence:validate -- path/to/production-smoke-evidence.json`
- nginx/TLS evidence that passes `npm run nginx:tls:evidence:validate -- path/to/nginx-tls-evidence.json`, including valid certificate, hostname verification, origin auth, authorized segment fetch, edge MISS/HIT, cross-token cache reuse, source URL redaction, cache-key redaction, and no third-party CDN fallback; local guard coverage remains `npm run smoke:nginx-tls-evidence-validation`
- source allowlist evidence that passes `npm run source:allowlist:evidence:validate -- path/to/source-allowlist-evidence.json`
- Alertmanager fire-drill screenshot or log

## Alertmanager Receiver Gate

Before launch, validate the rendered production Alertmanager receiver file:

```bash
npm run alertmanager:receivers:validate -- path/to/alertmanager.yml
npm run smoke:alertmanager-routing -- path/to/alertmanager.yml
npm run alertmanager:fire-drill:validate -- path/to/alertmanager-fire-drill.json
```

The receiver validator requires `oncall-default` and `oncall-critical`, one HTTPS webhook per receiver, `send_resolved: true`, distinct default and critical URLs, no URL credentials, and no query-string secrets. The routing smoke proves warning alerts use the default receiver, critical alerts use the critical receiver, and resolved critical alerts are delivered. The fire-drill evidence validator requires notification observation and acknowledgment for warning, critical, and resolved critical alerts. The fixtures at `test-fixtures/monitoring/alertmanager-production.yml` and `test-fixtures/monitoring/alertmanager-fire-drill-complete.synthetic.json` are synthetic coverage only.

Production compose uses `ALERTMANAGER_CONFIG_PATH` for the mounted receiver file. The production env validator requires this to be an absolute persistent `.yml` or `.yaml` path so production deploys do not silently use the bundled local placeholder receiver file.
- Android build artifact and device test result
- backup restore drill result
- retention worker `/metrics` scrape evidence
