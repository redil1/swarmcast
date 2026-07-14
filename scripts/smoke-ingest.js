import { once } from "node:events";
import { createIngestServer } from "../services/ingest/src/index.js";

const internalToken = "local-smoke-token";
const catalog = new Map([
  ["demo", {
    id: "demo",
    name: "Demo Channel",
    logo: "https://example.com/logo.png",
    group: "Demo",
    tvgId: "demo",
    sourceUrl: "https://source.example/live/demo.m3u8"
  }]
]);

const manager = {
  demand(channelId) {
    return channelId === "demo" ? { ok: true, state: "starting" } : { ok: false, error: "unknown_channel" };
  },
  status(channelId) {
    return channelId === "demo" ? { state: "idle" } : { state: "idle" };
  }
};

const { server } = createIngestServer({
  cfg: { internalToken },
  catalog,
  manager
});

server.listen(0, "127.0.0.1");
await once(server, "listening");

const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function request(path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      "x-internal-token": internalToken,
      ...(options.headers || {})
    }
  });
}

try {
  const unauthorized = await fetch(`${base}/channels`);
  if (unauthorized.status !== 401) throw new Error(`expected 401, got ${unauthorized.status}`);

  const channelsResponse = await request("/channels");
  if (!channelsResponse.ok) throw new Error(`channels failed: ${channelsResponse.status}`);
  const channels = await channelsResponse.json();
  if (channels.length !== 1 || channels[0].sourceUrl) throw new Error("public catalog leaked sourceUrl or had wrong size");

  const demandResponse = await request("/channels/demo/demand", { method: "POST" });
  const demand = await demandResponse.json();
  if (!demand.ok || demand.state !== "starting") throw new Error("demand endpoint failed");

  console.log("Ingest smoke OK");
} finally {
  server.close();
}
