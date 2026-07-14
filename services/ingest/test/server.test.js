import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createIngestServer } from "../src/index.js";

async function withServer(fn) {
  const catalog = new Map([
    ["demo", {
      id: "demo",
      name: "Demo",
      logo: "",
      group: "Test",
      tvgId: "",
      sourceUrl: "https://secret.example/demo.m3u8"
    }]
  ]);
  const manager = {
    active: new Map(),
    demand: (channelId) => ({ ok: channelId === "demo", state: "starting" }),
    status: () => ({ state: "idle" })
  };
  const { server } = createIngestServer({
    cfg: { internalToken: "test-token" },
    catalog,
    manager
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test("ingest server protects internal routes and strips source URLs", async () => {
  await withServer(async (base) => {
    const denied = await fetch(`${base}/channels`);
    assert.equal(denied.status, 401);

    const allowed = await fetch(`${base}/channels`, {
      headers: { "x-internal-token": "test-token" }
    });
    assert.equal(allowed.status, 200);
    const channels = await allowed.json();
    assert.equal(channels.length, 1);
    assert.equal("sourceUrl" in channels[0], false);
  });
});

test("ingest server forwards channel demand to manager", async () => {
  let captured = null;
  const catalog = new Map([
    ["demo", {
      id: "demo",
      name: "Demo",
      logo: "",
      group: "Test",
      tvgId: "",
      sourceUrl: "https://secret.example/demo.m3u8"
    }]
  ]);
  const manager = {
    active: new Map(),
    demand: (channelId, options) => {
      captured = { channelId, options };
      return { ok: true, state: "starting" };
    },
    status: () => ({ state: "idle" })
  };
  const { server } = createIngestServer({
    cfg: { internalToken: "test-token" },
    catalog,
    manager
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/channels/demo/demand`, {
      method: "POST",
      headers: { "x-internal-token": "test-token", "content-type": "application/json" },
      body: JSON.stringify({ swarmSize: 7 })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, state: "starting" });
    assert.deepEqual(captured, { channelId: "demo", options: { swarmSize: 7 } });
  } finally {
    server.close();
  }
});

test("ingest server exposes prometheus metrics", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/metrics`, {
      headers: { "x-internal-token": "test-token" }
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /swarmcast_ingest_active_channels/);
  });
});
