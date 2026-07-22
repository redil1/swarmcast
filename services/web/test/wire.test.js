import test from "node:test";
import assert from "node:assert/strict";
import { Wire, encodeBitfield, frame, parseBitfield, parseFrame } from "../client/wire.js";
import { SegmentStore } from "../client/segmentStore.js";

test("wire frames match the Android big-endian contract", () => {
  const encoded = new Uint8Array(frame(Wire.DATA, 0x01020304, new Uint8Array([7, 8])));
  assert.deepEqual([...encoded.slice(0, 12)], [0x5c, 2, 1, 2, 3, 4, 0, 0, 0, 2, 7, 8]);
  const parsed = parseFrame(encoded);
  assert.equal(parsed.seq, 0x01020304);
  assert.deepEqual([...parsed.payload], [7, 8]);
});

test("bitfield and bounded segment store round trip", () => {
  assert.deepEqual([...parseBitfield(encodeBitfield([3, 9, 12]))], [3, 9, 12]);
  const store = new SegmentStore({ maxBytes: 5, maxEntries: 2 });
  store.put(1, new Uint8Array([1, 2]), "a");
  store.put(2, new Uint8Array([3, 4]), "b");
  store.put(3, new Uint8Array([5, 6]), "c");
  assert.equal(store.has(1), false);
  assert.deepEqual(store.seqs(), [2, 3]);
});
