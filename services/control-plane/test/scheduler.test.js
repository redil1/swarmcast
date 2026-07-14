import test from "node:test";
import assert from "node:assert/strict";
import { IngestScheduler } from "../src/scheduler.js";

test("assign returns stable placement and respects capacity", () => {
  const scheduler = new IngestScheduler([
    { id: "n1", baseUrl: "https://n1.origin.example.tv" },
    { id: "n2", baseUrl: "https://n2.origin.example.tv" }
  ], 1);

  const first = scheduler.assign("channel-a");
  const again = scheduler.assign("channel-a");
  assert.equal(first.id, again.id);

  const second = scheduler.assign("channel-b");
  assert.notEqual(first.id, second.id);

  assert.equal(scheduler.assign("channel-c"), null);
});

test("release frees capacity", () => {
  const scheduler = new IngestScheduler([{ id: "n1", baseUrl: "https://n1.origin.example.tv" }], 1);
  assert.equal(scheduler.assign("a").id, "n1");
  assert.equal(scheduler.assign("b"), null);
  scheduler.release("a");
  assert.equal(scheduler.assign("b").id, "n1");
});
