import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthServer } from "../services/auth/src/index.js";
import { announceSegment } from "../services/ingest/src/segmentWatcher.js";
import { selectTrackerCell } from "../services/tracker/src/sharding.js";

const CHANNEL_ID = "single-channel-cells";
const INTERNAL_TOKEN = "tracker-cell-smoke-internal";
const APP_API_KEY = "tracker-cell-smoke-app-key";

if (![18, 20, 22, 23].includes(Number.parseInt(process.versions.node.split(".")[0], 10))) {
  console.log(`tracker cell WebSocket smoke SKIPPED: uWebSockets.js does not support Node ${process.versions.node}`);
  process.exit(0);
}

function listen(server, port = 0) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
}

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function waitForPort(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`port ${port} did not become ready`));
    });
  });
}

async function waitFor(fn, timeoutMs = 15_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("timed out");
}

async function tokenFromAuth(baseUrl) {
  const response = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "x-app-key": APP_API_KEY }
  });
  if (!response.ok) throw new Error(`token request failed: ${response.status}`);
  return (await response.json()).token;
}

function spawnTracker({ shard, shards, authPort, ingestPort }) {
  const child = spawn(process.execPath, ["services/tracker/src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      INTERNAL_TOKEN,
      AUTH_JWKS_URL: `http://127.0.0.1:${authPort}/jwks`,
      INGEST_URL: `http://127.0.0.1:${ingestPort}`,
      ORIGIN_BASE: "https://origin.example.tv",
      EDGE_BASE: "https://edge.example.tv",
      P2P_MIN_SWARM_SIZE: "1",
      TRACKER_PORT: String(shard.port),
      TRACKER_INTERNAL_PORT: String(shard.internalPort),
      TRACKER_SHARD_ID: shard.id,
      TRACKER_SHARDS: JSON.stringify(shards.map(({ id, wsUrl, internalUrl }) => ({ id, wsUrl, internalUrl }))),
      TRACKER_CELL_MAX_PEERS: "4",
      TRACKER_MAX_CONNECTIONS: "8",
      TRACKER_RATE_LIMIT_CAPACITY: "100",
      TRACKER_RATE_LIMIT_REFILL_PER_SECOND: "100"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let diagnostics = "";
  child.stdout.on("data", (chunk) => { diagnostics += chunk; });
  child.stderr.on("data", (chunk) => { diagnostics += chunk; });
  return { child, diagnostics: () => diagnostics };
}

async function stopTracker(tracker) {
  if (!tracker || tracker.child.exitCode !== null) return;
  tracker.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => tracker.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ]);
  if (tracker.child.exitCode === null) tracker.child.kill("SIGKILL");
}

async function waitTracker(shard, tracker) {
  await waitFor(async () => {
    if (tracker.child.exitCode !== null) throw new Error(`tracker ${shard.id} exited:\n${tracker.diagnostics()}`);
    const metricsReady = (await fetch(`${shard.internalUrl}/metrics`)).ok;
    if (!metricsReady) return false;
    return waitForPort(shard.port);
  });
}

function assignmentFor(shardId, shards) {
  for (let index = 0; index < 10_000; index += 1) {
    const assignmentKey = `viewer-${index}`;
    if (selectTrackerCell({ channelId: CHANNEL_ID, assignmentKey, shards }).shard.id === shardId) return assignmentKey;
  }
  throw new Error(`could not find assignment for ${shardId}`);
}

async function connectClient({ shard, assignmentKey, token }) {
  const ws = new WebSocket(`${shard.wsUrl}?token=${encodeURIComponent(token)}`);
  const messages = [];
  ws.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error(`WebSocket failed for ${shard.id}`)), { once: true });
  });
  ws.send(JSON.stringify({
    t: "join",
    channelId: CHANNEL_ID,
    assignmentKey,
    caps: { transport: "wifi", upload: true, uplinkKbps: 20_000 }
  }));
  const joined = await waitFor(() => messages.find((message) => message.t === "joined"));
  if (joined.cellId !== shard.id) throw new Error(`expected ${shard.id}, got ${joined.cellId}`);
  return { ws, messages, joined };
}

function waitForClose(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.addEventListener("close", resolve, { once: true });
  });
}

function closeClient(client) {
  if (!client || client.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return Promise.race([
    new Promise((resolve) => client.ws.addEventListener("close", resolve, { once: true })),
    new Promise((resolve) => setTimeout(resolve, 1000))
  ]).finally(() => client.ws.close());
}

const tempDir = mkdtempSync(join(tmpdir(), "swarmcast-tracker-cells-"));
let authServer;
let ingestServer;
const running = new Map();
const clients = [];

try {
  const ports = await Promise.all(Array.from({ length: 4 }, () => freePort()));
  const shards = [
    { id: "cell-a", port: ports[0], internalPort: ports[1], wsUrl: `ws://127.0.0.1:${ports[0]}/ws`, internalUrl: `http://127.0.0.1:${ports[1]}` },
    { id: "cell-b", port: ports[2], internalPort: ports[3], wsUrl: `ws://127.0.0.1:${ports[2]}/ws`, internalUrl: `http://127.0.0.1:${ports[3]}` }
  ];

  ingestServer = http.createServer(async (req, res) => {
    for await (const _chunk of req) void _chunk;
    res.writeHead(req.headers["x-internal-token"] === INTERNAL_TOKEN ? 200 : 401);
    res.end();
  });
  const ingestPort = await listen(ingestServer);
  authServer = await createAuthServer({ keyPath: join(tempDir, "auth.pem"), appApiKey: APP_API_KEY });
  const authPort = await listen(authServer);
  const token = await tokenFromAuth(`http://127.0.0.1:${authPort}`);

  for (const shard of shards) {
    const tracker = spawnTracker({ shard, shards, authPort, ingestPort });
    running.set(shard.id, tracker);
    await waitTracker(shard, tracker);
  }

  for (const shard of shards) {
    clients.push(await connectClient({ shard, assignmentKey: assignmentFor(shard.id, shards), token }));
  }

  await announceSegment({
    trackerInternalUrls: shards.map((shard) => shard.internalUrl),
    internalToken: INTERNAL_TOKEN,
    segment: { channelId: CHANNEL_ID, seq: 1, sha256: "a".repeat(64), size: 4096, k: 24 }
  });
  await waitFor(() => clients.every((client) => client.messages.some((message) => message.t === "segment" && message.seq === 1)));

  const failedShard = shards[1];
  const failedClient = clients[1];
  const closed = waitForClose(failedClient.ws);
  await stopTracker(running.get(failedShard.id));
  await closed;
  if (!failedClient.joined.edgeUrlTemplate.startsWith("https://edge.example.tv/")) {
    throw new Error("failed cell client did not retain an owned edge fallback template");
  }

  const replacement = spawnTracker({ shard: failedShard, shards, authPort, ingestPort });
  running.set(failedShard.id, replacement);
  await waitTracker(failedShard, replacement);
  clients[1] = await connectClient({
    shard: failedShard,
    assignmentKey: assignmentFor(failedShard.id, shards),
    token
  });

  await announceSegment({
    trackerInternalUrls: shards.map((shard) => shard.internalUrl),
    internalToken: INTERNAL_TOKEN,
    segment: { channelId: CHANNEL_ID, seq: 2, sha256: "b".repeat(64), size: 4096, k: 24 }
  });
  await waitFor(() => clients.every((client) => client.messages.some((message) => message.t === "segment" && message.seq === 2)));

  console.log(`tracker cell WebSocket smoke OK: channel=${CHANNEL_ID} cells=2 peers=2 fanout=2 cellFailure=edge-fallback rejoin=pass`);
} finally {
  await Promise.all(clients.map(closeClient));
  await Promise.all([...running.values()].map(stopTracker));
  if (authServer) await new Promise((resolve) => authServer.close(resolve));
  if (ingestServer) await new Promise((resolve) => ingestServer.close(resolve));
  rmSync(tempDir, { recursive: true, force: true });
}
