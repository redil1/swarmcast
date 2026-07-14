import test from "node:test";
import assert from "node:assert/strict";
import { formatPrometheusMetrics } from "../src/metrics.js";

test("formatPrometheusMetrics emits core tracker metrics", () => {
  const text = formatPrometheusMetrics({
    peers: 2,
    dlP2p: 100,
    dlEdge: 50,
    ul: 75,
    stalls: 1,
    peerTimeouts: 2,
    peerHashFailures: 1,
    peerDisconnects: 1,
    offloadRatio: 2 / 3,
    startupLatencyMsAvg: 1250,
    startupLatencySamples: 2,
    bufferMsAvg: 30000,
    bufferMsMin: 12000,
    rollingDlP2p: 30,
    rollingDlEdge: 70,
    rollingOffloadRatio: 0.3,
    rollingStallRate: 0.01,
    rollingPeerTimeouts: 1,
    rollingPeerHashFailures: 1,
    rollingPeerDisconnects: 1,
    rollingStartupLatencyMsAvg: 900,
    rollingBufferMsAvg: 28000,
    rollingBufferMsMin: 15000,
    wifiFraction: 0.5,
    superPeerFraction: 0.25
  });

  assert.match(text, /swarmcast_tracker_peers 2/);
  assert.match(text, /swarmcast_tracker_offload_ratio 0\.666/);
  assert.match(text, /swarmcast_tracker_offload_ratio_5m 0\.3/);
  assert.match(text, /swarmcast_tracker_playback_stalls_total 1/);
  assert.match(text, /swarmcast_tracker_peer_timeouts_total 2/);
  assert.match(text, /swarmcast_tracker_peer_hash_failures_total 1/);
  assert.match(text, /swarmcast_tracker_peer_disconnects_5m 1/);
  assert.match(text, /swarmcast_tracker_stall_rate_5m 0\.01/);
  assert.match(text, /swarmcast_tracker_startup_latency_ms_avg 1250/);
  assert.match(text, /swarmcast_tracker_startup_latency_ms_avg_5m 900/);
  assert.match(text, /swarmcast_tracker_startup_latency_samples_total 2/);
  assert.match(text, /swarmcast_tracker_buffer_ms_avg 30000/);
  assert.match(text, /swarmcast_tracker_buffer_ms_min_5m 15000/);
  assert.match(text, /swarmcast_tracker_super_peer_fraction 0\.25/);
});
