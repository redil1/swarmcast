import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { CodedSegmentReceiver } from "../src/codedSegment.js";
import { RlncEncoder } from "../src/rlnc.js";
import { sha256Hex } from "../src/segmentStore.js";

test("CodedSegmentReceiver verifies decoded bytes against manifest hash", () => {
  const segment = randomBytes(4097);
  const encoder = new RlncEncoder(segment, 8);
  const receiver = new CodedSegmentReceiver({
    seq: 7,
    size: segment.length,
    k: encoder.k,
    sha256: sha256Hex(segment)
  });

  let result = null;
  for (let i = 0; i < encoder.k; i += 1) {
    const coeffs = Buffer.alloc(encoder.k);
    coeffs[i] = 1;
    result = receiver.addPacket(encoder.generate(coeffs));
  }

  assert.equal(result.verified, true);
  assert.equal(receiver.complete, true);
  assert.deepEqual(result.bytes, segment);
});

test("CodedSegmentReceiver rejects decoded bytes with wrong manifest hash", () => {
  const segment = randomBytes(1024);
  const encoder = new RlncEncoder(segment, 4);
  const receiver = new CodedSegmentReceiver({
    seq: 1,
    size: segment.length,
    k: encoder.k,
    sha256: "bad"
  });

  let result = null;
  for (let i = 0; i < encoder.k; i += 1) {
    const coeffs = Buffer.alloc(encoder.k);
    coeffs[i] = 1;
    result = receiver.addPacket(encoder.generate(coeffs));
  }

  assert.equal(result.complete, true);
  assert.equal(result.verified, false);
  assert.equal(receiver.failedVerification, true);
  assert.equal(receiver.complete, false);
});
