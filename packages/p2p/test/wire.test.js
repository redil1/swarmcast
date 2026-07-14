import test from "node:test";
import assert from "node:assert/strict";
import {
  bitfieldPayload,
  codedPayload,
  FRAME,
  frame,
  parseBitfieldPayload,
  parseCodedPayload,
  parseFrame,
  parseRankPayload,
  rankPayload
} from "../src/wire.js";
import { CodedPacket } from "../src/rlnc.js";

test("frame round-trips basic header and payload", () => {
  const encoded = frame(FRAME.REQUEST, 42, Buffer.from("hello"));
  const parsed = parseFrame(encoded);

  assert.equal(parsed.type, FRAME.REQUEST);
  assert.equal(parsed.seq, 42);
  assert.deepEqual(parsed.payload, Buffer.from("hello"));
});

test("parseFrame rejects malformed frames", () => {
  assert.equal(parseFrame(Buffer.alloc(0)), null);
  const bad = frame(FRAME.DATA, 1, Buffer.from("abc"));
  bad.writeUInt32BE(99, 6);
  assert.equal(parseFrame(bad), null);
});

test("bitfield payload round-trips sequence sets", () => {
  const parsed = parseBitfieldPayload(bitfieldPayload([1, 2, 99]));
  assert.deepEqual([...parsed], [1, 2, 99]);
  assert.equal(parseBitfieldPayload(Buffer.from([1, 2])), null);
});

test("coded payload round-trips coefficients and data", () => {
  const packet = new CodedPacket(Buffer.from([1, 2, 3]), Buffer.from("coded-data"));
  const parsed = parseCodedPayload(codedPayload(packet));

  assert.deepEqual(parsed.coeffs, Buffer.from([1, 2, 3]));
  assert.deepEqual(parsed.data, Buffer.from("coded-data"));
});

test("rank payload round-trips seq and rank", () => {
  assert.deepEqual(parseRankPayload(rankPayload(1234, 31)), { seq: 1234, rank: 31 });
  assert.equal(parseRankPayload(Buffer.alloc(4)), null);
});
