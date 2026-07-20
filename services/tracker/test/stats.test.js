import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePeerStats, aggregateRollingPeerStats, recordPeerStats } from "../src/stats.js";

test("aggregatePeerStats computes offload and peer fractions", () => {
  const stats = aggregatePeerStats([
    {
      transport: "wifi",
      superPeer: true,
      bytesDownP2p: 90,
      bytesDownEdge: 10,
      bytesDownBootstrapOrigin: 10,
      bytesDownRelay: 0,
      bytesUp: 100,
      stalls: 0,
      peerTimeouts: 2,
      peerHashFailures: 1,
      peerDisconnects: 1,
      startupLatencyMsTotal: 1200,
      startupLatencySamples: 1,
      bufferMsLast: 32000
    },
    {
      transport: "cell",
      superPeer: false,
      bytesDownP2p: 10,
      bytesDownEdge: 90,
      bytesDownBootstrapOrigin: 0,
      bytesDownRelay: 10,
      bytesUp: 0,
      stalls: 1,
      peerTimeouts: 3,
      peerHashFailures: 0,
      peerDisconnects: 0,
      startupLatencyMsTotal: 800,
      startupLatencySamples: 1,
      bufferMsLast: 12000
    }
  ]);

  assert.equal(stats.peers, 2);
  assert.equal(stats.dlP2p, 100);
  assert.equal(stats.dlEdge, 100);
  assert.equal(stats.dlBootstrapOrigin, 10);
  assert.equal(stats.dlRelay, 10);
  assert.equal(stats.ul, 100);
  assert.equal(stats.stalls, 1);
  assert.equal(stats.peerTimeouts, 5);
  assert.equal(stats.peerHashFailures, 1);
  assert.equal(stats.peerDisconnects, 1);
  assert.equal(stats.stallRate, 0.5);
  assert.equal(stats.offloadRatio, 100 / 220);
  assert.equal(stats.wifiFraction, 0.5);
  assert.equal(stats.superPeerFraction, 0.5);
  assert.equal(stats.startupLatencyMsAvg, 1000);
  assert.equal(stats.startupLatencySamples, 2);
  assert.equal(stats.bufferMsAvg, 22000);
  assert.equal(stats.bufferMsMin, 12000);
});

test("recordPeerStats keeps cumulative counters, playback quality, and rolling window", () => {
  const peer = {
    transport: "wifi",
    superPeer: true,
    bytesDownP2p: 0,
    bytesDownEdge: 0,
    bytesDownBootstrapOrigin: 0,
    bytesDownRelay: 0,
    bytesUp: 0,
    stalls: 0,
    peerTimeouts: 0,
    peerHashFailures: 0,
    peerDisconnects: 0
  };

  recordPeerStats(peer, { dl_p2p: 100, dl_edge: 0, dl_bootstrap_origin: 20, dl_relay: 0, ul: 25, stalls: 0, peer_timeouts: 2, hash_failures: 1, peer_disconnects: 0, startup_ms: 1200, buffer_ms: 45000 }, 0, 5000);
  recordPeerStats(peer, { dl_p2p: 0, dl_edge: 100, dl_bootstrap_origin: 0, dl_relay: 10, ul: 10, stalls: 1, peer_timeouts: 1, hash_failures: 0, peer_disconnects: 1, startup_ms: 800, buffer_ms: 20000 }, 6000, 5000);

  assert.equal(peer.bytesDownP2p, 100);
  assert.equal(peer.bytesDownEdge, 100);
  assert.equal(peer.bytesDownBootstrapOrigin, 20);
  assert.equal(peer.bytesDownRelay, 10);
  assert.equal(peer.bytesUp, 35);
  assert.equal(peer.stalls, 1);
  assert.equal(peer.peerTimeouts, 3);
  assert.equal(peer.peerHashFailures, 1);
  assert.equal(peer.peerDisconnects, 1);
  assert.equal(peer.startupLatencyMsTotal, 2000);
  assert.equal(peer.startupLatencySamples, 2);
  assert.equal(peer.startupLatencyMsLast, 800);
  assert.equal(peer.bufferMsLast, 20000);

  const rolling = aggregateRollingPeerStats([peer], 6000, 5000);
  assert.equal(rolling.dlP2p, 0);
  assert.equal(rolling.dlEdge, 100);
  assert.equal(rolling.dlBootstrapOrigin, 0);
  assert.equal(rolling.dlRelay, 10);
  assert.equal(rolling.stalls, 1);
  assert.equal(rolling.peerTimeouts, 1);
  assert.equal(rolling.peerHashFailures, 0);
  assert.equal(rolling.peerDisconnects, 1);
  assert.equal(rolling.stallRate, 1);
  assert.equal(rolling.offloadRatio, 0);
  assert.equal(rolling.startupLatencyMsAvg, 800);
  assert.equal(rolling.bufferMsAvg, 20000);
  assert.equal(rolling.bufferMsMin, 20000);
});
