import test from "node:test";
import assert from "node:assert/strict";
import {
  createTrackerCellRouteToken,
  rankTrackerCells,
  rankTrackerShards,
  routeTrackerJoin,
  selectTrackerCell,
  selectTrackerSpillover,
  selectTrackerShard
} from "../src/sharding.js";

const shards = Object.freeze([
  { id: "tracker-a", wsUrl: "wss://tracker-a.example.tv/ws" },
  { id: "tracker-b", wsUrl: "wss://tracker-b.example.tv/ws" },
  { id: "tracker-c", wsUrl: "wss://tracker-c.example.tv/ws" }
]);

test("selectTrackerShard is deterministic and independent of shard order", () => {
  const channelId = "sports-main";
  const selected = selectTrackerShard(channelId, shards);
  const reversed = selectTrackerShard(channelId, [...shards].reverse());
  const ranked = rankTrackerShards(channelId, shards);

  assert.equal(selected.id, reversed.id);
  assert.equal(ranked[0].shard.id, selected.id);
  assert.deepEqual(new Set(ranked.map((entry) => entry.shard.id)), new Set(shards.map((shard) => shard.id)));
});

test("routeTrackerJoin redirects joins away from non-owning shards", () => {
  const channelId = "movie-night";
  const target = selectTrackerShard(channelId, shards);
  const wrongShard = shards.find((shard) => shard.id !== target.id);

  assert.deepEqual(routeTrackerJoin({
    channelId,
    shards,
    selfShardId: target.id
  }), {
    local: true,
    target,
    redirect: null
  });

  const wrongRoute = routeTrackerJoin({
    channelId,
    shards,
    selfShardId: wrongShard.id
  });
  assert.equal(wrongRoute.local, false);
  assert.deepEqual(wrongRoute.target, target);
  assert.deepEqual(wrongRoute.redirect, target);
});

test("cell assignment is stable and spreads one channel across tracker shards", () => {
  const channelId = "mega-event";
  const assignments = Array.from({ length: 600 }, (_, index) => selectTrackerCell({
    channelId,
    assignmentKey: `viewer-${index}`,
    shards
  }));
  const counts = new Map(shards.map((shard) => [shard.id, 0]));
  for (const assignment of assignments) counts.set(assignment.shard.id, counts.get(assignment.shard.id) + 1);

  assert.deepEqual(
    selectTrackerCell({ channelId, assignmentKey: "viewer-42", shards }),
    selectTrackerCell({ channelId, assignmentKey: "viewer-42", shards: [...shards].reverse() })
  );
  assert.equal([...counts.values()].every((count) => count > 150 && count < 250), true);
});

test("adding a tracker cell has bounded rendezvous movement", () => {
  const expanded = [...shards, { id: "tracker-d", wsUrl: "wss://tracker-d.example.tv/ws" }];
  let moved = 0;
  for (let index = 0; index < 2000; index += 1) {
    const assignmentKey = `viewer-${index}`;
    const before = selectTrackerCell({ channelId: "final", assignmentKey, shards }).shard.id;
    const after = selectTrackerCell({ channelId: "final", assignmentKey, shards: expanded }).shard.id;
    if (before !== after) moved += 1;
  }
  assert.ok(moved > 350 && moved < 650, `unexpected movement: ${moved}`);
});

test("cell ranking prefers matching regions before cross-region spillover", () => {
  const regionalShards = [
    { id: "eu-a", region: "eu", wsUrl: "wss://eu-a.example.tv/ws" },
    { id: "eu-b", region: "eu", wsUrl: "wss://eu-b.example.tv/ws" },
    { id: "us-a", region: "us", wsUrl: "wss://us-a.example.tv/ws" }
  ];
  const ranked = rankTrackerCells({
    channelId: "news",
    assignmentKey: "viewer",
    region: "eu",
    shards: regionalShards
  });
  assert.deepEqual(ranked.slice(0, 2).map((entry) => entry.shard.region), ["eu", "eu"]);
  assert.equal(ranked[2].shard.region, "us");
});

test("cell spillover follows rendezvous order and excludes attempted cells", () => {
  const ranked = rankTrackerCells({ channelId: "final", assignmentKey: "viewer", shards });
  const spillover = selectTrackerSpillover({
    channelId: "final",
    assignmentKey: "viewer",
    shards,
    excludedCellIds: [ranked[0].cellId]
  });
  assert.equal(spillover.cellId, ranked[1].cellId);
  assert.equal(selectTrackerSpillover({
    channelId: "final",
    assignmentKey: "viewer",
    shards,
    excludedCellIds: ranked.map((entry) => entry.cellId)
  }), null);
});

test("signed spillover routes are scoped, expiring, and accepted only by their target", () => {
  const nowMs = 1_800_000_000_000;
  const ranked = rankTrackerCells({ channelId: "final", assignmentKey: "viewer", shards });
  const target = ranked[1];
  const token = createTrackerCellRouteToken({
    channelId: "final",
    assignmentKey: "viewer",
    cellId: target.cellId,
    excludedCellIds: [ranked[0].cellId],
    shards,
    secret: "route-secret",
    nowMs,
    ttlMs: 60_000
  });
  const route = routeTrackerJoin({
    channelId: "final",
    assignmentKey: "viewer",
    shards,
    selfShardId: target.cellId,
    cellRouteToken: token,
    routeTokenSecret: "route-secret",
    nowMs
  });
  assert.equal(route.local, true);
  assert.equal(route.cellId, target.cellId);
  assert.deepEqual(route.excludedCellIds, [ranked[0].cellId]);

  const wrongViewer = routeTrackerJoin({
    channelId: "final",
    assignmentKey: "another-viewer",
    shards,
    selfShardId: target.cellId,
    cellRouteToken: token,
    routeTokenSecret: "route-secret",
    nowMs
  });
  assert.equal(wrongViewer.cellId, selectTrackerCell({
    channelId: "final",
    assignmentKey: "another-viewer",
    shards
  }).cellId);

  const expired = routeTrackerJoin({
    channelId: "final",
    assignmentKey: "viewer",
    shards,
    selfShardId: target.cellId,
    cellRouteToken: token,
    routeTokenSecret: "route-secret",
    nowMs: nowMs + 60_000
  });
  assert.equal(expired.cellId, ranked[0].cellId);

  const tampered = routeTrackerJoin({
    channelId: "final",
    assignmentKey: "viewer",
    shards,
    selfShardId: target.cellId,
    cellRouteToken: `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`,
    routeTokenSecret: "route-secret",
    nowMs
  });
  assert.equal(tampered.cellId, ranked[0].cellId);
});
