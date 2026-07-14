import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PlacementRegistry, PlacementService, publicPlacement } from "../src/placement.js";
import { SQLitePlacementRegistry } from "../src/sqlitePlacementRegistry.js";

test("PlacementService assigns, reuses, and releases placements", () => {
  const service = new PlacementService({
    nodes: [{ id: "n1", baseUrl: "https://n1.origin.example.tv" }],
    perNodeCap: 1
  });

  const first = service.assign("channel-a");
  assert.equal(first.node.id, "n1");
  assert.equal(service.assign("channel-a").node.id, "n1");
  assert.equal(service.assign("channel-b"), null);

  service.release("channel-a");
  assert.equal(service.assign("channel-b").node.id, "n1");
});

test("PlacementRegistry persists placement snapshots", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-placement-"));
  const filePath = path.join(dir, "placements.json");

  const first = new PlacementRegistry({ filePath });
  first.set("channel-a", "n1");

  const second = new PlacementRegistry({ filePath });
  assert.equal(second.get("channel-a"), "n1");
});

test("SQLitePlacementRegistry persists and deletes placements", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-placement-sqlite-"));
  const filePath = path.join(dir, "placements.sqlite");
  try {
    const first = await SQLitePlacementRegistry.open(filePath);
    first.set("channel-a", "n1");
    first.set("channel-b", "n2");
    first.close();

    const second = await SQLitePlacementRegistry.open(filePath);
    assert.equal(second.get("channel-a"), "n1");
    assert.equal(second.entries().length, 2);
    assert.equal(second.delete("channel-a"), true);
    second.close();

    const third = await SQLitePlacementRegistry.open(filePath);
    assert.equal(third.get("channel-a"), null);
    assert.equal(third.get("channel-b"), "n2");
    assert.deepEqual(
      third.database.prepare("PRAGMA table_info(channel_placements)").all().map((column) => column.name),
      ["channel_id", "node_id", "updated_at"]
    );
    third.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("publicPlacement strips scheduler internals", () => {
  assert.deepEqual(publicPlacement({
    channelId: "channel-a",
    node: { id: "n1", baseUrl: "https://n1.origin.example.tv", ingestUrl: "http://n1:7001", load: 10 }
  }), {
    channelId: "channel-a",
    node: { id: "n1", baseUrl: "https://n1.origin.example.tv", ingestUrl: "http://n1:7001" }
  });
});
