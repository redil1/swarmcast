# Tracker Cell Capacity

## Triggers

- `SwarmcastTrackerCellSpilloverRate` means full cells are redirecting viewers frequently, but ranked capacity still exists.
- `SwarmcastTrackerCellCapacityExhausted` means at least one join exhausted every eligible cell and was rejected.

## Impact

Spillover adds redirect and signaling latency. Exhaustion prevents affected viewers from joining tracker topology; playback may not start because media templates are returned only after a successful join.

## Triage

1. Group spillover and rejection rates by tracker shard and compare active peers, cells, CPU, memory, file descriptors, and event-loop latency.
2. Verify `TRACKER_CELL_MAX_PEERS` is consistent across the fleet and below the measured per-process ceiling.
3. Check that every configured shard is healthy, reachable by WebSocket, and present in the same `TRACKER_SHARDS` membership view.
4. Compare regional occupancy. A failed or undersized region should spill across regions before producing a rejection.
5. Confirm Android joins preserve `cellRouteToken` and that invalid or expired tokens return to deterministic routing instead of being accepted.

## Mitigation

1. Add healthy tracker cells to the affected membership and roll the shared configuration through the fleet.
2. Keep the existing peer ceiling until the new cells are ready and visible in metrics.
3. Drain overloaded cells gradually; clients retain owned-edge playback and reconnect through ranked routing.
4. Verify spillovers fall, rejections remain zero, all-cell segment announcements continue, and peer topology recovers before closing the incident.

Do not raise peer or connection ceilings without a production-equivalent load result covering sockets, fanout, memory, backpressure, and node loss.
