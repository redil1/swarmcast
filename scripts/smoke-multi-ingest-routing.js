import { once } from "node:events";
import assert from "node:assert/strict";
import { CatalogStore } from "../services/control-plane/src/catalogStore.js";
import { createControlPlaneServer } from "../services/control-plane/src/catalogServer.js";
import { PlacementService } from "../services/control-plane/src/placement.js";
import { createPeer, createTrackerState, handlePeerMessage } from "../services/tracker/src/index.js";
import { parseTrackerPolicy } from "../services/tracker/src/policy.js";

const internalToken = "multi-ingest-routing-token";
const nodes = [
  { id: "origin-a", baseUrl: "https://origin-a.example.tv", ingestUrl: "http://origin-a.internal:7001" },
  { id: "origin-b", baseUrl: "https://origin-b.example.tv", ingestUrl: "http://origin-b.internal:7001" }
];

const placementService = new PlacementService({
  nodes,
  perNodeCap: 1
});
const controlPlane = createControlPlaneServer({
  store: new CatalogStore([]),
  placementService,
  internalToken
});

controlPlane.listen(0, "127.0.0.1");
await once(controlPlane, "listening");
const controlPlaneUrl = `http://127.0.0.1:${controlPlane.address().port}`;

const state = createTrackerState();
const demandCalls = [];

function createWs() {
  return {
    sent: [],
    send(message) {
      this.sent.push(JSON.parse(message));
    },
    end(code, reason) {
      this.ended = { code, reason };
    }
  };
}

async function routingFetch(url, options = {}) {
  if (url.startsWith(controlPlaneUrl)) return fetch(url, options);
  if (url.includes("/channels/") && url.endsWith("/demand")) {
    demandCalls.push({
      url,
      body: JSON.parse(options.body || "{}"),
      token: options.headers?.["x-internal-token"]
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${url}`);
}

async function joinChannel(channelId) {
  const peer = createPeer({ sub: `viewer-${channelId}` });
  const ws = createWs();
  await handlePeerMessage({
    state,
    peer,
    ws,
    raw: Buffer.from(JSON.stringify({
      t: "join",
      channelId,
      caps: { transport: "wifi", upload: true, uplinkKbps: 15_000 }
    })),
    fetchFn: routingFetch,
    controlPlaneUrl,
    internalToken,
    ingestUrl: "http://default-ingest.internal:7001",
    originBase: "https://origin.example.tv",
    edgeBase: "https://edge.example.tv",
    policy: parseTrackerPolicy({ P2P_MIN_SWARM_SIZE: "99" })
  });
  const joined = ws.sent.find((message) => message.t === "joined");
  assert.ok(joined, `missing joined message for ${channelId}`);
  return { peer, joined };
}

try {
  const first = await joinChannel("channel-a");
  const second = await joinChannel("channel-b");
  const firstNode = first.joined.playlistUrl.match(/\/edge\/([^/]+)\//)?.[1];
  const secondNode = second.joined.playlistUrl.match(/\/edge\/([^/]+)\//)?.[1];

  assert.ok(firstNode, "first channel missing edge node route");
  assert.ok(secondNode, "second channel missing edge node route");
  assert.notEqual(firstNode, secondNode, "two channels should be placed on different nodes with per-node cap 1");
  assert.equal(first.joined.edgeUrlTemplate, `https://edge.example.tv/edge/${firstNode}/live/channel-a/{file}`);
  assert.equal(second.joined.edgeUrlTemplate, `https://edge.example.tv/edge/${secondNode}/live/channel-b/{file}`);
  assert.equal(first.joined.originUrlTemplate, `${nodes.find((node) => node.id === firstNode).baseUrl}/live/channel-a/{file}`);
  assert.equal(second.joined.originUrlTemplate, `${nodes.find((node) => node.id === secondNode).baseUrl}/live/channel-b/{file}`);

  assert.equal(demandCalls.length, 2);
  assert.deepEqual(new Set(demandCalls.map((call) => new URL(call.url).host)), new Set([
    "origin-a.internal:7001",
    "origin-b.internal:7001"
  ]));
  assert.deepEqual(demandCalls.map((call) => call.body.swarmSize), [1, 1]);
  assert.ok(demandCalls.every((call) => call.token === internalToken));

  console.log(`multi-ingest routing smoke OK: ${firstNode}->channel-a ${secondNode}->channel-b demandCalls=${demandCalls.length}`);
} finally {
  controlPlane.close();
}
