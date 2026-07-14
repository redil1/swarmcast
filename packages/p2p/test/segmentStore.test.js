import test from "node:test";
import assert from "node:assert/strict";
import { SegmentStore, sha256Hex } from "../src/segmentStore.js";

test("SegmentStore stores only verified bytes", () => {
  const store = new SegmentStore();
  const bytes = Buffer.from("segment");
  const hash = sha256Hex(bytes);

  assert.equal(store.putVerified(1, bytes, "bad"), false);
  assert.equal(store.get(1), null);

  assert.equal(store.putVerified(1, bytes, hash), true);
  assert.deepEqual(store.get(1).bytes, bytes);
});

test("SegmentStore evicts least recently used entries by byte budget", () => {
  const store = new SegmentStore({ maxBytes: 10 });
  const a = Buffer.from("aaaaa");
  const b = Buffer.from("bbbbb");
  const c = Buffer.from("ccccc");

  assert.equal(store.putVerified(1, a, sha256Hex(a)), true);
  assert.equal(store.putVerified(2, b, sha256Hex(b)), true);
  assert.deepEqual([...store.heldSeqs()], [1, 2]);

  store.get(1);
  assert.equal(store.putVerified(3, c, sha256Hex(c)), true);

  assert.equal(store.get(2), null);
  assert.deepEqual([...store.heldSeqs()], [1, 3]);
});
