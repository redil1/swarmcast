import test from "node:test";
import assert from "node:assert/strict";
import { add, div, mul, scale, scaleXorInto } from "../src/gf256.js";

test("GF256 add is xor", () => {
  assert.equal(add(0x53, 0xca), 0x99);
});

test("GF256 multiplication and division are inverse for non-zero values", () => {
  for (let a = 1; a < 256; a += 17) {
    for (let b = 1; b < 256; b += 19) {
      assert.equal(div(mul(a, b), b), a);
    }
  }
});

test("scale and scaleXorInto transform byte arrays", () => {
  const input = Buffer.from([1, 2, 3]);
  assert.deepEqual(scale(input, 1), input);
  assert.deepEqual(scale(input, 0), Buffer.from([0, 0, 0]));

  const target = Buffer.from([1, 1, 1]);
  scaleXorInto(target, input, 1);
  assert.deepEqual(target, Buffer.from([0, 3, 2]));
});
