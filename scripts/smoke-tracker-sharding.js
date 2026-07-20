import assert from "node:assert/strict";
import { loadTrackerConfig } from "../packages/config/src/env.js";
import { createPeer, createTrackerState, handlePeerMessage } from "../services/tracker/src/index.js";
import { selectTrackerCell } from "../services/tracker/src/sharding.js";

const shards = [
  { id: "tracker-a", wsUrl: "wss://tracker-a.example.tv/ws" },
  { id: "tracker-b", wsUrl: "wss://tracker-b.example.tv/ws" }
];
const channelId = "sharded-demo";
const assignmentKey = "sharding-smoke-viewer";
const { shard: target, cellId } = selectTrackerCell({ channelId, assignmentKey, shards });
const wrongShard = shards.find((shard) => shard.id !== target.id);
const config = loadTrackerConfig({
  TRACKER_SHARD_ID: target.id,
  TRACKER_SHARDS: JSON.stringify(shards)
});

assert.equal(config.trackerShardId, target.id);
assert.deepEqual(config.trackerShards, shards);

function createWs() {
  return {
    sent: [],
    ended: [],
    send(message) {
      this.sent.push(JSON.parse(message));
    },
    end(code, reason) {
      this.ended.push({ code, reason });
    }
  };
}

async function joinOnShard({ state, selfShardId, fetchFn }) {
  const peer = createPeer({ sub: assignmentKey });
  const ws = createWs();
  await handlePeerMessage({
    state,
    peer,
    ws,
    trackerShardConfig: { selfShardId, shards },
    raw: Buffer.from(JSON.stringify({
      t: "join",
      channelId,
      assignmentKey,
      caps: { transport: "wifi", upload: true, uplinkKbps: 15_000 }
    })),
    fetchFn
  });
  return { peer, ws };
}

const wrongState = createTrackerState();
const wrongJoin = await joinOnShard({
  state: wrongState,
  selfShardId: wrongShard.id,
  fetchFn: async () => {
    throw new Error("wrong shard must redirect before demand");
  }
});

assert.equal(wrongJoin.peer.channelId, null);
assert.equal(wrongState.swarms.size, 0);
assert.deepEqual(wrongJoin.ws.sent, [{
  t: "redirect",
  channelId,
  cellId,
  shardId: target.id,
  trackerUrl: target.wsUrl
}]);
assert.deepEqual(wrongJoin.ws.ended, [{ code: 1012, reason: "tracker shard redirect" }]);

const ownerState = createTrackerState();
const demandCalls = [];
const ownerJoin = await joinOnShard({
  state: ownerState,
  selfShardId: target.id,
  fetchFn: async (url, options = {}) => {
    demandCalls.push({ url, body: JSON.parse(options.body || "{}") });
    return { ok: true, status: 200 };
  }
});

const joined = ownerJoin.ws.sent.find((message) => message.t === "joined");
assert.ok(joined, "owning shard did not accept join");
assert.equal(ownerJoin.peer.channelId, channelId);
assert.equal(ownerState.swarms.get(`${channelId}::${cellId}`).size, 1);
assert.equal(demandCalls.length, 1);
assert.equal(demandCalls[0].url, `http://ingest:7001/channels/${channelId}/demand`);
assert.deepEqual(demandCalls[0].body, { swarmSize: 1 });

console.log(`tracker sharding smoke OK: channel=${channelId} cell=${cellId} owner=${target.id} redirectFrom=${wrongShard.id} demandCalls=${demandCalls.length}`);
