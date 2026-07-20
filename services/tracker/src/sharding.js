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

export function rankTrackerCells({ channelId, assignmentKey, shards = [], region = "" }) {
  const normalizedRegion = String(region || "").trim().toLowerCase();
  const regional = normalizedRegion
    ? shards.filter((shard) => String(shard.region || "").toLowerCase() === normalizedRegion)
    : [];
  const candidates = regional.length > 0 ? regional : shards;
  return candidates
    .map((shard) => ({
      shard,
      cellId: shard.id,
      score: createHash("sha256")
        .update(`${channelId}:${assignmentKey}:${shard.id}`)
        .digest()
        .readUInt32BE(0)
    }))
    .sort((a, b) => b.score - a.score || a.shard.id.localeCompare(b.shard.id));
}

export function selectTrackerCell({ channelId, assignmentKey, shards = [], region = "" }) {
  if (!shards.length) return { shard: null, cellId: "default" };
  const selected = rankTrackerCells({ channelId, assignmentKey, shards, region })[0];
  return { shard: selected.shard, cellId: selected.cellId };
}

export function routeTrackerJoin({ channelId, assignmentKey = "", region = "", shards = [], selfShardId = "" }) {
  const cellRoute = assignmentKey
    ? selectTrackerCell({ channelId, assignmentKey, shards, region })
    : { shard: selectTrackerShard(channelId, shards), cellId: shards.length ? null : "default" };
  const target = cellRoute.shard;
  if (!target) return { local: true, target: null, redirect: null };
  const local = target.id === selfShardId;
  return {
    local,
    target,
    redirect: local ? null : target,
    ...(cellRoute.cellId ? { cellId: cellRoute.cellId } : {})
  };
}
