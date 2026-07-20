# Build Status

Date: 2026-07-20

## Completed In Build Slice 1

- Created the monorepo foundation and Node workspace.
- Added the production backlog and implementation README.
- Added legal gate, assumptions register, ADRs, and host bootstrap runbook.
- Implemented ingest catalog parsing, public catalog sanitization, lazy channel manager, segment metadata helper, and REST server.
- Implemented tracker protocol parsing, peer scoring, contribution tiers, super-peer selection, swarm state, and segment announcements with `k`.
- Implemented control-plane ingest scheduler with bounded-load placement.
- Added auth service scaffold with ES256 JWT/JWKS behavior.
- Added origin nginx, edge nginx, Dockerfiles, compose skeletons, monitoring skeleton, and CI.
- Added unit tests and a local ingest smoke test.
- Locked Node dependency metadata.

## Completed In Build Slice 2

- Updated `BACKLOG.md` with explicit progress status and evidence.
- Added config validation for origin nginx, edge nginx, and compose files.
- Added auth service endpoint tests for token issuance, JWKS, and `/verify`.
- Added segment watcher tests for sequence parsing, SHA-256 metadata, `k`, and internal announce payloads.
- Added tracker message tests for `join`, `signal`, and `stats`.
- Added tracker stats aggregation for offload ratio, WiFi fraction, and super-peer fraction.
- Implemented tracker opaque signaling relay.

## Completed In Build Slice 3

- Added `npm run smoke:ffmpeg`.
- Generated local synthetic media with ffmpeg.
- Packaged the source into fMP4 HLS using the ingest ffmpeg argument builder.
- Validated playlist, `init.mp4`, segment output, SHA-256 metadata, segment sequence, and RLNC `k`.
- Adjusted ffmpeg args so HTTP sources use reconnect flags while local file smoke tests do not.
- Added unit coverage for source-specific reconnect behavior.

## Completed In Build Slice 4

- Added `npm run smoke:origin-auth`.
- Generated local fMP4 HLS media and served it through a token-gated origin contract.
- Verified playlist fetch fails without token.
- Verified token issuance through the auth service.
- Verified playlist and segment fetch with token.
- Verified media segment cache headers match the origin contract.

## Completed In Build Slice 5

- Added tracker token-bucket message rate limiting.
- Added tracker demand heartbeat helper for active swarms.
- Added Prometheus-format tracker metrics for peers, downloads, uploads, stalls, offload ratio, WiFi fraction, and super-peer fraction.
- Added tests for rate limiting, demand heartbeats, and metrics output.

## Completed In Build Slice 6

- Added `npm run smoke:edge-cache`.
- Added single-node `/live/...` edge route while preserving future `/edge/<node>/live/...` routing.
- Verified token-gated edge segment fetch rejects unauthorized requests.
- Verified first edge fetch reports `MISS`.
- Verified second edge fetch reports `HIT`.
- Verified cache hit reuses the same segment bytes and fills origin only once.

## Completed In Build Slice 7

- Added `npm run smoke:nginx-config`.
- The smoke generates temporary TLS certificates and runs real `nginx -t` in Docker when Docker and the `nginx:1.27` image are available.
- The smoke skips cleanly when Docker is unavailable.
- Local run skipped because the Docker daemon is not available in this environment.

## Completed In Build Slice 8

- Added ADR for WebRTC DataChannels.
- Added ADR for JWT auth.
- Added ADR for no TURN media relay.
- Added ADR for Hetzner-only operations.
- Marked the foundation ADR backlog item done.

## Completed In Build Slice 9

- Added control-plane catalog store with m3u import.
- Added paginated/searchable `/channels` API contract.
- Added `/groups` API contract.
- Added ETag support and 304 behavior.
- Ensured public catalog responses strip source URLs.
- Added control-plane Dockerfile and compose service.
- Added nginx API proxy for `/token`, `/channels`, and `/groups`.
- Added catalog store and catalog server tests.

## Completed In Build Slice 10

- Added file-backed channel placement registry.
- Added placement service on top of the bounded-load ingest scheduler.
- Added internal control-plane assignment, lookup, and release routes.
- Added compose persistence for placement state.
- Added tests for placement reuse, capacity handling, persistence, and internal route authorization.

## Completed In Build Slice 11

- Added tracker placement client.
- Tracker join flow now asks the control plane for channel placement when configured.
- Tracker demand POSTs use the assigned node's internal ingest URL.
- Tracker joined responses now return placement-aware edge and origin URL templates.
- Demand heartbeats reuse the assigned swarm demand URL.
- Added tests for placement-aware join flow and template building.

## Completed In Build Slice 12

- Added `npm run smoke:catalog-20k`.
- Generated a synthetic 20,000-channel m3u catalog.
- Verified paginated listing does not leak source URLs.
- Verified search and group filtering.
- Measured local timings: import 72.82 ms, first page 0.16 ms, search 3.90 ms, group filter 0.30 ms.

## Completed In Build Slice 13

- Added shared `@swarmcast/p2p` workspace.
- Added GF(2^8) arithmetic helpers.
- Added RLNC encoder, decoder, dependent-packet rejection, and recoding support.
- Added tests proving decode from independent packets and recoding from partial rank.
- Updated workspace test and syntax-check coverage to include packages.

## Completed In Build Slice 14

- Added shared P2P binary wire codec.
- Added frame encoding/parsing for the reserved protocol frame types.
- Added bitfield payload encoding/decoding.
- Added CODED payload encoding/decoding.
- Added RANK payload encoding/decoding.
- Added malformed-frame tests.

## Completed In Build Slice 15

- Added shared verified segment store.
- Added SHA-256 helper.
- Added rejection path for bad segment bytes.
- Added LRU byte-budget eviction.
- Added tests for verification and eviction behavior.

## Completed In Build Slice 16

- Added tracker tail policy module.
- Replaced hardcoded P2P minimum swarm size with `P2P_MIN_SWARM_SIZE`.
- Wired policy into tracker join behavior.
- Added compose and `.env.example` configuration.
- Added tests for edge-only versus P2P threshold behavior.

## Completed In Build Slice 17

- Extended internal demand calls with `swarmSize`.
- Tracker join and heartbeat demand calls now send current swarm size.
- Ingest channel manager stores swarm size per active channel.
- Tail channels below `TAIL_SWARM_THRESHOLD` use `TAIL_IDLE_TEARDOWN_MS`.
- Added tests for demand body forwarding and tail idle reaping.

## Completed In Build Slice 18

- Added ingest Prometheus metrics formatter.
- Added `/metrics` endpoint on ingest service.
- Added metrics for active, live, starting, degraded channels, and ffmpeg failure totals.
- Added Prometheus scrape config for ingest and tracker.
- Added tests for ingest metrics and server exposure.

## Completed In Build Slice 19

- Added auth Prometheus counters for issued tokens and verify outcomes.
- Added control-plane Prometheus metrics for catalog size, group count, and channel placements.
- Added Prometheus scrape config for auth and control plane.
- Added tests for auth metrics, control-plane metrics, and metrics endpoint exposure.

## Completed In Build Slice 20

- Added Grafana overview dashboard JSON.
- Added panels for tracker peers, offload ratio, super-peer fraction, ingest health, download split, auth activity, and control-plane state.
- Added dashboard JSON validation to config checks.

## Completed In Build Slice 21

- Added Prometheus alert rules for low offload ratio.
- Added alert for low super-peer fraction.
- Added alerts for degraded channels and ffmpeg failure spikes.
- Added alert for elevated auth verification failures.
- Wired alert rules into Prometheus config.
- Added alert presence checks to config validation.

## Completed In Build Slice 22

- Added runbook for low offload ratio.
- Added runbook for low super-peer fraction.
- Added runbook for ingest degradation and ffmpeg failure spikes.
- Added runbook for auth verification failures.
- Linked runbooks from alert annotations.
- Added runbook link validation to config checks.

## Completed In Build Slice 23

- Added auth token endpoint per-IP token bucket limiter.
- Supports `X-Forwarded-For` for proxy-aware limiting.
- Returns `429 rate_limited` when token issuance exceeds capacity.
- Added unit and endpoint tests.

## Completed In Build Slice 24

- Added `CodedSegmentReceiver`.
- Combines RLNC rank collection with manifest SHA-256 verification.
- Rejects completed decodes that do not match the tracker hash.
- Keeps verified bytes only after hash success.
- Added tests for verified decode and hash failure.

## Completed In Build Slice 25

- Added `npm run smoke:rlnc-swarm`.
- Simulates two partial peers, each holding half the rank.
- Downstream receiver reconstructs a full verified segment from recoded packets from both peers.
- Proves the headless/server RLNC harness supports partial-peer recoding behavior.

## Completed In Build Slice 26

- Added shared peer reputation module.
- Added success, timeout, reject, and hash-mismatch scoring events.
- Hash mismatches carry strong penalty and disconnect after two offenses.
- Added candidate sorting that excludes disconnected peers.
- Added `npm run smoke:poisoning` to prove a bad peer is disconnected after two failed manifest-hash decodes.

## Completed In Build Slice 27

- Added deterministic `HeadlessPeer` harness foundation.
- Headless peers use the shared RLNC, coded segment receiver, segment store, and reputation modules.
- Added tests showing a peer becomes a recoder after verified reconstruction.
- Added tests showing poisoning is recorded through the headless peer path.
- Added `npm run smoke:headless-peer`, proving a viewer reconstructs a segment from two partial peers.

## Completed In Build Slice 28

- Added `npm run smoke:headless-200`.
- Simulates one seed, 20 helpers, and 200 viewers.
- Every viewer reconstructs a verified segment from helper recoding.
- Provides a deterministic coded-swarm regression gate while the real WebRTC headless harness is still pending.

## Completed In Build Slice 29

- Added Android Gradle project scaffold.
- Added Android manifest with internet and network-state permissions.
- Added Compose app shell.
- Added Android `Wire.kt` matching the shared P2P frame contract.
- Added Android verified `SegmentStore`.
- Added Android `NetworkPolicy` scaffold.
- Added Android README documenting that SDK/Gradle verification is still pending in this environment.
- Added scaffold presence validation to config checks.

## Completed In Build Slice 30

- Added Android `AuthRepository`.
- Added token caching and pre-expiry refresh window.
- Added Android `ChannelRepository`.
- Added typed models for channel pages and groups.
- Repository scaffolds match the existing `/token`, `/channels`, and `/groups` API contracts.
- Added scaffold validation for the new repository files.

## Completed In Build Slice 31

- Added Android `TrackerClient`.
- Added typed tracker events for joined swarms, peer candidates, signal relays, segment announcements, and error messages.
- Added outbound join, stats, signal, and leave message helpers.
- Matched the Android tracker client scaffold to the existing tracker protocol used by the Node services.
- Added scaffold validation for the tracker client file.

## Completed In Build Slice 32

- Added Android `PlaybackUrls` helper.
- Added edge/origin segment URL tokenization that preserves existing query parameters and replaces stale `token` values.
- Added Android `PlayerHolder` wrapping Media3 `ExoPlayer`.
- Added HLS `MediaSource` setup, authenticated playlist handoff, `PlayerView` attach/detach, stop, and release lifecycle hooks.
- Extended Android scaffold validation to check key playback and tracker contract text.

## Completed In Build Slice 33

- Added Android `PeerConnectionManager`.
- Added WebRTC `PeerConnectionFactory` initialization and STUN-only ICE server configuration.
- Added ordered `sc-data` DataChannel creation and open/message/close callbacks.
- Added offer, answer, and ICE relay through the existing `TrackerClient.signal` path.
- Added peer close and `closeAll` lifecycle hooks.
- Extended Android scaffold validation for the peer manager contract.

## Completed In Build Slice 34

- Added Android `PeerLink`.
- Added whole-segment REQUEST, DATA, DATA_END, CANCEL, BITFIELD, and REJECT frame handling.
- Added peer bitfield tracking and single in-flight segment request support.
- Added upload-budget guarded segment serving with WebRTC buffered-amount backpressure.
- Added Android `UploadBudget` token-window scaffold.
- Added shared Android `Wire.CHUNK` constant and scaffold validation for PeerLink/upload budget contracts.

## Completed In Build Slice 35

- Added Android `SegmentScheduler`.
- Added local `SegmentStore` first lookup, peer candidate fetch attempts, and authenticated Delivery Fleet edge fallback.
- Added peer-byte SHA-256 verification through the existing `SegmentStore`.
- Added peer and edge download counters for future tracker stats reports.
- Added scheduler scaffold validation.

## Completed In Build Slice 36

- Added Android `PlaybackSessionCoordinator`.
- Wired token fetch, tracker join, network upload policy, Media3 playback start, tracker signal handling, segment announcements, peer handoff, and stat delta flushing.
- Added P2P enable/disable control that closes peer connections while preserving Delivery Fleet playback.
- Adjusted `PeerConnectionManager` open-channel handoff so opened DataChannels can become `PeerLink` instances.
- Added session coordinator scaffold validation.

## Completed In Build Slice 37

- Added Android Compose `SwarmCastScreen`.
- Added searchable channel-list scaffold with stable item keys.
- Added channel selection state and player-status panel.
- Added visible P2P upload switch wired through the screen callback.
- Replaced placeholder `MainActivity` text with the app surface scaffold.
- Added UI scaffold validation.

## Completed In Build Slice 38

- Added Android `AppConfig` loaded from manifest metadata.
- Added Gradle manifest placeholders for API base, tracker WebSocket URL, and app API key.
- Added `CatalogViewModel` with repository-backed search, refresh, page state, selection, and load-more hooks.
- Wired `MainActivity` to the catalog ViewModel instead of static placeholder state.
- Added config and ViewModel scaffold validation.

## Completed In Build Slice 39

- Wired channel selection to playback-session creation in `MainActivity`.
- Created the per-selection auth repository, tracker client, segment store, scheduler, network policy, player holder, and `PlaybackSessionCoordinator`.
- Passed the active Media3 player into the Compose `PlayerView`.
- Forwarded P2P switch changes into the active playback session.
- Released playback session resources from activity teardown.

## Completed In Build Slice 40

- Added Android `CatalogDiskCache`.
- Stores up to 20K catalog rows in app-private JSON cache.
- Filters cached rows by channel name, group, or TVG ID.
- Updated `CatalogViewModel` to show cached search results immediately before network refresh.
- Wired `MainActivity` to provide the cache to the catalog ViewModel.

## Completed In Build Slice 41

- Added P2P privacy disclosure dialog to the Compose app surface.
- Linked the disclosure from the P2P upload control.
- Kept the switch path wired to the active playback session.
- Added scaffold validation for the privacy surface text.

## Completed In Build Slice 42

- Added Android CODED payload helpers to `Wire`.
- Added Android RANK payload helpers to `Wire`.
- Added `PeerLink.requestCoded`, `sendCoded`, `sendRank`, and `rankFor` hooks.
- Added remote-rank tracking and CODED/REJECT completion handling.
- Extended scaffold validation for CODED/RANK protocol coverage.

## Completed In Build Slice 43

- Added Android `CodedFetch`.
- Added rank-based peer ordering for coded packet requests.
- Added deadline-bounded coded packet collection.
- Added `SegmentScheduler.collectCodedPackets` hook using tracker segment `k`.
- Added scaffold validation for coded fetch integration.

## Completed In Build Slice 44

- Added ADR 0008 for the Android RLNC library boundary.
- Documented that shipping Android must not use hand-rolled finite-field math without library selection or formal approval.
- Defined the Android decoder contract for accept, rank, complete, decode, and recode.
- Added release gates for decode CPU, allocation, fuzzing, license, ABI, and device swarm validation.
- Added ADR validation to config checks.

## Completed In Build Slice 45

- Added Android `NetworkCodingDecoder` interface.
- Added disabled guarded decoder implementation and factory.
- Added `SegmentScheduler.tryDecodeCodedSegment` seam that verifies decoded bytes through `SegmentStore` before returning them.
- Kept the default decoder disabled until the Android RLNC library decision is complete.
- Added decoder seam validation.

## Completed In Build Slice 46

- Tightened tracker seed-tier election to require super-peer eligible WiFi uploaders.
- Removed the post-election filter that could under-fill the seed tier.
- Added tests proving bounded seed-tier count, cellular exclusion, and rotation across segment announcements.

## Completed In Build Slice 47

- Changed tracker normal-peer candidate ordering from random-only to score-based.
- Preserved cellular viewer bias toward super-peers.
- Added a regression test proving throttled WiFi free riders rank behind full contributors.

## Completed In Build Slice 48

- Added a regression test proving implicit high-uplink WiFi peers are promoted as super-peer candidates.
- Verified cellular viewers receive promoted WiFi helpers before normal peers.

## Completed In Build Slice 49

- Added Android `PlaybackBufferPolicy`.
- Configured Media3 `DefaultLoadControl` with 30-60 second buffer targets.
- Added explicit playback and rebuffer thresholds.
- Exposed segment urgency timing for scheduler integration.
- Added buffer policy validation.

## Completed In Build Slice 50

- Added tracker `recordPeerStats` ingestion helper.
- Preserved cumulative upload/download/stall counters.
- Added per-peer rolling stats samples pruned to a 5-minute window.
- Added rolling aggregate stats and Prometheus 5-minute offload gauges.
- Added tests for cumulative plus rolling-window behavior.

## Completed In Build Slice 51

- Updated Grafana overview dashboard to use `swarmcast_tracker_offload_ratio_5m`.
- Added a rolling 5-minute download bytes panel.
- Updated low-offload alert to use the rolling 5-minute offload gauge.
- Added config validation that requires rolling offload metrics in dashboard and alert rules.

## Completed In Build Slice 52

- Added Alertmanager routing scaffold.
- Wired Prometheus to `alertmanager:9093`.
- Added Alertmanager service and persistent volume to compose.
- Added validation for Alertmanager routing and compose wiring.

## Completed In Build Slice 53

- Added tracker peer-drop alert and runbook.
- Added edge cache hit-ratio alert and runbook.
- Extended alert validation to require the new alerts and runbook links.

## Completed In Build Slice 54

- Added `docs/launch-readiness.md`.
- Documented hard blockers for legal approval, Android CI/builds, device playback, WebRTC/P2P, RLNC decoder selection, real nginx/TLS smoke, and Alertmanager fire-drills.
- Added production smoke, canary, rollback, and go/no-go sections.
- Added launch readiness validation.

## Completed In Build Slice 55

- Added GitHub release workflow.
- Release workflow verifies the repo before building service images.
- Builds auth, ingest, tracker, and control-plane images with immutable version and commit SHA tags.
- Pushes images to GHCR when enabled and writes release summary notes.
- Added deployment pipeline document covering promotion, rollback, and release notes.

## Completed In Build Slice 56

- Added production environment inventory template.
- Added service, edge-node, required secret, and launch evidence sections.
- Added backup and restore checklist.
- Added restore drill launch gate.
- Added validation for production inventory and backup/restore documents.

## Completed In Build Slice 57

- Added privacy and store compliance notes.
- Documented peer IP visibility, P2P toggle expectations, cellular no-upload behavior, telemetry scope, and retention.
- Added launch gate for privacy policy, app store notes, and support FAQ review.
- Added privacy compliance validation.

## Completed In Build Slice 58

- Added structured logging standard.
- Defined required JSON log fields for request, channel, peer, segment, node, swarm, and error context.
- Added stable event naming guidance and redaction rules.
- Added launch waiver requirement and validation.

## Completed In Build Slice 59

- Added security review checklist.
- Covered JWT/auth, internal APIs, source URL protection, tracker abuse, and P2P poisoning.
- Added production launch gate for P0/P1 findings.
- Added security checklist validation.

## Completed In Build Slice 60

- Fixed `smoke-nginx-config` so origin `conf.d` mounts only server snippets.
- Fixed edge nginx smoke wrapper to avoid duplicate `proxy_cache_path`.
- Verified Docker-backed `nginx -t` passes for origin and edge configs.
- Re-ran standard verification and dependency audit.

## Completed In Build Slice 61

- Added shared `@swarmcast/config` package.
- Added canonical required environment keys, service defaults, typed env readers, URL/port/JSON validation, and service config loaders.
- Added tests for required secret validation, defaults, URL validation, JSON parsing, and `.env.example` coverage.
- Added `docs/configuration.md`.
- Extended config validation to enforce `.env.example` and configuration documentation coverage.
- Refreshed package lock metadata for the new workspace.

## Completed In Build Slice 62

- Added shared error taxonomy export in `@swarmcast/config`.
- Added stable client-visible and internal error codes.
- Added HTTP status mapping, client-visible allowlist, and safe public error helper.
- Added `docs/error-taxonomy.md`.
- Added tests and validation for the taxonomy.

## Completed In Build Slice 63

- Added shared feature flag export in `@swarmcast/config`.
- Added flags for P2P, RLNC, tail downscale, edge-only mode, contribution enforcement, and super-peer threshold.
- Added conservative defaults and environment parsing.
- Added RLNC guard that blocks enabling coded Android path before review.
- Added `docs/feature-flags.md`.
- Added tests and validation for the flag contract.

## Completed In Build Slice 64

- Added reusable fixtures under `test-fixtures/`.
- Added valid and malformed M3U catalog fixtures.
- Added verified and corrupt segment byte fixtures.
- Added deterministic Zipf-style channel distribution fixture.
- Added fixture documentation and validation.
- Added parser regression tests using disk fixtures.

## Completed In Build Slice 65

- Added machine-readable launch performance budgets.
- Added shared budget validation in `@swarmcast/config`.
- Added budgets for tracker CPU/message, tracker memory/peer, segment hash latency, Android decode CPU, Android battery drain, and edge cache hit ratio.
- Added `docs/performance-budgets.md`.
- Extended config validation and package tests for the budget contract.

## Completed In Build Slice 66

- Added machine-readable dependency inventory.
- Added dependency review covering Node, `jose`, `uWebSockets.js`, ffmpeg, nginx, Prometheus, Alertmanager, Grafana, node_exporter, Android Gradle Plugin, Kotlin, Media3, OkHttp, Stream WebRTC Android, and the open Android RLNC library choice.
- Added launch-readiness dependency gate for digest pinning, upgrade/waiver records, and production dependency approval.
- Extended config validation for dependency review and inventory coverage.
- Verified `npm audit --audit-level=moderate` reports 0 vulnerabilities.

## Completed In Build Slice 67

- Added refreshed threat model.
- Covered assets, trust boundaries, threat scenarios, abuse cases, and production launch gates.
- Included auth, tracker, control plane, ingest, edge cache, Android P2P, RLNC decoder boundary, release pipeline, dependency supply chain, monitoring, privacy, and outage risks.
- Added launch-readiness threat-model sign-off gate.
- Extended config validation for threat-model coverage.

## Completed In Build Slice 68

- Added machine-readable data retention map.
- Added data retention policy covering peer stats, IP-related logs, auth logs, playback errors, and metrics.
- Defined raw retention, aggregate retention, prohibited fields, and deletion rules.
- Added launch-readiness and privacy/store references for retention approval.
- Extended config validation for retention policy and JSON coverage.

## Completed In Build Slice 69

- Added Android accessibility and UX baseline.
- Extracted Android UI strings into resources for localization readiness.
- Added Compose semantics for P2P state, player surface, loading/error announcements, and channel rows.
- Moved catalog fallback error text to Android resources.
- Added launch-readiness accessibility/UX gate and validation coverage.
- Checked Android build tooling; no Gradle wrapper or local Gradle binary is present, so Android compile/device checks remain open.

## Completed In Build Slice 70

- Added shared structured logger in `@swarmcast/config`.
- Added redaction for tokens, keys, secrets, and upstream source URLs.
- Added package tests for required log fields, redaction, and newline-delimited JSON output.
- Wired initial runtime logging into auth, ingest, tracker, and control-plane service paths.
- Added structured logging validation and logging standard updates.
- Fixed ingest ffmpeg retry restart to preserve `entry.swarmSize`.
- Refreshed workspace dependency metadata and installed workspace links.

## Completed In Build Slice 71

- Changed service compose builds to use the repo root context.
- Updated auth, control-plane, ingest, and tracker Dockerfiles to install workspace dependencies with `npm ci --omit=dev --ignore-scripts --workspace ...`.
- Copied `packages/config` into service images for runtime shared imports.
- Copied the ingest catalog parser into the control-plane image for its existing cross-service parser import.
- Fixed ingest image ownership for `/var/hls`.
- Verified `docker compose -f infra/docker-compose.yml config` renders with expected local secret warnings.
- Built `swarmcast-auth:local`, `swarmcast-control-plane:local`, `swarmcast-ingest:local`, and `swarmcast-tracker:local`.

## Completed In Build Slice 72

- Migrated auth startup config to `loadAuthConfig`.
- Migrated ingest runtime config to `loadIngestConfig`.
- Migrated control-plane startup config to `loadControlPlaneConfig`.
- Migrated tracker startup config and message-path defaults to `loadTrackerConfig`.
- Expanded shared ingest defaults for idle teardown, tail teardown, segment/window settings, ffmpeg, restart backoff, and RLNC `k`.
- Updated configuration documentation and validation for shared runtime loader usage.
- Rebuilt auth, control-plane, ingest, and tracker images through compose after the migration.

## Completed In Build Slice 73

- Added shared retention policy validation and decision helpers.
- Added retention actions for `keep_raw`, `aggregate_then_delete_raw`, and `delete_aggregate`.
- Added retention plan summary helper.
- Added `npm run retention:dry-run`.
- Added tests for policy validation, retention decisions, and summary planning.
- Updated retention documentation and config validation.

## Completed In Build Slice 74

- Added Prometheus-format retention metrics for record actions, job failures, and last successful run timestamp.
- Added `npm run retention:dry-run -- --prometheus` output mode.
- Added retention job failure and stale-run alerts.
- Added retention job failure/staleness runbook.
- Extended validation to require retention metrics, alerts, runbook links, and dry-run coverage.
- Added package test coverage for retention metric formatting.

## Completed In Build Slice 75

- Added adapter-based `runRetentionJob` helper in `@swarmcast/config/retention`.
- Added `npm run retention:job` with safe dry-run default and `RETENTION_EXECUTE=1` plus `--execute` guard for destructive mode.
- Added `RETENTION_STORE_MODULE` support for production datastore adapters.
- Added local JSONL retention store adapter and deterministic retention fixture.
- Added retention job docs, runbook updates, fixture documentation, and validation coverage.
- Added tests for dry-run action planning and per-record apply failure reporting.

## Completed In Build Slice 76

- Added `@swarmcast/retention-worker` service.
- Added scheduled retention job execution with `/health` and `/metrics` endpoints.
- Moved retention worker startup config into the shared `@swarmcast/config/env` loader.
- Exported the shared JSONL retention adapter from `@swarmcast/config/retention-stores`.
- Added retention-worker Dockerfile, compose service, Prometheus scrape target, production inventory, logging, threat-model, and launch-readiness updates.
- Added retention-worker to the release workflow image matrix and fixed release Docker builds to use the repo root context.
- Added runtime tests for worker metrics/health and shared config tests for boolean parsing and destructive-mode guard.

## Completed In Build Slice 77

- Added `npm run smoke:tracker-load`.
- Simulates 200 deterministic peers joining one tracker swarm and reporting stats.
- Verifies final swarm size, demand calls, P2P peer-list activation after the threshold, WiFi/super-peer mix, rolling offload ratio, and tracker message p95.
- Reads the tracker p95 message budget from `config/performance-budgets.json`.
- Added `docs/load-testing.md` with executable local gates, required VM/WebRTC staging ladder, and launch evidence fields.
- Extended validation to require the tracker load smoke and load-testing documentation.

## Completed In Build Slice 78

- Added `npm run smoke:tracker-ws`.
- The smoke starts local auth, fake ingest, and the tracker process, then joins the tracker over WebSocket with a real JWT and verifies ping, demand, stats, and metrics.
- Added a clear runtime guard for `uWebSockets.js` v20.51.0, which supports Node 18, 20, 22, and 23.
- Pinned the project engine to `>=22 <24` to match the tracker runtime constraint.
- Updated dependency review and load-testing documentation for Node 24 incompatibility.
- Extended validation to require the WebSocket smoke and Node compatibility notes.

## Completed In Build Slice 79

- Added `TRACKER_WS_DOCKER_IMAGE` fallback to `npm run smoke:tracker-ws`.
- The fallback runs the tracker from a Node 22 Docker image while local auth and fake ingest stay on the host.
- Rebuilt `swarmcast-tracker:local` with the current workspace metadata.
- Verified real JWT WebSocket join, ping, stats, ingest demand, and tracker metrics through the Dockerized tracker.

## Completed In Build Slice 80

- Extended `npm run smoke:tracker-ws` to reject invalid JWT WebSocket upgrades.
- Extended the same smoke to prove oversized frames disconnect.
- Updated load-testing documentation and validation for those WebSocket failure paths.
- Re-ran the Docker-backed smoke through `swarmcast-tracker:local`.

## Completed In Build Slice 81

- Added shared tracker WebSocket runtime config for max payload, max backpressure, idle timeout, rate-limit capacity, and rate-limit refill.
- Wired those settings into the tracker `uWebSockets.js` server and token-bucket limiter.
- Exposed the settings in compose, `.env.example`, and configuration docs.
- Added config loader tests and validation coverage.
- Rebuilt `swarmcast-tracker:local` and re-ran the Docker-backed tracker WebSocket smoke.

## Completed In Build Slice 82

- Added shared tracker max-connection config with a production default of 100,000.
- Rejected WebSocket upgrades when the tracker peer count reaches the configured cap.
- Added structured rejection logging for connection-limit events.
- Exposed `TRACKER_MAX_CONNECTIONS` in compose, `.env.example`, and configuration docs.
- Added unit coverage for connection-limit decisions.
- Extended the Docker-backed tracker WebSocket smoke to prove connection-limit rejection while still verifying invalid-token and oversized-frame behavior.

## Completed In Build Slice 83

- Added an application-level tracker idle reaper.
- Closed stale WebSocket peers with `1001 idle timeout` and removed them from tracker state/swarms.
- Added `tracker_idle_peers_closed` structured logging and logging-standard coverage.
- Added shared config validation for the `uWebSockets.js` idle-timeout rule: value must be `0` or greater than `8`.
- Extended the Docker-backed tracker WebSocket smoke to prove idle-timeout closure.
- Added unit coverage for idle peer cleanup.

## Completed In Build Slice 84

- Added `npm run smoke:tracker-ws-load`.
- Starts local auth, fake ingest, and a tracker process or Dockerized tracker image.
- Opens 200 real WebSocket clients, sends authenticated joins and stats, and validates demand calls.
- Verifies tracker metrics for peer count, `rho >= 0.90`, rolling offload, and P2P peer-list activation.
- Added load-testing docs and validation coverage for the new real WebSocket load gate.

## Completed In Build Slice 85

- Extended `smoke:tracker-ws-load` with `--channels`.
- Added `npm run smoke:tracker-ws-multichannel`.
- The multichannel mode opens 200 real WebSocket clients across 5 channels.
- Validates per-channel final demand swarm size, aggregate `rho`, rolling offload, and P2P peer-list activation.
- Updated load-testing docs and validation coverage.

## Completed In Build Slice 86

- Added `npm run smoke:tracker-ws-restart`.
- The restart drill starts auth, fake ingest, and tracker, then connects an active WebSocket swarm.
- Stops the tracker process and confirms all active WebSockets close.
- Restarts the tracker on the same ports and verifies every client can rejoin.
- Confirms joined responses still provide Delivery Fleet playlist URLs, demand calls resume, `rho >= 0.90`, rolling offload recovers, and P2P peer-list activation returns.
- Updated load-testing docs, tracker peer-drop runbook, backlog, and validation coverage.

## Completed In Build Slice 87

- Fixed ingest ffmpeg failure accounting so repeated crash counts persist across restarts.
- Added unit coverage proving repeated ffmpeg exits stop after `MAX_FFMPEG_FAILURES` and move the channel to degraded state.
- Added `npm run smoke:ingest-ffmpeg-chaos`.
- The smoke simulates a demanded channel whose ffmpeg worker exits repeatedly, verifies restart backoff preserves `swarmSize`, stops after 4 restarts and 5 failures, enters `degraded`, and emits `ffmpeg_worker_failed`.
- Added `docs/chaos-drills.md`.
- Updated load-testing docs, ingest degraded runbook, launch readiness, backlog, and validation coverage.

## Completed In Build Slice 88

- Added `npm run smoke:control-plane-placement-restart`.
- The smoke uses the real internal control-plane placement API with a file-backed placement registry.
- Assigns a channel, verifies placement metrics, restarts the server with the same placement file, and confirms placement lookup restores the same ingest node.
- Reassigns the same channel after restart and verifies the same node is reused.
- Releases the placement, restarts again, and confirms the deletion persists.
- Updated chaos-drill docs, launch readiness, backlog, and validation coverage.

## Completed In Build Slice 89

- Added `npm run smoke:retention-execute`.
- The smoke first proves `scripts/retention-job.js --execute` refuses to run without `RETENTION_EXECUTE=1`.
- Runs execute mode against a temporary JSONL retention store.
- Verifies 5 scanned records, 5 applied records, and 5 retention action-log entries.
- Confirms the action log includes `keep_raw`, `aggregate_then_delete_raw`, and `delete_aggregate`.
- Updated data-retention docs, launch readiness, backlog, and validation coverage.

## Completed In Build Slice 90

- Added shared `validateIngestNodes` config validation for control-plane `INGEST_NODES`.
- Requires a non-empty node array, safe unique node IDs, and valid `http` or `https` `baseUrl` values.
- Allows optional `http` or `https` `ingestUrl` values and normalizes trailing slashes.
- Added rejection coverage for duplicate IDs, unsafe IDs, invalid URLs, and unsupported protocols.
- Updated `.env.example`, configuration docs, backlog, and validation coverage.

## Completed In Build Slice 91

- Added owned media URL validation for runtime config.
- Tracker `ORIGIN_BASE` and `EDGE_BASE` now reject known third-party CDN provider hostnames.
- Control-plane ingest-node `baseUrl` now uses the same no-third-party-CDN guard.
- Added tests for CloudFront, Akamai, and Fastly host rejection.
- Updated configuration docs, backlog, and validation coverage.

## Completed In Build Slice 92

- Rebuilt `swarmcast-control-plane:local` with the current shared config package.
- Rebuilt `swarmcast-tracker:local` with the current shared config package.
- Re-ran the Docker-backed tracker WebSocket smoke through the rebuilt tracker image.
- Started the rebuilt control-plane image with a CloudFront ingest-node `baseUrl` and confirmed startup validation rejects the config.

## Completed In Build Slice 93

- Added `AUTH_KEY_ID` and `AUTH_PREVIOUS_JWKS_PATH` auth configuration.
- Auth now signs new tokens with the configured current `kid`.
- Auth `/jwks` can publish the current public key plus previous public keys during a rotation overlap.
- Auth `/verify` now verifies against the combined JWKS so old tokens can remain valid during the overlap window.
- Added tests for configured key IDs, previous JWKS publication, old-token verification, and private-key field stripping.
- Added `docs/runbooks/auth-key-rotation.md` and linked it from auth verification failure response.
- Updated configuration docs, `.env.example`, backlog, and validation coverage.

## Completed In Build Slice 94

- Rebuilt `swarmcast-auth:local` with the current auth rotation code.
- Started the auth image in Docker with `AUTH_KEY_ID=swarmcast-docker`.
- Verified `/jwks` publishes the configured key ID and does not expose private key material.
- Issued a token, confirmed the protected header uses the configured `kid`, and verified it through `/verify` with status 204.

## Completed In Build Slice 95

- Added shared `AUTH_JWT_AUDIENCE`, `AUTH_JWT_ISSUER`, and `AUTH_TOKEN_TTL_SECONDS` config.
- Auth now signs tokens with configured audience, issuer, and TTL, and `/verify` enforces the same claims.
- Tracker WebSocket upgrade verification now enforces configured audience and issuer against auth JWKS.
- Exposed the JWT settings in compose and `.env.example`.
- Updated configuration docs and auth key rotation runbook with issuer, audience, and TTL evidence requirements.
- Added tests for defaults, custom claim settings, TTL bounds, issuer rejection, and configured token claims.
- Rebuilt `swarmcast-auth:local` and `swarmcast-tracker:local`.
- Docker-backed tracker WebSocket smoke passed with issuer/audience enforcement.
- Auth Docker smoke passed with custom `kid`, issuer, audience, TTL, and `/verify`.

## Completed In Build Slice 96

- Added shared catalog source URL policy with `SOURCE_ALLOWED_HOSTS` and `SOURCE_ALLOW_PRIVATE_NETWORKS`.
- Source URL validation now rejects non-HTTP(S), URL credentials, private/loopback/link-local sources by default, and hosts outside the allowlist when configured.
- Wired the policy into ingest and control-plane M3U startup imports.
- Added parser, config, and control-plane catalog tests for source policy enforcement.
- Added `npm run smoke:source-policy`.
- Added `docs/source-url-policy.md` and updated configuration, security review, threat model, compose, `.env.example`, backlog, and validation coverage.
- Rebuilt `swarmcast-ingest:local` and `swarmcast-control-plane:local`.
- Docker startup checks confirmed both images reject a private source URL before listening.

## Completed In Build Slice 97

- Made `SOURCE_ALLOWED_HOSTS` mandatory when production startup validation is enabled.
- Moved the ingest executable startup path to the strict shared config loader while preserving lightweight defaults for tests/imports.
- Control-plane and ingest production config loaders now both refuse startup before opening ports when the source allowlist is empty.
- Updated `.env.example`, configuration docs, launch readiness, source URL policy docs, validation coverage, and backlog status.
- Added regression tests for direct source policy validation plus ingest/control-plane production config startup validation.
- Rebuilt `swarmcast-ingest:local` and `swarmcast-control-plane:local`.
- Docker startup checks confirmed both images reject missing `SOURCE_ALLOWED_HOSTS` with the explicit production validation error.

## Completed In Build Slice 98

- Added `npm run source:preflight` for operator pre-deployment checks against the configured M3U catalog.
- Source preflight applies the same `SOURCE_ALLOWED_HOSTS` policy, requires an explicit allowlist, probes playlists with `HEAD`, and falls back to ranged `GET` when an upstream rejects `HEAD`.
- Preflight summaries report channel IDs, names, methods, and status/error classes without exposing raw source URLs.
- Added `npm run smoke:catalog-source-preflight` with a local source server proving healthy sources pass, `HEAD` rejection can pass through ranged `GET`, failing sources are detected, and the CLI entrypoint works.
- Added `docs/runbooks/source-failure.md` and wired catalog source preflight into launch readiness, source policy docs, package scripts, and config validation.

## Completed In Build Slice 99

- Added `docs/runbooks/auth-outage.md` for auth availability incidents.
- Covered first checks for `/health`, `/jwks`, `/token`, `/verify`, key persistence, token contract settings, and metrics.
- Documented immediate recovery actions that preserve `AUTH_KEY_PATH`, `AUTH_KEY_ID`, `AUTH_JWT_AUDIENCE`, and `AUTH_JWT_ISSUER`.
- Documented service impact for new viewers, origin/edge/tracker auth checks, cached playback, and Delivery Fleet fallback.
- Linked `docs/runbooks/auth-verify-failures.md` to the outage runbook when auth endpoints are unavailable.
- Added validation coverage so the outage runbook and handoff remain part of `npm run check`.

## Completed In Build Slice 100

- Added `docs/runbooks/app-incident.md` for Android rollout and playback incidents.
- Documented first checks for crash-free sessions, startup latency, stall rate, tracker peer drops, auth failures, edge cache hit ratio, and low-offload alerts.
- Documented mitigation using `EDGE_ONLY_MODE=1`, `P2P_ENABLED=0`, and keeping `RLNC_ENABLED=0` during active incidents.
- Added guidance to pause Android rollout, roll back bad releases, add Delivery Fleet capacity, preserve P2P disclosure, and avoid exposing JWTs/source URLs/peer IPs.
- Added launch-readiness rollback text requiring the app incident runbook to force Delivery-Fleet-only playback and halt Android rollout.
- Added config validation coverage for the app incident runbook and launch-readiness rollback gate.

## Completed In Build Slice 101

- Added `docs/runbooks/restore-drill.md` for staging restore execution.
- Covered restore scope for auth keys/JWKS, control-plane placement state, catalog snapshots, monitoring config, Alertmanager/Grafana, nginx config, retention deployment config, and immutable image tags.
- Documented staging-first safety rules that prevent private keys, app keys, internal tokens, JWTs, source URLs, and datastore credentials from entering incident records.
- Added drill steps for auth health/JWKS/token/verify, catalog source preflight, control-plane placement restart, config validation, retention dry-run Prometheus output, and authenticated playback smokes.
- Added required restore evidence for RTO/RPO, snapshot IDs/checksums, auth `kid`, placement restore, source preflight, monitoring validation, retention output, and post-restore smokes.
- Linked the restore drill from `docs/backup-restore.md` and added config validation coverage.

## Completed In Build Slice 102

- Wired tracker runtime policy to the shared feature flag contract.
- `P2P_ENABLED=0` or `EDGE_ONLY_MODE=1` now forces `swarmMode: "edge-only"` even when swarm size is above `P2P_MIN_SWARM_SIZE`.
- Forced edge-only mode suppresses tracker peer-list messages, keeping clients on Delivery Fleet fallback during P2P incidents.
- Preserved default behavior: when flags allow P2P and swarm size meets the threshold, tracker still sends peer candidates.
- Added policy and tracker join tests for feature-flag behavior.
- Updated `docs/feature-flags.md` and config validation to require tracker consumption coverage.
- Rebuilt `swarmcast-tracker:local` and ran Docker-backed WebSocket smoke successfully.

## Completed In Build Slice 103

- Added Android manifest placeholders for `SWARMCAST_P2P_ENABLED`, `SWARMCAST_EDGE_ONLY_MODE`, and `SWARMCAST_RLNC_ENABLED`.
- Added `AppFeatureFlags` parsing in Android app config with a guard that refuses `RLNC_ENABLED` until the Android RLNC review gate is complete.
- Android startup now initializes P2P from policy instead of always defaulting on.
- Edge-only or disabled-P2P builds disable the P2P switch and clamp restored P2P UI state back off.
- Playback session creation now passes the policy-clamped P2P value into the coordinator.
- Updated `docs/feature-flags.md` and validation coverage for Android manifest-backed flag consumption.
- Android compile and device validation remain open because the local Gradle/Android toolchain is unavailable.

## Completed In Build Slice 104

- Added structured edge nginx access logs using `log_format swarmcast_edge`.
- Added `scripts/edge-cache-log-metrics.js` to parse edge access-log JSON lines and emit Prometheus metrics for requests, cache hit ratio, egress bytes, origin-fill bytes, errors, request time, upstream response time, cache status, and status class.
- Added `npm run smoke:edge-cache-metrics` with deterministic HIT/MISS/error log samples and assertions that output does not expose request URIs or hostnames.
- Added Grafana overview panels for edge cache hit ratio and edge egress/origin-fill bytes.
- Updated the low edge cache hit ratio runbook with metric names, the local smoke command, and raw-log handling guidance.
- Updated load-testing docs and config validation to cover the new edge metrics contract.
- Re-ran Docker-backed nginx config smoke; origin and edge `nginx -t` passed.

## Completed In Build Slice 105

- Added `scripts/edge-cache-metrics-server.js`, a small HTTP exporter for edge cache metrics.
- The exporter exposes `/health` and `/metrics`, reads the structured nginx edge access log, and returns Prometheus text from the shared parser.
- Added `npm run smoke:edge-cache-metrics-server`, proving `/health` and `/metrics` scrape successfully and do not expose request URIs or hostnames.
- Wired `infra/edge/docker-compose.yml` with an `edge-metrics` service on port `9101` and a shared `edge_logs` volume from nginx.
- Added a Prometheus scrape job for `edge.example.tv:9101`.
- Updated production environment docs, load-testing docs, edge cache runbook, and config validation.
- Rendered `docker compose -f infra/edge/docker-compose.yml config` successfully.

## Completed In Build Slice 106

- Added `SwarmcastHighEdgeOriginFillRate` alert using `rate(swarmcast_edge_origin_fill_bytes_total[5m]) > 50000000`.
- Added `SwarmcastHighEdgeErrorRate` alert using edge 5xx errors divided by edge requests over 5 minutes.
- Reused the low edge cache hit ratio runbook for cache-hit, origin-fill, and edge-error incidents.
- Expanded the runbook with origin-fill and 5xx triage paths plus localized edge-node mitigation.
- Added config validation for the new alert names, exact alert expressions, and runbook coverage.

## Completed In Build Slice 107

- Extended tracker stat intake to accept optional `startup_ms` and `buffer_ms` client fields while preserving cumulative transfer and stall counters.
- Added tracker Prometheus metrics for `swarmcast_tracker_playback_stalls_total`, `swarmcast_tracker_stall_rate_5m`, startup-latency averages, startup sample count, and buffer average/min gauges.
- Android PlayerHolder now tracks buffer depth, post-start rebuffer count, and playback-start state.
- Android PlaybackSessionCoordinator now reports transfer deltas, rebuffer deltas, one-shot startup latency, and buffer depth through the existing tracker stats flush.
- Added launch budgets for Android startup latency, stall rate, and minimum buffer depth.
- Added Grafana playback-quality panel and Prometheus alerts for high stall rate, high startup latency, and low playback buffer, all linked to the app incident runbook.
- Updated load-testing, performance-budget, launch-readiness, app-incident, validation, and smoke coverage for playback-quality metrics.
- Rebuilt `swarmcast-tracker:local` and verified the Docker-backed tracker WebSocket smoke against the updated metrics contract.

## Completed In Build Slice 108

- Added `services/tracker/src/segments.js` with validated internal segment announce parsing and a reusable swarm broadcast helper.
- Tracker internal `/internal/segment` now rejects malformed segment metadata before broadcast.
- Added uWebSockets abort handling for the internal segment POST body path; the Docker smoke exposed this runtime requirement.
- Added tracker tests proving segment metadata normalization, malformed-payload rejection, empty-swarm handling, and ordered `segment` messages to connected peers.
- Extended `smoke:tracker-ws` to reject a bad internal segment announce, post a valid announce, and verify the connected WebSocket client receives `seq`, `sha256`, `size`, and `k`.
- Updated repository validation so the segment announce helper, tests, and Docker-backed smoke assertion stay required.

## Completed In Build Slice 109

- Added `TRACKER_DEMAND_HEARTBEAT_SECONDS` with a 30-second default in the shared tracker config loader.
- Wired the demand heartbeat setting through `.env.example`, `infra/docker-compose.yml`, and `docs/configuration.md`.
- Tracker runtime now uses the configured heartbeat interval instead of a hard-coded 30-second timer.
- Extended `smoke:tracker-ws` to run the heartbeat at 1 second and require recurring demand calls while the joined client remains connected.
- Updated load-testing docs and repository validation for recurring demand heartbeat evidence.
- Rebuilt `swarmcast-tracker:local` with a clean no-cache build after a local Docker snapshot-cache export failure, then verified the Docker-backed smoke with `demandCalls=2`.

## Completed In Build Slice 110

- Added latest successful segment tracking to the ingest `ChannelManager`.
- `watchSegments` can now notify the ingest manager after a successful tracker segment announcement.
- Added `swarmcast_ingest_segment_age_seconds`, representing the oldest latest segment age across active ingest channels.
- Added `SwarmcastIngestStaleSegments` alert for segment age above 30 seconds and updated the ingest degraded runbook with the new first check.
- Added segment age to the Grafana ingest health panel and repository validation.
- Added focused tests for segment timestamp recording and ingest segment-age metric formatting.

## Completed In Build Slice 111

- Added `SwarmcastHighEdgeEgressRate` using `rate(swarmcast_edge_egress_bytes_total[5m]) > 200000000`.
- Kept high total edge egress distinct from origin-fill egress: total edge egress tracks Delivery Fleet capacity/cost risk, while origin-fill tracks upstream saturation.
- Expanded the edge cache runbook with total edge egress impact, triage, mitigation, and follow-up evidence.
- Added validation coverage for the new alert name, exact expression, metric source, and runbook text.

## Completed In Build Slice 112

- Extended `smoke:tracker-ws` with low runtime `TRACKER_RATE_LIMIT_CAPACITY` and `TRACKER_RATE_LIMIT_REFILL_PER_SECOND` values.
- Added a joined-client burst path that sends excessive peer messages and requires a WebSocket close code `1008`.
- Updated load-testing docs to list rate-limit disconnect coverage as part of the authenticated tracker WebSocket smoke.
- Added validation coverage requiring the rate-limit settings and `rateLimitClosed=true` smoke output.
- Verified the Docker-backed tracker smoke through `swarmcast-tracker:local`; latest run reported `rateLimitClosed=true`.

## Completed In Build Slice 113

- Added `infra/host/sysctl.d/99-swarmcast.conf` with SwarmCast host tuning for file handles, listen backlog, ephemeral ports, SYN backlog, TCP reuse, and swappiness.
- Added `infra/host/security-limits.d/99-swarmcast.conf` with 1,048,576 `nofile` soft/hard limits for service users and root.
- Expanded the Ubuntu host bootstrap runbook with exact install commands, `sysctl --system`, `ulimit -n`, and reboot validation checks.
- Added config validation coverage for the host tuning files and host bootstrap runbook.

## Completed In Build Slice 114

- Added `infra/host/firewall/ufw-swarmcast.sh`, a dry-run-capable UFW bootstrap script.
- The script defaults to no host mutation unless `APPLY=1` is set, supports restricted SSH via `ALLOW_SSH_FROM`, allows public `80/tcp` and `443/tcp`, and denies direct access to internal service ports `7000`, `7001`, `7002`, `7003`, `7010`, `7020`, and `9101`.
- Updated the host bootstrap runbook with firewall review/application commands and reboot validation expectations.
- Added config validation coverage for the firewall script and runbook references.
- Verified the firewall script with `bash -n`.

## Completed In Build Slice 115

- Added `infra/host/tls/certbot-swarmcast.sh`, a dry-run-first certbot helper that supports webroot and standalone issuance.
- The TLS helper issues one certificate per hostname so nginx can read `/etc/letsencrypt/live/<hostname>/fullchain.pem` for origin, API, tracker, and edge server blocks.
- Added ACME HTTP-01 challenge handling to origin and edge nginx and mounted `/var/www/certbot` into both compose stacks.
- Expanded the host bootstrap runbook with first-issue, webroot renewal, edge reload, and `certbot renew --dry-run` checks.
- Added config validation coverage for ACME challenge routes, certbot mounts, the TLS helper, and runbook references.
- Verified the TLS script with `bash -n`, its default dry-run output, compose config rendering, Docker-backed nginx config smoke for origin and edge, and `npm run verify`.

## Completed In Build Slice 116

- Extended `scripts/smoke-tracker-ws.js` from a one-client connection-limit smoke to a two-client signaling smoke with a third-client rejection.
- The Docker-backed tracker WebSocket smoke now joins two authenticated clients and relays offer, answer, and ICE-shaped signaling envelopes through the real tracker process.
- Kept the same runtime coverage for invalid JWT rejection, segment announce delivery, playback-quality metrics, recurring demand heartbeat, rate-limit disconnect, oversized-frame disconnect, and idle-timeout closure.
- Updated load-testing docs and config validation to require the two-client WebRTC signaling relay evidence and `signalingRelayed=true` smoke output.
- Verified with `TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws` and `npm run verify`.

## Completed In Build Slice 117

- Hardened `.github/workflows/ci.yml` with explicit dependency audit and deployment-shape gates.
- CI now runs `npm audit --audit-level=moderate`, renders both origin and edge compose files, pulls `nginx:1.27`, and runs `npm run smoke:nginx-config`.
- Updated `docs/deployment-pipeline.md` to make verify, audit, compose rendering, and nginx config smoke mandatory pre-release CI gates.
- Added config validation coverage for the CI workflow and deployment-pipeline gate text.
- Verified locally with `npm audit --audit-level=moderate`, both compose config commands, `npm run smoke:nginx-config`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 118

- Added `not_found` to the shared error taxonomy with HTTP 404 mapping and documentation.
- Routed auth, ingest, control-plane, and retention-worker JSON error responses through `publicError` and `httpStatusForError`.
- Updated ingest channel-demand failures to return taxonomy-backed HTTP errors for `unknown_channel` and `capacity`.
- Mapped tracker placement failures to client-safe public codes so internal-only `placement_failed` is not sent to clients.
- Added validation coverage for service adoption of the shared error taxonomy.
- Verified with focused taxonomy/service tests, `npm run smoke:ingest`, Docker-backed `npm run smoke:tracker-ws`, and `npm run verify`.

## Completed In Build Slice 119

- Added `android/app/src/main/java/tv/swarmcast/data/ErrorTaxonomy.kt` with Android-side error constants, `ApiErrorBody`, `SwarmCastApiException`, HTTP status fallback mapping, and safe user-message extraction.
- Updated Android auth and channel repositories to parse server error bodies through `apiExceptionFromResponse`.
- Updated Android edge segment fallback to map failed edge responses to `edge_unavailable` when the server does not provide a taxonomy body.
- Updated Android tracker event parsing so missing error codes collapse to `config_invalid`.
- Updated catalog UI state handling to use safe public server messages before the existing localized fallback text.
- Added static validation coverage for the Android taxonomy scaffold and repository/scheduler/tracker usage.
- Verified with `npm run verify`.

## Completed In Build Slice 120

- Added `infra/docker-compose.release.yml` to name service containers with immutable published images from `SWARMCAST_IMAGE_REPOSITORY` and `SWARMCAST_IMAGE_TAG`.
- Added `docs/runbooks/rollback-drill.md` with preflight, `pull`, `up --no-build`, post-rollback smoke, and evidence requirements.
- Updated deployment pipeline docs to require the release override and `--no-build` rollback behavior instead of rebuilding old commits.
- Updated launch readiness rollback requirements to include staging rehearsal of the rollback drill.
- Added config validation coverage for the release compose override and rollback drill runbook.
- Verified the release compose override renders sample immutable image names for auth, ingest, tracker, control-plane, and retention-worker.
- Verified with `npm run verify`.

## Completed In Build Slice 121

- Added `scripts/generate-sbom.js`, a dependency-free SBOM generator that reads `package-lock.json`, Android Gradle files, service Dockerfiles, and origin/edge/release compose image references.
- Added `npm run sbom:generate`, with `--output` for writing JSON evidence and `--check` for parser coverage validation.
- Updated dependency review docs with the SBOM generation and check commands required before production.
- Added config validation coverage for the SBOM command, generator source inputs, and dependency review SBOM workflow text.
- Verified `npm run sbom:generate -- --check` reports 41 components across npm, Maven, Gradle plugin, and OCI/container ecosystems.
- Verified with `npm run verify`.

## Completed In Build Slice 122

- Changed `infra/docker-compose.release.yml` from shared repository/tag interpolation to explicit per-service image refs: `SWARMCAST_AUTH_IMAGE`, `SWARMCAST_INGEST_IMAGE`, `SWARMCAST_TRACKER_IMAGE`, `SWARMCAST_CONTROL_PLANE_IMAGE`, and `SWARMCAST_RETENTION_WORKER_IMAGE`.
- Added `scripts/validate-release-images.js` and `npm run release:images:check` to require digest-pinned `@sha256:<64 hex chars>` image refs for production deploy/rollback.
- Updated deployment pipeline, rollback drill, production environment, and dependency review docs to require digest-pinned per-service refs.
- Added config validation coverage for the release image checker and new per-service release image variables.
- Verified the release image check and rendered release compose with sample digest-pinned refs for all five service images.
- Verified with `npm run verify`.

## Completed In Build Slice 123

- Added `scripts/validate-image-scan-report.js` to validate Trivy-style image scan JSON reports.
- The validator fails by default on `HIGH` or `CRITICAL` findings and supports `--allow-high` when a formal waiver is needed.
- Added `test-fixtures/security/trivy-clean.json` as a low-severity fixture for local validation.
- Updated dependency review and launch readiness docs to require scan reports validated by `npm run image:scan:validate`.
- Added config validation coverage for the image scan command, validator, and fixture.
- Verified `npm run image:scan:validate -- test-fixtures/security/trivy-clean.json` and `npm run verify`.

## Completed In Build Slice 124

- Added `test-fixtures/retention/sensitive-records.jsonl` with synthetic JWT, upstream source URL, IP, email, and API-key sentinel fields.
- Added `npm run smoke:retention-redaction`.
- The smoke runs the real retention job in dry-run JSON mode, Prometheus mode, and execute mode against the sensitive fixture.
- Verified those outputs do not include sensitive sentinels and that execute-mode action logs only contain `at`, `recordId`, `classId`, `observedAt`, and `action`.
- Updated retention policy docs and fixture docs to require the redaction gate and clarify that the sensitive fixture contains only fake sentinel values.
- Added config validation coverage for the new smoke, fixture, package script, and docs.
- Verified `npm run smoke:retention-redaction`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 125

- Added `scripts/retention-http-store.js`, a production-oriented HTTP retention store module loaded through `RETENTION_STORE_MODULE`.
- The adapter reads `RETENTION_STORE_HTTP_BASE_URL`, optional `RETENTION_STORE_HTTP_TOKEN`, and `RETENTION_STORE_HTTP_TIMEOUT_MS`.
- Dry-run mode lists records but skips remote apply calls.
- Execute mode sends only minimal action payloads: `recordId`, `classId`, `observedAt`, `action`, `dryRun`, and `now`.
- Added `npm run smoke:retention-http-store`, which stands up a local internal datastore API and verifies dry-run/apply behavior against the real retention job.
- Wired the adapter into `infra/docker-compose.yml`, `.env.example`, and the retention-worker Docker image.
- Updated retention policy, configuration docs, and the retention-failure runbook.
- Added config validation coverage for the adapter, smoke, compose variables, Dockerfile copy, and docs.
- Verified `npm run smoke:retention-http-store`, `docker compose -f infra/docker-compose.yml config`, and `npm run verify`.

## Completed In Build Slice 126

- Added `npm run smoke:nginx-origin-playback`.
- The smoke generates fMP4 HLS with ffmpeg, creates temporary TLS certs, starts the real origin nginx TLS server block in Docker, and uses the auth service for media authorization.
- Verified unauthenticated playlist access returns 401.
- Verified a real issued token fetches the playlist over HTTPS with `Cache-Control: no-cache`.
- Verified the first media segment is served over HTTPS with immutable cache headers.
- Fixed auth `/verify` to accept nginx `X-Original-URI` token fallback when `X-Auth-Token` is absent.
- Added auth test coverage for nginx-style verification.
- Updated load-testing docs, launch-readiness evidence, threat-model coverage, and validation guards.
- Verified `node --test services/auth/test/auth.test.js`, `npm run smoke:nginx-origin-playback`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 127

- Added `npm run smoke:nginx-edge-cache`.
- The smoke generates fMP4 HLS, starts a local auth service and local origin media server, then runs the real edge nginx TLS server block in Docker.
- Fixed edge nginx auth subrequests to forward `X-Original-URI` so query-token playback URLs verify through the auth service.
- Verified unauthenticated edge segment access returns 401.
- Verified the first authenticated segment request returns `X-Cache: MISS`.
- Verified the second authenticated request for the same segment returns `X-Cache: HIT` with the same bytes and one origin fill.
- Updated load-testing docs, launch-readiness evidence, threat-model coverage, and validation guards.
- Verified `npm run smoke:nginx-edge-cache`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 128

- Added `proxy_cache_key "$scheme$proxy_host$uri"` to both single-node and multi-node edge cache routes so token query strings do not fragment segment cache entries after auth succeeds.
- Extended `npm run smoke:nginx-edge-cache` to issue two valid viewer tokens.
- Verified the first token gets `X-Cache: MISS` for a segment and the second token gets `X-Cache: HIT` for the same segment.
- Verified the local origin still sees exactly one fill.
- Updated load-testing docs, threat-model mitigation text, and validation guards for token-independent edge cache keys.
- Verified `npm run smoke:nginx-edge-cache`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 129

- Updated the CI `deployment-shape` job to install ffmpeg for deterministic HLS packaging smokes.
- Kept origin and edge compose rendering plus `npm run smoke:nginx-config`.
- Added `npm run smoke:nginx-origin-playback` to CI.
- Added `npm run smoke:nginx-edge-cache` to CI.
- Increased the deployment-shape timeout to 20 minutes to account for package installation and Docker smokes.
- Updated deployment pipeline docs and config validation so releases require real nginx origin/edge smoke coverage before the release workflow.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 130

- Added an Android CI job.
- The job sets up JDK 17, Android SDK platform 35 plus build-tools 35.0.0, and Gradle 8.9.
- The job runs `gradle -p android --no-daemon assembleDebug assembleRelease`.
- Added `org.jetbrains.kotlin.plugin.compose` to the Android Gradle files so Kotlin 2.0 Compose builds have an explicit compiler plugin.
- Updated Android README, deployment pipeline docs, launch readiness, and config validation.
- Verified SBOM parsing still covers Android Gradle inputs; `npm run sbom:generate -- --check` now reports 42 components across 4 ecosystems.
- Local Gradle is still unavailable in this workspace, so Android assembly itself is left to the CI job and first remote CI artifact remains open.
- Verified `npm run check`, `npm run sbom:generate -- --check`, and `npm run verify`.

## Completed In Build Slice 131

- Added release-workflow SBOM generation in the `verify` job.
- The workflow writes `var/sbom/swarmcast-sbom.json` with `npm run sbom:generate -- --output`.
- The workflow validates SBOM parser coverage with `npm run sbom:generate -- --check`.
- The workflow uploads the SBOM via `actions/upload-artifact@v4` as `swarmcast-sbom`.
- The release summary now links the `swarmcast-sbom` artifact.
- Updated deployment pipeline docs and validation guards for the release SBOM artifact.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 132

- Added `scripts/generate-release-manifest.js`.
- Added `npm run release:manifest` with strict version, environment, commit, repository, service image, expected scan report, and optional digest-pin validation.
- The release workflow now writes `var/release/swarmcast-release-manifest.json`, validates it with `npm run release:manifest -- --input ... --check`, uploads it as `swarmcast-release-manifest`, and links it from the release summary.
- Updated deployment pipeline docs and config validation guards for the release manifest artifact.
- Added `var/` to `.gitignore` so generated release/SBOM/scan artifacts stay out of source.
- Verified `npm run release:manifest -- --version v0.1.0-rc1 --environment staging --commit 0123456789abcdef0123456789abcdef01234567 --repository Aziz/Ads --output var/release/swarmcast-release-manifest.json`, `npm run release:manifest -- --input var/release/swarmcast-release-manifest.json --check`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 133

- Added `scripts/validate-launch-evidence.js`.
- Added `npm run launch:evidence:validate` for release go/no-go evidence bundles.
- The validator requires 17 launch gates, owners, statuses, evidence references, waiver details where allowed, synthetic-evidence opt-in, and redaction checks for token/source URL leakage in evidence references.
- Added `test-fixtures/launch/evidence-complete.synthetic.json`.
- Updated launch readiness docs with the machine-readable evidence format and required gate IDs.
- Added config validation guards for the launch evidence script, fixture, and readiness documentation.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 134

- Added `scripts/validate-production-env.js`.
- Added `npm run env:production:validate` for production deployment env files.
- The validator rejects placeholders, weak launch secrets, non-HTTPS public bases, unsafe source allowlists, private source networks, missing retention execute/store settings, and tag-only service images.
- Added `test-fixtures/config/production.env` with synthetic production-shaped values and digest-pinned service image refs.
- Updated configuration docs and validation guards for the production env gate.
- Verified `npm run env:production:validate -- test-fixtures/config/production.env`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 135

- Added `scripts/validate-alertmanager-receivers.js`.
- Added `npm run alertmanager:receivers:validate` for rendered production Alertmanager receiver files.
- The validator requires `oncall-default` and `oncall-critical`, exactly one HTTPS webhook per receiver, `send_resolved: true`, distinct default/critical URLs, no URL credentials, and no query-string secrets.
- Added `test-fixtures/monitoring/alertmanager-production.yml` as synthetic production-shaped receiver coverage.
- Updated launch readiness and production environment docs, plus config validation guards.
- Verified `npm run alertmanager:receivers:validate -- test-fixtures/monitoring/alertmanager-production.yml`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 136

- Added `scripts/validate-canary-metrics.js`.
- Added `npm run canary:metrics:validate` for canary rollout metric snapshots.
- The validator uses `config/performance-budgets.json` for startup latency, stall rate, buffer depth, and edge cache hit ratio, and snapshot limits for crash-free sessions, offload ratio, edge/origin egress, auth verification failures, and tracker peer drops.
- Added `test-fixtures/launch/canary-metrics-pass.json` with a passing synthetic 30-minute canary snapshot.
- Updated launch readiness, performance budget docs, and validation guards for the canary gate.
- Verified `npm run canary:metrics:validate -- test-fixtures/launch/canary-metrics-pass.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 137

- Added `config/capacity-plan.json`.
- Added `scripts/validate-capacity-plan.js`.
- Added `npm run capacity:plan:validate` for machine-readable capacity plan checks.
- The validator computes residual Delivery Fleet egress after measured P2P offload, origin fill after edge cache hits, and required edge/origin node counts with headroom.
- Added `docs/capacity-plan.md` and linked the gate from launch readiness and assumptions.
- Verified `npm run capacity:plan:validate -- config/capacity-plan.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 138

- Added `scripts/smoke-ingest-demand-playlist.js`.
- Added `npm run smoke:ingest-demand-playlist`.
- The smoke starts a real ingest HTTP server with `ChannelManager`, demands a channel, uses a synthetic HLS worker to write `playlist.m3u8`, `init.mp4`, and `seg_00000000.m4s`, runs the recursive segment watcher, announces segment metadata to a fake tracker internal endpoint, and verifies live status plus `latestSegmentAt`.
- Updated load-testing docs and validation guards.
- Verified `npm run smoke:ingest-demand-playlist`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 139

- Added `packages/config/src/mediaUrls.js`.
- Exported `@swarmcast/config/media-urls`.
- Added `buildMediaUrlContract` and `validateMediaUrlContract` for single-node and placement-aware playlist, edge, origin, and demand URL templates.
- Rewired tracker `buildMediaTemplates` to delegate to the shared media URL contract.
- Added `docs/media-url-contract.md` and config validation guards.
- Added tests for fallback URLs, placement-aware URLs, unsafe IDs, third-party CDN rejection, and malformed template rejection.
- Verified focused media URL/tracker placement tests, `npm run check`, and `npm run verify`.

## Completed In Build Slice 140

- Added sanitized catalog snapshot support to `CatalogStore`.
- Added `CatalogStore.toSnapshot`, `saveSnapshot`, and `fromSnapshotFile`.
- Added `CATALOG_SNAPSHOT_PATH` to shared config, `.env.example`, compose, and configuration docs.
- Control-plane startup now saves a sanitized snapshot after a valid M3U import and can load the snapshot if the configured M3U file is unavailable.
- Snapshot validation rejects stored `sourceUrl` fields.
- Verified focused catalog/config tests, `npm run check`, and `npm run verify`.

## Completed In Build Slice 141

- Added gzip compression for JSON responses in `services/control-plane/src/catalogServer.js` when clients send `Accept-Encoding: gzip`.
- Added `Vary: Accept-Encoding` and `Content-Length` headers for JSON responses.
- Preserved ETag/304 behavior with no compressed body on cache hits.
- Added a raw HTTP catalog test that verifies `Content-Encoding: gzip`, decompresses the body, checks `sourceUrl` is still absent, and verifies `304` responses stay empty.
- Updated validation guards for catalog gzip support.
- Verified `node --test services/control-plane/test/catalogServer.test.js`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 142

- Added `scripts/smoke-placement-movement.js`.
- Added `npm run smoke:placement-movement`.
- The smoke assigns 20,000 synthetic channels before and after adding an ingest node.
- It verifies movement stays below 0.40 and load skew stays below 1.10.
- Local result: moved ratio 0.335, load skew 1.010, loads `{"origin-a":6650,"origin-b":6642,"origin-c":6708}`.
- Updated load-testing docs and validation guards.
- Verified `npm run smoke:placement-movement`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 143

- Added `scripts/smoke-multi-ingest-routing.js`.
- Added `npm run smoke:multi-ingest-routing`.
- The smoke starts a real control-plane placement API with two ingest nodes and `perNodeCap: 1`.
- It drives tracker joins for two channels and verifies they land on different ingest nodes.
- It verifies placement-aware `/edge/<node>/live/...` playlist, edge template, and origin template values.
- It verifies tracker demand calls route to the selected ingest nodes with the internal token.
- Updated load-testing docs and validation guards.
- Verified `npm run smoke:multi-ingest-routing`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 144

- Added `services/tracker/src/sharding.js` for deterministic channel-to-tracker-shard routing.
- Added `TRACKER_SHARD_ID` and `TRACKER_SHARDS` validation to shared tracker config.
- Tracker `join` now returns a `redirect` message and closes before placement or demand when the connected shard does not own the channel.
- Android `TrackerClient` now parses tracker redirects and reconnects to the target shard with a bounded redirect limit.
- Added `scripts/smoke-tracker-sharding.js` and `npm run smoke:tracker-sharding`.
- The smoke proves wrong-shard joins do not create swarm state or demand calls, while the owning shard accepts the join and sends demand.
- Updated compose, `.env.example`, configuration docs, load-testing docs, and validation guards.
- Verified focused shard/config/message tests, `npm run smoke:tracker-sharding`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 145

- Added guarded cold-tail downscale packaging to `ChannelManager`.
- Added `TAIL_DOWNSCALE_ENABLED`, `TAIL_DOWNSCALE_VIDEO_KBPS`, and `TAIL_DOWNSCALE_AUDIO_KBPS` ingest config.
- Cold demanded channels below `TAIL_SWARM_THRESHOLD` use lower-bitrate ffmpeg arguments when the feature flag is enabled.
- Channels are restarted back to source-copy packaging when demand rises above the tail threshold.
- Restart switches wait for the old ffmpeg process exit before launching replacement packaging.
- Added `scripts/smoke-ingest-tail-downscale.js` and `npm run smoke:ingest-tail-downscale`.
- Updated compose, `.env.example`, configuration docs, feature-flag docs, load-testing docs, and validation guards.
- Verified focused ingest/config tests, `npm run smoke:ingest-tail-downscale`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 146

- Added `TAIL_ADMISSION_MAX_CHANNELS` ingest config with disabled-by-default behavior.
- Added `ChannelManager` tail-demand helpers for admission, downscale eligibility, and active tail counting.
- New below-threshold tail channels are rejected with `capacity` before ffmpeg starts once the tail admission budget is full.
- Hot channels above `TAIL_SWARM_THRESHOLD` still enter the normal capacity path.
- Added `scripts/smoke-ingest-tail-admission.js` and `npm run smoke:ingest-tail-admission`.
- Updated compose, `.env.example`, configuration docs, load-testing docs, and validation guards.
- Verified focused ingest/config tests, `npm run smoke:ingest-tail-admission`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 147

- Added `scripts/smoke-alertmanager-routing.js`.
- Added `npm run smoke:alertmanager-routing`.
- The smoke parses the Alertmanager route/receiver subset used by this repo.
- It proves warning alerts route to `oncall-default`.
- It proves critical firing and resolved critical alerts route to `oncall-critical`.
- It verifies routed receivers have exactly one webhook and `send_resolved: true`.
- Updated production environment docs and validation guards.
- Verified `npm run smoke:alertmanager-routing`, `npm run smoke:alertmanager-routing -- test-fixtures/monitoring/alertmanager-production.yml`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 148

- Added `scripts/validate-restore-evidence.js`.
- Added `npm run restore:evidence:validate`.
- Added `test-fixtures/restore/evidence-complete.synthetic.json`.
- The validator requires staging restore metadata, RTO/RPO, seven restored asset classes, seven post-restore checks, and clean evidence references.
- Synthetic restore evidence is rejected unless `--allow-synthetic` is passed.
- Updated backup/restore docs, restore-drill runbook, launch-readiness rollback requirements, and validation guards.
- Verified `npm run restore:evidence:validate -- --allow-synthetic test-fixtures/restore/evidence-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 149

- Added `scripts/validate-security-review.js`.
- Added `npm run security:review:validate`.
- Added `test-fixtures/security/security-review-complete.synthetic.json`.
- The validator requires staging/production review metadata, reviewers, six required security scopes, clean evidence references, and explicit P0/P1 closure by fix or waiver.
- Synthetic security-review evidence is rejected unless `--allow-synthetic` is passed.
- Updated security review docs, launch-readiness hard gates, and validation guards.
- Verified `npm run security:review:validate -- --allow-synthetic test-fixtures/security/security-review-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 150

- Added `scripts/validate-dependency-review.js`.
- Added `npm run dependency:review:validate`.
- Added `test-fixtures/dependency/dependency-review-complete.synthetic.json`.
- The validator reads `config/dependency-inventory.json`, requires every inventory item to have an approved or waived decision, and rejects missing or duplicate decisions.
- It requires audit, SBOM, release image reference, image scan, Android debug build, and Android release build checks before dependency review evidence can pass.
- Synthetic dependency-review evidence is rejected unless `--allow-synthetic` is passed.
- Updated dependency review docs, launch-readiness hard gates, and validation guards.
- Verified `npm run dependency:review:validate -- --allow-synthetic test-fixtures/dependency/dependency-review-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 151

- Added `scripts/validate-threat-model-review.js`.
- Added `npm run threat:model:validate`.
- Added `test-fixtures/security/threat-model-review-complete.synthetic.json`.
- The validator requires coverage for 11 architecture areas, all 15 documented threat IDs, required open-gate acknowledgements, and security/platform/android/operations sign-offs.
- Synthetic threat-model evidence is rejected unless `--allow-synthetic` is passed.
- Updated threat-model docs, launch-readiness hard gates, and validation guards.
- Verified `npm run threat:model:validate -- --allow-synthetic test-fixtures/security/threat-model-review-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 152

- Added `scripts/validate-retention-approval.js`.
- Added `npm run retention:approval:validate`.
- Added `test-fixtures/retention/retention-approval-complete.synthetic.json`.
- The validator reads `config/data-retention.json`, requires every retention class to match policy windows, and requires privacy/legal/security/operations approval roles.
- It gates structured log redaction, public catalog sanitization, retention job execution, destructive execution guard, retention-worker health, staging execution, backup/restore retention scope, and incident hold process evidence.
- Synthetic retention approval evidence is rejected unless `--allow-synthetic` is passed.
- Updated data-retention docs, launch-readiness hard gates, and validation guards.
- Verified `npm run retention:approval:validate -- --allow-synthetic test-fixtures/retention/retention-approval-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 153

- Added `scripts/validate-android-ci-evidence.js`.
- Added `npm run android:ci:evidence:validate`.
- Added `test-fixtures/android/ci-build-complete.synthetic.json`.
- The validator requires a GitHub Actions `CI` / `android` job, Java/Gradle/Android SDK toolchain metadata, six required build steps, and debug plus release artifacts with SHA-256 checksums.
- Synthetic Android CI evidence is rejected unless `--allow-synthetic` is passed.
- Updated Android README, launch-readiness hard gates, backlog CI/Android/deployment statuses, and validation guards.
- Verified `npm run android:ci:evidence:validate -- --allow-synthetic test-fixtures/android/ci-build-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 154

- Added `scripts/validate-android-accessibility-evidence.js`.
- Added `npm run android:accessibility:validate`.
- Added `test-fixtures/android/accessibility-complete.synthetic.json`.
- The validator requires device metadata and pass evidence for TalkBack focus order, 200% font scale, small-screen layout, Media3 controls, P2P toggle, privacy dialog, error states, and pseudo-locale coverage.
- Synthetic Android accessibility evidence is rejected unless `--allow-synthetic` is passed.
- Updated accessibility baseline docs, launch-readiness hard gates, backlog Q-010 status, and validation guards.
- Verified `npm run android:accessibility:validate -- --allow-synthetic test-fixtures/android/accessibility-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 155

- Added `scripts/validate-android-playback-evidence.js`.
- Added `npm run android:playback:evidence:validate`.
- Added `test-fixtures/android/playback-delivery-fleet-complete.synthetic.json`.
- The validator reads `config/performance-budgets.json` and requires Delivery-Fleet-only sessions to meet 30-minute soak duration, startup latency, stall rate, buffer minimum, edge cache hit ratio, battery, authentication, and crash-free constraints.
- Synthetic Android playback evidence is rejected unless `--allow-synthetic` is passed.
- Updated Android README, launch-readiness hard gates, backlog M4/P4 playback statuses, and validation guards.
- Verified `npm run android:playback:evidence:validate -- --allow-synthetic test-fixtures/android/playback-delivery-fleet-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 156

- Added `scripts/validate-android-p2p-evidence.js`.
- Added `npm run android:p2p:evidence:validate`.
- Added `test-fixtures/android/p2p-transfer-complete.synthetic.json`.
- The validator requires at least two devices, WebRTC offer/answer, ICE connected, DataChannel open, verified peer segment transfer, hash verification, edge fallback, tracker stats, and P2P-disable closure evidence.
- It enforces zero hash failures/disconnects plus stall-rate and buffer-minimum budgets from `config/performance-budgets.json`.
- Synthetic Android P2P evidence is rejected unless `--allow-synthetic` is passed.
- Updated Android README, launch-readiness hard gates, backlog M4/M5 P2P statuses, and validation guards.
- Verified `npm run android:p2p:evidence:validate -- --allow-synthetic test-fixtures/android/p2p-transfer-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 157

- Added `scripts/validate-android-rlnc-decision.js`.
- Added `npm run android:rlnc:decision:validate`.
- Added `test-fixtures/android/rlnc-decision-complete.synthetic.json`.
- The validator requires implementation metadata, Android/security/legal/performance reviewers, license review, ABI review, decode/allocation benchmarks, malformed-packet fuzzing, bad-decode rejection, device swarm decode, hash-before-store, and maintenance-owner evidence.
- It enforces decode CPU and battery budgets from `config/performance-budgets.json`, zero fuzz crashes, zero bad stores, and zero device hash failures.
- Synthetic Android RLNC decision evidence is rejected unless `--allow-synthetic` is passed.
- Updated the Android RLNC ADR, launch-readiness hard gates, backlog P6 status, and validation guards.
- Verified `npm run android:rlnc:decision:validate -- --allow-synthetic test-fixtures/android/rlnc-decision-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 158

- Added `scripts/validate-load-ladder-evidence.js`.
- Added `npm run load:ladder:validate`.
- Added `test-fixtures/load/load-ladder-complete.synthetic.json`.
- The validator requires all four staged load gates: 1 channel / 3 devices, 1 channel / 200 peers, 50 channels / 2000 peers, and a Zipf-distributed catalog run.
- It enforces offload ratio, stall rate, startup latency, buffer minimum, tracker CPU p95, tracker memory per peer, edge cache hit ratio, edge/origin egress fields, and clear alert state against the performance budgets.
- Synthetic load-ladder evidence is rejected unless `--allow-synthetic` is passed.
- Updated load-testing docs, launch-readiness hard gates, backlog P8/P9 capacity statuses, and validation guards.
- Verified `npm run load:ladder:validate -- --allow-synthetic test-fixtures/load/load-ladder-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 159

- Added `scripts/validate-staging-chaos-evidence.js`.
- Added `npm run chaos:staging:validate`.
- Added `test-fixtures/chaos/staging-chaos-complete.synthetic.json`.
- The validator requires tracker restart during Android playback, ffmpeg worker crash, edge-node failover, ingest-node failover, control-plane restart, and multi-service recovery drills.
- It enforces pass status, observed alerts, recovery, no cascade, no data loss, and no third-party CDN fallback for every drill.
- Synthetic staging chaos evidence is rejected unless `--allow-synthetic` is passed.
- Updated chaos-drill docs, launch-readiness hard gates, backlog P8 chaos status, and validation guards.
- Verified `npm run chaos:staging:validate -- --allow-synthetic test-fixtures/chaos/staging-chaos-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 160

- Added `scripts/validate-rollback-evidence.js`.
- Added `npm run rollback:evidence:validate`.
- Added `test-fixtures/rollback/rollback-drill-complete.synthetic.json`.
- The validator requires all five service images for the current and rollback versions to be digest-pinned and different.
- It enforces preflight checks, `pull`, `up -d --no-build`, service `ps`, post-rollback smokes, dashboard evidence, no data loss, and no third-party CDN fallback.
- Synthetic rollback evidence is rejected unless `--allow-synthetic` is passed.
- Updated rollback runbook, deployment pipeline docs, launch-readiness rollback gate, backlog P9 deployment status, and validation guards.
- Verified `npm run rollback:evidence:validate -- --allow-synthetic test-fixtures/rollback/rollback-drill-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 161

- Added `scripts/validate-alertmanager-fire-drill.js`.
- Added `npm run alertmanager:fire-drill:validate`.
- Added `test-fixtures/monitoring/alertmanager-fire-drill-complete.synthetic.json`.
- The validator requires receiver validation and routing smoke evidence before accepting fire-drill results.
- It enforces warning, critical, and resolved-critical notification observation and acknowledgment against the expected Alertmanager receivers.
- Synthetic Alertmanager fire-drill evidence is rejected unless `--allow-synthetic` is passed.
- Updated production environment docs, launch-readiness hard gates, backlog P8/P9 alert statuses, and validation guards.
- Verified `npm run alertmanager:fire-drill:validate -- --allow-synthetic test-fixtures/monitoring/alertmanager-fire-drill-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 162

- Added `scripts/validate-nginx-tls-evidence.js`.
- Added `npm run nginx:tls:evidence:validate`.
- Added `test-fixtures/launch/nginx-tls-smoke-complete.synthetic.json`.
- The validator requires local origin/edge smoke pass markers plus real host origin and edge TLS evidence.
- It enforces hostname-verified TLS, origin auth 401/200 behavior, segment cache headers, edge unauthenticated 401, edge `MISS` then `HIT`, cross-token cache reuse, one origin fill, no source URL leakage, no token cache-key leakage, and no third-party CDN fallback.
- Synthetic nginx/TLS evidence is rejected unless `--allow-synthetic` is passed.
- Updated launch evidence requirements, launch-readiness gates, production environment docs, backlog M1/M2 origin/edge statuses, and validation guards.
- Verified `npm run nginx:tls:evidence:validate -- --allow-synthetic test-fixtures/launch/nginx-tls-smoke-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 163

- Added `scripts/validate-source-allowlist-evidence.js`.
- Added `npm run source:allowlist:evidence:validate`.
- Added `test-fixtures/launch/source-allowlist-complete.synthetic.json`.
- The validator requires approved source hosts, private-network denial, no catch-all wildcard, production env validation, catalog preflight success, source URL redaction, private/credentialed source rejection, and public catalog source stripping.
- Synthetic source allowlist evidence is rejected unless `--allow-synthetic` is passed.
- Updated source URL policy docs, launch evidence requirements, launch-readiness hard gates, production environment docs, backlog catalog/prod-env statuses, and validation guards.
- Verified `npm run source:allowlist:evidence:validate -- --allow-synthetic test-fixtures/launch/source-allowlist-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 164

- Added `scripts/validate-legal-approval.js`.
- Added `npm run legal:approval:validate`.
- Added `test-fixtures/legal/legal-approval-complete.synthetic.json`.
- The validator requires redistribution, rebroadcast, peer relay, viewer device retransmission, territory, app-store/platform, operational metrics logging, and privacy disclosure rights to be explicitly approved.
- It requires legal, content-licensing, and privacy approver roles with clean evidence references.
- Synthetic legal approval evidence is rejected unless `--allow-synthetic` is passed.
- Updated legal gate docs, launch evidence requirements, launch-readiness hard gates, backlog M0 legal status, and validation guards.
- Verified `npm run legal:approval:validate -- --allow-synthetic test-fixtures/legal/legal-approval-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 165

- Added `scripts/validate-production-smoke-evidence.js`.
- Added `npm run production:smoke:evidence:validate`.
- Added `test-fixtures/launch/production-smokes-complete.synthetic.json`.
- The validator requires auth token issuance/verification, source preflight, catalog search/pagination, ingest demand/segments, edge cache MISS/HIT, tracker join/peer-list/signal/stats/metrics, retention health/metrics, and offload dashboard/alert query evidence.
- It enforces no third-party CDN use, no source URL exposure, and no token exposure in the smoke record.
- Synthetic production smoke evidence is rejected unless `--allow-synthetic` is passed.
- Updated launch evidence requirements, launch-readiness hard gates, production environment docs, backlog P9 production status, and validation guards.
- Verified `npm run production:smoke:evidence:validate -- --allow-synthetic test-fixtures/launch/production-smokes-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 166

- Added `scripts/validate-retention-execution-evidence.js`.
- Added `npm run retention:execution:evidence:validate`.
- Added `test-fixtures/retention/retention-execution-complete.synthetic.json`.
- The validator requires retention approval validation, dry-run Prometheus metrics, execute-mode evidence, scoped credentials, destructive guard proof, all retention classes, zero failures, and redacted action logs.
- Synthetic retention execution evidence is rejected unless `--allow-synthetic` is passed.
- Updated data retention policy docs, launch evidence requirements, launch-readiness hard gates, backlog Q-009 retention status, and validation guards.
- Verified `npm run retention:execution:evidence:validate -- --allow-synthetic test-fixtures/retention/retention-execution-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 167

- Added `scripts/validate-host-provisioning-evidence.js`.
- Added `npm run host:provisioning:evidence:validate`.
- Added `test-fixtures/infra/host-provisioning-complete.synthetic.json`.
- The validator requires Ubuntu 24.04, Docker/Compose, sysctl, file limits, `/var/hls` tmpfs, UFW, internal port denies, TLS issuance, certbot renew dry-run, DNS, and compose rendering evidence.
- It enforces public TCP ports `[80, 443]`, denied internal service ports, required origin/edge/API/tracker host roles, clean hostnames, and no third-party CDN use.
- Synthetic host provisioning evidence is rejected unless `--allow-synthetic` is passed.
- Updated host bootstrap runbook, launch evidence requirements, launch-readiness hard gates, production environment docs, backlog P1/P9 statuses, and validation guards.
- Verified `npm run host:provisioning:evidence:validate -- --allow-synthetic test-fixtures/infra/host-provisioning-complete.synthetic.json`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 168

- Added `scripts/validate-image-scan-bundle.js`.
- Added `npm run image:scan:bundle:validate`.
- Added `test-fixtures/security/image-scan-release-manifest.synthetic.json`.
- Added synthetic Trivy reports under `test-fixtures/security/scans/` for auth, ingest, tracker, control-plane, and retention-worker.
- The validator requires digest-pinned release manifest images, one expected Trivy report per service, matching report `ArtifactName` values, and no high/critical findings by default.
- Synthetic release manifests and scan reports are rejected unless `--allow-synthetic` is passed.
- Updated release manifest checks, deployment pipeline docs, dependency review docs, launch-readiness hard gates, launch evidence requirements, backlog P0/P9/Q-007 statuses, and validation guards.
- Verified `npm run image:scan:bundle:validate -- --allow-synthetic --manifest test-fixtures/security/image-scan-release-manifest.synthetic.json test-fixtures/security/scans/*.trivy.json`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 169

- Added `scripts/validate-secrets-evidence.js`.
- Added `npm run secrets:evidence:validate`.
- Added `test-fixtures/security/secrets-evidence-complete.synthetic.json`.
- The validator requires evidence for internal token, app API key, auth signing key, retention store token, Alertmanager default/critical webhooks, and production env file handling.
- It requires secret-manager or encrypted storage, rotation dates, injection targets, production env validation, access review, deployment injection proof, auth-key rotation readiness, backup/restore coverage, redaction review, and no raw secret values.
- Synthetic secrets evidence is rejected unless `--allow-synthetic` is passed.
- Updated configuration docs, production environment docs, launch-readiness hard gates, launch evidence requirements, backlog P9/Q-002 statuses, and validation guards.
- Verified `npm run secrets:evidence:validate -- --allow-synthetic test-fixtures/security/secrets-evidence-complete.synthetic.json`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 170

- Added `scripts/validate-deployment-evidence.js`.
- Added `npm run deployment:evidence:validate`.
- Added `test-fixtures/deployment/deployment-complete.synthetic.json`.
- The validator requires release manifest validation, digest-pinned images, production env validation, secrets evidence, host provisioning evidence, compose rendering, image pulls, `up --no-build`, service health, post-deploy smokes, rollback readiness, and no third-party CDN use.
- It rejects deployment evidence that builds images during promotion or includes sensitive evidence references.
- Synthetic deployment evidence is rejected unless `--allow-synthetic` is passed.
- Updated deployment pipeline docs, production environment docs, launch-readiness hard gates, launch evidence requirements, backlog P9 deployment status, and validation guards.
- Verified `npm run deployment:evidence:validate -- --allow-synthetic test-fixtures/deployment/deployment-complete.synthetic.json`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 171

- Added `scripts/validate-canary-rollout-evidence.js`.
- Added `npm run canary:rollout:evidence:validate`.
- Added `test-fixtures/launch/canary-rollout-complete.synthetic.json`.
- The validator requires internal, 1%, 5%, 25%, and full-public rollout stages, each with `canary:metrics:validate` evidence, clear alerts, and rollback availability.
- It also requires rollout-control, rollback/halt, edge-egress budget, alert, support-monitoring, and no-third-party-CDN checks.
- Synthetic canary rollout evidence is rejected unless `--allow-synthetic` is passed.
- Updated launch-readiness canary gates, launch evidence requirements, backlog P9 canary status, and validation guards.
- Verified `npm run canary:rollout:evidence:validate -- --allow-synthetic test-fixtures/launch/canary-rollout-complete.synthetic.json`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 172

- Added `scripts/validate-catalog-import.js`.
- Added `npm run catalog:import:validate`.
- Added `test-fixtures/catalog/catalog-import-complete.synthetic.json`.
- Added `docs/catalog-import.md`.
- The validator requires source preflight evidence, source allowlist validation, sanitized snapshot metadata, 64-hex snapshot hash and ETag, explicit source URL stripping, operator signature verification, public catalog smoke evidence, and rollback snapshot readiness.
- It rejects raw source URL presence, sensitive evidence references, unsupported signature algorithms, mismatched preflight/snapshot channel counts, and synthetic evidence unless `--allow-synthetic` is passed.
- Updated source URL policy docs, configuration docs, backlog P1/P7 catalog statuses, and validation guards.
- Verified `npm run catalog:import:validate -- --allow-synthetic test-fixtures/catalog/catalog-import-complete.synthetic.json`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 173

- Added `services/control-plane/src/sqliteCatalogStore.js`.
- Added optional control-plane `CATALOG_DB_PATH` startup wiring.
- Added `npm run smoke:catalog-sqlite`.
- Added SQLite catalog persistence coverage in `services/control-plane/test/sqliteCatalogStore.test.js`.
- The SQLite store persists sanitized public channel fields only, creates group/name indexes, stores catalog metadata, preserves ETags across reopen, and can be loaded when the source M3U is unavailable.
- Updated `.env.example`, compose, configuration docs, catalog import docs, config tests, backlog P7 catalog status, and validation guards.
- Verified `npm run smoke:catalog-sqlite`, focused catalog/config tests, `npm run check`, and `npm run verify`.

## Completed In Build Slice 174

- Added `scripts/smoke-catalog-sqlite-20k.js`.
- Added `npm run smoke:catalog-sqlite-20k`.
- The smoke imports 20,000 synthetic channels into SQLite, closes the importer, reloads the catalog from disk, starts the real public catalog HTTP server, and checks first-page, search, and group responses.
- The smoke enforces source URL stripping and 100 ms HTTP budgets for first page, search, and group filtering.
- Latest local run: import 144.67 ms, reload 39.11 ms, first page 13.99 ms, search 2.86 ms, group 1.25 ms.
- Updated load-testing docs, backlog P7 catalog/API statuses, and validation guards.
- Verified `npm run smoke:catalog-sqlite-20k`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 175

- Added `services/control-plane/src/sqlitePlacementRegistry.js`.
- Added optional control-plane `PLACEMENT_DB_PATH` startup wiring.
- Added `npm run smoke:control-plane-placement-sqlite`.
- Added SQLite placement persistence coverage in `services/control-plane/test/placement.test.js`.
- The SQLite registry stores channel-to-node assignments with update timestamps, persists assignment and release operations, restores placements into the scheduler on process restart, and keeps the existing JSON `PLACEMENT_PATH` fallback.
- Updated `.env.example`, compose, configuration docs, backup/restore docs, restore-drill runbook, backlog P7 placement status, and validation guards.
- Verified `npm run smoke:control-plane-placement-sqlite`, focused placement/config tests, `npm run check`, and `npm run verify`.

## Completed In Build Slice 176

- Added `logHttpRequest` to `@swarmcast/config/logging`.
- Added request completion logging for auth, ingest, control-plane, and retention-worker HTTP servers.
- Added logging tests proving `http_request_completed` records keep `request_id`, method, sanitized path, status code, duration, and error class while dropping query strings that may contain tokens or source URLs.
- Added `retention-worker` to the allowed structured logging service names.
- Updated logging docs and validation guards for request completion logging coverage.
- Verified focused logging/HTTP service tests, `npm run check`, and `npm run verify`.

## Completed In Build Slice 177

- Added `scripts/smoke-sqlite-backup-restore.js`.
- Added `npm run smoke:sqlite-backup-restore`.
- The smoke creates catalog and placement SQLite databases, backs them up with a checksum manifest, restores copies into fresh paths, and verifies catalog rows, placement mappings, and source URL stripping.
- Updated backup/restore docs, restore-drill runbook, backlog P8 backup status, and validation guards.
- Verified `npm run smoke:sqlite-backup-restore`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 178

- Added catalog and placement backend identity to control-plane stats.
- Added Prometheus info-style metrics: `swarmcast_control_catalog_backend_info` and `swarmcast_control_placement_backend_info`.
- Marked catalog stores as `memory`, `m3u`, `snapshot`, or `sqlite`, and placement registries as `memory`, `file`, or `sqlite`.
- Updated control-plane metrics tests, backlog P8 metrics status, and validation guards.
- Verified focused control-plane tests, `npm run check`, and `npm run verify`.

## Completed In Build Slice 179

- Added a Grafana overview dashboard panel for control-plane storage backends.
- Wired `swarmcast_control_catalog_backend_info` and `swarmcast_control_placement_backend_info` into dashboard visibility.
- Extended dashboard/config validation guards to require the backend metrics and panel title.
- Updated backlog P8 dashboard status.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 180

- Added Prometheus alerts for non-durable control-plane catalog and placement backends.
- Added `docs/runbooks/control-plane-storage-backend.md` with triage, mitigation, and recovery evidence steps.
- Extended config validation to require the new alert names, PromQL expressions, runbook link, and runbook recovery commands.
- Updated backlog P8 alert status.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 181

- Added `scripts/validate-prometheus-alerts.js`.
- Added `npm run prometheus:alerts:validate` and wired it into `npm run check`.
- The validator now checks alert uniqueness, expression presence/balancing, `for` duration, severity, summary, description, and existing runbook links.
- Updated backlog P8 alert status and validation guards.
- Verified `npm run prometheus:alerts:validate`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 182

- Added `scripts/validate-grafana-dashboard.js`.
- Added `npm run grafana:dashboard:validate` and wired it into `npm run check`.
- The validator now checks dashboard metadata, production tags, unique panel ids/titles, supported panel types, non-overlapping grid positions, query expressions, and legends.
- Updated backlog P8 dashboard status and validation guards.
- Verified `npm run grafana:dashboard:validate`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 183

- Added an `Active Alerts` panel to the Grafana overview dashboard.
- The panel queries currently firing SwarmCast alerts through the Prometheus `ALERTS` series.
- Expanded dashboard validation guards for the new panel and query.
- Updated backlog P8 dashboard status.
- Verified `npm run grafana:dashboard:validate`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 184

- Tightened production env validation to require `CATALOG_DB_PATH` and `PLACEMENT_DB_PATH`.
- Added absolute, persistent SQLite path checks for both durable control-plane databases.
- Updated the production env fixture plus configuration and production-environment docs.
- Updated backlog P9 production environment and Q-002 config-validation status.
- Verified `npm run env:production:validate -- test-fixtures/config/production.env`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 185

- Tightened production env validation for the built-in HTTP retention store.
- Production env validation now requires `RETENTION_STORE_HTTP_BASE_URL`, a 64-hex `RETENTION_STORE_HTTP_TOKEN`, and explicit `RETENTION_STORE_HTTP_TIMEOUT_MS` when using `retention-http-store`.
- Updated configuration, production environment, and data retention docs.
- Updated backlog P9 production environment, Q-002 config, and Q-009 retention status.
- Verified `npm run env:production:validate -- test-fixtures/config/production.env`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 186

- Updated `infra/docker-compose.yml` so control-plane catalog and placement DB/snapshot paths come from environment variables with durable `/data` defaults.
- Added config validation guards for the env-backed compose values.
- Rendered compose with the production fixture and confirmed the expected catalog, placement, and retention environment values appear.
- Updated backlog P9 production environment and Q-002 config status.
- Verified compose rendering, `npm run check`, and `npm run verify`.

## Completed In Build Slice 187

- Tightened production env validation to require `AUTH_KEY_PATH`.
- Added persistent absolute-path validation for `AUTH_KEY_PATH` and optional `AUTH_PREVIOUS_JWKS_PATH`.
- Added `AUTH_KEY_PATH` to `.env.example`, the production env fixture, and auth compose environment passthrough.
- Updated production configuration docs and validation guards.
- Verified production env validation, compose rendering, `npm run check`, and `npm run verify`.

## Completed In Build Slice 188

- Added `scripts/smoke-production-env-validation.js`.
- Added `npm run smoke:production-env-validation` and wired it into `npm run check`.
- The smoke proves the production env validator accepts the complete fixture and rejects missing `AUTH_KEY_PATH`, temporary `CATALOG_DB_PATH`, missing `RETENTION_STORE_HTTP_TOKEN`, and missing `RETENTION_STORE_HTTP_TIMEOUT_MS`.
- Updated backlog P9 production environment and Q-002 config status.
- Verified `npm run smoke:production-env-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 189

- Updated `infra/docker-compose.yml` so control-plane `INGEST_NODES` comes from the validated environment with the existing local default.
- Added config validation coverage for the env-backed compose value.
- Rendered compose with defaults and with `--env-file test-fixtures/config/production.env`, confirming the production `origin-a` ingest-node JSON is preserved.
- Updated backlog P9 production environment and Q-002 config status.
- Verified compose rendering, `npm run check`, and `npm run verify`.

## Completed In Build Slice 190

- Updated ingest and control-plane compose `M3U_PATH` to use `${M3U_PATH:-/config/source.m3u}`.
- Added config validation coverage for the env-backed compose value.
- Rendered compose with defaults and with the production env fixture, confirming both services receive the expected M3U path.
- Updated backlog P9 production environment and Q-002 config status.
- Verified compose rendering, `npm run check`, and `npm run verify`.

## Completed In Build Slice 191

- Added `scripts/smoke-compose-production-env.js`.
- Added `npm run smoke:compose-production-env` and wired it into `npm run check`.
- The smoke renders default compose and production-env compose, then checks auth key path, M3U path, ingest-node JSON, catalog/placement paths, and retention HTTP settings.
- Updated backlog P9 production environment and Q-002 config status.
- Verified `npm run smoke:compose-production-env`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 192

- Added an explicit production environment config gate to `docs/launch-readiness.md`.
- The gate requires `npm run env:production:validate -- path/to/production.env`, `npm run smoke:production-env-validation`, and `npm run smoke:compose-production-env`.
- Added a matching go/no-go table row and validation guard coverage.
- Updated backlog P9 production environment and launch-readiness status.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 193

- Updated `docs/configuration.md` so the production env validation summary matches the current auth key, durable control-plane SQLite, retention HTTP credential/timeout, image, execution, and launch-secret gates.
- Updated the configuration validation guard to require the stricter summary text.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 194

- Required production env files to set an absolute persistent `ALERTMANAGER_CONFIG_PATH`.
- Made compose mount the configured Alertmanager receiver file while preserving the bundled local default.
- Extended production env and compose smokes to catch missing Alertmanager config path and verify the production render.
- Updated configuration and production environment docs plus validation guards.
- Verified focused env/compose smokes, `npm run check`, and `npm run verify`.

## Completed In Build Slice 195

- Required production `RETENTION_STORE_MODULE` values to be absolute `.js` paths that resolve inside the container.
- Updated the production fixture to use `/app/scripts/retention-http-store.js`.
- Changed retention-worker compose to default `RETENTION_RECORDS_FILE` to `/data/retention-records.jsonl` instead of a test fixture path.
- Extended production env and compose smokes plus docs/validation guards.
- Verified focused env/compose smokes, `npm run check`, and `npm run verify`.

## Completed In Build Slice 196

- Extended `smoke:compose-production-env` to render `infra/docker-compose.yml` with `infra/docker-compose.release.yml`.
- Verified the production env fixture renders digest-pinned images for auth, ingest, tracker, control-plane, and retention-worker.
- Updated deployment/configuration docs and validation guards.
- Verified `npm run smoke:compose-production-env`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 197

- Added production env-backed image refs for nginx, Prometheus, Alertmanager, Grafana, edge metrics, and node exporter.
- Tightened production env validation to require 12 digest-pinned images across services and infrastructure.
- Extended `smoke:compose-production-env` to render base, release-overlay, and edge compose plans with the production env fixture.
- Updated configuration, deployment, and dependency docs plus validation guards.
- Verified focused env/compose smokes, `npm run check`, and `npm run verify`.

## Completed In Build Slice 198

- Added a `SWARMCAST_PROMETHEUS_IMAGE` tag-only regression case to `smoke:production-env-validation`.
- Kept production env validation coverage aligned with the 12-image service and infrastructure digest gate.
- Verified focused production env smoke, `npm run check`, and `npm run verify`.

## Completed In Build Slice 199

- Extended release manifest generation and validation to cover 12 production images.
- Extended `image:scan:bundle:validate` to require scan reports for service and infrastructure images.
- Added synthetic Trivy scan reports for nginx, Prometheus, Alertmanager, Grafana, edge nginx, edge metrics, and node exporter.
- Regenerated the checked-in release manifest with the 12-image shape.
- Verified release manifest checks, image scan bundle validation, `npm run check`, and `npm run verify`.

## Completed In Build Slice 200

- Extended `release:images:check` to validate all 12 service and infrastructure image refs.
- Verified the check with the production fixture image set.
- Updated deployment/dependency docs and validation guards.
- Verified `release:images:check`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 201

- Updated rollback runbook exports to include all service and infrastructure image refs required by `release:images:check`.
- Updated the deployment image-ref list and release workflow summary to name the full 12-image production set.
- Updated validation guards for the expanded image list.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 202

- Added `scripts/smoke-release-manifest-production.js`.
- Wired `npm run smoke:release-manifest-production` into `npm run check`.
- Proved the production env fixture can generate a `--require-digests` production release manifest with 12 image refs and 12 expected scan paths.
- Updated deployment docs and validation guards.
- Verified the focused smoke, `npm run check`, and `npm run verify`.

## Completed In Build Slice 203

- Added service image placeholders to `.env.example` for auth, ingest, tracker, control-plane, and retention-worker.
- Guarded `.env.example` for service and infrastructure image ref placeholders.
- Updated the Q-002 backlog summary.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 204

- Extended `smoke:release-manifest-production` to run `scripts/validate-release-images.js` with production fixture image refs before manifest generation.
- Kept the 12-image release ref check covered by `npm run check`.
- Updated validation guards and deployment backlog status.
- Verified focused release smokes, `npm run check`, and `npm run verify`.

## Verified

```bash
npm ci --ignore-scripts && npm run verify
npm install --ignore-scripts
node --test services/tracker/test/stats.test.js services/tracker/test/metrics.test.js services/tracker/test/messages.test.js packages/config/test/performanceBudgets.test.js
node --test services/tracker/test/segments.test.js services/tracker/test/swarm.test.js services/ingest/test/segmentWatcher.test.js
node --test packages/config/test/mediaUrls.test.js services/tracker/test/placementClient.test.js
node --test services/control-plane/test/catalogStore.test.js packages/config/test/env.test.js
node --test services/control-plane/test/catalogServer.test.js
node --test packages/config/test/env.test.js
node --test services/ingest/test/metrics.test.js services/ingest/test/channelManager.test.js services/ingest/test/segmentWatcher.test.js
node --test packages/config/test/errors.test.js services/auth/test/auth.test.js services/ingest/test/server.test.js services/control-plane/test/catalogServer.test.js services/retention-worker/test/worker.test.js services/tracker/test/messages.test.js services/tracker/test/placementClient.test.js
bash -n infra/host/firewall/ufw-swarmcast.sh
bash -n infra/host/tls/certbot-swarmcast.sh
infra/host/tls/certbot-swarmcast.sh
npm run legal:approval:validate -- --allow-synthetic test-fixtures/legal/legal-approval-complete.synthetic.json
npm run alertmanager:receivers:validate -- test-fixtures/monitoring/alertmanager-production.yml
npm run alertmanager:fire-drill:validate -- --allow-synthetic test-fixtures/monitoring/alertmanager-fire-drill-complete.synthetic.json
npm run smoke:alertmanager-routing
npm run smoke:alertmanager-routing -- test-fixtures/monitoring/alertmanager-production.yml
npm run canary:metrics:validate -- test-fixtures/launch/canary-metrics-pass.json
npm run canary:rollout:evidence:validate -- --allow-synthetic test-fixtures/launch/canary-rollout-complete.synthetic.json
npm run restore:evidence:validate -- --allow-synthetic test-fixtures/restore/evidence-complete.synthetic.json
npm run rollback:evidence:validate -- --allow-synthetic test-fixtures/rollback/rollback-drill-complete.synthetic.json
npm run security:review:validate -- --allow-synthetic test-fixtures/security/security-review-complete.synthetic.json
npm run dependency:review:validate -- --allow-synthetic test-fixtures/dependency/dependency-review-complete.synthetic.json
npm run threat:model:validate -- --allow-synthetic test-fixtures/security/threat-model-review-complete.synthetic.json
npm run retention:approval:validate -- --allow-synthetic test-fixtures/retention/retention-approval-complete.synthetic.json
npm run retention:execution:evidence:validate -- --allow-synthetic test-fixtures/retention/retention-execution-complete.synthetic.json
npm run android:ci:evidence:validate -- --allow-synthetic test-fixtures/android/ci-build-complete.synthetic.json
npm run android:accessibility:validate -- --allow-synthetic test-fixtures/android/accessibility-complete.synthetic.json
npm run android:playback:evidence:validate -- --allow-synthetic test-fixtures/android/playback-delivery-fleet-complete.synthetic.json
npm run android:p2p:evidence:validate -- --allow-synthetic test-fixtures/android/p2p-transfer-complete.synthetic.json
npm run android:rlnc:decision:validate -- --allow-synthetic test-fixtures/android/rlnc-decision-complete.synthetic.json
npm run load:ladder:validate -- --allow-synthetic test-fixtures/load/load-ladder-complete.synthetic.json
npm run chaos:staging:validate -- --allow-synthetic test-fixtures/chaos/staging-chaos-complete.synthetic.json
npm run nginx:tls:evidence:validate -- --allow-synthetic test-fixtures/launch/nginx-tls-smoke-complete.synthetic.json
npm run source:allowlist:evidence:validate -- --allow-synthetic test-fixtures/launch/source-allowlist-complete.synthetic.json
npm run catalog:import:validate -- --allow-synthetic test-fixtures/catalog/catalog-import-complete.synthetic.json
npm run production:smoke:evidence:validate -- --allow-synthetic test-fixtures/launch/production-smokes-complete.synthetic.json
npm run host:provisioning:evidence:validate -- --allow-synthetic test-fixtures/infra/host-provisioning-complete.synthetic.json
npm run secrets:evidence:validate -- --allow-synthetic test-fixtures/security/secrets-evidence-complete.synthetic.json
npm run deployment:evidence:validate -- --allow-synthetic test-fixtures/deployment/deployment-complete.synthetic.json
npm run capacity:plan:validate -- config/capacity-plan.json
npm run check
npm run smoke:catalog-source-preflight
npm run smoke:catalog-sqlite
npm run smoke:catalog-sqlite-20k
npm run smoke:edge-cache-metrics
npm run smoke:edge-cache-metrics-server
npm run smoke:ffmpeg
npm run smoke:catalog-20k
npm run smoke:edge-cache
npm run smoke:headless-200
npm run smoke:headless-peer
npm run smoke:control-plane-placement-restart
npm run smoke:control-plane-placement-sqlite
npm run smoke:sqlite-backup-restore
npm run smoke:ingest-demand-playlist
npm run smoke:ingest-ffmpeg-chaos
npm run smoke:ingest-tail-admission
npm run smoke:ingest-tail-downscale
npm run smoke:nginx-config
npm run smoke:nginx-edge-cache
npm run smoke:nginx-origin-playback
npm run smoke:origin-auth
npm run smoke:multi-ingest-routing
npm run smoke:placement-movement
npm run smoke:poisoning
npm run smoke:rlnc-swarm
npm run smoke:retention-execute
npm run smoke:retention-http-store
npm run smoke:retention-redaction
npm run smoke:source-policy
npm run smoke:tracker-load
npm run smoke:tracker-sharding
npm run smoke:tracker-ws
npm run smoke:tracker-ws-load
npm run smoke:tracker-ws-multichannel
npm run smoke:tracker-ws-restart
npm run smoke:ingest
npm run retention:dry-run
npm run retention:dry-run -- --prometheus
RETENTION_NOW=2026-07-05T00:00:00.000Z npm run retention:job
RETENTION_NOW=2026-07-05T00:00:00.000Z npm run retention:job -- --prometheus
npm run env:production:validate -- test-fixtures/config/production.env
npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json
npm audit --audit-level=moderate
npm run sbom:generate -- --check
npm run release:manifest -- --version v0.1.0-rc1 --environment staging --commit 0123456789abcdef0123456789abcdef01234567 --repository Aziz/Ads --output var/release/swarmcast-release-manifest.json
npm run release:manifest -- --input var/release/swarmcast-release-manifest.json --check
SWARMCAST_AUTH_IMAGE=ghcr.io/example/swarmcast/auth@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa SWARMCAST_INGEST_IMAGE=ghcr.io/example/swarmcast/ingest@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb SWARMCAST_TRACKER_IMAGE=ghcr.io/example/swarmcast/tracker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc SWARMCAST_CONTROL_PLANE_IMAGE=ghcr.io/example/swarmcast/control-plane@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd SWARMCAST_RETENTION_WORKER_IMAGE=ghcr.io/example/swarmcast/retention-worker@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee npm run release:images:check
npm run image:scan:validate -- test-fixtures/security/trivy-clean.json
npm run image:scan:bundle:validate -- --allow-synthetic --manifest test-fixtures/security/image-scan-release-manifest.synthetic.json test-fixtures/security/scans/*.trivy.json
docker compose -f infra/docker-compose.yml config
docker compose -f infra/edge/docker-compose.yml config
SWARMCAST_AUTH_IMAGE=ghcr.io/example/swarmcast/auth@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa SWARMCAST_INGEST_IMAGE=ghcr.io/example/swarmcast/ingest@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb SWARMCAST_TRACKER_IMAGE=ghcr.io/example/swarmcast/tracker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc SWARMCAST_CONTROL_PLANE_IMAGE=ghcr.io/example/swarmcast/control-plane@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd SWARMCAST_RETENTION_WORKER_IMAGE=ghcr.io/example/swarmcast/retention-worker@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee docker compose -f infra/docker-compose.yml -f infra/docker-compose.release.yml config
docker build -f services/auth/Dockerfile -t swarmcast-auth:local .
docker build -f services/control-plane/Dockerfile -t swarmcast-control-plane:local .
docker build -f services/ingest/Dockerfile -t swarmcast-ingest:local .
docker build -f services/tracker/Dockerfile -t swarmcast-tracker:local .
docker build -f services/retention-worker/Dockerfile -t swarmcast-retention-worker:local .
docker compose -f infra/docker-compose.yml build auth control-plane ingest tracker
docker compose -f infra/docker-compose.yml build retention-worker
TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws
docker build -f services/tracker/Dockerfile -t swarmcast-tracker:local . && TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws
docker build --no-cache -f services/tracker/Dockerfile -t swarmcast-tracker:local .
TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws-load
TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws-multichannel
TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws-restart
```

Results:

- Syntax checks passed across 164 JavaScript files.
- 142 Node tests passed.
- Control-plane backend identity metrics passed for catalog and placement storage backends.
- SQLite backup/restore smoke passed with 2 backed-up assets, 3 restored catalog channels, 2 restored placements, valid checksums, and no restored source URL leakage.
- HTTP request completion logging tests passed with query strings stripped from logged paths and token/source URL sentinels absent from emitted records.
- Control-plane SQLite placement restart smoke passed with restored node `origin-a` and persisted release.
- Catalog SQLite 20K HTTP smoke passed with import 144.67 ms, reload 39.11 ms, first page 13.99 ms, search 2.86 ms, and group 1.25 ms.
- Catalog SQLite smoke passed with 3 sanitized channels, 2 groups, source URL-free persisted fields, and reload from the SQLite database.
- Catalog import evidence validation passed for the synthetic complete fixture with 20,000 channels and 7 required checks.
- Retention execution evidence validation passed for the synthetic complete fixture with 5 retention classes and zero failures.
- Production smoke evidence validation passed for the synthetic complete fixture with 9 required smoke checks.
- Legal approval validation passed for the synthetic complete fixture with 8 required rights and 3 approver roles.
- Source allowlist evidence validation passed for the synthetic complete fixture with 2 approved hosts and 20,000 preflight-healthy channels.
- nginx/TLS evidence validation passed for the synthetic complete fixture with origin auth playback and edge MISS/HIT cache proof.
- Alertmanager fire-drill evidence validation passed for the synthetic complete fixture with 3 observed and acknowledged notification cases.
- Staging chaos evidence validation passed for the synthetic complete fixture with 6 required drills and no third-party CDN/cascade/data-loss conditions.
- Rollback evidence validation passed for the synthetic complete fixture with 5 service image pairs and 9 required post-rollback checks.
- Android scaffold presence validation passed, including app config, catalog cache, repositories, tracker client, playback files, buffer policy, session coordinator, player UI handoff, peer manager, PeerLink, upload budget, scheduler, CODED/RANK wire helpers, coded fetch, decoder seam, Compose UI, privacy surface, and catalog ViewModel.
- Config validation passed across 9 text files and 5 JSON configs, including dashboard JSON, playback-quality metrics, segment announce validation, tracker demand heartbeat config, ingest segment-age metrics, high edge egress alerting, host tuning files, host firewall script, host TLS script, release compose override, performance budgets, alerts, dependency inventory, data retention, capacity plan, edge compose, and Android RLNC ADR guardrails.
- Error taxonomy validation now requires `not_found`, shared public error helpers, and service adoption across auth, ingest, control-plane, retention-worker, and tracker placement handling.
- Android scaffold validation now requires `ErrorTaxonomy.kt`, typed API error parsing in auth/catalog repositories, edge error mapping in `SegmentScheduler`, and safe catalog UI message fallback.
- TLS certbot helper syntax passed and the default dry run emitted one certbot command per hostname for origin, API, and tracker with webroot, staging, per-host cert names, and an nginx deploy hook.
- Nginx origin playback smoke passed over HTTPS through a real nginx container: playlist without token returned 401, playlist with token returned 200, and `seg_00000000.m4s` returned 200 with immutable cache headers.
- Nginx edge cache smoke passed over HTTPS through a real nginx container: segment without token returned 401, first authenticated segment fetch returned `MISS`, a second valid token returned `HIT`, and the local origin saw one fill.
- Focused tracker playback-quality tests passed for stat aggregation, Prometheus formatting, tracker message handling, and performance-budget validation.
- Focused segment announce tests passed for ingest metadata helpers, tracker segment validation, ordered broadcast, empty swarms, malformed payload rejection, and seed-tier messages.
- Focused shared config tests passed for `TRACKER_DEMAND_HEARTBEAT_SECONDS` defaults and overrides.
- Focused ingest tests passed for latest segment timestamp recording, segment-age metric formatting, segment metadata description, and internal segment announce helper behavior.
- Auth key rotation tests passed for current-key `kid`, previous public JWKS overlap, old-token verification, and JWKS private-field stripping.
- Auth JWT claim tests passed for configured audience, issuer, TTL, and issuer rejection.
- Control-plane ingest node config validation rejects malformed node arrays before startup and normalizes accepted URLs.
- Source URL policy tests and smoke passed for allowlisted imports, private-source rejection, credential rejection, and allowlist rejection.
- Production source allowlist tests passed for direct policy loading plus ingest/control-plane strict startup config.
- Catalog source preflight smoke passed with two healthy local sources, ranged `GET` fallback for a `HEAD` rejection, one detected failing source, and CLI entrypoint coverage.
- Runtime media URL config rejects known third-party CDN provider hosts before startup.
- Retention dry run passed and produced keep, aggregate-then-delete, and delete decisions.
- Retention Prometheus dry run passed and emitted records, failures, and last-success metrics.
- Retention job dry run passed against the JSONL adapter with 5 planned actions and no failures.
- Retention job Prometheus mode emitted action, failure, and last-success metrics.
- Retention execute smoke passed: unsafe execute was refused without `RETENTION_EXECUTE=1`, then execute mode scanned/applied 5 records and wrote 5 action-log entries.
- Retention HTTP store smoke passed: dry-run made 0 apply calls, execute made 5 apply calls, and each action payload contained only minimal fields.
- Retention redaction smoke passed: dry-run JSON, Prometheus metrics, and execute-mode action logs did not expose synthetic JWT, source URL, IP, email, or API-key sentinels.
- Retention worker test passed for scheduled dry-run metrics and health state.
- Control-plane placement restart smoke passed with restored node `origin-a` and persisted release.
- Ingest ffmpeg chaos smoke passed with 4 restarts, 5 failures, degraded state, and latest swarm size preserved.
- Tracker load smoke passed with 200 peers, 400 messages, p95 0.040 ms against a 2 ms budget, rho 0.900, stall rate 0.000, and minimum buffer 30000 ms.
- Tracker WebSocket smoke skips cleanly in this local Node 24.9.0 shell unless `TRACKER_WS_DOCKER_IMAGE` is set.
- Docker-backed tracker WebSocket smoke passed through `swarmcast-tracker:local` with real JWT join, ping, playback-quality stats, recurring demand heartbeat (`demandCalls=3` in the latest run), metrics, malformed internal segment announce rejection, valid segment broadcast to the connected client, two-client offer/answer/ICE signaling relay (`signalingRelayed=true`), and rate-limit close code `1008`.
- Tracker feature-flag tests passed for forced Delivery-Fleet-only mode and normal P2P peer-list behavior.
- Rebuilt control-plane Docker image rejects forbidden third-party CDN ingest-node `baseUrl` values at startup.
- Rebuilt ingest and control-plane Docker images reject private source URLs at startup through the catalog source policy.
- Rebuilt ingest and control-plane Docker images reject missing `SOURCE_ALLOWED_HOSTS` at startup before opening service ports.
- Docker-backed tracker WebSocket smoke also passed invalid-token rejection, third-client connection-limit rejection, oversized-frame disconnect, and idle-timeout closure checks.
- Docker-backed tracker WebSocket load smoke passed with 200 real clients, 200 demand calls, rho 0.900, join p95 74.1 ms, and 181 P2P peer-list activations.
- Docker-backed tracker WebSocket multichannel smoke passed with 200 real clients across 5 channels, 200 demand calls, rho 0.900, join p95 77.6 ms, and 105 P2P peer-list activations.
- Docker-backed tracker WebSocket restart smoke passed with 24 active clients closed by tracker stop, 24 clients rejoined after restart, 48 demand calls, rho 0.900, and 22 P2P peer-list activations before and after restart.
- Tracker WebSocket payload, backpressure, connection cap, idle-timeout, and rate-limit settings are now runtime-configurable and covered by config tests.
- CI validation now requires `npm audit --audit-level=moderate`, Android debug/release Gradle assembly, origin and edge compose rendering, `docker pull nginx:1.27`, `npm run smoke:nginx-config`, `npm run smoke:nginx-origin-playback`, and `npm run smoke:nginx-edge-cache`.
- SBOM generation now covers npm workspaces, Android Gradle dependencies, service Dockerfiles, and compose image references; `npm run sbom:generate -- --check` reports 42 components across 4 ecosystems.
- Release manifest generation now records version, commit SHA, target environment, service image refs, `swarmcast-sbom`, expected Trivy report paths, and required verification gates; local validation passed for a sample staging release manifest with 5 images.
- Launch evidence validation now requires 22 go/no-go gates and rejects incomplete launch records by default; the synthetic complete fixture validates only with explicit `--allow-synthetic`.
- Host provisioning evidence validation passed for the synthetic complete fixture with 4 required host roles and 11 bootstrap checks.
- Secrets evidence validation passed for the synthetic complete fixture with 7 required secrets and 7 required checks, without raw secret values.
- Deployment evidence validation passed for the synthetic complete fixture with 5 services and 12 required deployment checks.
- Canary rollout evidence validation passed for the synthetic complete fixture with 5 rollout stages and 7 required checks.
- Production env validation now rejects placeholders, unsafe public URLs/source allowlists, disabled retention execution, and non-digest service image refs; the synthetic production env fixture validates with 27 required keys and 5 digest-pinned images.
- Alertmanager receiver validation now rejects placeholder/local receiver URLs, non-HTTPS webhooks, shared default/critical URLs, credentials, and query-string secrets; the synthetic production receiver fixture validates with 2 receivers.
- Alertmanager routing smoke passed for local and synthetic production configs: warning alerts route to `oncall-default`, critical alerts route to `oncall-critical`, and resolved critical alerts are delivered.
- Restore evidence validation passed for the synthetic complete fixture with 7 required restored assets and 7 required post-restore checks.
- Security review validation passed for the synthetic complete fixture with 6 required scopes and P0/P1 closure enforcement.
- Dependency review validation passed for the synthetic complete fixture with all 15 inventory decisions covered, 13 approvals, 2 waivers, and required audit/SBOM/image/Android checks.
- Threat model review validation passed for the synthetic complete fixture with 11 required areas, 15 threat IDs, 6 open-gate acknowledgements, and 4 sign-off roles.
- Retention approval validation passed for the synthetic complete fixture with all 5 retention classes, 4 approval roles, and 8 operational controls.
- Android CI evidence validation passed for the synthetic complete fixture with six required GitHub Actions steps and debug/release artifact checksums.
- Android accessibility evidence validation passed for the synthetic complete fixture with 2 devices and 8 required UX/accessibility checks.
- Android Delivery-Fleet playback evidence validation passed for the synthetic complete fixture with 2 devices, 2 sessions, and 1800-second soak budget enforcement.
- Android P2P evidence validation passed for the synthetic complete fixture with 2 devices, 8 required WebRTC/DataChannel/transfer checks, and 24 verified peer segments.
- Android RLNC decision validation passed for the synthetic complete fixture with 9 required decision checks, 4 reviewer roles, and 32 verified decoded segments.
- Load ladder evidence validation passed for the synthetic complete fixture with all 4 required stages and a 2000-peer maximum stage.
- Canary metrics validation now gates crash-free sessions, startup latency, stall rate, buffer depth, offload ratio, edge cache hit ratio, edge/origin egress, auth verification failures, and tracker peer drops; the synthetic 30-minute canary snapshot validates with rho 0.920 and stall 0.003.
- Capacity plan validation now computes residual edge delivery and origin fill from peak viewers, bitrate, measured offload, cache hit ratio, and headroom; the current plan validates at 10000.0 Mbps edge delivery, 1500.0 Mbps origin fill, 2 edge nodes, and 5 origin nodes.
- Ingest demand-to-playlist smoke passed with a real ingest HTTP server, `ChannelManager`, recursive watcher, fake tracker announce, live status, and first segment metadata (`seq=0`, 26 bytes).
- Shared media URL contract tests passed for single-node fallback, placement-aware `/edge/<node>/live/...` templates, malformed template rejection, unsafe path IDs, and third-party CDN host rejection.
- Catalog snapshot tests passed: snapshots persist sanitized public catalog data, reject source URL leakage, restore groups/search state, and preserve ETags.
- Catalog gzip tests passed: public catalog responses return `Content-Encoding: gzip` when requested, decompress to sanitized JSON without `sourceUrl`, and preserve empty `304` responses for matching ETags.
- Placement movement smoke passed for 20K synthetic channels after adding an ingest node: moved ratio 0.335 and load skew 1.010.
- Multi-ingest routing smoke passed with two channels placed across two ingest nodes, placement-aware edge/origin media templates, and demand calls routed to the selected ingest origins.
- Tracker sharding smoke passed: wrong-shard joins redirect before creating swarm state or demand, and the owning shard accepts the channel join with one demand call.
- Ingest tail downscale smoke passed: cold demand used lower-bitrate packaging, then rising demand promoted the channel back to source-copy packaging with one controlled restart.
- Ingest tail admission smoke passed: one cold-tail channel was admitted, the next cold-tail channel was rejected before ffmpeg spawn, and a hot channel still started.
- Release image validation requires digest-pinned per-service image refs, and the release compose override renders `@sha256` image refs for auth, ingest, tracker, control-plane, and retention-worker.
- Image scan report validation now accepts Trivy-style JSON and blocks high/critical findings by default; the clean fixture reports 1 low finding and blocked=0.
- Image scan bundle validation passed for the synthetic complete fixture with 12 digest-pinned service and infrastructure images, 12 matching Trivy reports, 12 low findings, and blocked=0.
- ffmpeg packaging smoke passed and produced 3 fMP4 media segments.
- Edge cache smoke passed with `MISS` then `HIT`.
- Edge cache metrics smoke passed with structured access-log HIT/MISS/error samples, cache hit ratio, origin-fill bytes, egress bytes, and no URI/hostname leakage in metric output.
- Edge cache metrics server smoke passed with `/health`, `/metrics`, hit-ratio output, origin-fill bytes, and no URI/hostname leakage in metric output.
- Origin compose config renders with the ACME webroot mount on `/var/www/certbot`.
- Edge compose config renders with nginx shared log volume, ACME webroot mount, public `80/tcp` for HTTP-01 challenges, and edge metrics exporter on port 9101.
- Docker-backed nginx config smoke passed for origin and edge with temporary certificates and ACME webroot mounts.
- Auth Docker image smoke passed for configured `AUTH_KEY_ID`, `/jwks`, token issuance, and `/verify`.
- Auth Docker image smoke passed for configured JWT `kid`, issuer, audience, 900-second TTL, and `/verify`.
- Service Docker images build successfully for auth, control-plane, ingest, and tracker; the tracker image was rebuilt after playback-quality metrics changes, the segment endpoint fix, and the heartbeat config change.
- Service Docker image builds successfully for retention-worker.
- Compose service image build succeeds for auth, control-plane, ingest, tracker, and retention-worker after shared config migration.
- Authenticated origin smoke passed.
- Ingest smoke test passed.
- Dependency audit reported 0 vulnerabilities.
- Android CI is configured for debug/release assembly with Android SDK platform 35 and Gradle 8.9, but local Gradle is not present; first remote Android build artifact, TalkBack, large-font, small-screen, Media3 control, and pseudo-locale checks remain open.

## Completed In Build Slice 205

- Required launch release-artifact evidence to include `smoke:release-manifest-production`.
- Updated the synthetic launch evidence fixture and launch readiness docs.
- Updated validation guards for the stricter release-artifacts gate.
- Verified launch evidence fixture, production release manifest smoke, `npm run check`, and `npm run verify`.

## Completed In Build Slice 206

- Required launch image-scan evidence to include all 12 expected service and infrastructure Trivy report paths.
- Updated the synthetic launch evidence fixture, launch readiness docs, and validation guards.
- Refreshed the build status image scan summary from 5 service reports to 12 service and infrastructure reports.
- Verified launch evidence fixture, config validation, `npm run check`, and `npm run verify`.

## Completed In Build Slice 207

- Added `smoke:launch-evidence-validation` and wired it into `npm run check`.
- Covered negative launch evidence cases for missing `smoke:release-manifest-production`, missing `var/scans/node-exporter.trivy.json`, and sensitive source URL material.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 208

- Added `smoke:release-images-validation` and wired it into `npm run check`.
- Covered negative release image cases for missing `SWARMCAST_AUTH_IMAGE`, tag-only `SWARMCAST_PROMETHEUS_IMAGE`, and whitespace in `SWARMCAST_EDGE_METRICS_IMAGE`.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:release-images-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 209

- Added `smoke:image-scan-bundle-validation` and wired it into `npm run check`.
- Covered negative image scan bundle cases for a missing `node-exporter` report, mismatched scan artifact name, and blocked high-severity finding.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:image-scan-bundle-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 210

- Added `smoke:deployment-evidence-validation` and wired it into `npm run check`.
- Covered negative deployment evidence cases for missing `up --no-build`, tag-only `auth` image, third-party CDN use, and sensitive evidence references.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:deployment-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 211

- Added `smoke:rollback-evidence-validation` and wired it into `npm run check`.
- Covered negative rollback evidence cases for same-as-current rollback images, rollback commands that build, third-party CDN fallback, data loss, and sensitive evidence references.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:rollback-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 212

- Added `smoke:secrets-evidence-validation` and wired it into `npm run check`.
- Covered negative secrets evidence cases for raw secret values, exposed secret values, unapproved storage, invalid rotation windows, and secret-looking evidence references.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:secrets-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 213

- Added `smoke:host-provisioning-evidence-validation` and wired it into `npm run check`.
- Covered negative host provisioning evidence cases for public port drift, missing denied internal ports, invalid hostnames, third-party CDN use, and sensitive evidence references.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:host-provisioning-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 214

- Added `smoke:source-allowlist-evidence-validation` and wired it into `npm run check`.
- Covered negative source allowlist evidence cases for placeholder hosts, private-network approval, raw source URL exposure, missing private-source rejection proof, unsanitized public catalog output, and sensitive evidence references.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:source-allowlist-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 215

- Added `smoke:production-smoke-evidence-validation` and wired it into `npm run check`.
- Covered negative production smoke evidence cases for third-party CDN use, source URL exposure, token exposure, missing `edge-cache-miss-hit`, and sensitive evidence references.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:production-smoke-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 216

- Added `smoke:alertmanager-fire-drill-validation` and wired it into `npm run check`.
- Covered negative Alertmanager fire-drill evidence cases for wrong critical routing, unobserved notification, missing resolved notification evidence, webhook-looking evidence references, and missing routing-smoke command proof.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:alertmanager-fire-drill-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 217

- Added `smoke:alertmanager-receivers-validation` and wired it into `npm run check`.
- Covered negative receiver file cases for non-HTTPS webhooks, placeholder hosts, URL credentials, query-string secrets, shared default/critical URLs, and missing `send_resolved`.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:alertmanager-receivers-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 218

- Added `smoke:canary-rollout-evidence-validation` and wired it into `npm run check`.
- Covered negative canary rollout evidence cases for third-party CDN use, uncleared alert state, unavailable rollback, missing per-stage metrics validation, missing full-public stage, and sensitive evidence references.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:canary-rollout-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 219

- Added `smoke:canary-metrics-validation` and wired it into `npm run check`.
- Covered negative canary metric cases for low crash-free sessions, high startup latency, high stall rate, low buffer depth, low offload ratio, and low edge cache hit ratio.
- Documented the default-check guard in launch readiness and performance budget docs.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:canary-metrics-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 220

- Added `smoke:capacity-plan-validation` and wired it into `npm run check`.
- Covered negative capacity plan cases for invalid review dates, low measured offload ratio, low edge cache hit ratio, insufficient edge nodes, and insufficient origin nodes.
- Documented the default-check guard in launch readiness and capacity plan docs.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:capacity-plan-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 221

- Added `smoke:load-ladder-evidence-validation` and wired it into `npm run check`.
- Fixed `scripts/validate-load-ladder-evidence.js` so the first file argument is not dropped when `--budgets` is omitted.
- Covered negative load-ladder evidence cases for missing required stages, low offload, high stall rate, high tracker CPU, firing alerts, sensitive evidence references, and synthetic records without `--allow-synthetic`.
- Documented the default-check guard in launch readiness and load-testing docs.
- Updated package/config guards for the new smoke and parser fix.
- Verified `npm run smoke:load-ladder-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 222

- Added `smoke:staging-chaos-evidence-validation` and wired it into `npm run check`.
- Covered negative staging chaos evidence cases for missing required drills, unobserved alerts, failed recovery, cascading failures, third-party CDN fallback, data loss, sensitive evidence references, and synthetic records without `--allow-synthetic`.
- Documented the default-check guard in launch readiness and chaos-drill docs.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:staging-chaos-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 223

- Added `smoke:restore-evidence-validation` and wired it into `npm run check`.
- Covered negative restore evidence cases for missing required assets, unrestored assets, invalid checksums, missing required checks, incomplete checks without allowance, bad time ordering, sensitive evidence references, and synthetic records without `--allow-synthetic`.
- Covered the explicit `--allow-incomplete` shape-only path for incomplete restore checks.
- Documented the default-check guard in launch readiness, backup/restore docs, and the restore drill runbook.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:restore-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 224

- Added `smoke:security-review-validation` and wired it into `npm run check`.
- Covered negative security review evidence cases for missing required scopes, non-passing scopes, unresolved P1 findings, waived P1 findings without waiver metadata, invalid waiver expiration, sensitive evidence references, and synthetic records without `--allow-synthetic`.
- Documented the default-check guard in launch readiness and security review docs.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:security-review-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 225

- Added `smoke:dependency-review-validation` and wired it into `npm run check`.
- Fixed `scripts/validate-dependency-review.js` so the first file argument is not dropped when `--inventory` is omitted.
- Covered negative dependency review evidence cases for missing required checks, failing checks, missing inventory decisions, unknown decisions, missing waiver metadata, invalid waiver expiration, sensitive evidence references, and synthetic records without `--allow-synthetic`.
- Documented the default-check guard in launch readiness and dependency review docs.
- Updated package/config guards for the new smoke and parser fix.
- Verified `npm run smoke:dependency-review-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 226

- Added `smoke:threat-model-review-validation` and wired it into `npm run check`.
- Covered negative threat-model review evidence cases for missing required areas, missing required threats, invalid threat statuses, missing waiver metadata, missing open-gate acknowledgements, missing signoff roles, sensitive evidence references, and synthetic records without `--allow-synthetic`.
- Documented the default-check guard in launch readiness and threat model docs.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:threat-model-review-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 227

- Added `smoke:retention-approval-validation` and wired it into `npm run check`.
- Fixed `scripts/validate-retention-approval.js` so the first file argument is not dropped when `--policy` is omitted.
- Covered negative retention approval evidence cases for missing required approvers, missing policy class approvals, retention-window mismatches, missing waiver metadata, missing required controls, failed controls, sensitive evidence references, and synthetic records without `--allow-synthetic`.
- Documented the default-check guard in launch readiness and data retention docs.
- Updated package/config guards for the new smoke and parser fix.
- Verified `npm run smoke:retention-approval-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 228

- Added `smoke:retention-execution-evidence-validation` and wired it into `npm run check`.
- Covered negative retention execution evidence cases for policy review date drift, missing scoped credentials, missing destructive guard proof, sensitive leak flags, empty dry runs, missing execute flags, per-class failures, missing retention classes, sensitive evidence references, and synthetic records without `--allow-synthetic`.
- Documented the default-check guard in launch readiness and data retention docs.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:retention-execution-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 229

- Added `smoke:legal-approval-validation` and wired it into `npm run check`.
- Covered negative legal approval evidence cases for missing peer-relay rights, missing privacy approval, duplicate approver roles, invalid approval timestamps, duplicate territories, sensitive approval/top-level evidence references, and synthetic records without `--allow-synthetic`.
- Documented the default-check guard in launch readiness and legal gate docs.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:legal-approval-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 230

- Added `smoke:nginx-tls-evidence-validation` and wired it into `npm run check`.
- Covered negative nginx/TLS evidence cases for synthetic records without `--allow-synthetic`, incomplete staging launch evidence without `--allow-incomplete`, placeholder hosts, missing local origin proof, invalid origin certificates, auth-gate drift, source URL leakage, wrong edge cache status, missing cross-token hits, origin-fill drift, third-party CDN use, token cache-key leakage, and sensitive evidence references.
- Covered the explicit `--allow-incomplete` shape-only path for staging nginx/TLS evidence.
- Documented the default-check guard in launch readiness and production environment docs.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:nginx-tls-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 231

- Added `smoke:android-ci-evidence-validation` and wired it into `npm run check`.
- Covered negative Android CI evidence cases for synthetic records without `--allow-synthetic`, invalid GitHub Actions run URLs, bad time ordering, invalid Android platform values, missing release assembly, failed debug assembly, duplicate CI steps, sensitive step evidence, missing release artifacts, invalid artifact paths, invalid checksums, empty artifacts, and duplicate artifacts.
- Documented the default-check guard in launch readiness and Android README.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:android-ci-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 232

- Added `smoke:android-playback-evidence-validation` and wired it into `npm run check`.
- Fixed `scripts/validate-android-playback-evidence.js` so the first file argument is not dropped when `--budgets` is omitted.
- Covered negative Delivery-Fleet-only playback evidence cases for synthetic records without `--allow-synthetic`, duplicate devices, sessions referencing unknown devices, P2P-enabled sessions, unauthenticated sessions, crashed sessions, short soaks, startup latency, stall rate, buffer depth, edge cache, battery budget failures, and sensitive evidence references.
- Documented the default-check guard in launch readiness and Android README.
- Updated package/config guards for the new smoke and parser fix.
- Verified `npm run smoke:android-playback-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 233

- Added `smoke:android-p2p-evidence-validation` and wired it into `npm run check`.
- Fixed `scripts/validate-android-p2p-evidence.js` so the first file argument is not dropped when `--budgets` is omitted.
- Covered negative Android P2P evidence cases for synthetic records without `--allow-synthetic`, insufficient devices, missing required checks, failed checks, unknown check devices, duplicate checks, sensitive check evidence, disabled P2P, missing edge fallback, same source/sink devices, missing verified segments, hash failures, disconnects, low offload, high stall rate, low buffer, and sensitive transfer evidence references.
- Documented the default-check guard in launch readiness and Android README.
- Updated package/config guards for the new smoke and parser fix.
- Verified `npm run smoke:android-p2p-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 234

- Added `smoke:android-rlnc-decision-validation` and wired it into `npm run check`.
- Fixed `scripts/validate-android-rlnc-decision.js` so the first file argument is not dropped when `--budgets` is omitted.
- Covered negative Android RLNC decision cases for synthetic records without `--allow-synthetic`, high ABI risk, missing reviewer roles, duplicate reviewers, invalid reviewer timestamps, missing required checks, failed checks, duplicate checks, sensitive check evidence, decode CPU, battery, `k` budget failures, insufficient fuzz cases, fuzz crashes, insufficient device decode devices, missing verified segments, hash failures, unverified segment store, and sensitive device-decode evidence.
- Documented the default-check guard in launch readiness and the Android RLNC ADR.
- Updated package/config guards for the new smoke and parser fix.
- Verified `npm run smoke:android-rlnc-decision-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 235

- Added `smoke:android-accessibility-evidence-validation` and wired it into `npm run check`.
- Covered negative Android accessibility evidence cases for synthetic records without `--allow-synthetic`, missing devices, duplicate devices, invalid font scale, missing required checks, failed checks, duplicate checks, empty check device lists, unknown check devices, and sensitive evidence references.
- Documented the default-check guard in launch readiness and accessibility baseline docs.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:android-accessibility-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 236

- Added `smoke:catalog-import-validation` and wired it into `npm run check`.
- Covered negative catalog import evidence cases for synthetic records without `--allow-synthetic`, incomplete staging records without `--allow-incomplete`, raw source URL flags, invalid preflight commands, inconsistent preflight totals, raw URL exposure, unsafe snapshot URLs, missing source stripping, channel-count drift, bad snapshot checksums, invalid signature algorithms, missing required checks, duplicate checks, and sensitive evidence references.
- Covered the explicit `--allow-incomplete` shape-only path for staging catalog import evidence.
- Documented the default-check guard in catalog import, source policy, and configuration docs.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:catalog-import-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 237

- Added `smoke:image-scan-report-validation` and wired it into `npm run check`.
- Covered report-level Trivy validation cases for clean reports, LOW findings, HIGH findings blocked by default, HIGH findings allowed only with `--allow-high`, and CRITICAL findings blocked with and without `--allow-high`.
- Documented the default-check guard in launch readiness and dependency review docs.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:image-scan-report-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 238

- Added `smoke:prometheus-alerts-validation` and wired it into `npm run check`.
- Covered Prometheus alert validation cases for non-SwarmCast alert names, duplicate alert names, unbalanced expressions, invalid durations, invalid severities, placeholder summaries, and traversing runbook links.
- Documented the default-check guard in launch readiness.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:prometheus-alerts-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 239

- Added `smoke:grafana-dashboard-validation` and wired it into `npm run check`.
- Covered Grafana dashboard validation cases for missing production tags, placeholder dashboard titles, duplicate panel IDs, overlapping panel grids, unsupported panel types, unbalanced Prometheus queries, and empty legend formats.
- Documented the default-check guard in launch readiness.
- Updated package/config guards for the new smoke.
- Verified `npm run smoke:grafana-dashboard-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 240

- Installed Android SDK platform 35/build-tools 35.0.0 locally and used a local Gradle 8.9 distribution for verification.
- Added Android Gradle project settings for AndroidX and a larger Gradle JVM heap/metaspace.
- Aligned Android Java and Kotlin compilation to JDK 17.
- Fixed Android Kotlin compile issues in serialization imports, `CodedFetch` construction, tracker JSON array encoding, and the `TrackerClient` call site.
- Verified local Android `assembleDebug assembleRelease` produces debug and unsigned release APKs.
- Updated Android README, launch readiness, dependency review, accessibility baseline, and backlog status text to keep remote CI and real-device evidence open while recording local assembly success.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 241

- Added the Android Gradle 8.9 wrapper files under `android/`.
- Switched CI Android assembly from a globally installed Gradle command to `./gradlew --no-daemon assembleDebug assembleRelease`.
- Updated Android README, launch readiness, dependency review, backlog, and config guards for wrapper-pinned Android assembly.
- Verified wrapper-based Android `assembleDebug assembleRelease`.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 242

- Added CI artifact uploads for `swarmcast-android-debug-apk` and `swarmcast-android-release-unsigned-apk`.
- Guarded the Android artifact names, APK paths, and `if-no-files-found: error` behavior in config validation.
- Documented the expected APK artifacts in the Android README, launch readiness, and backlog tracking.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 243

- Replaced the Android JSON catalog cache with an app-private SQLite database.
- Added channel name, group, tvg-id, and update-time indexes plus write-ahead logging and 20K row trimming.
- Updated Android README and config validation guards for the SQLite cache implementation.
- Verified wrapper-based Android `assembleDebug assembleRelease`.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 244

- Added `hasMore` to Android catalog UI state and wired the existing `loadMore()` repository path into the Compose screen.
- Added a guarded bottom-of-list load-more footer with localized loading labels.
- Updated static config guards for the paginated Android channel list behavior.
- Verified wrapper-based Android `assembleDebug assembleRelease`.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 245

- Added a shared Android `OkHttpClient` with a 32 MB disk cache under `swarmcast-http-cache`.
- Wired the shared client into catalog and auth repositories so catalog ETag/cache-control responses can be reused or revalidated.
- Updated Android README and config validation guards for the HTTP cache behavior.
- Verified wrapper-based Android `assembleDebug assembleRelease`.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 246

- Added `npm run android:release-config:validate` for Android release Gradle properties.
- Added a complete synthetic release properties fixture and smoke coverage for missing/unsafe API and tracker URLs, dev or weak app keys, RLNC enablement, and third-party CDN hosts.
- Wired `smoke:android-release-config-validation` into `npm run check`.
- Documented the Android release-config gate in Android README, launch readiness, and configuration docs.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 247

- Added `android-release-config` to the machine-readable launch evidence required gates.
- Updated the complete launch evidence fixture and launch readiness required gate list.
- Extended launch-evidence smoke coverage for missing Android release-config smoke evidence.
- Verified `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 248

- Added Android `NetworkPolicySnapshot` with transport, metered state, battery, charging, uplink, and upload eligibility fields.
- Enforced upload only on unmetered WiFi with acceptable battery state and zeroed uplink reporting when upload is unsafe.
- Fixed `PlaybackSessionCoordinator.setP2pEnabled` to recompute `p2pAllowed` and close peer links whenever the toggle or policy disables upload.
- Verified wrapper-based Android `assembleDebug assembleRelease`.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 249

- Hardened Android peer cleanup so closed or replaced DataChannels complete pending whole/coded requests.
- Disposed stale DataChannels and PeerConnections through idempotent manager close paths.
- Made scheduler link replacement/removal close old PeerLinks without removing a newly installed link.
- Guarded tracker signal handling so Delivery-Fleet-only policy states do not recreate P2P connections after the toggle closes them.
- Verified wrapper-based Android `assembleDebug assembleRelease`.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 250

- Added Android `SwarmSegmentDataSource` for Media3 HLS playback.
- Routed numbered media segment requests through `SegmentScheduler.fetchSegment`, preserving peer-first fetch, hash verification, deadline handling, and owned-edge fallback.
- Kept playlists, init assets, and unrecognized HLS URLs on authenticated HTTP.
- Wired `PlayerHolder` to accept the active scheduler and wired `MainActivity` to share the cached OkHttp client with scheduler edge fallback.
- Verified wrapper-based Android `assembleDebug assembleRelease`.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 251

- Added Android `PeerReputation`, `PeerReputationBook`, and event snapshots matching the shared poisoning-defense policy.
- Changed Android scheduler peer fetches to require tracker hash metadata before accepting peer bytes.
- Recorded peer successes, timeouts, and hash mismatches, disconnecting peers after two poisoned segment failures.
- Applied hash-mismatch penalties to accepted coded-packet contributors when a decoded segment fails verification.
- Verified wrapper-based Android `assembleDebug assembleRelease`.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 252

- Added upload-byte accounting callback wiring from `PeerLink` into `SegmentScheduler`.
- Counted successfully sent whole-segment DATA payload bytes and coded-packet payload bytes.
- Reported accumulated upload bytes through `SchedulerStats.uploadedToPeers`, making tracker `ul` deltas reflect peer media served by the Android client.
- Verified wrapper-based Android `assembleDebug assembleRelease`.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 253

- Added Android scheduler counters for peer timeouts, peer hash failures, and peer disconnects.
- Extended Android tracker stats flushes with bounded peer-health deltas.
- Extended tracker stat accumulation and Prometheus output for peer timeout, hash-failure, and disconnect counters.
- Added focused tracker test coverage for stat accumulation, rolling windows, and metrics output.
- Verified wrapper-based Android `assembleDebug assembleRelease` and focused tracker tests.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 254

- Added Prometheus alerts for peer hash failures, peer disconnect spikes, and peer timeout spikes.
- Added the peer-health runbook with triage, mitigation, validation, safety rules, and follow-up evidence.
- Guarded the new alert names, expressions, and runbook link in config validation.
- Verified `npm run prometheus:alerts:validate` reports 21 alerts and 10 runbooks.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 255

- Added a Grafana `Peer Health` panel for tracker peer timeout, hash-failure, and disconnect 5-minute counters.
- Shifted the lower storage-backend and active-alert panels so the dashboard layout remains non-overlapping.
- Guarded the peer-health panel title and metrics in config validation.
- Verified `npm run grafana:dashboard:validate` reports 15 panels and 29 targets.
- Verified `npm run check` and `npm run verify`.

## Completed In Build Slice 256

- Added `smoke:headless-super-peer-sweep` for a deterministic 500-peer coded-transfer sweep.
- Covered 5%, 10%, 15%, 20%, and 25% super-peer fractions with a 150-packet per-helper upload budget.
- Verified every viewer reconstructs the segment and measured the first zero edge-fallback point at 15%.
- Documented the smoke in load-testing docs and guarded the script, package entry, and docs text in config validation.
- Verified `npm run smoke:headless-super-peer-sweep`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 257

- Extended load-ladder evidence validation with a required `selfSustainingSweep` section.
- The sweep evidence records tested super-peer fractions, helper upload budget, flatten fraction, per-fraction edge fallback, and sanitized evidence links.
- Updated the synthetic load-ladder fixture with the 15% flatten point from the local sweep.
- Expanded smoke coverage for missing sweep evidence and nonzero edge fallback after the flatten point.
- Verified `npm run load:ladder:validate -- --allow-synthetic test-fixtures/load/load-ladder-complete.synthetic.json`, `npm run smoke:load-ladder-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 258

- Added `selfSustainingSuperPeerFraction`, `helperUploadPacketsPerSegment`, and `superPeerSweepEvidence` to the capacity plan.
- Capacity validation now blocks self-sustaining flatten points above 25% and unsafe sweep evidence references.
- Updated capacity docs and assumptions with the 15% deterministic sweep result.
- Expanded capacity-plan smoke coverage to seven failure cases.
- Verified `npm run capacity:plan:validate -- config/capacity-plan.json`, `npm run smoke:capacity-plan-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 259

- Tightened the `capacity-load-ladder` launch evidence gate to require `capacity:plan:validate`, `load:ladder:validate`, and `selfSustainingSweep`.
- Updated the synthetic launch evidence fixture and launch-readiness hard blocker text.
- Expanded launch-evidence smoke coverage for missing self-sustaining sweep evidence.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 260

- Extended canary metrics validation with peer timeouts, peer hash failures, and peer disconnects.
- Updated the passing canary fixture to require zero peer hash failures, zero peer disconnects, and bounded peer timeouts.
- Expanded canary metrics smoke coverage for timeout spikes, hash failures, and disconnects.
- Updated launch-readiness and performance-budget docs for peer-health rollout gates.
- Verified `npm run canary:metrics:validate -- test-fixtures/launch/canary-metrics-pass.json`, `npm run smoke:canary-metrics-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 261

- Tightened canary rollout evidence validation so each staged cohort must include peer-health snapshot markers.
- The internal, 1%, 5%, 25%, and full-public synthetic rollout stages now record bounded `peerTimeouts5m`, zero `peerHashFailures5m`, and zero `peerDisconnects5m`.
- Expanded canary rollout smoke coverage for missing per-stage peer-health evidence.
- Updated launch-readiness docs and config validation guards for the stricter rollout evidence.
- Verified `npm run canary:rollout:evidence:validate -- --allow-synthetic test-fixtures/launch/canary-rollout-complete.synthetic.json`, `npm run smoke:canary-rollout-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 262

- Added `peer-health-incident` as a required staging chaos drill.
- The drill must observe `SwarmcastPeerHashFailures`, reference `docs/runbooks/peer-health.md`, recover, avoid cascade, avoid third-party CDN fallback, and preserve data.
- Updated the synthetic staging chaos fixture, chaos-drill docs, launch-readiness docs, and config validation guards.
- Expanded staging chaos smoke coverage for missing peer-health runbook evidence.
- Verified `npm run chaos:staging:validate -- --allow-synthetic test-fixtures/chaos/staging-chaos-complete.synthetic.json`, `npm run smoke:staging-chaos-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 263

- Tightened the final launch `staging-chaos-drills` gate to require `chaos:staging:validate`, `peer-health-incident`, `SwarmcastPeerHashFailures`, and `docs/runbooks/peer-health.md`.
- Updated the complete synthetic launch evidence fixture and launch-readiness required gate list.
- Expanded launch evidence smoke coverage for missing peer-health staging chaos evidence.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 264

- Tightened the final launch `alert-receiver-fire-drill` gate to require `alertmanager:receivers:validate`, `alertmanager:fire-drill:validate`, and `smoke:alertmanager-routing`.
- Updated the complete synthetic launch evidence fixture and launch-readiness required gate list.
- Expanded launch evidence smoke coverage for missing Alertmanager fire-drill evidence.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 265

- Tightened the final launch gates for Android CI, Android playback, Android P2P transfer, Android RLNC decision, threat-model signoff, dependency review, accessibility baseline, and rollback drill.
- Each gate now requires its dedicated validator evidence marker in `npm run launch:evidence:validate`.
- Updated the complete synthetic launch evidence fixture, launch-readiness required gate list, and config validation guards.
- Expanded launch evidence smoke coverage for missing Android CI, threat-model, and rollback evidence.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 266

- Tightened final launch evidence validation so non-synthetic launch records must use `environment: production`.
- Synthetic staging fixtures remain allowed with `--allow-synthetic`, but now report `status=synthetic-shape-ready` instead of `launch-ready`.
- Expanded launch evidence smoke coverage for non-synthetic staging records.
- Updated launch-readiness docs and config validation guards for the production-environment rule.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 267

- Tightened final launch evidence validation so top-level `waived` gates are not launch-ready.
- Waived gates are now only accepted under `--allow-incomplete` for rehearsal or shape checks.
- Expanded launch evidence smoke coverage for waived top-level launch gates.
- Updated launch-readiness docs and config validation guards for the no-waiver final go/no-go rule.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 268

- Added `security-review` as a required final launch evidence gate.
- The gate requires `security:review:validate` evidence and is represented in the complete synthetic launch fixture.
- Updated launch-readiness docs and config validation guards for the 24-gate launch bundle.
- Expanded launch evidence smoke coverage for missing security-review evidence.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 269

- Added `prometheus-alerts` and `grafana-dashboard` as required final launch evidence gates.
- The gates require `prometheus:alerts:validate` and `grafana:dashboard:validate` evidence.
- Updated the complete synthetic launch evidence fixture, launch-readiness required gate list, and config validation guards for the 26-gate launch bundle.
- Expanded launch evidence smoke coverage for missing Prometheus alert evidence.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 270

- Added `restore-drill` as a required final launch evidence gate.
- The gate requires `restore:evidence:validate` evidence and `docs/runbooks/restore-drill.md`.
- Updated the complete synthetic launch evidence fixture, launch-readiness required gate list, config validation guards, and launch evidence smoke coverage.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 271

- Added `production-environment` as a required final launch evidence gate.
- The gate requires `env:production:validate`, `smoke:production-env-validation`, and `smoke:compose-production-env` evidence.
- Updated the complete synthetic launch evidence fixture, launch-readiness required gate list, config validation guards, and launch evidence smoke coverage.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 272

- Added `catalog-import` as a required final launch evidence gate.
- The gate requires `catalog:import:validate` and `smoke:catalog-import-validation` evidence.
- Updated launch readiness to treat signed sanitized catalog import evidence as a hard blocker.
- Updated the complete synthetic launch evidence fixture, config validation guards, and launch evidence smoke coverage.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 273

- Tightened `canary-rollout` as a final launch evidence gate.
- The gate now requires `canary:metrics:validate`, `peerTimeouts5m`, `peerHashFailures5m=0`, and `peerDisconnects5m=0` alongside `canary:rollout:evidence:validate`.
- Updated the complete synthetic launch evidence fixture, launch-readiness required gate list, config validation guards, and launch evidence smoke coverage.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 274

- Tightened `production-smokes` as a final launch evidence gate.
- The gate now requires the production smoke validator plus source preflight, catalog search, ingest demand, edge cache, tracker join/signal/stats/metrics, retention health, and dashboard/alert query markers.
- Updated the complete synthetic launch evidence fixture, launch-readiness required gate list, config validation guards, and launch evidence smoke coverage.
- Verified `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 275

- Tightened rollback evidence validation for Android release halt readiness, app-incident Delivery-Fleet-only control, and tail edge-only mode.
- Tightened the final `rollback-drill` launch evidence gate to require those incident-control markers alongside `rollback:evidence:validate` and `docs/runbooks/rollback-drill.md`.
- Updated the rollback fixture, launch fixture, launch-readiness required gate list, config validation guards, rollback smoke coverage, and launch evidence smoke coverage.
- Verified `npm run rollback:evidence:validate -- --allow-synthetic test-fixtures/rollback/rollback-drill-complete.synthetic.json`, `npm run smoke:rollback-evidence-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 276

- Tightened load-ladder evidence validation so each stage must record WebRTC DataChannel transport, tracker-signaling relay, and successful DataChannel transfer.
- Tightened the final `capacity-load-ladder` launch evidence gate to require `webrtc-datachannel` and `tracker-signaling-relay` markers alongside capacity, load-ladder, and self-sustaining sweep evidence.
- Updated the load-ladder fixture, launch fixture, load-testing docs, launch-readiness required gate list, config validation guards, load-ladder smoke coverage, and launch evidence smoke coverage.
- Verified `npm run load:ladder:validate -- --allow-synthetic test-fixtures/load/load-ladder-complete.synthetic.json`, `npm run smoke:load-ladder-evidence-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 277

- Tightened staging chaos evidence validation for Android playback continuity, owned-edge failover, placement failover, and durable placement restore markers.
- Tightened the final `staging-chaos-drills` launch evidence gate to require those markers alongside `chaos:staging:validate`, peer-health, alert, and runbook evidence.
- Updated the staging chaos fixture, launch fixture, chaos docs, launch-readiness required gate list, config validation guards, staging chaos smoke coverage, and launch evidence smoke coverage.
- Verified `npm run chaos:staging:validate -- --allow-synthetic test-fixtures/chaos/staging-chaos-complete.synthetic.json`, `npm run smoke:staging-chaos-evidence-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 278

- Added `privacy:store:validate` machine-readable privacy/store compliance evidence validation.
- The gate requires privacy/legal/support approvals and checks for policy text, app store notes, support FAQ, peer IP disclosure, upload controls, telemetry redaction, and retention linkage.
- Added `privacy-store-compliance` as a required final launch evidence gate with privacy-store validation, docs, support FAQ, and app-store notes evidence.
- Updated the privacy fixture, launch fixture, privacy docs, launch-readiness required gate list, config validation guards, privacy smoke coverage, and launch evidence smoke coverage.
- Verified `npm run privacy:store:validate -- --allow-synthetic test-fixtures/privacy/privacy-store-compliance-complete.synthetic.json`, `npm run smoke:privacy-store-compliance-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 279

- Tightened Android CI release evidence around published APK artifacts.
- CI now computes checksum sidecars for debug and unsigned release APKs and uploads those sidecars with `swarmcast-android-debug-apk` and `swarmcast-android-release-unsigned-apk`.
- `android:ci:evidence:validate` now requires checksum/upload steps plus artifact evidence naming the upload artifacts and `.sha256` sidecars.
- The final `android-ci-build` launch gate now requires both uploaded Android artifact names.
- Updated the Android CI fixture, launch fixture, Android README, launch-readiness docs, config validation guards, Android CI smoke coverage, and launch evidence smoke coverage.
- Verified `npm run android:ci:evidence:validate -- --allow-synthetic test-fixtures/android/ci-build-complete.synthetic.json`, `npm run smoke:android-ci-evidence-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 280

- Tightened Android Delivery-Fleet-only playback evidence validation.
- Playback evidence now requires unique sessions across WiFi and cellular devices.
- Each playback session must include `delivery-fleet-only`, `30m-soak`, `edge-cache-hit`, and `crash-free` evidence markers.
- The final `android-device-playback` launch gate now requires Delivery-Fleet-only, 30-minute soak, WiFi, and cellular markers.
- Updated the playback fixture, launch fixture, Android README, launch-readiness docs, config validation guards, Android playback smoke coverage, and launch evidence smoke coverage.
- Verified `npm run android:playback:evidence:validate -- --allow-synthetic test-fixtures/android/playback-delivery-fleet-complete.synthetic.json`, `npm run smoke:android-playback-evidence-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 281

- Tightened Android P2P transfer evidence validation.
- P2P evidence now requires WiFi and cellular devices plus a `cellular-receive-only` check.
- P2P transfer evidence now requires a WiFi upload source, cellular sink, WebRTC DataChannel, tracker-signaling relay, verified segment hash, edge fallback, P2P-disable closure, and cellular no-upload markers.
- The final `android-p2p-transfer` launch gate now requires WebRTC DataChannel, tracker-signaling, verified-hash, and cellular no-upload markers.
- Updated the P2P fixture, launch fixture, Android README, launch-readiness docs, config validation guards, Android P2P smoke coverage, and launch evidence smoke coverage.
- Verified `npm run android:p2p:evidence:validate -- --allow-synthetic test-fixtures/android/p2p-transfer-complete.synthetic.json`, `npm run smoke:android-p2p-evidence-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 282

- Tightened Android accessibility evidence validation.
- Accessibility evidence now requires a true 200% font-scale device, a small-screen device, touch-target checks, and per-check evidence markers.
- The final `accessibility-ux-baseline` launch gate now requires TalkBack, 200% font, small-screen, and touch-target markers.
- Updated the accessibility fixture, launch fixture, accessibility docs, launch-readiness docs, config validation guards, accessibility smoke coverage, and launch evidence smoke coverage.
- Verified `npm run android:accessibility:validate -- --allow-synthetic test-fixtures/android/accessibility-complete.synthetic.json`, `npm run smoke:android-accessibility-evidence-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 283

- Tightened legal approval evidence validation.
- Legal approval evidence now requires explicit markers for redistribution, rebroadcast, peer relay, viewer-device retransmission, territory/platform scope, app store distribution, operational metrics logging, and privacy disclosure.
- The final `legal-approval` launch gate now requires legal validation plus redistribution, peer-relay, viewer-device retransmission, and privacy-disclosure markers.
- Updated the legal fixture, launch fixture, legal docs, launch-readiness docs, config validation guards, legal smoke coverage, and launch evidence smoke coverage.
- Verified `npm run legal:approval:validate -- --allow-synthetic test-fixtures/legal/legal-approval-complete.synthetic.json`, `npm run smoke:legal-approval-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 284

- Tightened host provisioning evidence validation.
- Host provisioning evidence now requires origin, edge, API, tracker, control-plane, retention-worker, and monitoring host roles.
- Each host provisioning check must include its own evidence marker, and duplicate host IDs are rejected.
- The final `host-provisioning` launch gate now requires public DNS, denied internal ports, TLS certificate, and monitoring markers.
- Updated the host fixture, launch fixture, host bootstrap runbook, launch-readiness docs, config validation guards, host provisioning smoke coverage, and launch evidence smoke coverage.
- Verified `npm run host:provisioning:evidence:validate -- --allow-synthetic test-fixtures/infra/host-provisioning-complete.synthetic.json`, `npm run smoke:host-provisioning-evidence-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 285

- Tightened production secrets evidence validation.
- Each required secret now needs a purpose, production scope, rotation policy, required runtime injection targets, and evidence that names the exact secret.
- Each secrets check now needs evidence that names the exact control being claimed.
- The final `production-secrets` launch gate now requires secret-storage, rotation-policy, runtime-injection, access-review, redaction-proof, backup-restore, and no-raw-secret markers.
- Updated the secrets fixture, launch fixture, production environment docs, launch-readiness docs, configuration docs, config validation guards, secrets smoke coverage, and launch evidence smoke coverage.
- Verified `npm run secrets:evidence:validate -- --allow-synthetic test-fixtures/security/secrets-evidence-complete.synthetic.json`, `npm run smoke:secrets-evidence-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 286

- Tightened dependency review evidence validation.
- Dependency review now requires release-engineering and application-security reviewer roles.
- Each required dependency check and inventory decision now needs evidence that names the exact check or dependency decision.
- Waivers must include metadata and expire after the review date.
- The final `dependency-review` launch gate now requires npm-audit, SBOM, release-image-refs, image-scans, Android debug/release build, inventory-decision, and waiver-expiry markers alongside dependency validation.
- Updated the dependency fixture, launch fixture, dependency review docs, launch-readiness docs, config validation guards, dependency review smoke coverage, and launch evidence smoke coverage.
- Verified `npm run dependency:review:validate -- --allow-synthetic test-fixtures/dependency/dependency-review-complete.synthetic.json`, `npm run smoke:dependency-review-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 287

- Tightened deployment execution evidence validation.
- Deployment commands must mention every required service.
- Each deployed service must have evidence naming the exact service.
- Each deployment check must have evidence naming the exact control.
- The final `deployment-execution` launch gate now requires release-manifest-validated, image-digests-pinned, compose-rendered, images-pulled, deployed-up-no-build, service-health, post-deploy-smokes, and rollback-ready markers alongside deployment validation.
- Updated the deployment fixture, launch fixture, production environment docs, launch-readiness docs, config validation guards, deployment smoke coverage, and launch evidence smoke coverage.
- Verified `npm run deployment:evidence:validate -- --allow-synthetic test-fixtures/deployment/deployment-complete.synthetic.json`, `npm run smoke:deployment-evidence-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 288

- Tightened nginx/TLS evidence validation.
- Origin and edge TLS evidence must name valid certificate and hostname verification markers.
- Origin playback evidence must name auth 401, authorized playlist and segment fetch, cache header behavior, and source URL redaction.
- Edge evidence must name auth 401, MISS/HIT cache behavior, cross-token cache reuse, one origin fill, no third-party CDN fallback, and cache-key redaction.
- The final `nginx-tls-smoke` launch gate now requires TLS, origin auth, edge cache, no-CDN, source-redaction, and cache-key-redaction markers alongside nginx validation and local smoke references.
- Updated the nginx/TLS fixture, launch fixture, production environment docs, launch-readiness docs, config validation guards, nginx/TLS smoke coverage, and launch evidence smoke coverage.
- Verified `npm run nginx:tls:evidence:validate -- --allow-synthetic test-fixtures/launch/nginx-tls-smoke-complete.synthetic.json`, `npm run smoke:nginx-tls-evidence-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 289

- Tightened Alertmanager fire-drill evidence validation.
- Receiver validation evidence must name `alertmanager:receivers:validate`.
- Routing evidence must name `smoke:alertmanager-routing`.
- Each warning, critical, and resolved-critical notification must name its notification ID, observed receiver, and acknowledgment.
- The final `alert-receiver-fire-drill` launch gate now requires warning-firing, critical-firing, critical-resolved, oncall-default, oncall-critical, and acknowledged markers alongside receiver/fire-drill/routing validation.
- Updated the fire-drill fixture, launch fixture, launch-readiness docs, config validation guards, fire-drill smoke coverage, and launch evidence smoke coverage.
- Verified `npm run alertmanager:fire-drill:validate -- --allow-synthetic test-fixtures/monitoring/alertmanager-fire-drill-complete.synthetic.json`, `npm run smoke:alertmanager-fire-drill-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 290

- Tightened Prometheus alert validation.
- Default alert validation now requires the full launch alert inventory plus warning and critical severity coverage.
- The final `prometheus-alerts` launch gate now requires low-offload, peer-hash, playback-stall, edge-cache, ingest, auth, retention, warning, critical, and runbook-link markers.
- Updated alert validation smoke coverage, launch fixture, launch-readiness docs, config validation guards, and launch evidence smoke coverage.
- Verified `npm run prometheus:alerts:validate`, `npm run smoke:prometheus-alerts-validation`, `npm run launch:evidence:validate -- --allow-synthetic test-fixtures/launch/evidence-complete.synthetic.json`, `npm run smoke:launch-evidence-validation`, `npm run check`, and `npm run verify`.

## Completed In Build Slice 291

- Selected Backblaze JavaReedSolomon `Galois` for Android GF(2^8), pinned to immutable commit `d3c481dc69471e0c47ff6f67f33d53bde941675e` through a group-restricted JitPack repository and Gradle dependency lock.
- Implemented Android RLNC segment splitting, packet generation, rank tracking, malformed/dependent packet rejection, reconstruction, and partial-rank recoding without a native ABI.
- Added Android unit tests for server-compatible GF(2^8) wire output, non-aligned segment reconstruction, malformed/dependent packet rejection, and partial-rank recoding.
- Added `CODED_REQUEST`, upload-budgeted coded serving, repeated deadline-bounded coded collection, rank advertisement, and coded recovery before whole-segment peer and edge fallback.
- Kept SHA-256 verification mandatory before decoded bytes enter `SegmentStore`.
- Updated the Android release gate so RLNC remains disabled by default and can be enabled only with real non-synthetic approval for the exact selected implementation.
- Added Android unit tests to the CI job and Android CI evidence contract before debug/release APK assembly and checksum artifact publication.
- Updated the RLNC ADR, dependency inventory/review, synthetic evidence shape, configuration docs, launch-readiness docs, and validation guards.
- Verified Android `testDebugUnitTest assembleDebug assembleRelease`, focused Android release/RLNC/CI evidence validators and smokes, `npm run check`, and `npm run verify`; all 142 repository tests pass.
- Production RLNC remains blocked only on real legal/security/performance reviewer approval, malformed-packet fuzz evidence, and real-device decode/allocation/battery/hash evidence.

## Completed In Build Slice 292

- Cold-launched the freshly built Android app on clean Android 13 and Android 16 emulators.
- Rebuilt and launched with `SWARMCAST_RLNC_ENABLED=true`, verified the packaged manifest flag, foreground activity, live process, and absence of an app fatal exception or ANR.
- Found and fixed unreadable light status-bar icons on Android 16 by applying explicit light transparent system-bar styles.
- Added `npm run android:runtime:smoke` to install an APK, verify its RLNC manifest setting, cold-launch it, check process/focus/log health, and record APK and screenshot SHA-256 hashes.
- The runtime runner requires explicit `--allow-emulator` opt-in and marks emulator output as ineligible for launch-gate closure.
- Recorded real local Android 16 RLNC emulator evidence at `evidence/android/emulator-api36-rlnc-runtime-2026-07-14.json` with its screenshot artifact.
- Proved the runner rejects emulator execution without opt-in and rejects an unexpected RLNC manifest value.
- Verified Android `testDebugUnitTest assembleDebug assembleRelease` and `npm run check`.
- Emulator evidence does not close physical-device playback, WebRTC/P2P, RLNC performance/battery, accessibility, or remote-CI launch gates.

## Completed In Build Slice 293

- Audited the workspace for credentials and generated output, initialized Git, and created the private `redil1/swarmcast` GitHub repository.
- Ran the complete remote Node, deployment-shape, and Android CI jobs successfully twice.
- Updated all CI and release third-party actions to current release lines pinned by immutable commit SHA.
- Fixed Android APK checksum sidecars to use artifact-local basenames so a normal downloaded artifact verifies directly with `sha256sum -c`.
- Hardened run `29327610922` passed Android unit tests, debug/release assembly, checksum generation, and both artifact uploads at commit `8685f81207499c3e2f843f9755f1d0b5374ee7d6`.
- Downloaded `swarmcast-android-debug-apk` and `swarmcast-android-release-unsigned-apk`; both checksum sidecars passed.
- Recorded non-synthetic run, job, toolchain, artifact ID, size, and SHA-256 evidence in `evidence/android/ci-build-29327610922.json`.
- Verified the record with `npm run android:ci:evidence:validate` and retained all local checks green.
- The first remote Android CI artifact blocker is closed; physical-device and production-environment gates remain open.

## Completed In Build Slice 294

- Rebuilt the release workflow around all 12 production runtime images instead of only five app services.
- The workflow builds custom services and immutable origin nginx, edge nginx, and edge-metrics images, and mirrors the four monitoring images into the owned GHCR namespace.
- Every image is tagged by release and commit, pulled back from GHCR, resolved to a registry digest, scanned with Trivy, and documented with a CycloneDX image SBOM.
- HIGH and CRITICAL findings fail the matrix while still uploading raw per-image evidence for diagnosis.
- Clean image digests are keyless-signed and verified with the GitHub Actions OIDC identity through Cosign.
- The final evidence job aggregates 12 digest environment records, enforces digest pins, validates all scan reports against the release manifest, and uploads manifest, source SBOM, image scans, image SBOMs, digests, and signature verification records for 90 days.
- All workflow actions are pinned to immutable commits; Trivy 0.72.0 and Cosign 3.1.1 are selected explicitly.
- Added baked origin nginx, edge nginx, and edge metrics Dockerfiles; production containers no longer depend on host-mounted application source or nginx configuration.
- Verified both workflow files with actionlint 1.7.12, rendered base/edge/production compose plans, built all three new images locally, ran the edge-metrics image, validated SBOM coverage, and passed `npm run check`.
- GitHub branch protection could not be enabled because the current account tier rejects protection for private repositories; the repository was not made public to bypass that policy.

## Completed In Build Slice 295

- Remote CI run `29329195430` passed for slice 294.
- Real staging release run `29329381667` exercised all 12 production image paths for `v0.1.0-rc1`.
- All image jobs retained registry digest, Trivy JSON, and CycloneDX SBOM evidence.
- The security gate rejected every candidate image because HIGH/CRITICAL findings remained, so signing and final release publication were correctly skipped.
- No scan policy was weakened and no waiver was created; dependency and base-image remediation is the active build task.

## Completed In Build Slice 296

- Rebuilt the five Node services and edge metrics exporter on immutable builder/runtime digests, using distroless non-root runtimes where package managers are unnecessary.
- Rebuilt origin and edge nginx from the immutable `1.29.8-alpine3.23-slim` digest with patched Alpine packages and retained the production configuration/playback/cache behavior.
- Upgraded Prometheus to immutable `v3.13.1-distroless` and node_exporter to immutable `v1.12.0-distroless` release sources.
- Rebuilt Alertmanager `v0.33.1` from exact commit `2c8da51e03f3dbbed24f9711ca2d76aab4eef9c5`, verified the official UI archive checksum, used Go `1.26.5`, and upgraded `golang.org/x/crypto` to `v0.53.0`.
- Rebuilt Grafana `13.1.0` from exact commit `b309c9bb3b81a748c3a75289236a27309ed2566a` with Go `1.26.5`; the unused Tempo backend and its affected module are excluded from the binary instead of waived.
- Corrected the source rebuilds to use BuildKit target OS/architecture values so ARM64 local builds and AMD64 release-runner builds receive matching binaries.
- Fixed fresh retention-worker volumes to initialize an empty records file safely while preserving fail-closed behavior for callers that do not explicitly allow initialization; added regression coverage.
- Built and runtime-probed auth token issuance, control-plane health, retention health, tracker metrics, ingest health, edge metrics, origin/edge nginx config and authenticated cache behavior, Alertmanager version/config, and Grafana version/database health.
- Scanned all 12 release images with Trivy `0.72.0` and the 2026-07-20 vulnerability database; every report passed the unchanged validator with zero HIGH/CRITICAL findings.
- Updated dependency inventory/review, release-manifest defaults, source SBOM base-image resolution, compose defaults, nginx smokes, CI image pinning, and validation guards.
- Added repository checks that reject monitoring source-build drift, missing exact commit/base-image pins, host-architecture defaults, omitted Grafana hardening patch use, or missing release-matrix coverage.
- Classified vendored patch files for Git whitespace handling so required unified-diff context remains intact while staged source checks stay strict for every other file.
- Verified actionlint `1.7.12`, base/edge/release compose rendering, source SBOM coverage, `npm audit --audit-level=moderate` with zero findings, `git diff --check`, and `npm run verify` with 144 passing tests.
- Clean signed remote staging publication remains open and is the next release gate.

## Next Build Slice

1. Continue hardening the remaining launch gates:
   - Execute a clean signed staging release with all 12 locally remediated digest-pinned images, SBOMs, and zero-blocked-finding scan evidence.
   - Run physical-device playback/P2P/RLNC/accessibility evidence when hardware is attached; emulator evidence remains regression-only.
2. Remaining hard gates are clean signed 12-image publication, signed legal/privacy/security/threat/dependency/RLNC/retention approvals, physical Android device validation, real host provisioning/DNS/TLS/secrets, signed catalog import, real production/staging smokes, VM/WebRTC load ladder, Alertmanager/chaos/restore/rollback/canary drills, and final owner go/no-go.

## Build Slice 297 In Progress

- Hardened commit `1f97f45` passed remote CI run `29756616628`.
- The Node job passed `npm run verify` and the moderate-severity audit gate.
- The Android job passed unit tests, assembled debug and unsigned release APKs, computed checksums, and uploaded both artifacts.
- The deployment-shape job passed base/edge compose rendering and all pinned-nginx configuration, authenticated origin, and edge-cache smokes.
- Clean signed staging candidate `v0.1.0-rc2` is the active release gate.
- Candidate `v0.1.0-rc2` exposed a mirror-only publication defect: Docker retained both upstream and GHCR repository digests, and the workflow selected the upstream digest for Prometheus/node_exporter signing.
- Release digest resolution now filters for the exact owned GHCR image prefix and validates that prefix before scan, SBOM, signing, and evidence generation; repository validation protects the behavior.
- All ten built-image jobs in run `29756836844` passed, including the exact-source Grafana and Alertmanager builds; both mirrored images passed their unchanged vulnerability gate before failing only at upstream-reference signing.
- Added a tested owned-digest parser covering upstream-first, normalization, missing, malformed, ambiguous, and unsafe input cases; `npm run verify` passes 148 tests.

## Architecture Review 298

- Confirmed tracker sharding assigns an entire channel to one process; it does not partition a channel's viewers.
- Identified mega-channel hot paths: per-segment O(N) WebSocket broadcast, O(N log N) candidate/seeder selection, per-peer rolling sample retention, and O(N) metrics aggregation every scrape.
- Confirmed the runtime connection cap defaults to 100,000 even though the blueprint estimates 300,000-500,000 idle sessions per box; neither figure proves the active segment-fanout workload.
- Confirmed Android parses `seedTier` and configures `originTemplate` but does not use either in scheduling, so bounded designated seeding is not active end to end.
- Confirmed cellular receive-only P2P is currently disabled because peer connectivity and upload permission share one `p2pAllowed` flag.
- Confirmed peers receive candidates only on join; there is no `need_peers` refresh or server-pushed replacement topology when links close.
- Confirmed Android RLNC is now implemented and wired behind `SWARMCAST_RLNC_ENABLED`, correcting the stale claim that RLNC exists only in JavaScript simulation; production enablement and real-device evidence remain blocked.
- Confirmed the deterministic 500-peer sweep preloads every super-peer with the segment but counts only one bootstrap segment, so its reported offload cannot be used for fleet economics.
- Recorded the unresolved capacity mismatch: the blueprint and standard AX41 uplink premise use about 0.8 Gbps usable per box, while `config/capacity-plan.json` assumes 8 Gbps without host evidence.
- Added `docs/architecture-remediation-plan.md` with phased deliverables and evidence gates for release repair, receive-only/topology repair, bounded bootstrap, intra-channel swarm cells, honest offload, capacity, devices, load, and final production proof.

## Completed In Build Slice 299

- Closed the release-publication blocker: commit `2d7ab7b` passed CI run `29761475940`, and staging `v0.1.0-rc3` run `29761660544` passed all 12 image jobs and final release-evidence assembly.
- Independently validated the downloaded release bundle: 12 owned GHCR digests, 12 non-empty Cosign verification records, 12 CycloneDX image SBOMs, 12 Trivy reports with zero HIGH/CRITICAL findings, a valid 12-image manifest, and a 55-component source SBOM.
- Split Android P2P download and upload permissions so cellular/metered clients can receive directly while whole and coded upload requests are rejected by policy.
- Added Android tracker reconnect with capped jittered backoff, token refresh, rejoin, redirect continuity, malformed-event isolation, and a complete WebSocket close handshake.
- Added tracker `need_peers`, exclusion IDs, same-swarm signaling enforcement, swarm-mode transition broadcasts, client topology replenishment, and candidate backfill when normal peers are scarce.
- Added Android JVM tests for cellular receive-only policy and a real two-connection MockWebServer reconnect, plus tracker regression tests for replacement peers, threshold transitions, cross-channel signal rejection, and candidate-degree backfill.
- Extended real WebSocket load smokes to close 60 of 200 clients and prove 20 sampled topologies recover target candidate degree using only live same-channel replacements; both one-channel and five-channel shapes pass at `rho=0.900` with join p95 below 100 ms.
- `npm run verify` passes 153 repository tests; Android unit tests, the tracker Docker build, and remote CI run `29763105754` pass. Physical-device connectivity/no-upload evidence remains open as a launch gate.

## Build Slice 300 Complete

- Phase B commit `4073fdf` passed remote CI run `29763105754` across Node, deployment-shape, and Android jobs.
- Android SegmentScheduler now consumes tracker `seedTier` and `originTemplate`; only designated super-peers can bootstrap from owned origin, and advertised peer supply suppresses redundant origin pulls.
- Non-seeds wait for peer supply until the fallback budget and never use origin. Origin bootstrap failure falls back to owned edge without returning unverified bytes.
- Added per-segment in-flight deduplication and made tracker SHA-256 verification mandatory for owned origin and edge segment bytes before return/storage.
- Split Android/tracker accounting into direct P2P, edge, designated origin bootstrap, relay, and upload bytes; `rho` includes every server-delivered category in its denominator.
- Added Prometheus series and Grafana download panels for origin-bootstrap and relay bytes.
- Corrected the 500-peer helper model to charge every preloaded super-peer segment as bootstrap traffic. Its best and flatten offload are both `0.850`, replacing the invalid `0.997` synthetic claim.
- Hardened load-ladder evidence to derive model offload from packet counts, reject omitted helper bootstrap, recompute real-stage `rho` from all delivery categories, and require client edge/origin/relay bytes to reconcile with access-log egress within 5%.
- Repository-wide verification passes 153 tests. Android unit tests plus debug/release assemblies, including release lint, pass locally; the corrected headless model smoke, the 12-failure-path load-evidence smoke, and `npm run check` also pass.
- Final commit `55cf6b6` passed remote CI run `29764650180` across Node, deployment-shape, and Android jobs. Build slice 300 is complete; physical-device offload proof remains a launch gate.

## Build Slice 301 Complete

- Replaced channel-only tracker ownership with stable per-viewer rendezvous assignment across process-owned cells, including optional regional affinity, redirect/join `cellId`, Android reconnect-stable assignment keys, same-cell signaling enforcement, and a configurable 20K peer ceiling per cell.
- Replaced production full-swarm candidate and seeder sorting with incrementally maintained bounded score buckets and rotating pools.
- Segment fanout now pre-encodes the seed/non-seed variants once per cell and routes delivery through a per-socket backpressure budget with drop, capacity-rejection, and active-cell metrics plus a critical alert/runbook.
- Replaced scrape-time peer aggregation with monotonic incremental counters, fixed-size one-second rolling buckets, and an indexed one-entry-per-active-peer buffer-min heap.
- Added authenticated multi-endpoint ingest announcement fanout with per-attempt timeouts and retries.
- Added deterministic assignment/distribution/movement/locality, cell-cap, cross-cell signaling, bounded-send, multi-cell fanout, incremental-stat, config, and Android assignment-continuity tests.
- The real two-process Node 22 WebSocket smoke passes: one channel spans two cells, both receive segment metadata, one cell fails while its client retains owned-edge fallback, the cell restarts, the client rejoins, and both receive the next segment.
- Repository-wide verification passes 163 tests. Android unit/debug/release builds, tracker sharding smoke, the real two-process Node 22 cell smoke, alert validation, and dashboard validation pass locally.
- Commit `8952b9e` passed remote CI run `29766749092`; the Node job independently passed the two-process cell smoke, the Android job passed unit/debug/release builds and artifact uploads, and the deployment-shape job passed. Real 1K/10K/100K per-channel scale evidence remains a hard gate.

## Build Slice 302 Complete

- Expanded the load-ladder evidence contract from four runtime stages to seven by adding mandatory single-channel cell stages at 1K, 10K, and 100K peers.
- Cell evidence now reconciles every peer to a bounded cell, requires enough tracker processes, proves segment fanout reached every cell, and rejects backpressure drops, capacity rejections, or cross-cell signaling.
- Each cell stage must record owned-edge fallback during a cell failure, stable rejoin after recovery, and p95 recovery within 30 seconds.
- Expanded the negative validation smoke from 12 to 18 failure paths and documented that the committed synthetic fixture proves record shape only, never capacity or launch readiness.
- The seven-stage synthetic fixture, 18-case negative smoke, configuration validation, `npm run check`, and repository-wide verification with 163 tests pass locally.
- Commit `8f07e17` passed remote CI run `29767526051` across Node, deployment-shape, and Android jobs. The actual 1K/10K/100K fleet runs remain external launch gates.

## Build Slice 303 Complete

- Reclassified the committed capacity plan as a draft instead of allowing synthetic and modeled inputs to masquerade as launch measurements.
- Replaced the unsupported 8 Gbps edge-host assumption with a conservative 800 Mbps allowance bounded by a 1 Gbps link and 80% sustained utilization.
- Replaced the false `measuredOffloadRatio=0.90` input with the corrected modeled direct-P2P `rho=0.85`; the 20K-viewer draft now requires 25 edge nodes with 30% headroom instead of 2.
- Added a recomputed 1M-viewer sensitivity table requiring 82, 813, 2,438, or 4,063 edge nodes at direct-P2P `rho` 0.99, 0.90, 0.70, or 0.50 respectively.
- Launch validation now requires measured non-synthetic offload, measured sustained TLS host throughput, approved provider traffic terms, and relay egress inclusion. Draft calculations require the explicit `--allow-draft` flag.
- Final launch evidence now separately requires those capacity proofs plus 1K/10K/100K single-channel cell-ladder markers.
- Capacity validation passes 2 positive shapes and rejects 15 invalid or unproved cases; launch evidence validation passes one synthetic shape and rejects 37 failure cases. Repository-wide verification passes 163 tests.
- Commit `aede0e8` passed remote CI run `29768513960` across Node, deployment-shape, and Android jobs. Real offload, throughput, provider-terms, and scale evidence remain launch gates.

## Build Slice 304 Complete

- Added Android ICE attempt/outcome telemetry using the selected WebRTC candidate-pair stats rather than inferring connectivity from SDP.
- Successful paths are classified as `host`, `srflx`, `prflx`, `relay`, or `unknown`; relay takes precedence when either selected endpoint is relayed.
- Tracker stats reconcile success classifications and export attempts, successes, failures, and selected candidate types by joined WiFi, cellular, Ethernet, or unknown network class.
- Added Grafana panels for ICE outcomes by network and selected candidate types.
- Android P2P launch evidence now requires WiFi and cellular ICE outcomes, reconciled selected-candidate counts, and sanitized network/candidate evidence markers; its smoke now rejects 25 failure paths.
- Android unit/debug/release builds, 49 targeted tracker tests, and repository-wide verification with 163 tests pass.
- Commit `94b9efa` passed remote CI run `29769852588` across Node, deployment-shape, and Android jobs. Real devices across carriers are still required to decide whether STUN-only operation is economically acceptable or TURN must be provisioned.

## Build Slice 305 In Progress

- Superseded the STUN-only decision with an owned TURN relay design using short-lived, subject-bound coturn REST credentials returned with viewer tokens.
- Android validates and caches ICE responses, refreshes before the earliest token/TURN expiry, applies credentialed ICE servers before peer creation, and no longer contains third-party STUN defaults.
- Production config requires owned STUN and UDP/TCP/TLS TURN URLs, a strong shared secret, bounded credential lifetime, immutable image ref, TLS files, quotas, relay range, bandwidth caps, and monitored targets.
- Added a minimal coturn 4.7.0 image built from exact commit `678996a52954ddc7a44afd9f72f5b5c647e41083` on digest-pinned Alpine 3.23 with unused database backends disabled.
- Trivy 0.72.0 with the 2026-07-20 database reports zero vulnerabilities for the local hardened image; the unchanged HIGH/CRITICAL validator passes without waivers.
- Added hardened relay config, dedicated firewall, private/loopback/CGNAT denial, TLS 1.2+, quotas, bandwidth limits, secret-rotation overlap, Prometheus file discovery, alerts, dashboard panels, and an operator runbook.
- Added deterministic live smoke coverage for STUN, authenticated UDP relay, authenticated TLS relay, and Prometheus metrics; every external probe has a bounded timeout.
- Extended release, SBOM, scan, dependency, host, deployment, secrets, security, threat, rollback, and launch evidence contracts from 12 to 13 runtime images/components where applicable.
- `npm run verify` passes 166 tests. Android unit tests and debug/release assemblies pass. The local hardened TURN image build, scan, and live relay smoke pass.
- Remote CI and a clean signed 13-image staging publication remain required before this slice is complete. Physical carrier/device relay proof, measured relay capacity/egress, and production provisioning remain launch gates.
