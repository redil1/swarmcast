import test from "node:test";
import assert from "node:assert/strict";
import { parseTrackerPolicy, swarmModeForSize } from "../src/policy.js";

test("swarmModeForSize keeps small tail channels edge-only", () => {
  assert.equal(swarmModeForSize(19, { minP2pPeers: 20 }), "edge-only");
  assert.equal(swarmModeForSize(20, { minP2pPeers: 20 }), "p2p");
  assert.equal(swarmModeForSize(100, { minP2pPeers: 20, p2pEnabled: false }), "edge-only");
  assert.equal(swarmModeForSize(100, { minP2pPeers: 20, edgeOnlyMode: true }), "edge-only");
});

test("parseTrackerPolicy reads and validates min swarm size", () => {
  assert.equal(parseTrackerPolicy({ P2P_MIN_SWARM_SIZE: "12" }).minP2pPeers, 12);
  assert.deepEqual(parseTrackerPolicy({
    P2P_MIN_SWARM_SIZE: "12",
    P2P_ENABLED: "0",
    EDGE_ONLY_MODE: "1"
  }), {
    minP2pPeers: 12,
    p2pEnabled: false,
    edgeOnlyMode: true
  });
  assert.throws(() => parseTrackerPolicy({ P2P_MIN_SWARM_SIZE: "0" }), /positive integer/);
});
