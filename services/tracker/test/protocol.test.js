import test from "node:test";
import assert from "node:assert/strict";
import { parseMessage } from "../src/protocol.js";

test("parseMessage accepts valid JSON messages", () => {
  assert.deepEqual(parseMessage(Buffer.from('{"t":"ping"}')), { t: "ping" });
});

test("parseMessage rejects invalid and oversized messages", () => {
  assert.equal(parseMessage(Buffer.from("not json")), null);
  assert.equal(parseMessage(Buffer.alloc(20 * 1024, "a")), null);
});
