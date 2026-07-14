import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { CodedPacket, RlncDecoder, RlncEncoder } from "../src/rlnc.js";

test("RLNC decodes a segment from k independent packets", () => {
  const segment = randomBytes(4097);
  const encoder = new RlncEncoder(segment, 8);
  const decoder = new RlncDecoder({
    k: encoder.k,
    blockSize: encoder.blockSize,
    originalSize: encoder.originalSize
  });

  for (let i = 0; i < encoder.k; i += 1) {
    const coeffs = Buffer.alloc(encoder.k);
    coeffs[i] = 1;
    assert.equal(decoder.add(encoder.generate(coeffs)), true);
  }

  assert.equal(decoder.complete, true);
  assert.deepEqual(decoder.decode(), segment);
});

test("RLNC rejects dependent packets without increasing rank", () => {
  const segment = Buffer.from("hello world, this is a segment");
  const encoder = new RlncEncoder(segment, 4);
  const decoder = new RlncDecoder({
    k: encoder.k,
    blockSize: encoder.blockSize,
    originalSize: encoder.originalSize
  });

  const coeffs = Buffer.from([1, 0, 0, 0]);
  const packet = encoder.generate(coeffs);
  assert.equal(decoder.add(packet), true);
  assert.equal(decoder.add(new CodedPacket(packet.coeffs, packet.data)), false);
  assert.equal(decoder.rank, 1);
});

test("RLNC recodes partial rank into a useful coded packet", () => {
  const segment = randomBytes(2048);
  const encoder = new RlncEncoder(segment, 4);
  const partial = new RlncDecoder({
    k: encoder.k,
    blockSize: encoder.blockSize,
    originalSize: encoder.originalSize
  });
  const downstream = new RlncDecoder({
    k: encoder.k,
    blockSize: encoder.blockSize,
    originalSize: encoder.originalSize
  });

  const first = Buffer.from([1, 0, 0, 0]);
  const second = Buffer.from([0, 1, 0, 0]);
  assert.equal(partial.add(encoder.generate(first)), true);
  assert.equal(partial.add(encoder.generate(second)), true);

  const recoded = partial.recode(Buffer.from([1, 1]));
  assert.equal(downstream.add(recoded), true);
  assert.equal(downstream.rank, 1);
});
