# Dependency Review

Review date: 2026-07-14

This review records the production dependency posture for SwarmCast. It does not approve launch by itself; it defines the dependency gates that must be closed before launch readiness can pass.

## Current Posture

| Area | Dependency | Current Project Version | Launch Decision | Release Gate |
|---|---|---:|---|---|
| Server | Node.js runtime | `node:22-slim` / `>=22 <24` | Staging only | Pin service images by digest and keep Node 22/23 until `uWebSockets.js` is upgraded or Node 24 native binary support is validated. |
| Server | `jose` | `^5.9.0`, lockfile `5.10.0` | Staging only | Pin exact version or complete `jose` 6 migration review with auth/token regression tests. |
| Server | `uWebSockets.js` | `v20.51.0` git tag | Staging only | Validate Node native binary compatibility and tracker WebSocket soak. |
| Ingest | `ffmpeg` | Debian apt package in image | Blocked | Pin base image digest or package snapshot and rerun packaging/playback smokes. |
| Edge | `nginx` | `nginx:1.27` | Blocked | Move to a supported stable tag, pin by digest, and rerun origin/edge smokes. |
| Monitoring | Prometheus | `v2.53.0` | Staging only | Review Prometheus 3 migration or document v2 support choice, then pin image digest. |
| Monitoring | Alertmanager | `v0.27.0` | Staging only | Upgrade review and receiver fire-drill, then pin image digest. |
| Monitoring | Grafana | `11.1.0` | Staging only | Review major-version upgrade path and pin image digest. |
| Monitoring | node_exporter | `v1.8.0` | Staging only | Review latest exporter version and pin image digest. |
| Android | Android Gradle Plugin | `8.7.3` | Staging only | Local wrapper-based debug/release assembly passes; review AGP 9.x before production. |
| Android | Kotlin Gradle plugins | `2.0.21` | Staging only | Local wrapper-based debug/release assembly passes; review Kotlin 2.4 migration before production. |
| Android | AndroidX Media3 | `1.6.0` | Blocked | Run playback soak on real devices and evaluate current stable Media3. |
| Android | OkHttp | `4.12.0` | Blocked | Evaluate OkHttp 5 migration after tracker/auth tests and real-device playback pass. |
| Android | Stream WebRTC Android | `1.3.8` | Blocked | Upgrade or explicitly waive after multi-device WebRTC/DataChannel transfer and license review. |
| Android | Backblaze JavaReedSolomon GF(2^8) | `d3c481dc69471e0c47ff6f67f33d53bde941675e` | Blocked | Pure-Java field arithmetic is integrated; complete MIT license/security approval, fuzzing, device benchmarks, battery measurement, and hash-verified swarm decode before release enablement. |

## Upstream Check

- Node.js: official release table shows Node 22 is still LTS, with newer Node 24 LTS and Node 26 current lines available. Local Node 24 is not approved for tracker runtime because `uWebSockets.js` v20.51.0 does not ship the needed native binary.
- `jose`: npm lists `6.2.3` as the latest package while this repo is locked to `5.10.0`.
- `uWebSockets.js`: GitHub release listings show newer `v20.65.0` after the repo's `v20.51.0` tag.
- `nginx`: nginx.org lists newer stable/mainline releases than `1.27`; Docker Hub shows the current `nginx:1.27` tag is old and tag-only.
- Prometheus: official downloads list Prometheus `3.13.0` as latest, while this repo uses `2.53.0`.
- Alertmanager: GitHub release listings show `0.33.1` newer than this repo's `0.27.0`.
- Grafana: Grafana download pages list `13.1.0`, while this repo uses `11.1.0`.
- AndroidX Media3: Maven listings show stable releases newer than this repo's `1.6.0`.
- OkHttp: official docs show OkHttp 5.x artifacts available while this repo uses `4.12.0`.
- Stream WebRTC Android: Maven listings show `1.3.10` newer than this repo's `1.3.8`.
- Backblaze JavaReedSolomon: the selected MIT-licensed pure-Java GF(2^8) implementation is pinned to commit `d3c481dc69471e0c47ff6f67f33d53bde941675e`; the app's RLNC row reduction uses the same `0x11d` field polynomial as the server/headless implementation and avoids a native Android ABI.

## Required Before Production

- Run `npm audit --audit-level=moderate` and keep zero moderate-or-higher findings.
- Generate an SBOM for Node workspaces, Android artifacts, and runtime container images with `npm run sbom:generate -- --output var/sbom/swarmcast-sbom.json`, and verify parser coverage with `npm run sbom:generate -- --check`.
- Replace tag-only local defaults with digest-pinned images from production env refs after final upgrade decisions and verify all service and infrastructure release refs with `npm run release:images:check` plus `npm run smoke:compose-production-env`.
- Run vulnerability scans for service and infrastructure images after final Docker builds, write Trivy JSON reports under `var/scans/`, validate each report with `npm run image:scan:validate -- var/scans/*.json`, keep report-level guard coverage in `npm run check` with `npm run smoke:image-scan-report-validation`, and validate release coverage with `npm run image:scan:bundle:validate -- --manifest var/release/swarmcast-release-manifest.json var/scans/*.trivy.json`.
- Run Android debug and release builds in CI before approving any Android dependency versions.
- Run real-device playback, WebRTC/DataChannel, and RLNC decode tests before approving Android media/P2P dependencies.
- Validate the pinned Android RLNC decision with malformed-packet fuzzing, decode/allocation/battery budgets, at least two real devices, and SHA-256 verification before changing `SWARMCAST_RLNC_ENABLED` from `0`.
- Document every dependency upgrade or waiver in the launch-readiness record.
- Record the final dependency decisions in a machine-readable evidence file and validate it before launch:

```bash
npm run dependency:review:validate -- path/to/dependency-review.json
```

Synthetic fixtures must be validated explicitly:

```bash
npm run dependency:review:validate -- --allow-synthetic test-fixtures/dependency/dependency-review-complete.synthetic.json
npm run image:scan:bundle:validate -- --allow-synthetic --manifest test-fixtures/security/image-scan-release-manifest.synthetic.json test-fixtures/security/scans/*.trivy.json
```

`npm run smoke:dependency-review-validation` must remain in `npm run check` to protect required checks, inventory decision coverage, required reviewer roles, waiver metadata and expiry, exact evidence markers, evidence redaction, and synthetic-fixture handling.

## Sources

- https://nodejs.org/en/about/previous-releases
- https://www.npmjs.com/package/jose
- https://github.com/uNetworking/uWebSockets.js/releases
- https://nginx.org/
- https://hub.docker.com/_/nginx
- https://prometheus.io/download/
- https://github.com/prometheus/alertmanager/releases
- https://grafana.com/grafana/download
- https://developer.android.com/build/releases/agp-9-2-0-release-notes
- https://kotlinlang.org/docs/releases.html
- https://developer.android.com/jetpack/androidx/releases/media3
- https://square.github.io/okhttp/
- https://central.sonatype.com/artifact/io.getstream/stream-webrtc-android
- https://github.com/Backblaze/JavaReedSolomon
