import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const CELL_ROUTE_TOKEN_VERSION = 1;
const CELL_ROUTE_TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_CELL_ROUTE_HISTORY = 64;

function normalizedCellIds(values = [], shards = []) {
  const allowed = new Set(shards.map((shard) => shard.id));
  return [...new Set(values.map(String).filter((id) => allowed.has(id)))].slice(0, MAX_CELL_ROUTE_HISTORY);
}

function signCellRoutePayload(encodedPayload, secret) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

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

export function selectOriginBootstrapCell(channelId, shards = []) {
  return selectTrackerShard(String(channelId), shards)?.id || "default";
}

export function rankTrackerCells({ channelId, assignmentKey, shards = [], region = "" }) {
  const normalizedRegion = String(region || "").trim().toLowerCase();
  const hasRegionalCandidate = normalizedRegion && shards.some(
    (shard) => String(shard.region || "").toLowerCase() === normalizedRegion
  );
  return shards
    .map((shard) => ({
      shard,
      cellId: shard.id,
      localityRank: hasRegionalCandidate && String(shard.region || "").toLowerCase() !== normalizedRegion ? 1 : 0,
      score: createHash("sha256")
        .update(`${channelId}:${assignmentKey}:${shard.id}`)
        .digest()
        .readUInt32BE(0)
    }))
    .sort((a, b) => a.localityRank - b.localityRank || b.score - a.score || a.shard.id.localeCompare(b.shard.id));
}

export function selectTrackerCell({ channelId, assignmentKey, shards = [], region = "" }) {
  if (!shards.length) return { shard: null, cellId: "default" };
  const selected = rankTrackerCells({ channelId, assignmentKey, shards, region })[0];
  return { shard: selected.shard, cellId: selected.cellId };
}

export function selectTrackerSpillover({ channelId, assignmentKey, region = "", shards = [], excludedCellIds = [] }) {
  const excluded = new Set(normalizedCellIds(excludedCellIds, shards));
  const selected = rankTrackerCells({ channelId, assignmentKey, shards, region })
    .find(({ cellId }) => !excluded.has(cellId));
  return selected ? { shard: selected.shard, cellId: selected.cellId } : null;
}

export function createTrackerCellRouteToken({
  channelId,
  assignmentKey,
  cellId,
  excludedCellIds = [],
  shards = [],
  secret,
  nowMs = Date.now(),
  ttlMs = CELL_ROUTE_TOKEN_TTL_MS
}) {
  if (!secret) throw new Error("tracker cell route token secret is required");
  if (!shards.some((shard) => shard.id === cellId)) throw new Error("tracker cell route target is invalid");
  const excluded = normalizedCellIds(excludedCellIds, shards).filter((id) => id !== cellId);
  const payload = Buffer.from(JSON.stringify({
    v: CELL_ROUTE_TOKEN_VERSION,
    channelId: String(channelId),
    assignmentKey: String(assignmentKey),
    cellId: String(cellId),
    excludedCellIds: excluded,
    expiresAt: Math.floor((nowMs + ttlMs) / 1000)
  })).toString("base64url");
  return `${payload}.${signCellRoutePayload(payload, secret)}`;
}

export function verifyTrackerCellRouteToken({
  token,
  channelId,
  assignmentKey,
  shards = [],
  secret,
  nowMs = Date.now()
}) {
  if (!token || !secret) return null;
  try {
    const [encodedPayload, suppliedSignature, extra] = String(token).split(".");
    if (!encodedPayload || !suppliedSignature || extra !== undefined) return null;
    const expectedSignature = signCellRoutePayload(encodedPayload, secret);
    const supplied = Buffer.from(suppliedSignature, "base64url");
    const expected = Buffer.from(expectedSignature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (payload.v !== CELL_ROUTE_TOKEN_VERSION) return null;
    if (payload.channelId !== String(channelId) || payload.assignmentKey !== String(assignmentKey)) return null;
    if (!Number.isInteger(payload.expiresAt) || payload.expiresAt <= Math.floor(nowMs / 1000)) return null;
    if (!shards.some((shard) => shard.id === payload.cellId)) return null;
    if (!Array.isArray(payload.excludedCellIds) || payload.excludedCellIds.length > MAX_CELL_ROUTE_HISTORY) return null;
    const excludedCellIds = normalizedCellIds(payload.excludedCellIds, shards);
    if (excludedCellIds.length !== payload.excludedCellIds.length || excludedCellIds.includes(payload.cellId)) return null;
    return { cellId: payload.cellId, excludedCellIds };
  } catch {
    return null;
  }
}

export function routeTrackerJoin({
  channelId,
  assignmentKey = "",
  region = "",
  shards = [],
  selfShardId = "",
  cellRouteToken = "",
  routeTokenSecret = "",
  nowMs = Date.now()
}) {
  const authorizedRoute = assignmentKey ? verifyTrackerCellRouteToken({
    token: cellRouteToken,
    channelId,
    assignmentKey,
    shards,
    secret: routeTokenSecret,
    nowMs
  }) : null;
  const authorizedShard = authorizedRoute
    ? shards.find((shard) => shard.id === authorizedRoute.cellId)
    : null;
  const cellRoute = authorizedShard
    ? { shard: authorizedShard, cellId: authorizedRoute.cellId }
    : assignmentKey
      ? selectTrackerCell({ channelId, assignmentKey, shards, region })
      : { shard: selectTrackerShard(channelId, shards), cellId: shards.length ? null : "default" };
  const target = cellRoute.shard;
  if (!target) return { local: true, target: null, redirect: null };
  const local = target.id === selfShardId;
  return {
    local,
    target,
    redirect: local ? null : target,
    ...(cellRoute.cellId ? { cellId: cellRoute.cellId } : {}),
    ...(authorizedRoute ? { excludedCellIds: authorizedRoute.excludedCellIds } : {})
  };
}
