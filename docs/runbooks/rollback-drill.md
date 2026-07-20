# Rollback Drill Runbook

Use this runbook to rehearse or execute service rollback to the previous stable immutable image tag. Do not rebuild an old commit during an incident.

## Inputs

- Environment name.
- Incident or drill owner.
- Current image tag.
- Previous stable image refs.
- Digest-pinned image refs for app service and infrastructure `SWARMCAST_*_IMAGE` values.
- Link to the launch-readiness evidence record.

## Preflight

1. Freeze unrelated deployments.
2. Confirm the previous stable tag exists for `auth`, `ingest`, `tracker`, `control-plane`, `retention-worker`, and `turn`.
3. Confirm current auth key volume, placement state, retention action log, and monitoring data are backed up or covered by the restore drill.
4. Export the previous stable immutable image refs:

```bash
export SWARMCAST_AUTH_IMAGE=ghcr.io/org/repo/auth@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export SWARMCAST_INGEST_IMAGE=ghcr.io/org/repo/ingest@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
export SWARMCAST_TRACKER_IMAGE=ghcr.io/org/repo/tracker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
export SWARMCAST_CONTROL_PLANE_IMAGE=ghcr.io/org/repo/control-plane@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
export SWARMCAST_RETENTION_WORKER_IMAGE=ghcr.io/org/repo/retention-worker@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
export SWARMCAST_NGINX_IMAGE=nginx:1.27@sha256:1111111111111111111111111111111111111111111111111111111111111111
export SWARMCAST_PROMETHEUS_IMAGE=prom/prometheus:v2.53.0@sha256:2222222222222222222222222222222222222222222222222222222222222222
export SWARMCAST_ALERTMANAGER_IMAGE=prom/alertmanager:v0.27.0@sha256:3333333333333333333333333333333333333333333333333333333333333333
export SWARMCAST_GRAFANA_IMAGE=grafana/grafana:11.1.0@sha256:4444444444444444444444444444444444444444444444444444444444444444
export SWARMCAST_EDGE_NGINX_IMAGE=nginx:1.27@sha256:5555555555555555555555555555555555555555555555555555555555555555
export SWARMCAST_EDGE_METRICS_IMAGE=node:22-slim@sha256:6666666666666666666666666666666666666666666666666666666666666666
export SWARMCAST_NODE_EXPORTER_IMAGE=prom/node-exporter:v1.8.0@sha256:7777777777777777777777777777777777777777777777777777777777777777
export SWARMCAST_TURN_IMAGE=ghcr.io/org/repo/turn@sha256:8888888888888888888888888888888888888888888888888888888888888888
npm run release:images:check
docker compose -f infra/docker-compose.yml -f infra/docker-compose.release.yml config
docker compose --env-file .env.production -f infra/turn/docker-compose.yml config
```

The release override sets immutable image names. Use the rollback commands with `--no-build`; do not rely on local build contexts during rollback.

## Rollback

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.release.yml pull auth ingest tracker control-plane retention-worker
docker compose -f infra/docker-compose.yml -f infra/docker-compose.release.yml up -d --no-build auth ingest tracker control-plane retention-worker
docker compose -f infra/docker-compose.yml -f infra/docker-compose.release.yml ps
docker compose --env-file .env.production -f infra/turn/docker-compose.yml pull turn
docker compose --env-file .env.production -f infra/turn/docker-compose.yml up -d --no-build turn
docker compose --env-file .env.production -f infra/turn/docker-compose.yml ps turn
```

## Post-Rollback Smokes

- Auth token issuance and `/verify` pass.
- `npm run source:preflight` passes from the ingest network path.
- Catalog `/channels` and `/groups` respond.
- Channel demand starts ingest and produces recent segments.
- Tracker WebSocket join, signal relay, stats intake, and `/metrics` respond.
- Edge cache still returns authenticated `MISS` then `HIT`.
- Retention worker `/health` and `/metrics` respond.
- TURN accepts fresh short-lived credentials over UDP and TLS, rejects expired credentials and private-peer targets, and exposes metrics only to monitoring.

## Evidence

Validate the rollback drill record before attaching it to launch readiness:

```bash
npm run rollback:evidence:validate -- path/to/rollback-evidence.json
```

Synthetic shape checks can use the complete fixture:

```bash
npm run rollback:evidence:validate -- --allow-synthetic test-fixtures/rollback/rollback-drill-complete.synthetic.json
```

Attach this evidence to the launch-readiness record:

- current image tag and previous stable image tag
- current image digests and previous stable image digests
- compose config output using `infra/docker-compose.release.yml`
- pull and up command timestamps
- post-rollback smoke results
- dashboard snapshot for errors, stalls, offload ratio, edge egress, and origin egress
- decision to keep rollback, retry deploy, or open a follow-up incident
