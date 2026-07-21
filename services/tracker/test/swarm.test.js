import test from "node:test";
import assert from "node:assert/strict";
import { Swarm } from "../src/swarm.js";

test("announceSegment includes k and marks eligible seed tier", () => {
  const swarm = new Swarm("ch1");
  swarm.addPeer({ id: "p1", transport: "wifi", uploadEnabled: true, uplinkKbps: 30_000, superPeer: true });
  swarm.addPeer({ id: "p2", transport: "cell", uploadEnabled: false, uplinkKbps: 0, superPeer: false });

  const messages = [];
  swarm.announceSegment({ seq: 10, sha256: "abc", size: 1000, k: 32 }, (peer, msg) => {
    messages.push({ peer: peer.id, msg });
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].msg.k, 32);
  assert.equal(messages.some((entry) => entry.msg.seedTier), true);
  assert.equal(messages.every((entry) => entry.msg.edgeSeedTier === false), true);
});

test("announceSegment bounds seed tier to super-peer eligible helpers", () => {
  const swarm = new Swarm("ch1");
  for (let i = 0; i < 20; i += 1) {
    swarm.addPeer({
      id: `wifi-${i}`,
      transport: "wifi",
      uploadEnabled: true,
      uplinkKbps: 30_000,
      superPeer: true
    });
  }
  for (let i = 0; i < 5; i += 1) {
    swarm.addPeer({
      id: `cell-${i}`,
      transport: "cell",
      uploadEnabled: false,
      uplinkKbps: 0,
      superPeer: false
    });
  }

  const messages = [];
  swarm.announceSegment({ seq: 11, sha256: "abc", size: 1000, k: 32 }, (peer, msg) => {
    messages.push({ peer, msg });
  });

  const seedMessages = messages.filter((entry) => entry.msg.seedTier);
  assert.equal(seedMessages.length, 3);
  assert.equal(seedMessages.every((entry) => entry.peer.transport === "wifi" && entry.peer.superPeer), true);
});

test("announceSegment rotates seed tier helpers across segments", () => {
  const swarm = new Swarm("ch1");
  for (let i = 0; i < 4; i += 1) {
    swarm.addPeer({
      id: `wifi-${i}`,
      transport: "wifi",
      uploadEnabled: true,
      uplinkKbps: 30_000,
      superPeer: true
    });
  }

  const first = [];
  swarm.announceSegment({ seq: 12, sha256: "abc", size: 1000, k: 24 }, (peer, msg) => {
    if (msg.seedTier) first.push(peer.id);
  });

  const second = [];
  swarm.announceSegment({ seq: 13, sha256: "def", size: 1000, k: 24 }, (peer, msg) => {
    if (msg.seedTier) second.push(peer.id);
  });

  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.notDeepEqual(first, second);
});

test("announceSegment assigns mutually exclusive edge helpers outside the origin cell", () => {
  const swarm = new Swarm("ch1", "cell-b");
  for (let i = 0; i < 4; i += 1) {
    swarm.addPeer({
      id: `wifi-${i}`,
      transport: "wifi",
      uploadEnabled: true,
      uplinkKbps: 30_000,
      superPeer: true
    });
  }

  const messages = [];
  const result = swarm.announceSegment(
    { seq: 14, sha256: "abc", size: 1000, k: 24 },
    (peer, msg) => messages.push({ peer, msg }),
    { bootstrapSource: "edge" }
  );

  assert.equal(result.originSeedAssignments, 0);
  assert.equal(result.edgeSeedAssignments, 2);
  assert.equal(messages.filter((entry) => entry.msg.edgeSeedTier).length, 2);
  assert.equal(messages.every((entry) => !(entry.msg.seedTier && entry.msg.edgeSeedTier)), true);
});

test("announceSegment rejects an unknown bootstrap source", () => {
  const swarm = new Swarm("ch1");
  assert.throws(
    () => swarm.announceSegment(
      { seq: 15, sha256: "abc", size: 1000, k: 24 },
      () => {},
      { bootstrapSource: "unowned" }
    ),
    /bootstrapSource/
  );
});
