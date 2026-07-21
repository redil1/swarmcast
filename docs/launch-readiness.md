# SwarmCast Launch Readiness Gate

This document is the release go/no-go checklist. A production launch is blocked until every required gate is marked complete by the owning reviewer.

## Hard Blockers

- Legal redistribution, rebroadcast, peer-relay, viewer-device retransmission, privacy disclosure, territory/platform, app store, and metrics-logging approval evidence passes `npm run legal:approval:validate -- path/to/legal-approval.json`; local guard coverage remains `npm run smoke:legal-approval-validation`.
- Privacy and store compliance evidence passes `npm run privacy:store:validate -- path/to/privacy-store-compliance.json`; local guard coverage remains `npm run smoke:privacy-store-compliance-validation`.
- Android release Gradle properties pass `npm run android:release-config:validate -- path/to/release.properties`; an RLNC-enabled release must also pass a real decision through `--rlnc-decision path/to/android-rlnc-decision.json`; local guard coverage remains `npm run smoke:android-release-config-validation`.
- Android app attestation evidence passes `npm run android:attestation:evidence:validate -- path/to/android-attestation-evidence.json`, proving Play Console linking, API enablement, service-account authorization, package/signing-certificate matching, request-hash binding, automatic replay protection, recognized/licensed app verdicts, device integrity, successful auth issuance, and no raw token retention; local guard coverage remains `npm run smoke:android-attestation-evidence-validation`.
- Android debug and release build evidence passes `npm run android:ci:evidence:validate -- path/to/android-ci-evidence.json`, including `swarmcast-android-debug-apk`, `swarmcast-android-release-unsigned-apk`, and checksum sidecar evidence; local guard coverage remains `npm run smoke:android-ci-evidence-validation`.
- Android Delivery-Fleet-only playback evidence passes `npm run android:playback:evidence:validate -- path/to/android-playback-evidence.json` with 30-minute WiFi and cellular soaks, edge cache hit evidence, and crash-free playback; local guard coverage remains `npm run smoke:android-playback-evidence-validation`.
- Android P2P transfer evidence passes `npm run android:p2p:evidence:validate -- path/to/android-p2p-evidence.json` with WebRTC DataChannel, tracker-signaling relay, verified segment hashes, edge fallback, P2P-disable closure, cellular receive-only/no-upload proof, direct-versus-relay payload attribution, recomputed offload, and reconciled relay egress; local guard coverage remains `npm run smoke:android-p2p-evidence-validation`.
- Android RLNC decoder decision evidence passes `npm run android:rlnc:decision:validate -- path/to/android-rlnc-decision.json`; local guard coverage remains `npm run smoke:android-rlnc-decision-validation`.
- Threat model sign-off evidence passes `npm run threat:model:validate -- path/to/threat-model-review.json` for auth, tracker, control plane, ingest, segment metadata bus, retention worker, edge, Android P2P, RLNC, release, and dependency supply chain; local guard coverage remains `npm run smoke:threat-model-review-validation`.
- Security review evidence passes `npm run security:review:validate -- path/to/security-review.json`; local guard coverage remains `npm run smoke:security-review-validation`.
- Dependency review evidence passes `npm run dependency:review:validate -- path/to/dependency-review.json`; evidence must cover npm audit, SBOM, release image refs, image scans, Android debug/release builds, inventory decisions, reviewer roles, and waiver expiry; local guard coverage remains `npm run smoke:dependency-review-validation`.
- Repository governance evidence passes `npm run repository:governance:evidence:validate -- path/to/repository-governance-evidence.json` with protected `main`, strict required CI checks, pull-request-only changes, admin enforcement, disabled force-push/deletion, CODEOWNERS, Dependabot version/security updates, secret scanning, and push protection; local guard coverage remains `npm run smoke:repository-governance-evidence-validation`.
- Release artifact evidence includes the `swarmcast-release-manifest` and `swarmcast-sbom` artifacts, plus `npm run smoke:release-manifest-production` output proving the production env can generate a digest-required 15-image manifest.
- Runtime image vulnerability scan reports pass `npm run image:scan:validate`, local report-level guard coverage remains `npm run smoke:image-scan-report-validation`, the release bundle passes `npm run image:scan:bundle:validate -- --manifest var/release/swarmcast-release-manifest.json var/scans/*.trivy.json`, and launch evidence references all 15 expected service and infrastructure scan report paths.
- Owned TURN packaging passes `npm run smoke:turn`; production evidence must additionally pass `npm run turn:capacity:evidence:validate -- path/to/turn-capacity-evidence.json` with short-lived REST credentials, synchronized independent generators, sustained UDP and TLS capacity across two relay failure domains, Prometheus scraping, private-peer denial, Android relay candidate selection, direct-versus-relay payload attribution, host/provider egress reconciliation, and 30% headroom.
- Capacity/load ladder evidence passes `npm run capacity:plan:validate -- config/capacity-plan.json` without `--allow-draft` and `npm run load:ladder:validate -- path/to/load-ladder-evidence.json`, including measured direct-P2P offload, measured sustained TLS edge throughput, approved provider traffic terms, relay egress accounting, the self-sustaining sweep, and 1K/10K/100K single-channel cell stages; local guard coverage remains `npm run smoke:capacity-plan-validation` and `npm run smoke:load-ladder-evidence-validation`.
- Data retention approval evidence passes `npm run retention:approval:validate -- path/to/retention-approval.json`, retention execution evidence passes `npm run retention:execution:evidence:validate -- path/to/retention-execution-evidence.json`, and local guard coverage remains `npm run smoke:retention-approval-validation` plus `npm run smoke:retention-execution-evidence-validation`.
- Accessibility and UX evidence passes `npm run android:accessibility:validate -- path/to/android-accessibility-evidence.json` for TalkBack, 200% fonts, small screens, player controls, P2P/privacy controls, touch targets, error states, and localization readiness; local guard coverage remains `npm run smoke:android-accessibility-evidence-validation`.
- Host provisioning evidence passes `npm run host:provisioning:evidence:validate -- path/to/host-provisioning-evidence.json` with origin, edge, API, tracker, control-plane, retention-worker, TURN, and monitoring host coverage plus DNS, TLS, TURN port/range, internal-port deny, and compose-render evidence before production smoke evidence.
- Production secrets evidence passes `npm run secrets:evidence:validate -- path/to/secrets-evidence.json` before launch evidence is approved.
- Production environment config passes `npm run env:production:validate -- path/to/production.env`, `npm run smoke:production-env-validation`, and `npm run smoke:compose-production-env` before deployment.
- Final non-synthetic launch evidence must set `environment` to `production`; synthetic staging fixtures are shape-only and require `--allow-synthetic`.
- Deployment execution evidence passes `npm run deployment:evidence:validate -- path/to/deployment-evidence.json`, proving each required service image was pulled, deployed with `up --no-build`, checked healthy, post-deploy smoked, and rollback-ready with exact service and control evidence markers.
- Real nginx/TLS edge and origin playback evidence passes `npm run nginx:tls:evidence:validate -- path/to/nginx-tls-evidence.json`; evidence must name valid certificate, hostname verification, origin auth, authorized segment fetch, edge MISS/HIT, cross-token cache reuse, source URL redaction, cache-key redaction, and no third-party CDN fallback; local regression coverage remains `npm run smoke:nginx-origin-playback`, `npm run smoke:nginx-edge-cache`, and `npm run smoke:nginx-tls-evidence-validation`.
- Source allowlist evidence passes `npm run source:allowlist:evidence:validate -- path/to/source-allowlist-evidence.json`, proving approved `SOURCE_ALLOWED_HOSTS`, private-network rejection, production env validation, and production catalog preflight.
- Signed catalog import evidence passes `npm run catalog:import:validate -- path/to/catalog-import-evidence.json`; local guard coverage remains `npm run smoke:catalog-import-validation`.
- Production smoke evidence passes `npm run production:smoke:evidence:validate -- path/to/production-smoke-evidence.json`.
- Prometheus alert rules pass `npm run prometheus:alerts:validate`, including the launch alert inventory, warning and critical severity coverage, and runbook links; local guard coverage remains `npm run smoke:prometheus-alerts-validation`.
- Grafana dashboard JSON passes `npm run grafana:dashboard:validate`; local guard coverage remains `npm run smoke:grafana-dashboard-validation`.
- Alertmanager fire-drill evidence passes `npm run alertmanager:fire-drill:validate -- path/to/alertmanager-fire-drill.json`; evidence must name receiver validation, routing smoke, warning firing, critical firing, critical resolved, expected receivers, and acknowledgment markers.
- The rendered production Alertmanager receiver file passes `npm run alertmanager:receivers:validate -- path/to/alertmanager.yml` before the fire-drill.
- Staging chaos drill evidence passes `npm run chaos:staging:validate -- path/to/staging-chaos-evidence.json`, including a peer-health incident drill with `SwarmcastPeerHashFailures` and `docs/runbooks/peer-health.md`; local guard coverage remains `npm run smoke:staging-chaos-evidence-validation`.

## Required Production Smokes

Validate the combined smoke record with:

```bash
npm run production:smoke:evidence:validate -- path/to/production-smoke-evidence.json
```

- Auth token issuance and verification.
- Catalog source preflight passes against the production catalog from the ingest network path.
- Catalog search and pagination against production-sized catalog.
- Channel demand starts ingest and produces fMP4 HLS.
- Edge cache returns `MISS` then `HIT` for authenticated segment fetch.
- Tracker join, peer list, signal relay, stats intake, and metrics endpoint.
- Retention worker `/health` and `/metrics` expose a recent successful run.
- Rolling 5-minute offload dashboard and alert query return live values.

## Canary Gates

- Crash-free Android sessions meet target.
- Startup latency, stall rate, and buffer depth stay within launch budget.
- Rolling 5-minute offload ratio stays above launch threshold.
- Edge egress and origin egress remain inside capacity plan.
- Auth verification failures, tracker peer drops, peer timeouts, peer hash failures, and peer disconnects remain below alert thresholds.
- Capacity plan passes `npm run capacity:plan:validate -- config/capacity-plan.json` with measured direct-P2P `rho`, reconciled owned relay egress, cache hit ratio, peak viewers, bitrate, sustained TLS node capacity, and approved provider traffic terms. The committed draft is expected to fail this launch command until measurements replace pending evidence.
- `npm run smoke:capacity-plan-validation` remains in `npm run check` to protect the capacity gate failure cases.

Validate canary metric snapshots before each rollout step:

```bash
npm run canary:metrics:validate -- path/to/canary-metrics.json
```

This gate uses `config/performance-budgets.json` for startup latency, stall rate, buffer depth, and edge cache hit ratio, and uses the snapshot limits for crash-free sessions, offload ratio, edge/origin egress, auth verification failures, tracker peer drops, peer timeouts, peer hash failures, and peer disconnects.

`npm run smoke:canary-metrics-validation` must stay in `npm run check` to protect those budget and threshold failure cases.

Validate the staged rollout record after each cohort:

```bash
npm run canary:rollout:evidence:validate -- path/to/canary-rollout-evidence.json
```

Each staged rollout record must carry per-cohort peer-health evidence from the metric snapshot, including bounded `peerTimeouts5m`, zero `peerHashFailures5m`, and zero `peerDisconnects5m`.

## Rollback Requirements

- Every service image has an immutable tag and previous stable tag.
- Database and placement state backups are restorable in staging.
- Staging restore evidence passes `npm run restore:evidence:validate -- path/to/restore-evidence.json`; local guard coverage remains `npm run smoke:restore-evidence-validation`.
- Android release can be halted or rolled back through the distribution channel.
- App incident runbook can force Delivery-Fleet-only playback and halt Android rollout.
- Tail channels can be forced to Delivery-Fleet-only mode during incidents.
- Rollback drill evidence passes `npm run rollback:evidence:validate -- path/to/rollback-evidence.json` after rehearsing `docs/runbooks/rollback-drill.md` against staging image tags.

## Go/No-Go Record

| Gate | Owner | Status | Evidence |
|---|---|---|---|
| Legal approval | TBD | Partial | `npm run legal:approval:validate` enforces approval evidence shape; signed approval remains open |
| Privacy/store compliance | TBD | Partial | `npm run privacy:store:validate` enforces privacy policy, store notes, support FAQ, peer disclosure, upload controls, telemetry redaction, and retention linkage evidence shape; final real copy approval remains open |
| Android CI build | Release Engineering | Ready | Protected `main` GitHub Actions run `29785361703` passed Android unit tests and debug/release assembly at commit `6ffcb8335108b18253280d7929d59ba15d6cd297`; both downloaded artifacts passed their portable SHA-256 sidecars, and `evidence/android/ci-build-29785361703.json` passes `npm run android:ci:evidence:validate` |
| Android app attestation | TBD | Partial | Request-bound Play Integrity is implemented and required by production/release config; real Play Console linkage and Play-installed physical-device evidence remain open |
| Real device playback | TBD | Blocked | 30-minute WiFi and cellular Delivery-Fleet-only device soaks are shape-gated, but real device evidence is not run |
| Real nginx/TLS smoke | TBD | Partial | Origin/edge TLS evidence shape is enforced by `npm run nginx:tls:evidence:validate` with TLS, origin auth, edge MISS/HIT, cross-token cache reuse, redaction, and no-CDN markers; real host/staging evidence remains open |
| Image scan reports | TBD | Partial | `npm run image:scan:bundle:validate` enforces one clean scan report per digest-pinned release image, and launch evidence must reference all 15 service and infrastructure scan report paths; real production scan artifacts remain open |
| Production smokes | TBD | Partial | `npm run production:smoke:evidence:validate` enforces combined smoke evidence shape; real production/staging execution remains open |
| Canary rollout | TBD | Partial | `npm run canary:rollout:evidence:validate` enforces staged rollout, metric validation, rollback/halt, alert, support, and no-third-party-CDN evidence shape; real rollout remains open |
| Alert receiver fire-drill | TBD | Partial | `npm run alertmanager:fire-drill:validate` enforces fire-drill evidence shape with receiver validation, routing smoke, warning, critical, resolved-critical, receiver, and acknowledgment markers; real receiver notification evidence remains open |
| Capacity review | TBD | Blocked | No VM/WebRTC load ladder results |
| Dependency review | TBD | Blocked | `npm run dependency:review:validate` enforces audit/SBOM/image/Android/inventory decision evidence, required reviewer roles, and waiver expiry shape; `docs/dependency-review.md` still records real open image, Android, and RLNC gates |
| Repository governance | Release Engineering | Ready | GitHub enforcement and protected PR #1 are recorded in `evidence/security/repository-governance-main-20260720.json` and pass the repository-governance evidence validator |
| Threat model sign-off | TBD | Blocked | `docs/threat-model.md` records open Android, edge, dependency, retention, and chaos gates |
| Data retention approval | TBD | Partial | `npm run retention:approval:validate` and `npm run retention:execution:evidence:validate` enforce approval/execution evidence shape; real scoped execution remains open |
| Accessibility/UX baseline | TBD | Blocked | 200% font, small-screen, TalkBack, and touch-target evidence are shape-gated; Android device pass is not run |
| Host provisioning | TBD | Partial | `npm run host:provisioning:evidence:validate` enforces host bootstrap evidence shape; real host dry run remains open |
| Production secrets | TBD | Partial | `npm run secrets:evidence:validate` enforces secret purpose, production scope, storage, rotation policy, runtime injection, access-review, backup/restore, redaction, and no-raw-secret evidence shape; launch evidence must include `secret-storage`, `rotation-policy`, `runtime-injection`, `access-review`, `redaction-proof`, `backup-restore`, and `no-raw-secret`; real secret provisioning remains open |
| Production environment config | TBD | Partial | `npm run env:production:validate`, `npm run smoke:production-env-validation`, and `npm run smoke:compose-production-env` gate env shape and compose rendering; real operator env remains open |
| Catalog import | TBD | Partial | `npm run catalog:import:validate` enforces signed, sanitized catalog snapshot promotion evidence; real operator import remains open |
| Deployment execution | TBD | Partial | `npm run deployment:evidence:validate` enforces release manifest, digest pins, service command coverage, pull, `up --no-build`, service health, post-deploy smoke, rollback-ready, and exact evidence markers; real deployment remains open |
| Chaos drills | TBD | Blocked | `docs/chaos-drills.md` records local tracker restart, ffmpeg failure, and control-plane placement restart gates; Android playback, edge-node, ingest-node, and full control-plane staging drills remain open |

## Machine-Readable Launch Evidence

Before a release can be approved, attach a JSON evidence bundle to the release record and validate it with:

```bash
npm run launch:evidence:validate -- path/to/launch-evidence.json
```

The validator requires every hard blocker to be present, owned, complete, and backed by evidence. It fails by default when any gate is `blocked`, `partial`, or `waived`; use `--allow-incomplete` only for rehearsal or shape checks before the final go/no-go review.

Required gate IDs:

- `legal-approval` with `legal:approval:validate`, `redistribution-rights`, `peer-relay-rights`, `viewer-device-retransmission`, and `privacy-disclosure`
- `privacy-store-compliance` with `privacy:store:validate`, `docs/privacy-store-compliance.md`, `support-faq-reviewed`, and `app-store-notes-reviewed`
- `release-artifacts`
- `android-release-config`
- `android-ci-build` with `android:ci:evidence:validate`, `swarmcast-android-debug-apk`, and `swarmcast-android-release-unsigned-apk`
- `android-device-playback` with `android:playback:evidence:validate`, `delivery-fleet-only`, `30m-soak`, `wifi`, and `cellular`
- `android-p2p-transfer` with `android:p2p:evidence:validate`, `webrtc-datachannel`, `tracker-signaling-relay`, `verified-segment-hash`, `cellular-no-upload`, `ice-network-class`, and `ice-selected-candidate-type`
- `android-rlnc-decision` with `android:rlnc:decision:validate`
- `threat-model-signoff` with `threat:model:validate`
- `security-review` with `security:review:validate`
- `dependency-review` with `dependency:review:validate`, `npm-audit`, `sbom`, `release-image-refs`, `image-scans`, `android-debug-build`, `android-release-build`, `inventory-decisions`, and `waiver-expiry`
- `repository-governance` with `repository:governance:evidence:validate`, `branch-protection-enabled`, `strict-required-checks`, `pull-request-required`, `admin-enforcement`, `force-push-disabled`, `deletion-disabled`, `codeowners`, `dependabot-version-updates`, `dependabot-security-updates`, `secret-scanning`, and `push-protection`
- `image-scan-reports`
- `data-retention-approval`
- `accessibility-ux-baseline` with `android:accessibility:validate`, `talkback-focus-order`, `large-font-200`, `small-screen-layout`, and `touch-targets`
- `host-provisioning` with `host:provisioning:evidence:validate`, `public-dns-configured`, `internal-ports-denied`, `tls-certificates-issued`, and `monitoring`
- `production-secrets`
- `production-environment` with `env:production:validate`, `smoke:production-env-validation`, and `smoke:compose-production-env`
- `turn-relay` with `smoke:turn`, `turn:capacity:evidence:validate`, `turn-rest-credentials`, `turn-udp-relay`, `turn-tls-relay`, `turn-prometheus`, `turn-private-peer-deny`, `android-relay-candidate-selected`, `direct-relay-payload-attribution`, `relay-egress-reconciled`, `relay-egress-included`, `turn-capacity-sustained`, `independent-load-generators`, `udp-tls-capacity`, and `provider-egress-reconciled`
- `deployment-execution` with `deployment:evidence:validate`, `release-manifest-validated`, `image-digests-pinned`, `compose-rendered`, `images-pulled`, `deployed-up-no-build`, `service-health`, `post-deploy-smokes`, and `rollback-ready`
- `nginx-tls-smoke` with `nginx:tls:evidence:validate`, `smoke:nginx-origin-playback`, `smoke:nginx-edge-cache`, `valid-certificate`, `hostname-verified`, `origin-auth-401`, `origin-segment-200`, `edge-cache-miss`, `edge-cache-hit`, `cross-token-hit`, `no-third-party-cdn`, `source-url-redaction`, and `cache-key-redaction`
- `source-allowlist`
- `catalog-import` with `catalog:import:validate` and `smoke:catalog-import-validation`
- `production-smokes` with `production:smoke:evidence:validate`, `source-preflight`, `catalog-search-pagination`, `ingest-demand-segments`, `edge-cache-miss-hit`, `tracker-join-peer-list-signal-stats-metrics`, `retention-health-metrics`, and `offload-dashboard-alert-query`
- `canary-rollout` with `canary:rollout:evidence:validate`, `canary:metrics:validate`, `peerTimeouts5m`, `peerHashFailures5m=0`, and `peerDisconnects5m=0`
- `prometheus-alerts` with `prometheus:alerts:validate`, `SwarmcastLowOffloadRatio`, `SwarmcastPeerHashFailures`, `SwarmcastHighPlaybackStallRate`, `SwarmcastLowEdgeCacheHitRatio`, `SwarmcastIngestDegradedChannels`, `SwarmcastAuthVerifyFailures`, `SwarmcastRetentionJobFailures`, `warning`, `critical`, and `runbook-links`
- `grafana-dashboard` with `grafana:dashboard:validate`
- `alert-receiver-fire-drill` with `alertmanager:receivers:validate`, `alertmanager:fire-drill:validate`, `smoke:alertmanager-routing`, `warning-firing`, `critical-firing`, `critical-resolved`, `oncall-default`, `oncall-critical`, and `acknowledged`
- `capacity-load-ladder` with `capacity:plan:validate`, `load:ladder:validate`, `direct-p2p-offload-measured`, `edge-tls-throughput-measured`, `provider-traffic-terms-approved`, `relay-egress-included`, `selfSustainingSweep`, `webrtc-datachannel`, `tracker-signaling-relay`, and the `single-channel-cell-ladder-1k`, `single-channel-cell-ladder-10k`, and `single-channel-cell-ladder-100k` markers
- `staging-chaos-drills` with `chaos:staging:validate`, `android-playback-continuity`, `owned-edge-failover`, `placement-failover`, `durable-placement-restore`, `peer-health-incident`, `SwarmcastPeerHashFailures`, and `docs/runbooks/peer-health.md`
- `restore-drill` with `restore:evidence:validate` and `docs/runbooks/restore-drill.md`
- `rollback-drill` with `rollback:evidence:validate`, `docs/runbooks/rollback-drill.md`, `android-release-halt-ready`, `app-incident-delivery-fleet-only`, and `tail-edge-only-mode`

Synthetic evidence fixtures must be validated with `--allow-synthetic` and cannot be used as production launch evidence.
