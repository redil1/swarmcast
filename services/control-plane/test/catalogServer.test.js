import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { gunzipSync } from "node:zlib";
import { CatalogStore } from "../src/catalogStore.js";
import { createCatalogServer, createControlPlaneServer } from "../src/catalogServer.js";
import { PlacementService } from "../src/placement.js";

async function withCatalogServer(fn) {
  const store = new CatalogStore([
    { id: "1", name: "Alpha News", group: "News", logo: "", tvgId: "a", sourceUrl: "https://secret/a" },
    { id: "2", name: "Beta Sports", group: "Sports", logo: "", tvgId: "b", sourceUrl: "https://secret/b" }
  ]);
  const server = createCatalogServer({ store });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

function rawGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    request.on("error", reject);
  });
}

test("catalog server returns paginated channels and ETag", async () => {
  await withCatalogServer(async (base) => {
    const response = await fetch(`${base}/channels?pageSize=1`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.has("etag"), true);

    const body = await response.json();
    assert.equal(body.items.length, 1);
    assert.equal(body.hasMore, true);
    assert.equal("sourceUrl" in body.items[0], false);

    const cached = await fetch(`${base}/channels?pageSize=1`, {
      headers: { "if-none-match": response.headers.get("etag") }
    });
    assert.equal(cached.status, 304);
  });
});

test("catalog server returns groups and search results", async () => {
  await withCatalogServer(async (base) => {
    const groups = await fetch(`${base}/groups`);
    assert.deepEqual((await groups.json()).groups, ["News", "Sports"]);

    const sports = await fetch(`${base}/channels?q=sports`);
    const body = await sports.json();
    assert.equal(body.total, 1);
    assert.equal(body.items[0].name, "Beta Sports");
  });
});

test("catalog readiness reflects lifecycle state", async () => {
  let ready = false;
  const server = createCatalogServer({ store: new CatalogStore([]), isReady: () => ready });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    ready = true;
    assert.equal((await fetch(`${base}/ready`)).status, 200);
  } finally {
    server.close();
  }
});

test("catalog server gzips public catalog responses when requested", async () => {
  await withCatalogServer(async (base) => {
    const response = await rawGet(`${base}/channels?pageSize=2`, {
      "accept-encoding": "gzip"
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-encoding"], "gzip");
    assert.equal(response.headers.vary, "Accept-Encoding");
    const body = JSON.parse(gunzipSync(response.body).toString("utf8"));
    assert.equal(body.items.length, 2);
    assert.equal("sourceUrl" in body.items[0], false);

    const cached = await rawGet(`${base}/channels?pageSize=2`, {
      "accept-encoding": "gzip",
      "if-none-match": response.headers.etag
    });
    assert.equal(cached.statusCode, 304);
    assert.equal(cached.body.length, 0);
  });
});

test("control-plane placement routes require token and assign nodes", async () => {
  const store = new CatalogStore([]);
  const placementService = new PlacementService({
    nodes: [{ id: "n1", baseUrl: "https://n1.origin.example.tv", ingestUrl: "http://n1:7001" }],
    perNodeCap: 1
  });
  const server = createControlPlaneServer({ store, placementService, internalToken: "secret" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const denied = await fetch(`${base}/internal/channels/demo/assign`, { method: "POST" });
    assert.equal(denied.status, 401);

    const assigned = await fetch(`${base}/internal/channels/demo/assign`, {
      method: "POST",
      headers: { "x-internal-token": "secret" }
    });
    assert.equal(assigned.status, 200);
    assert.deepEqual(await assigned.json(), {
      channelId: "demo",
      node: { id: "n1", baseUrl: "https://n1.origin.example.tv", ingestUrl: "http://n1:7001" }
    });

    const placement = await fetch(`${base}/internal/channels/demo/placement`, {
      headers: { "x-internal-token": "secret" }
    });
    assert.equal(placement.status, 200);

    const released = await fetch(`${base}/internal/channels/demo/placement`, {
      method: "DELETE",
      headers: { "x-internal-token": "secret" }
    });
    assert.equal(released.status, 200);
  } finally {
    server.close();
  }
});

test("control-plane server exposes metrics", async () => {
  const store = new CatalogStore([
    { id: "1", name: "Alpha", group: "News", logo: "", tvgId: "", sourceUrl: "https://secret/a" }
  ]);
  const placementService = new PlacementService({
    nodes: [{ id: "n1", baseUrl: "https://n1.origin.example.tv" }]
  });
  const server = createControlPlaneServer({ store, placementService, internalToken: "secret" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/metrics`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /swarmcast_control_catalog_channels 1/);
  } finally {
    server.close();
  }
});
