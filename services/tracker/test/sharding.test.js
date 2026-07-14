import test from "node:test";
import assert from "node:assert/strict";
import { rankTrackerShards, routeTrackerJoin, selectTrackerShard } from "../src/sharding.js";

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
