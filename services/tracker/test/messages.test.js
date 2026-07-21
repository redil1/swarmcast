import test from "node:test";
import assert from "node:assert/strict";
import {
  canAcceptTrackerConnection,
  createTrackerSender,
  createPeer,
  createTrackerState,
  handlePeerMessage,
  reapIdleTrackerPeers,
  removePeerFromState,
  sendDemandHeartbeats
} from "../src/index.js";
import { rankTrackerCells, selectTrackerCell } from "../src/sharding.js";
import { Swarm } from "../src/swarm.js";

function fakeWs(peer = null) {
  const sent = [];
  const ended = [];
  return {
    sent,
    ended,
    send: (msg) => sent.push(JSON.parse(msg)),
    end: (code, reason) => ended.push({ code, reason }),
    getUserData: peer ? () => peer : undefined
  };
}

test("join stores peer in swarm and sends joined response", async () => {
  const state = createTrackerState();
  const peer = createPeer();
  const ws = fakeWs();
  const fetches = [];

  await handlePeerMessage({
    state,
    peer,
    ws,
    raw: Buffer.from(JSON.stringify({
      t: "join",
      channelId: "demo",
      caps: { transport: "wifi", upload: true, uplinkKbps: 20_000 }
    })),
    fetchFn: async (url, options) => {
      fetches.push({ url, options });
      return { ok: true };
    }
  });

  assert.equal(peer.channelId, "demo");
  assert.equal(peer.superPeer, true);
  assert.equal(state.swarms.get("demo").size, 1);
  assert.equal(ws.sent[0].t, "joined");
  assert.equal(ws.sent[0].swarmMode, "edge-only");
  assert.equal(fetches.length, 1);
});

test("tracker subscribes on first local join and unsubscribes after the last peer leaves", async () => {
  const state = createTrackerState();
  const subscribed = [];
  const unsubscribed = [];
  state.segmentSubscriber = {
    subscribeChannel: async (channelId) => subscribed.push(channelId),
    unsubscribeChannel: (channelId) => unsubscribed.push(channelId)
  };
  const peer = createPeer();
  const ws = fakeWs(peer);
  await handlePeerMessage({
    state,
    peer,
    ws,
    raw: Buffer.from(JSON.stringify({ t: "join", channelId: "demo", caps: {} })),
    fetchFn: async () => ({ ok: true })
  });
  assert.deepEqual(subscribed, ["demo"]);
  assert.equal(ws.sent[0].t, "joined");

  removePeerFromState(state, peer);
  assert.deepEqual(unsubscribed, ["demo"]);
  assert.equal(state.channelSwarms.has("demo"), false);
});

test("tracker fails a first join closed when durable metadata subscription fails", async () => {
  const state = createTrackerState();
  state.segmentSubscriber = {
    subscribeChannel: async () => { throw new Error("broker unavailable"); },
    unsubscribeChannel: () => {}
  };
  const peer = createPeer();
  const ws = fakeWs(peer);
  await handlePeerMessage({
    state,
    peer,
    ws,
    raw: Buffer.from(JSON.stringify({ t: "join", channelId: "demo", caps: {} })),
    fetchFn: async () => ({ ok: true })
  });
  assert.equal(ws.sent[0].code, "tracker_unavailable");
  assert.equal(peer.channelId, null);
  assert.equal(state.swarms.size, 0);
});

test("join redirects to owning tracker shard before creating swarm state", async () => {
  const state = createTrackerState();
  const peer = createPeer();
  const ws = fakeWs();
  const shards = [
    { id: "tracker-a", wsUrl: "wss://tracker-a.example.tv/ws" },
    { id: "tracker-b", wsUrl: "wss://tracker-b.example.tv/ws" }
  ];
  const channelId = "sharded-demo";
  const assignmentKey = "viewer-sharded-demo";
  const { shard: target, cellId } = selectTrackerCell({ channelId, assignmentKey, shards });
  const wrongShard = shards.find((shard) => shard.id !== target.id);

  await handlePeerMessage({
    state,
    peer,
    ws,
    trackerShardConfig: {
      selfShardId: wrongShard.id,
      shards
    },
    raw: Buffer.from(JSON.stringify({
      t: "join",
      channelId,
      assignmentKey,
      caps: { transport: "wifi", upload: true, uplinkKbps: 20_000 }
    })),
    fetchFn: async () => {
      throw new Error("redirected joins must not reach placement or demand");
    }
  });

  assert.equal(peer.channelId, null);
  assert.equal(state.swarms.size, 0);
  assert.deepEqual(ws.sent, [{
    t: "redirect",
    channelId,
    cellId,
    shardId: target.id,
    trackerUrl: target.wsUrl
  }]);
  assert.deepEqual(ws.ended, [{ code: 1012, reason: "tracker shard redirect" }]);
});

test("cell capacity rejects joins before a cell exceeds its configured ceiling", async () => {
  const state = createTrackerState();
  const existing = createPeer();
  existing.id = "existing";
  existing.channelId = "demo";
  existing.cellId = "default";
  const swarm = new Swarm("demo");
  swarm.addPeer(existing);
  state.swarms.set("demo", swarm);

  const peer = createPeer();
  const ws = fakeWs(peer);
  await handlePeerMessage({
    state,
    peer,
    ws,
    cellMaxPeers: 1,
    raw: Buffer.from(JSON.stringify({ t: "join", channelId: "demo", caps: {} })),
    fetchFn: async () => ({ ok: true })
  });

  assert.equal(ws.sent.at(-1).code, "capacity");
  assert.equal(swarm.size, 1);
  assert.equal(peer.channelId, null);
});

test("full tracker cells issue an authenticated redirect to the next ranked cell", async () => {
  const shards = [
    { id: "tracker-a", wsUrl: "wss://tracker-a.example.tv/ws" },
    { id: "tracker-b", wsUrl: "wss://tracker-b.example.tv/ws" },
    { id: "tracker-c", wsUrl: "wss://tracker-c.example.tv/ws" }
  ];
  const channelId = "mega-event";
  const assignmentKey = "overflow-viewer";
  const ranked = rankTrackerCells({ channelId, assignmentKey, shards });
  const primary = ranked[0].shard;
  const secondary = ranked[1].shard;
  const state = createTrackerState();
  const existing = { ...createPeer(), id: "existing", channelId, cellId: primary.id };
  const fullSwarm = new Swarm(channelId, primary.id);
  fullSwarm.addPeer(existing);
  state.swarms.set(`${channelId}::${primary.id}`, fullSwarm);

  const peer = createPeer();
  const ws = fakeWs(peer);
  await handlePeerMessage({
    state,
    peer,
    ws,
    internalToken: "route-secret",
    trackerShardConfig: { selfShardId: primary.id, shards },
    cellMaxPeers: 1,
    raw: Buffer.from(JSON.stringify({ t: "join", channelId, assignmentKey, caps: {} })),
    fetchFn: async () => ({ ok: true })
  });

  const redirect = ws.sent.at(-1);
  assert.equal(redirect.t, "redirect");
  assert.equal(redirect.cellId, secondary.id);
  assert.equal(typeof redirect.cellRouteToken, "string");
  assert.deepEqual(ws.ended, [{ code: 1012, reason: "tracker cell spillover" }]);
  assert.equal(state.delivery.cellCapacitySpillovers, 1);
  assert.equal(state.delivery.cellCapacityRejections, 0);

  const secondaryState = createTrackerState();
  const redirectedPeer = createPeer();
  const redirectedWs = fakeWs(redirectedPeer);
  await handlePeerMessage({
    state: secondaryState,
    peer: redirectedPeer,
    ws: redirectedWs,
    internalToken: "route-secret",
    trackerShardConfig: { selfShardId: secondary.id, shards },
    cellMaxPeers: 1,
    raw: Buffer.from(JSON.stringify({
      t: "join",
      channelId,
      assignmentKey,
      cellRouteToken: redirect.cellRouteToken,
      caps: {}
    })),
    fetchFn: async () => ({ ok: true })
  });

  assert.equal(redirectedWs.sent[0].t, "joined");
  assert.equal(redirectedWs.sent[0].cellId, secondary.id);
  assert.equal(redirectedPeer.cellId, secondary.id);
});

test("join feature flags can force Delivery-Fleet-only mode", async () => {
  const state = createTrackerState();
  const existing = createPeer();
  existing.id = "existing";
  existing.channelId = "demo";
  const swarm = new Swarm("demo");
  swarm.addPeer(existing);
  state.swarms.set("demo", swarm);
  const peer = createPeer();
  const ws = fakeWs();

  await handlePeerMessage({
    state,
    peer,
    ws,
    policy: { minP2pPeers: 1, edgeOnlyMode: true, p2pEnabled: true },
    raw: Buffer.from(JSON.stringify({
      t: "join",
      channelId: "demo",
      caps: { transport: "wifi", upload: true, uplinkKbps: 20_000 }
    })),
    fetchFn: async () => ({ ok: true })
  });

  assert.equal(ws.sent[0].swarmMode, "edge-only");
  assert.equal(ws.sent.some((msg) => msg.t === "peers"), false);
});

test("join sends peer list when P2P mode is enabled by policy", async () => {
  const state = createTrackerState();
  const existing = createPeer();
  existing.id = "existing";
  existing.channelId = "demo";
  const swarm = new Swarm("demo");
  swarm.addPeer(existing);
  state.swarms.set("demo", swarm);
  const peer = createPeer();
  const ws = fakeWs();

  await handlePeerMessage({
    state,
    peer,
    ws,
    policy: { minP2pPeers: 1, edgeOnlyMode: false, p2pEnabled: true },
    raw: Buffer.from(JSON.stringify({
      t: "join",
      channelId: "demo",
      caps: { transport: "wifi", upload: true, uplinkKbps: 20_000 }
    })),
    fetchFn: async () => ({ ok: true })
  });

  assert.equal(ws.sent[0].swarmMode, "p2p");
  assert.equal(ws.sent[1].t, "peers");
  assert.equal(ws.sent[1].peers[0].id, "existing");
});

test("crossing the P2P threshold updates existing peers and refreshes topology", async () => {
  const state = createTrackerState();
  const existing = createPeer();
  existing.id = "existing";
  existing.channelId = "demo";
  const existingWs = fakeWs(existing);
  state.peersById.set(existing.id, existingWs);
  const swarm = new Swarm("demo");
  swarm.addPeer(existing);
  swarm.mode = "edge-only";
  state.swarms.set("demo", swarm);

  const joining = createPeer();
  await handlePeerMessage({
    state,
    peer: joining,
    ws: fakeWs(joining),
    policy: { minP2pPeers: 2, edgeOnlyMode: false, p2pEnabled: true },
    raw: Buffer.from(JSON.stringify({
      t: "join",
      channelId: "demo",
      caps: { transport: "wifi", upload: true, uplinkKbps: 20_000 }
    })),
    fetchFn: async () => ({ ok: true })
  });

  assert.deepEqual(existingWs.sent[0], { t: "swarm_mode", swarmMode: "p2p", swarmSize: 2 });
  assert.equal(existingWs.sent[1].t, "peers");
  assert.equal(existingWs.sent[1].peers[0].id, joining.id);
});

test("leaving the P2P threshold updates remaining peers to edge-only", () => {
  const state = createTrackerState();
  const staying = createPeer();
  staying.id = "staying";
  staying.channelId = "demo";
  const leaving = createPeer();
  leaving.id = "leaving";
  leaving.channelId = "demo";
  const stayingWs = fakeWs(staying);
  state.peersById.set(staying.id, stayingWs);
  state.peersById.set(leaving.id, fakeWs(leaving));
  const swarm = new Swarm("demo");
  swarm.addPeer(staying);
  swarm.addPeer(leaving);
  swarm.mode = "p2p";
  state.swarms.set("demo", swarm);

  removePeerFromState(state, leaving, {
    policy: { minP2pPeers: 2, edgeOnlyMode: false, p2pEnabled: true }
  });

  assert.deepEqual(stayingWs.sent, [{ t: "swarm_mode", swarmMode: "edge-only", swarmSize: 1 }]);
});

test("need_peers excludes active links when returning replacements", async () => {
  const state = createTrackerState();
  const requester = createPeer();
  requester.id = "requester";
  requester.channelId = "demo";
  const excluded = createPeer();
  excluded.id = "excluded";
  excluded.channelId = "demo";
  const replacement = createPeer();
  replacement.id = "replacement";
  replacement.channelId = "demo";
  const swarm = new Swarm("demo");
  [requester, excluded, replacement].forEach((peer) => swarm.addPeer(peer));
  swarm.mode = "p2p";
  state.swarms.set("demo", swarm);
  const ws = fakeWs(requester);

  await handlePeerMessage({
    state,
    peer: requester,
    ws,
    policy: { minP2pPeers: 2, edgeOnlyMode: false, p2pEnabled: true },
    raw: Buffer.from(JSON.stringify({ t: "need_peers", exclude: [excluded.id] }))
  });

  assert.deepEqual(ws.sent, [{
    t: "peers",
    peers: [{ id: replacement.id, transport: "cell", superPeer: false }]
  }]);
});

test("signal relays opaque payload to target peer", async () => {
  const state = createTrackerState();
  const fromPeer = createPeer();
  fromPeer.id = "from";
  fromPeer.channelId = "demo";
  const targetPeer = createPeer();
  targetPeer.id = "to";
  targetPeer.channelId = "demo";
  const targetWs = fakeWs(targetPeer);
  state.peersById.set("to", targetWs);

  await handlePeerMessage({
    state,
    peer: fromPeer,
    ws: fakeWs(),
    raw: Buffer.from(JSON.stringify({
      t: "signal",
      to: "to",
      data: { kind: "offer", sdp: "v=0" }
    }))
  });

  assert.deepEqual(targetWs.sent[0], {
    t: "signal",
    from: "from",
    data: { kind: "offer", sdp: "v=0" }
  });
});

test("signal relay rejects targets outside the sender swarm", async () => {
  const state = createTrackerState();
  const fromPeer = createPeer();
  fromPeer.id = "from";
  fromPeer.channelId = "demo";
  const targetPeer = createPeer();
  targetPeer.id = "to";
  targetPeer.channelId = "other";
  const targetWs = fakeWs(targetPeer);
  state.peersById.set(targetPeer.id, targetWs);

  await handlePeerMessage({
    state,
    peer: fromPeer,
    ws: fakeWs(fromPeer),
    raw: Buffer.from(JSON.stringify({
      t: "signal",
      to: targetPeer.id,
      data: { kind: "offer", sdp: "v=0" }
    }))
  });

  assert.deepEqual(targetWs.sent, []);
});

test("signal relay rejects targets in another cell of the same channel", async () => {
  const state = createTrackerState();
  const fromPeer = { ...createPeer(), id: "from", channelId: "demo", cellId: "cell-a" };
  const targetPeer = { ...createPeer(), id: "to", channelId: "demo", cellId: "cell-b" };
  const targetWs = fakeWs(targetPeer);
  state.peersById.set(targetPeer.id, targetWs);

  await handlePeerMessage({
    state,
    peer: fromPeer,
    ws: fakeWs(fromPeer),
    raw: Buffer.from(JSON.stringify({ t: "signal", to: targetPeer.id, data: { kind: "offer" } }))
  });

  assert.deepEqual(targetWs.sent, []);
});

test("bounded sender drops segment delivery before exceeding backpressure", () => {
  const state = createTrackerState();
  const peer = createPeer();
  let sends = 0;
  state.peersById.set(peer.id, {
    getBufferedAmount: () => 1000,
    send: () => { sends += 1; return 1; }
  });
  const send = createTrackerSender({ state, maxBackpressureBytes: 1024 });

  assert.equal(send(peer, { t: "segment" }, "x".repeat(30)), false);
  assert.equal(sends, 0);
  assert.equal(state.delivery.messagesDropped, 1);
  assert.equal(state.delivery.backpressureDrops, 1);
});

test("stats accumulates peer counters", async () => {
  const state = createTrackerState();
  const peer = createPeer();

  await handlePeerMessage({
    state,
    peer,
    ws: fakeWs(),
    raw: Buffer.from(JSON.stringify({
      t: "stats",
      dl_p2p: 100,
      dl_edge: 25,
      dl_bootstrap_origin: 10,
      dl_relay: 5,
      ul: 80,
      stalls: 1,
      peer_timeouts: 2,
      hash_failures: 1,
      peer_disconnects: 1,
      ice_attempts: 4,
      ice_successes: 3,
      ice_failures: 1,
      ice_candidate_host: 1,
      ice_candidate_srflx: 2,
      startup_ms: 1350,
      buffer_ms: 31000
    }))
  });

  assert.equal(peer.bytesDownP2p, 100);
  assert.equal(peer.bytesDownEdge, 25);
  assert.equal(peer.bytesDownBootstrapOrigin, 10);
  assert.equal(peer.bytesDownRelay, 5);
  assert.equal(peer.bytesUp, 80);
  assert.equal(peer.stalls, 1);
  assert.equal(peer.peerTimeouts, 2);
  assert.equal(peer.peerHashFailures, 1);
  assert.equal(peer.peerDisconnects, 1);
  assert.equal(peer.startupLatencyMsTotal, 1350);
  assert.equal(peer.startupLatencySamples, 1);
  assert.equal(peer.bufferMsLast, 31000);
});

test("rate limiter disconnects excessive peer messages", async () => {
  const state = createTrackerState();
  const peer = createPeer();
  const ws = fakeWs();
  const rateLimiter = { allow: () => false };

  await handlePeerMessage({
    state,
    peer,
    ws,
    rateLimiter,
    raw: Buffer.from(JSON.stringify({ t: "ping" }))
  });

  assert.deepEqual(ws.ended[0], { code: 1008, reason: "rate limit" });
});

test("connection limit rejects once max peer count is reached", () => {
  const state = createTrackerState();
  assert.equal(canAcceptTrackerConnection(state, 1), true);
  state.peersById.set("p1", {});
  assert.equal(canAcceptTrackerConnection(state, 1), false);
  assert.equal(canAcceptTrackerConnection(state, 2), true);
});

test("idle reaper closes and removes stale peers", () => {
  const state = createTrackerState();
  const peer = createPeer();
  peer.id = "idle-peer";
  peer.channelId = "demo";
  peer.lastSeenMs = 1000;
  const ended = [];
  const ws = {
    getUserData: () => peer,
    end: (code, reason) => ended.push({ code, reason })
  };
  state.peersById.set(peer.id, ws);
  state.swarms.set("demo", new (class {
    constructor() {
      this.peers = new Map([[peer.id, peer]]);
    }
    removePeer(peerId) {
      this.peers.delete(peerId);
    }
    get size() {
      return this.peers.size;
    }
  })());

  const closed = reapIdleTrackerPeers({
    state,
    nowMs: 12_000,
    idleTimeoutMs: 10_000
  });

  assert.equal(closed, 1);
  assert.deepEqual(ended, [{ code: 1001, reason: "idle timeout" }]);
  assert.equal(state.peersById.has(peer.id), false);
  assert.equal(state.swarms.has("demo"), false);
});

test("sendDemandHeartbeats refreshes non-empty swarms", async () => {
  const state = createTrackerState();
  const peer = createPeer();
  peer.id = "p1";
  const swarm = new (await import("../src/swarm.js")).Swarm("demo");
  swarm.addPeer(peer);
  state.swarms.set("demo", swarm);
  state.swarms.set("empty", new (await import("../src/swarm.js")).Swarm("empty"));

  const calls = [];
  const count = await sendDemandHeartbeats({
    state,
    ingestUrl: "http://ingest.local",
    internalToken: "secret",
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return { ok: true };
    }
  });

  assert.equal(count, 1);
  assert.equal(calls[0].url, "http://ingest.local/channels/demo/demand");
  assert.equal(calls[0].options.headers["x-internal-token"], "secret");
  assert.deepEqual(JSON.parse(calls[0].options.body), { swarmSize: 1 });
});

test("join uses control-plane placement for demand and media templates", async () => {
  const state = createTrackerState();
  const peer = createPeer();
  const ws = fakeWs();
  const calls = [];

  await handlePeerMessage({
    state,
    peer,
    ws,
    controlPlaneUrl: "http://control.local",
    raw: Buffer.from(JSON.stringify({
      t: "join",
      channelId: "demo",
      caps: { transport: "wifi", upload: true, uplinkKbps: 20_000 }
    })),
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("/assign")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            channelId: "demo",
            node: { id: "n1", baseUrl: "https://n1.origin.example.tv", ingestUrl: "http://n1:7001" }
          })
        };
      }
      return { ok: true, status: 200 };
    }
  });

  assert.equal(calls[0].url, "http://control.local/internal/channels/demo/assign");
  assert.equal(calls[1].url, "http://n1:7001/channels/demo/demand");
  assert.deepEqual(JSON.parse(calls[1].options.body), { swarmSize: 1 });
  assert.equal(state.swarms.get("demo").demandUrl, "http://n1:7001");
  assert.equal(ws.sent[0].playlistUrl, "https://edge.example.tv/edge/n1/live/demo/playlist.m3u8");
  assert.equal(ws.sent[0].originUrlTemplate, "https://n1.origin.example.tv/live/demo/{file}");
});
