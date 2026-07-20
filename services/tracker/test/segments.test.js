import test from "node:test";
import assert from "node:assert/strict";
import { createPeer, createTrackerState, swarmFor } from "../src/index.js";
import { announceSegmentToState, validateSegmentAnnounce } from "../src/segments.js";

const SHA = "A".repeat(64);

function segment(seq = 1) {
  return {
    channelId: "demo",
    seq,
    sha256: SHA,
    size: 4096,
    k: 32
  };
}

test("validateSegmentAnnounce normalizes valid segment metadata", () => {
  assert.deepEqual(validateSegmentAnnounce(segment()), {
    channelId: "demo",
    seq: 1,
    sha256: SHA.toLowerCase(),
    size: 4096,
    k: 32
  });
});

test("announceSegmentToState broadcasts ordered segment announcements", () => {
  const state = createTrackerState();
  const swarm = swarmFor(state, "demo");
  const peerA = { ...createPeer(), id: "peer-a", transport: "wifi", superPeer: true };
  const peerB = { ...createPeer(), id: "peer-b", transport: "cell", superPeer: false };
  swarm.addPeer(peerA);
  swarm.addPeer(peerB);
  const sent = [];

  const first = announceSegmentToState({
    state,
    segment: segment(1),
    send: (peer, message) => sent.push({ peerId: peer.id, message })
  });
  const second = announceSegmentToState({
    state,
    segment: segment(2),
    send: (peer, message) => sent.push({ peerId: peer.id, message })
  });

  assert.equal(first.ok, true);
  assert.equal(first.recipients, 2);
  assert.equal(second.ok, true);
  assert.equal(second.recipients, 2);
  assert.deepEqual(sent.filter((entry) => entry.peerId === "peer-a").map((entry) => entry.message.seq), [1, 2]);
  assert.deepEqual(sent.filter((entry) => entry.peerId === "peer-b").map((entry) => entry.message.seq), [1, 2]);
  assert.equal(sent[0].message.t, "segment");
  assert.equal(sent[0].message.sha256, SHA.toLowerCase());
  assert.equal(sent[0].message.size, 4096);
  assert.equal(sent[0].message.k, 32);
  assert.equal(typeof sent[0].message.seedTier, "boolean");
});

test("announceSegmentToState rejects malformed segment announcements", () => {
  const state = createTrackerState();
  const result = announceSegmentToState({
    state,
    segment: { ...segment(), sha256: "not-a-digest" },
    send: () => {}
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /sha256/);
});

test("announceSegmentToState accepts valid segment when swarm is empty", () => {
  const state = createTrackerState();
  const result = announceSegmentToState({
    state,
    segment: segment(),
    send: () => {
      throw new Error("send should not run without a swarm");
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.recipients, 0);
});

test("announceSegmentToState fans one channel announcement across local cells with two encodes per cell", () => {
  const state = createTrackerState();
  const cellA = swarmFor(state, "demo", "cell-a");
  const cellB = swarmFor(state, "demo", "cell-b");
  cellA.addPeer({ ...createPeer(), id: "a", channelId: "demo", cellId: "cell-a" });
  cellB.addPeer({ ...createPeer(), id: "b", channelId: "demo", cellId: "cell-b" });
  const encodedPayloads = [];

  const result = announceSegmentToState({
    state,
    segment: segment(3),
    send: (_peer, _message, encoded) => encodedPayloads.push(encoded)
  });

  assert.equal(result.cells, 2);
  assert.equal(result.recipients, 2);
  assert.equal(state.delivery.segmentPayloadsEncoded, 4);
  assert.equal(encodedPayloads.every((payload) => typeof payload === "string"), true);
});
