# Architecture Remediation Plan

This plan converts the 1M-viewer architecture review into production gates. A phase is complete only when its runtime behavior and required evidence pass; implementation shape or synthetic fixtures alone do not close a gate.

## Target Outcomes

1. One popular channel can be partitioned across tracker processes without placing all viewers or segment fanout on one process.
2. WiFi, Ethernet, metered, low-battery, and cellular policies independently control P2P download and upload.
3. Every active client repairs its peer topology and reconnects to its tracker without operator intervention.
4. Seed-tier assignment causes bounded, measured bootstrap fetches and stops when useful swarm supply exists.
5. Offload ratio is derived from real transfers and reconciled with edge egress; synthetic client counters cannot prove capacity.
6. Delivery-fleet counts use measured sustained host throughput, failure headroom, and provider traffic terms.

## Phase A: Release Evidence Repair

Deliverables:

- Select only an owned GHCR digest after mirroring an upstream image.
- Reject missing, malformed, upstream-only, or ambiguous repository digests.
- Publish, scan, generate SBOMs for, sign, and verify all 15 images, including the owned TURN relay, NATS, and NATS exporter images.

Acceptance evidence:

- Unit tests for upstream-first and failure cases.
- Remote CI success for the repair commit.
- One staging release with 15 clean scan reports, 15 image SBOMs, 15 owned digests, 15 verified signatures, source SBOM, and validated release manifest.

## Phase B: Client Connectivity And Topology Repair

Deliverables:

- Separate `downloadAllowed` from `uploadAllowed`; cellular and other receive-only clients may download from direct peers without uploading.
- Enforce one shared monotonic token bucket across all peer links, capped at 80% of the current reported uplink and 1.5 MB/s of payload, with at most three seconds of burst capacity.
- Re-evaluate network, metering, battery, and uplink policy before and during each upload so a WiFi-to-cellular transition fails closed.
- Track desired/minimum/maximum peer degree independently of upload policy.
- Add `need_peers` with bounded request rate, exclusion IDs, and server-side same-swarm validation.
- Push swarm-mode changes when a channel crosses the P2P threshold.
- Replenish after ICE/DataChannel closure and reconnect to the tracker with capped exponential backoff and jitter.
- Reject cross-channel signaling and unknown peer targets.

Acceptance evidence:

- Tracker and Android unit tests for receive-only mode, monotonic upload rate and burst boundaries, concurrent reservations, policy reconfiguration, replacement peers, mode transition, reconnect, rate limits, and same-swarm signaling.
- Real WebSocket churn smoke proving peer degree recovers after at least 30% link loss.
- Physical-device evidence proving cellular no-upload with direct peer download where ICE succeeds.

## Phase C: Bounded Bootstrap And Honest Offload

Deliverables:

- Consume legacy `seedTier` as direct-origin capability and optional `edgeSeedTier` as owned-edge capability in the Android scheduler.
- Allow only designated helpers to perform controlled bootstrap fetches; all other clients wait for peer supply until their edge-fallback deadline.
- Advertise useful rank/supply and stop seed pulls when the configured deficit is filled.
- Count bootstrap, direct P2P, edge, and any relayed bytes separately.
- Correct the headless sweep so every preloaded helper segment is charged as bootstrap traffic.
- Reconcile client-reported edge bytes with edge access-log egress before accepting `rho` evidence.

Acceptance evidence:

- Scheduler tests proving seed and non-seed behavior under deadlines.
- Corrected model reports that include all bootstrap bytes.
- Three-device WiFi transfer plus staged 200-peer WebRTC transfer with hashes, stalls, startup, useful upload, and edge reconciliation.

## Phase D: Intra-Channel Swarm Cells

Target topology:

- A channel contains many bounded swarm cells; a cell, not a whole channel, is the tracker ownership unit.
- The rendezvous tier assigns viewers by stable hash plus capacity and locality, returning `channelId`, `cellId`, and owning tracker.
- Each cell has a configured peer ceiling and independent topology, seed pool, counters, and backpressure budget.
- Segment metadata is published once to the channel and distributed to cells through an internal authenticated bus; trackers do not perform cross-process peer signaling.
- Exactly one shard-order-independent tracker cell per channel assigns direct-origin helpers. Every other active cell assigns owned-edge helpers, so adding cells cannot multiply direct-origin authorization.

Deliverables:

- Add stable cell assignment and redirect contracts.
- Spill full cells through the locality-first rendezvous ranking with signed, expiring route assignments; reject only after all eligible cells are exhausted.
- Key tracker swarm state by channel and cell.
- Replace full-swarm peer sorting with bounded score buckets/reservoir selection maintained incrementally.
- Maintain seeder pools incrementally instead of sorting all peers per segment.
- Encode segment payload variants once per announcement and enforce backpressure/drop metrics.
- Maintain incremental tracker counters so Prometheus scrapes are independent of peer count.
- Publish each segment once to a durable JetStream channel subject; trackers subscribe only for locally active channels and replay the latest persisted metadata after reconnect.
- Preserve rolling-upgrade safety: old clients ignore `edgeSeedTier`, and no secondary cell receives the legacy `seedTier` origin capability. During rollout, old secondary-cell clients may reach normal edge fallback, but cannot fetch bootstrap segments from origin.

Acceptance evidence:

- Deterministic assignment, bounded movement, authenticated capacity spillover, cell-cap exhaustion, redirect, and same-cell signaling tests.
- Multi-process WebSocket smoke proving one channel spans cells, assigns origin bootstrap in exactly one deterministic cell, assigns edge bootstrap in every secondary cell, spills a full cell, and survives one cell failure through edge fallback/rejoin.
- Staged ladder at 1K, 10K, and 100K active viewers per channel shape before any extrapolation to 1M.
- A 1M single-channel claim remains prohibited until the production-equivalent distributed test passes every budget.

## Phase E: Capacity And Production Proof

Deliverables:

- Replace the unproven 8 Gbps edge-node capacity with measured sustained TLS delivery throughput or document/provision the exact 10 Gbps shape and traffic cost.
- Record ICE success by network class and selected candidate type.
- Treat TURN/relay traffic as owned delivery egress, not P2P offload.
- Bind Android peer-delivery counters to the selected ICE path so relay or unclassified DataChannel bytes cannot inflate direct-P2P `rho`.
- Size edge, tracker, ingest, and monitoring fleets from measured p95/p99 load with node-loss and regional headroom.

Required ladder:

1. Three physical Android devices on WiFi.
2. Physical devices across at least two WiFi networks and two cellular carriers.
3. One channel with 200 real WebRTC peers.
4. Fifty channels with 2,000 peers across multiple VMs.
5. One channel partitioned across multiple tracker cells at 1K, 10K, and 100K peers.
6. Zipf-distributed catalog load with real DataChannel transfers.
7. Production-equivalent peak test, chaos, restore, rollback, Alertmanager, and canary drills.

Launch remains blocked until legal, privacy, security, dependency, RLNC, retention, host, secret, device, load, and owner approvals contain real non-synthetic evidence.
