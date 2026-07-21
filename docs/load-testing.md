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
- `npm run smoke:tracker-ws-cells`: starts two tracker processes, proves one channel is split into two process-owned cells, fans one segment announcement to both cells, kills one cell, verifies the client retains its owned-edge fallback, and verifies stable cell rejoin after restart.
- `npm run smoke:tracker-ws-cells-1k`: opens exactly 1,000 real WebSocket clients for one channel across four process-owned cells using 25-client batches and bounded join-ack retries, reconciles exact per-cell counts against a 300-peer ceiling, verifies all-client segment fanout, proves same-cell signaling and blocks cross-cell signaling, requires no more than 10 aggregate join retries, zero message/backpressure drops, and zero capacity spillovers/rejections, then restarts one 250-client cell and requires owned-edge fallback, close code `1012`, complete rejoin, and recovery p95 within 30 seconds.
- `npm run smoke:tracker-ws-cells-10k`: runs the same assertions with exactly 10,000 real WebSocket clients across ten process-owned cells, 1,000 peers per cell, a 1,100-peer ceiling, and at most 100 aggregate bounded join retries. This heavier preflight is intentionally not part of ordinary CI and must run on a dedicated high-descriptor host or through the pinned tracker image.
- `npm run smoke:webrtc-200`: opens exactly 200 authenticated browser WebSocket clients against the real tracker in 25-client admission batches with socket-generation guards, a five-second join-ack watchdog, at most three attempts per peer, and at most 20 aggregate retries; pairs 100 WiFi-class upload sources with 100 cellular-class receive-only sinks; relays every offer, answer, and ICE candidate through tracker signaling; negotiates 100 real ordered WebRTC DataChannels; transfers and SHA-256 verifies 64 KiB per pair; requires host/host selected ICE paths; and reconciles exact direct-P2P download and upload bytes with zero edge/relay bytes, tracker drops, or capacity rejections.
- `npm run smoke:webrtc-hash-rejection`: runs a two-peer adversarial control using the same real tracker and DataChannel path, corrupts the payload after computing the expected digest, and passes only when the receiver rejects it before download accounting.
- `npm run smoke:webrtc-turn-relay`: starts the exact owned coturn image with explicit UDP listener and relay-port mappings, obtains short-lived REST credentials from the real auth service, forces two browser peers to `iceTransportPolicy=relay`, relays tracker signaling, requires a `relay/relay` selected ICE pair, SHA-256 verifies 64 KiB, checks coturn Prometheus reachability, and reconciles zero direct bytes with exact relay and upload bytes.
- `npm run smoke:webrtc-turn-auth-rejection`: mutates the issued coturn credential, forces relay-only ICE, requires Chrome to report TURN authentication rejection, and requires zero direct, relay, and upload accounting.
- `npm run smoke:load-ladder-evidence-validation`: proves the load-ladder evidence gate rejects missing stages, low offload, high stall rate, high tracker CPU, firing alerts, sensitive evidence references, invalid single-channel cell accounting, incomplete cell fanout, cell failure without edge fallback, tracker backpressure drops, and synthetic evidence without an explicit flag.

`smoke:tracker-ws` requires a Node version supported by `uWebSockets.js` v20.51.0: Node 18, 20, 22, or 23. The CI and service Docker runtime use Node 22.
On a local Node 24 shell, build the tracker image and run `TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws` to execute the smoke through Docker.
Use the same `TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local` prefix for `npm run smoke:tracker-ws-load`, `npm run smoke:tracker-ws-multichannel`, and `npm run smoke:tracker-ws-restart`.
Run the 1K cell preflight on Node 24 with `TRACKER_CELL_LOAD_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws-cells-1k`; CI runs the four tracker processes directly on Node 22.
Run the 10K control-plane preflight with `TRACKER_CELL_LOAD_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws-cells-10k` on Node 24.
Run the browser WebRTC preflights on Node 24 with `TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-hash-rejection`, `TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-200`, `TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-turn-auth-rejection`, and `TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-turn-relay`. The TURN modes require Docker and build `TURN_WEBRTC_DOCKER_IMAGE` (default `swarmcast-turn:local`) when absent. Set `WEBRTC_BROWSER_CHANNEL` or `WEBRTC_BROWSER_EXECUTABLE` when the default installed Chrome channel is unavailable.

The 1K and 10K cell preflights are control-plane evidence only. They do not generate WebRTC DataChannel traffic, measure direct-P2P offload, emulate carrier NAT, reconcile delivery egress, or replace the required non-synthetic VM/WebRTC `1-channel-1000-cell-peers` and `1-channel-10000-cell-peers` staging records.
The 200-peer browser preflight is real same-host WebRTC transport evidence, but its WiFi/cellular classes are tracker policy inputs and all selected ICE candidates are host/host. The forced-relay preflight additionally proves browser-to-owned-coturn transport, credential enforcement, relay selection, local Prometheus reachability, and exact tracker relay accounting. Neither test emulates carrier NAT, represents independent devices or networks, measures TURN fleet capacity, reconciles external provider egress, or replaces the required multi-host staging and physical-device records.

## Required Staging Ladder

1. 1 channel / 3 Android devices on WiFi.
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
- rolling `rho` computed as direct P2P bytes divided by direct P2P, edge, origin-bootstrap, and relay bytes; stall rate, startup latency, buffer health, tracker p95 message cost, and memory per peer
- separate client P2P/edge/origin-bootstrap/relay byte counters reconciled within 5% of edge, origin, and relay access-log egress; cache hit ratio and alert state
- for each single-channel cell stage: tracker process/cell counts, configured cell ceiling, exact per-cell peer counts, all-cell segment fanout, zero backpressure drops, zero capacity rejections, zero cross-cell signaling, owned-edge fallback during one cell failure, stable cell rejoin, and p95 recovery within 30 seconds
- for physical-device stages: ICE attempts, successes, failures, and selected `host`/`srflx`/`prflx`/`relay`/unknown candidate counts split by WiFi, cellular, and Ethernet where present; selected-candidate counts must reconcile to successes
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
