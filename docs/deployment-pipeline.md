# Deployment Pipeline

## Artifacts

The release workflow builds immutable container images for:

- `auth`
- `ingest`
- `tracker`
- `control-plane`
- `retention-worker`

Each image is tagged with the requested release version and the Git commit SHA.

The release workflow generates `var/release/swarmcast-release-manifest.json`, validates it with `npm run release:manifest -- --input var/release/swarmcast-release-manifest.json --check`, uploads it as the `swarmcast-release-manifest` artifact, and links it from the release summary. The manifest records the release version, commit SHA, target environment, service and infrastructure image refs, expected SBOM artifact, expected image scan report paths, and required verification gates. After final service and infrastructure images are scanned, validate release coverage with `npm run image:scan:bundle:validate -- --manifest var/release/swarmcast-release-manifest.json var/scans/*.trivy.json`.

`npm run smoke:release-manifest-production` proves the production env file can generate a `--require-digests` production release manifest with all 12 image refs and matching expected scan report paths.

The release workflow also generates `var/sbom/swarmcast-sbom.json`, validates parser coverage with `npm run sbom:generate -- --check`, uploads it as the `swarmcast-sbom` artifact, and links it from the release summary.

Production deploys use `infra/docker-compose.release.yml` plus env-backed base and edge compose image refs so every production container is named with an explicit immutable image ref:

- `SWARMCAST_AUTH_IMAGE`
- `SWARMCAST_INGEST_IMAGE`
- `SWARMCAST_TRACKER_IMAGE`
- `SWARMCAST_CONTROL_PLANE_IMAGE`
- `SWARMCAST_RETENTION_WORKER_IMAGE`
- `SWARMCAST_NGINX_IMAGE`
- `SWARMCAST_PROMETHEUS_IMAGE`
- `SWARMCAST_ALERTMANAGER_IMAGE`
- `SWARMCAST_GRAFANA_IMAGE`
- `SWARMCAST_EDGE_NGINX_IMAGE`
- `SWARMCAST_EDGE_METRICS_IMAGE`
- `SWARMCAST_NODE_EXPORTER_IMAGE`

Production values must be digest-pinned with `@sha256:` and pass `npm run release:images:check` before deployment. This check covers the five app services plus nginx, Prometheus, Alertmanager, Grafana, edge metrics, and node exporter image refs. Operators must deploy the override with `pull` and `up --no-build` so rollback uses published images instead of rebuilding local contexts.

`npm run smoke:compose-production-env` also renders `infra/docker-compose.yml` with `infra/docker-compose.release.yml` and the production env fixture, proving the production compose plan contains the five digest-pinned service images plus digest-pinned nginx, Prometheus, Alertmanager, Grafana, edge metrics, and node exporter images.

Deployment execution evidence must be attached after staging and production promotion:

```bash
npm run deployment:evidence:validate -- path/to/deployment-evidence.json
```

Synthetic shape coverage can be checked with:

```bash
npm run deployment:evidence:validate -- --allow-synthetic test-fixtures/deployment/deployment-complete.synthetic.json
```

## Promotion

1. Run CI on the target commit.
2. Run the release workflow with `environment=staging`.
3. Deploy the immutable image tags to staging.
4. Run production smokes from `docs/launch-readiness.md`.
5. Promote the same immutable tags to production after go/no-go approval.

## CI Gates

CI must pass `npm run verify`, `npm audit --audit-level=moderate`, Android debug/release Gradle assembly, origin and edge compose rendering, `npm run smoke:nginx-config`, `npm run smoke:nginx-origin-playback`, and `npm run smoke:nginx-edge-cache` before a release workflow is run.

## Rollback

Rollback uses the previous stable immutable tag. Do not rebuild an old commit during an incident.
The operator procedure lives in `docs/runbooks/rollback-drill.md`.

Required rollback evidence:

- JSON drill record that passes `npm run rollback:evidence:validate -- path/to/rollback-evidence.json`
- previous stable image tag
- deployment timestamp
- service owner
- reason for rollback
- post-rollback smoke result

## Release Notes

Every release must include:

- version
- commit SHA
- services changed
- migrations or state changes
- known risks
- rollback tag
- launch-readiness evidence link
- `swarmcast-release-manifest` artifact link
- `swarmcast-sbom` artifact link
