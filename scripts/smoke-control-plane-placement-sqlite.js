import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CatalogStore } from "../services/control-plane/src/catalogStore.js";
import { createControlPlaneServer } from "../services/control-plane/src/catalogServer.js";
import { PlacementService } from "../services/control-plane/src/placement.js";
import { SQLitePlacementRegistry } from "../services/control-plane/src/sqlitePlacementRegistry.js";

const INTERNAL_TOKEN = "control-plane-sqlite-placement-token";
const CHANNEL_ID = "sqlite-restart-news";
const NODES = [
  { id: "origin-a", baseUrl: "https://origin-a.example.tv", ingestUrl: "http://origin-a:7001" },
  { id: "origin-b", baseUrl: "https://origin-b.example.tv", ingestUrl: "http://origin-b:7001" }
];

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function startControlPlane(placementDbPath) {
  const store = new CatalogStore([
    {
      id: CHANNEL_ID,
      name: "SQLite Restart News",
      group: "News",
      logo: "",
      tvgId: "sqlite-restart-news",
      sourceUrl: "https://source.example/sqlite-restart-news.m3u8"
    }
  ]);
  const registry = await SQLitePlacementRegistry.open(placementDbPath);
  const placementService = new PlacementService({
    nodes: NODES,
    perNodeCap: 10,
    registry
  });
  const server = createControlPlaneServer({ store, placementService, internalToken: INTERNAL_TOKEN });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    registry,
    server,
    base: `http://127.0.0.1:${server.address().port}`
  };
}

async function requestJson(base, pathName, options = {}) {
  const response = await fetch(`${base}${pathName}`, {
    ...options,
    headers: {
      "x-internal-token": INTERNAL_TOKEN,
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function metricValue(base, name) {
  const response = await fetch(`${base}/metrics`);
  if (!response.ok) throw new Error(`metrics failed: ${response.status}`);
  const text = await response.text();
  const match = text.match(new RegExp(`^${name} ([0-9.]+)$`, "m"));
  if (!match) throw new Error(`missing metric ${name}`);
  return Number.parseFloat(match[1]);
}

const tempDir = mkdtempSync(path.join(tmpdir(), "swarmcast-control-placement-sqlite-"));
const placementDbPath = path.join(tempDir, "placements.sqlite");
let running = null;

try {
  running = await startControlPlane(placementDbPath);

  const assigned = await requestJson(running.base, `/internal/channels/${CHANNEL_ID}/assign`, { method: "POST" });
  if (assigned.response.status !== 200) throw new Error(`assignment failed: ${assigned.response.status}`);
  const assignedNodeId = assigned.body.node.id;
  if (await metricValue(running.base, "swarmcast_control_channel_placements") !== 1) {
    throw new Error("expected one placement before restart");
  }

  await closeServer(running.server);
  running.registry.close();
  running = await startControlPlane(placementDbPath);

  const restored = await requestJson(running.base, `/internal/channels/${CHANNEL_ID}/placement`);
  if (restored.response.status !== 200) throw new Error(`restored placement lookup failed: ${restored.response.status}`);
  if (restored.body.node.id !== assignedNodeId) {
    throw new Error(`expected restored node ${assignedNodeId}, got ${restored.body.node.id}`);
  }

  const released = await requestJson(running.base, `/internal/channels/${CHANNEL_ID}/placement`, { method: "DELETE" });
  if (released.response.status !== 200) throw new Error(`release failed: ${released.response.status}`);
  await closeServer(running.server);
  running.registry.close();
  running = await startControlPlane(placementDbPath);

  const missing = await requestJson(running.base, `/internal/channels/${CHANNEL_ID}/placement`);
  if (missing.response.status !== 404) throw new Error(`expected released placement to stay deleted, got ${missing.response.status}`);
  if (await metricValue(running.base, "swarmcast_control_channel_placements") !== 0) {
    throw new Error("expected zero placements after persisted release");
  }

  console.log(`control-plane SQLite placement restart smoke OK: channel=${CHANNEL_ID} restoredNode=${assignedNodeId} releasePersisted=true`);
} finally {
  if (running?.server?.listening) await closeServer(running.server);
  running?.registry?.close();
  rmSync(tempDir, { recursive: true, force: true });
}
