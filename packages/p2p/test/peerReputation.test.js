import test from "node:test";
import assert from "node:assert/strict";
import { PEER_EVENT, PeerReputation, PeerReputationBook } from "../src/peerReputation.js";

test("PeerReputation disconnects after two hash mismatches", () => {
  const peer = new PeerReputation({ peerId: "bad" });

  let state = peer.record(PEER_EVENT.HASH_MISMATCH);
  assert.equal(state.disconnected, false);
  assert.equal(state.poisonOffenses, 1);

  state = peer.record(PEER_EVENT.HASH_MISMATCH);
  assert.equal(state.disconnected, true);
  assert.equal(state.poisonOffenses, 2);
  assert.equal(state.score, -50);
});

test("PeerReputation scores success, reject, and timeout differently", () => {
  const peer = new PeerReputation({ peerId: "peer" });

  peer.record(PEER_EVENT.SUCCESS);
  peer.record(PEER_EVENT.SUCCESS);
  peer.record(PEER_EVENT.REJECT);
  const state = peer.record(PEER_EVENT.TIMEOUT);

  assert.equal(state.successes, 2);
  assert.equal(state.failures, 2);
  assert.equal(state.score, 2);
});

test("PeerReputationBook excludes disconnected candidates and sorts by score", () => {
  const book = new PeerReputationBook();
  book.record("good", PEER_EVENT.SUCCESS);
  book.record("ok", PEER_EVENT.REJECT);
  book.record("bad", PEER_EVENT.HASH_MISMATCH);
  book.record("bad", PEER_EVENT.HASH_MISMATCH);

  assert.deepEqual(book.candidates().map((peer) => peer.peerId), ["good", "ok"]);
});
