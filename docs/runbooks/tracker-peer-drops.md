# Runbook: Tracker Peer Drops

## Alert

`SwarmcastTrackerPeerDrops`

## Impact

Large tracker peer drops reduce P2P availability, push traffic to the Delivery Fleet, and may interrupt WebRTC signaling.

## Triage

1. Check tracker process restarts, CPU, memory, and event-loop latency.
2. Compare auth verification failures with peer drops.
3. Inspect WebSocket close reasons for rate-limit, auth, and backpressure patterns.
4. Confirm control-plane placement and ingest demand routes are responding.
5. Check whether drops are concentrated on one app version, network type, region, or channel.
6. Reproduce the tracker restart path with `npm run smoke:tracker-ws-restart`; on a local Node 24 shell, use `TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws-restart`.

## Mitigation

1. Roll back recent tracker or Android signaling changes.
2. Temporarily raise Delivery Fleet capacity for affected channels.
3. Lower peer candidate counts if signaling load is the bottleneck.
4. Keep tail channels in edge-only mode until peer counts stabilize.

## Follow-Up

- Capture close-code distribution and top affected channels.
- Add a load or smoke test that reproduces the drop pattern.
- Attach the tracker restart smoke output when the incident involved process restarts or deploy rollovers.
