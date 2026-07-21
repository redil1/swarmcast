# Load Testing

The load ladder must move from deterministic local smokes to VM/WebRTC tests before launch.

## Executable Local Gates

- `npm run smoke:edge-cache-metrics`: parses structured edge nginx access-log samples and verifies cache hit ratio, egress bytes, origin-fill bytes, error counts, and upstream timing metrics without exposing request URIs.
- `npm run smoke:edge-cache-metrics-server`: starts the edge metrics exporter and verifies `/health` plus `/metrics` can be scraped from structured edge logs.
- `npm run smoke:nginx-edge-cache`: runs the edge nginx TLS server block in Docker, verifies unauthorized segment requests return 401, and verifies one authenticated segment fetch returns `X-Cache: MISS` while a second valid token for the same segment returns `X-Cache: HIT` with one origin fill.
- `npm run smoke:catalog-sqlite-20k`: imports a synthetic 20K-channel catalog into SQLite, reloads it from disk, starts the public catalog HTTP server, and checks first-page, search, and group latency against the 100 ms budget.
- `npm run smoke:placement-movement`: assigns 20K synthetic channels before and after adding an ingest node, verifies bounded placement movement, and checks distribution skew across ingest nodes.
- `npm run smoke:headless-peer`: verifies a peer reconstructs a segment from two partial recoders.
- `npm run smoke:headless-200`: verifies 200 viewers reconstruct a verified coded segment through helper recoding.
- `npm run smoke:headless-super-peer-sweep`: runs a 500-peer deterministic headless sweep across 5%, 10%, 15%, 20%, and 25% super-peer fractions, verifies every viewer reconstructs the segment, charges every preloaded helper segment as bootstrap delivery, and reports the resulting model `rho`. This is a model diagnostic, not production offload evidence.
- `npm run smoke:ingest-demand-playlist`: starts a real ingest HTTP server with `ChannelManager`, demands a channel, produces synthetic fMP4 HLS files through a worker shim, watches the segment, announces it to a fake tracker internal endpoint, and verifies live status.
- `npm run smoke:ingest-ffmpeg-chaos`: simulates repeated ffmpeg worker crashes for a demanded channel and verifies restart backoff preserves demand metadata before the channel enters degraded state.
- `npm run smoke:ingest-tail-admission`: verifies `TAIL_ADMISSION_MAX_CHANNELS` rejects new cold-tail channels before ffmpeg starts while allowing hot channels through the normal capacity path.
- `npm run smoke:ingest-tail-downscale`: verifies cold-tail demand uses lower-bitrate ffmpeg arguments when `TAIL_DOWNSCALE_ENABLED` is set and restarts back to source-copy packaging when demand rises above the tail threshold.
- `npm run smoke:multi-ingest-routing`: starts a real control-plane placement API with two ingest nodes, drives tracker joins for two channels, verifies `/edge/<node>/live/...` media templates, and confirms demand calls route to the selected ingest nodes.
- `npm run smoke:nginx-origin-playback`: packages fMP4 HLS, runs the origin nginx TLS server block in Docker, verifies auth-gated playlist denial without a token, then fetches the playlist and first media segment over HTTPS with a real auth token.
- `npm run smoke:tracker-load`: drives 200 deterministic peers through tracker join and stats handling, verifies `rho >= 0.90`, confirms P2P peer lists after the swarm threshold, checks tracker message p95 against `config/performance-budgets.json`, and verifies tracker playback-quality metrics for stall rate, startup latency, buffer health, plus peer timeout/hash-failure/disconnect counters.
- Android retains unsent stats across incomplete tracker joins and reconnects; the replacement join flushes those deltas with `tracker_join_timeouts`, exposed as cumulative and rolling tracker metrics. Load evidence must keep join-timeout alerts clear or explain and reconcile every timeout.
- `npm run smoke:tracker-sharding`: verifies deterministic channel-to-tracker-shard routing, wrong-shard `redirect` responses, and that only the owning shard creates swarm state and sends demand.
- `npm run smoke:tracker-ws`: starts local auth, fake ingest, and the tracker process; rejects an invalid JWT, connects with a real JWT over WebSocket, verifies join, ping, recurring demand heartbeat, tracker metrics, playback-quality stats, segment announcement delivery, two-client WebRTC signaling relay for offer, answer, and ICE-shaped envelopes, connection-limit rejection, rate-limit disconnect, oversized-frame disconnect behavior, and idle-timeout closure.
- `npm run smoke:tracker-ws-load`: opens 200 real WebSocket clients against the tracker, verifies demand calls, `rho >= 0.90`, rolling offload, P2P peer-list activation, and replacement-candidate recovery after closing 30% of clients.
- `npm run smoke:tracker-ws-multichannel`: opens 200 real WebSocket clients across 5 channels and verifies per-channel demand size, aggregate `rho`, rolling offload, and P2P peer-list activation.
- `npm run smoke:tracker-ws-restart`: starts auth, fake ingest, and tracker, connects an active WebSocket swarm, stops the tracker, confirms sockets close, restarts the tracker on the same ports, and verifies clients can rejoin with Delivery Fleet playlist URLs, demand calls, `rho >= 0.90`, rolling offload, and P2P peer-list activation.
- `npm run smoke:tracker-ws-cells`: starts two tracker processes, proves one channel is split into two process-owned cells, fans one segment announcement to both cells, verifies exactly one deterministic cell grants direct-origin bootstrap while the other grants owned-edge bootstrap, reconciles separate assignment counters, kills one cell, verifies the client retains its owned-edge fallback, and verifies the same capability split after stable rejoin.
- `npm run smoke:tracker-ws-cells-1k`: opens exactly 1,000 real WebSocket clients for one channel across four process-owned cells using 25-client batches and bounded join-ack retries, reconciles exact per-cell counts against a 300-peer ceiling, verifies all-client segment fanout, proves same-cell signaling and blocks cross-cell signaling, requires no more than 10 aggregate join retries, zero message/backpressure drops, and zero capacity spillovers/rejections, then restarts one 250-client cell and requires owned-edge fallback, close code `1012`, complete rejoin, and recovery p95 within 30 seconds.
- `npm run smoke:tracker-ws-cells-10k`: runs the same assertions with exactly 10,000 real WebSocket clients across ten process-owned cells, 1,000 peers per cell, a 1,100-peer ceiling, and at most 100 aggregate bounded join retries. This heavier preflight is intentionally not part of ordinary CI and must run on a dedicated high-descriptor host or through the pinned tracker image.
- `npm run smoke:webrtc-200`: opens exactly 200 authenticated browser WebSocket clients against the real tracker in 25-client admission batches with socket-generation guards, a five-second join-ack watchdog, at most three attempts per peer, and at most 20 aggregate retries; pairs 100 WiFi-class upload sources with 100 cellular-class receive-only sinks; relays every offer, answer, and ICE candidate through tracker signaling; negotiates 100 real ordered WebRTC DataChannels; transfers and SHA-256 verifies 64 KiB per pair; requires host/host selected ICE paths; and reconciles exact direct-P2P download and upload bytes with zero edge/relay bytes, tracker drops, or capacity rejections.
- `npm run smoke:webrtc-hash-rejection`: runs a two-peer adversarial control using the same real tracker and DataChannel path, corrupts the payload after computing the expected digest, and passes only when the receiver rejects it before download accounting.
- `npm run smoke:webrtc-turn-relay`: starts the exact owned coturn image with explicit UDP listener and relay-port mappings, obtains short-lived REST credentials from the real auth service, forces two browser peers to `iceTransportPolicy=relay`, relays tracker signaling, requires a `relay/relay` selected ICE pair, SHA-256 verifies 64 KiB, checks coturn Prometheus reachability, and reconciles zero direct bytes with exact relay and upload bytes.
- `npm run smoke:webrtc-turn-relay-20`: obtains a distinct JWT and short-lived TURN username/credential for every one of 20 browser viewers, opens 10 simultaneous relay-only DataChannel pairs against a coturn instance configured for exactly 20 total allocations and 20 relay ports, requires an exact observed peak of 20 active allocations followed by zero leaked allocations, verifies all 10 payloads and selected `relay/relay` paths, reconciles 655,360 tracker relay/upload payload bytes, and requires coturn's finished-session ingress and egress counters to cover both transport legs. This is a same-host quota-boundary preflight, not a TURN fleet capacity benchmark.
- `npm run smoke:webrtc-turn-auth-rejection`: mutates the issued coturn credential, forces relay-only ICE, requires Chrome to report TURN authentication rejection, and requires zero direct, relay, and upload accounting.
- `npm run smoke:load-ladder-probe`: runs a synthetic exact-hash driver through the bounded distributed probe, verifies mode `0600` secret-free raw output, and proves the collector rejects missing load acknowledgement, private production targets, stale or mismatched drivers, start skew, failed joins, unknown ICE candidates, missing cross-generator traffic, byte drift, unsupported or sensitive output, and missing integrity markers.
- `npm run smoke:load-ladder-evidence-validation`: proves the load-ladder evidence gate rejects missing stages, low offload, high stall rate, high tracker CPU, firing alerts, sensitive evidence references, invalid single-channel cell accounting, incomplete cell fanout, cell failure without edge fallback, tracker backpressure drops, missing or hash-mismatched raw probe artifacts, single-provider generators, peer-range gaps/overlaps, start skew, release drift, inadequate cross-host coverage, raw byte/transfer drift, incomplete cell observation, unknown ICE candidates, and synthetic evidence without an explicit flag.
- `npm run smoke:turn-capacity-probe`: uses a synthetic client and metrics endpoint to prove the staging probe issues unique credentials, runs warm-up and sustained phases, samples an exact concurrent-allocation peak, parses loss and latency, drains allocations to zero, writes mode `0600` evidence, and never records credentials. Its test mode is always marked synthetic.
- `npm run smoke:turn-capacity-evidence-validation`: proves final TURN capacity evidence rejects single-host or single-generator runs, unsynchronized probes, missing UDP/TLS profiles, insufficient allocation or bandwidth headroom, counter mismatch, impossible throughput, packet loss, resource pressure, allocation leaks, missing provider reconciliation, sensitive references, and synthetic evidence without an explicit flag.

`smoke:tracker-ws` requires a Node version supported by `uWebSockets.js` v20.51.0: Node 18, 20, 22, or 23. The CI and service Docker runtime use Node 22.
On a local Node 24 shell, build the tracker image and run `TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws` to execute the smoke through Docker.
Use the same `TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local` prefix for `npm run smoke:tracker-ws-load`, `npm run smoke:tracker-ws-multichannel`, and `npm run smoke:tracker-ws-restart`.
Run the 1K cell preflight on Node 24 with `TRACKER_CELL_LOAD_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws-cells-1k`; CI runs the four tracker processes directly on Node 22.
Run the 10K control-plane preflight with `TRACKER_CELL_LOAD_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws-cells-10k` on Node 24.
Run the browser WebRTC preflights on Node 24 with `TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-hash-rejection`, `TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-200`, `TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-turn-auth-rejection`, `TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-turn-relay`, and `TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-turn-relay-20`. The TURN modes require Docker and build `TURN_WEBRTC_DOCKER_IMAGE` (default `swarmcast-turn:local`) when absent. Set `WEBRTC_BROWSER_CHANNEL` or `WEBRTC_BROWSER_EXECUTABLE` when the default installed Chrome channel is unavailable.

The 1K and 10K cell preflights are control-plane evidence only. They do not generate WebRTC DataChannel traffic, measure direct-P2P offload, emulate carrier NAT, reconcile delivery egress, or replace the required non-synthetic VM/WebRTC `1-channel-1000-cell-peers` and `1-channel-10000-cell-peers` staging records.
The 200-peer browser preflight is real same-host WebRTC transport evidence, but its WiFi/cellular classes are tracker policy inputs and all selected ICE candidates are host/host. The forced-relay preflights additionally prove browser-to-owned-coturn transport, per-viewer credential issuance, credential enforcement, relay selection, local Prometheus reachability, quota-boundary concurrency, exact tracker payload accounting, and coturn transport-byte coverage. Coturn counters include protocol traffic and are not expected to equal tracker application-payload counters. These tests do not emulate carrier NAT, represent independent devices or networks, measure TURN fleet capacity, reconcile external provider billing egress, or replace the required multi-host staging and physical-device records.

## TURN Capacity Ladder

Run `turnutils_peer` on two independent public load-generator hosts in separate providers and failure domains. Each generator must use the other generator's public echo address, an exact-version `turnutils_uclient`, a monitoring tunnel to one TURN host, and the same future `--start-at` timestamp. The shared secret is injected through `TURN_SHARED_SECRET`; never place it in command arguments, output, evidence, or shell history.

For a 1,300-allocation host profile, run 650 allocations from each generator at the same time. This example produces a nominal host-wide relay transport rate near 780 Mbps before protocol variation:

```bash
npm run turn:capacity:probe -- \
  --acknowledge-staging-load \
  --run-id turn-a-udp-load-a \
  --commit "$RELEASE_COMMIT" \
  --release-version "$RELEASE_VERSION" \
  --start-at "$TURN_PROFILE_START_AT" \
  --server turn-a.staging.example \
  --port 3478 \
  --transport udp \
  --peer-address "$LOAD_B_PUBLIC_IP" \
  --peer-port 3480 \
  --metrics-url http://127.0.0.1:19641/metrics \
  --load-generator-host-id load-a \
  --load-generator-failure-domain provider-a-eu \
  --load-generator-provider provider-a \
  --load-generator-region eu-west \
  --allocations 650 \
  --expected-host-allocations 1300 \
  --message-bytes 1200 \
  --interval-ms 32 \
  --warmup-seconds 60 \
  --phase-gap-seconds 30 \
  --sustained-seconds 300 \
  --output evidence/turn/turn-a-udp-load-a.raw.json
```

Repeat simultaneously from `load-b`. Both probes take idle counter baselines before the shared warm-up start and before the shared sustained start after the drain gap. Then repeat the pair against TLS port 5349 with `--transport tls --ca-file /path/to/ca.pem`. Execute both transports on at least two TURN hosts in separate failure domains. Do not overlap UDP and TLS profiles unless the approval explicitly covers a combined profile.

Join the raw records with coturn Prometheus deltas, host NIC counters, provider ingress/egress exports, CPU, memory, restart/OOM/quota records, image digest, traffic-terms approval, and operations/performance/security approvals. The final record must include exactly one synchronized raw probe per generator in every host/transport profile and preserve at least 30% headroom. Validate it without a synthetic allowance:

```bash
npm run turn:capacity:evidence:validate -- path/to/turn-capacity-evidence.json
```

The committed fixture is schema coverage only:

```bash
npm run turn:capacity:evidence:validate -- --allow-synthetic test-fixtures/load/turn-capacity-complete.synthetic.json
```

## Segment Metadata Bus Capacity

Run the procedure in `docs/segment-bus-capacity.md` against exactly three staging brokers in three real failure domains and at least two providers. The synchronized driver must sustain `segmentBusTargetMessagesPerSecond` for at least 15 minutes, preserve exact publication and subscriber delivery counts, stay within p99 latency and host resource budgets, continue without loss through active-leader failure, recover three replicas, replay the exact latest sequence and hash after a full-cluster restart, rotate both runtime credentials, and reconcile every monitoring and storage sample.

Collect immutable raw evidence with:

```bash
npm run segment-bus:capacity:probe -- \
  --acknowledge-staging-disruption \
  --manifest path/to/segment-bus-capacity-manifest.json \
  --driver path/to/segment-bus-capacity-driver \
  --output path/to/segment-bus-capacity-raw.json
```

After distinct platform, performance, and security review, validate the hash-bound final record with:

```bash
npm run segment-bus:capacity:evidence:validate -- path/to/segment-bus-capacity-evidence.json
```

`npm run smoke:segment-bus-capacity-probe` and `npm run smoke:segment-bus-capacity-evidence-validation` are contract tests only. Their synthetic output cannot satisfy launch readiness.

## Required Staging Ladder

Distributed VM stages are collected through `docs/distributed-load-ladder.md` and `npm run load:ladder:probe`. Every final stage is bound to the exact mode-`0600` raw probe files by relative path and SHA-256.

1. 1 channel / at least 4 Play-installed physical Android devices across 2 WiFi failure domains and 2 cellular carriers, collected through `docs/android-device-lab.md`.
2. 1 channel / 200 mixed headless peers through real tracker WebSockets and WebRTC DataChannels.
3. 50 channels / 2000 peers across multiple VMs with WebRTC DataChannel transfer.
4. 1 channel / 1000 peers partitioned across at least 2 tracker cells.
5. 1 channel / 10000 peers partitioned across at least 2 tracker cells.
6. 1 channel / 100000 peers partitioned across at least 5 tracker cells, with no cell above 20000 peers.
7. Zipf-distributed catalog test using the committed distribution fixtures with WebRTC DataChannel transfer.

## Launch Evidence

Each staging run must record:

- command, commit, image tags, and host shape
- peer count, channel count, WiFi/cellular mix, and super-peer fraction
- WebRTC DataChannel transport, tracker-signaling relay path, and successful DataChannel transfer
- for every distributed stage: hash-bound raw probe bundles from independent providers/failure domains, one immutable driver build, synchronized starts within five seconds, contiguous non-overlapping peer ranges covering the exact stage population, distinct opaque egress fingerprints, at least 10% cross-generator endpoints, reconciled verified sends/receives, complete selected ICE classification, and raw client delivery/upload totals equal to the final stage totals
- rolling `rho` computed as direct P2P bytes divided by direct P2P, edge, origin-bootstrap, and relay bytes; stall rate, startup latency, buffer health, tracker p95 message cost, and memory per peer
- separate client P2P/edge/origin-bootstrap/relay byte counters reconciled within 5% of edge, origin, and relay access-log egress; cache hit ratio and alert state
- for each single-channel cell stage: tracker process/cell counts, configured cell ceiling, exact per-cell peer counts, all-cell segment fanout, segment count and coding rank, exactly one origin-bootstrap cell, origin assignments no greater than `segmentAnnouncements * max(2, ceil(k/12))`, edge-bootstrap coverage and bounded assignments for every secondary cell, zero backpressure drops, zero capacity rejections, zero cross-cell signaling, owned-edge fallback during one cell failure, stable cell rejoin, and p95 recovery within 30 seconds
- for physical-device stages: opaque device fingerprints and installed base-APK hashes; at least two WiFi failure domains and two cellular carriers; measured useful WiFi upload and exact cellular zero upload; ICE attempts, successes, failures, and selected `host`/`srflx`/`prflx`/`relay`/unknown candidate counts per device; attempts must reconcile to outcomes, selected candidates must reconcile to successes, and unknown candidates must be zero
- self-sustaining sweep command, tested super-peer fractions, flatten fraction, helper upload budget, every preloaded helper charged as bootstrap packets, and packet-derived model `rho` per fraction

Validate the final ladder evidence before launch:

```bash
npm run load:ladder:validate -- path/to/load-ladder-evidence.json
```

Synthetic fixtures must be validated explicitly:

```bash
npm run load:ladder:validate -- --allow-synthetic test-fixtures/load/load-ladder-complete.synthetic.json
```

The committed synthetic fixture proves only that the validator accepts the required record shape. It is not capacity, device, network, or launch evidence. Production launch remains blocked until the VM/WebRTC ladder has stored non-synthetic results and regressions are tied to the release gate.
