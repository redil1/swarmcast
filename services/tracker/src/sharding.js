import { createHash } from "node:crypto";

export function rankTrackerShards(channelId, shards = []) {
  return shards
    .map((shard) => ({
      shard,
      score: createHash("sha1").update(`${channelId}:${shard.id}`).digest().readUInt32BE(0)
    }))
    .sort((a, b) => b.score - a.score || a.shard.id.localeCompare(b.shard.id));
}

export function selectTrackerShard(channelId, shards = []) {
  if (!shards.length) return null;
  return rankTrackerShards(String(channelId), shards)[0].shard;
}

export function routeTrackerJoin({ channelId, shards = [], selfShardId = "" }) {
  const target = selectTrackerShard(channelId, shards);
  if (!target) return { local: true, target: null, redirect: null };
  const local = target.id === selfShardId;
  return {
    local,
    target,
    redirect: local ? null : target
  };
}
