import test from "node:test";
import assert from "node:assert/strict";
import { candidatePeers, contributionTier, isSuperPeer } from "../src/scoring.js";

test("contributionTier exempts cellular and gates wifi ratios", () => {
  assert.equal(contributionTier({ transport: "cell", bytesUp: 0, bytesDownP2p: 1000, bytesDownEdge: 0 }), "guest");
  assert.equal(contributionTier({ transport: "wifi", bytesUp: 100, bytesDownP2p: 1000, bytesDownEdge: 0 }), "throttled");
  assert.equal(contributionTier({ transport: "wifi", bytesUp: 900, bytesDownP2p: 1000, bytesDownEdge: 0 }), "full");
});

test("isSuperPeer requires unmetered-style wifi upload capacity", () => {
  assert.equal(isSuperPeer({ transport: "wifi", uploadEnabled: true, uplinkKbps: 20_000 }), true);
  assert.equal(isSuperPeer({ transport: "cell", uploadEnabled: true, uplinkKbps: 20_000 }), false);
  assert.equal(isSuperPeer({ transport: "wifi", uploadEnabled: true, uplinkKbps: 1000 }), false);
});

test("candidatePeers biases cellular peers toward super peers", () => {
  const swarm = {
    peers: new Map([
      ["cell", { id: "cell", transport: "cell" }],
      ["super", { id: "super", transport: "wifi", uploadEnabled: true, uplinkKbps: 30_000, superPeer: true }],
      ["normal", { id: "normal", transport: "wifi", uploadEnabled: true, uplinkKbps: 1000 }]
    ])
  };

  const peers = candidatePeers(swarm, swarm.peers.get("cell"), 2);
  assert.equal(peers[0].id, "super");
});

test("candidatePeers promotes high-uplink wifi peers for cellular viewers", () => {
  const swarm = {
    peers: new Map([
      ["cell", { id: "cell", transport: "cell" }],
      ["implicit-super", {
        id: "implicit-super",
        transport: "wifi",
        uploadEnabled: true,
        uplinkKbps: 30_000,
        superPeer: false
      }],
      ["normal", {
        id: "normal",
        transport: "wifi",
        uploadEnabled: true,
        uplinkKbps: 1000,
        superPeer: false
      }]
    ])
  };

  const peers = candidatePeers(swarm, swarm.peers.get("cell"), 2);
  assert.deepEqual(peers[0], { id: "implicit-super", transport: "wifi", superPeer: true });
});

test("candidatePeers deprioritizes throttled wifi free riders", () => {
  const swarm = {
    peers: new Map([
      ["viewer", { id: "viewer", transport: "wifi", uploadEnabled: true, bytesUp: 500, bytesDownP2p: 500 }],
      ["full", {
        id: "full",
        transport: "wifi",
        uploadEnabled: true,
        uplinkKbps: 1000,
        bytesUp: 900,
        bytesDownP2p: 1000,
        transfersOk: 10,
        transfersFail: 0
      }],
      ["throttled", {
        id: "throttled",
        transport: "wifi",
        uploadEnabled: true,
        uplinkKbps: 1000,
        bytesUp: 10,
        bytesDownP2p: 1000,
        transfersOk: 10,
        transfersFail: 0
      }]
    ])
  };

  const peers = candidatePeers(swarm, swarm.peers.get("viewer"), 2);
  assert.equal(peers[0].id, "full");
  assert.equal(peers[1].id, "throttled");
});

test("candidatePeers backfills requested degree from super peers", () => {
  const swarm = {
    peers: new Map()
  };
  const requester = { id: "requester", transport: "wifi", uploadEnabled: true };
  swarm.peers.set(requester.id, requester);
  for (let index = 0; index < 16; index += 1) {
    const candidate = {
      id: `super-${index}`,
      transport: "wifi",
      uploadEnabled: true,
      uplinkKbps: 20_000,
      superPeer: true
    };
    swarm.peers.set(candidate.id, candidate);
  }

  assert.equal(candidatePeers(swarm, requester, 12).length, 12);
});
