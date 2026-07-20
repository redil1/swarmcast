# Deployment Pipeline

## Artifacts

The release workflow builds or mirrors immutable container images in GHCR for all 13 runtime components:

- `auth`
- `ingest`
- `tracker`
- `control-plane`
- `retention-worker`
- `nginx`
- `prometheus`
- `alertmanager`
- `grafana`
- `edge-nginx`
- `edge-metrics`
- `node-exporter`
- `turn`

Each image is tagged with the requested release version and Git commit SHA, resolved back to its registry digest, scanned with Trivy, documented with a CycloneDX image SBOM, and signed plus verified with keyless Cosign identity. All workflow actions are pinned to immutable release commits.

The release workflow generates `var/release/swarmcast-release-manifest.json`, validates it with `npm run release:manifest -- --input var/release/swarmcast-release-manifest.json --check`, uploads it as the `swarmcast-release-manifest` artifact, and links it from the release summary. The manifest records the release version, commit SHA, target environment, service and infrastructure image refs, expected SBOM artifact, expected image scan report paths, and required verification gates. After final service and infrastructure images are scanned, validate release coverage with `npm run image:scan:bundle:validate -- --manifest var/release/swarmcast-release-manifest.json var/scans/*.trivy.json`.

`npm run smoke:release-manifest-production` proves the production env file can generate a `--require-digests` production release manifest with all 13 image refs and matching expected scan report paths.

The release workflow also generates `var/sbom/swarmcast-sbom.json`, validates parser coverage with `npm run sbom:generate -- --check`, uploads it as the `swarmcast-sbom` artifact, and links it from the release summary. Per-image CycloneDX SBOMs, Cosign verification records, digest records, and all 13 real Trivy JSON reports are uploaded as separate release evidence artifacts.

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
- `SWARMCAST_TURN_IMAGE`

Production values must be digest-pinned with `@sha256:` and pass `npm run release:images:check` before deployment. This check covers the five app services plus nginx, Prometheus, Alertmanager, Grafana, edge metrics, node exporter, and coturn image refs. Operators must deploy the override with `pull` and `up --no-build` so rollback uses published images instead of rebuilding local contexts.

`npm run smoke:compose-production-env` also renders the base, release, edge, and TURN compose files with the production env fixture, proving every runtime component uses the expected digest-pinned image.

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
