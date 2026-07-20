# Tracker Backpressure Drops

## Trigger

`SwarmcastTrackerBackpressureDrops` fires when a tracker drops one or more messages because a WebSocket exceeded the configured backpressure budget.

## Impact

Affected clients can miss peer, mode, or segment announcements and may use owned edge fallback until topology repair or reconnect succeeds.

## Triage

1. Identify the tracker shard and compare active cells, peers, drop rate, CPU, memory, and event-loop latency.
2. Check cell-capacity rejection rate and verify no cell exceeds `TRACKER_CELL_MAX_PEERS`.
3. Check whether a small set of slow sockets owns most buffered bytes; confirm clients reconnect and request replacement peers.
4. Verify every tracker cell received the latest internal segment announcement.

## Mitigation

1. Drain the affected tracker shard and add tracker cells before raising any peer ceiling.
2. Keep clients on owned edge fallback during the drain.
3. Restore the shard, verify segment fanout and topology replenishment, then return traffic gradually.
4. Do not raise `TRACKER_MAX_BACKPRESSURE_BYTES` without a measured memory budget and a repeat load test.
