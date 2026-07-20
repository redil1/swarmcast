import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createAuthServer } from "../services/auth/src/index.js";

const CHANNEL_ID = "ws-load";
const INTERNAL_TOKEN = "tracker-ws-load-internal";
const APP_API_KEY = "tracker-ws-load-app-key";

function intArg(name, fallback) {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  if (!arg) return fallback;
  return Number.parseInt(arg.slice(prefix.length), 10);
}

const PEERS = intArg("--peers", Number.parseInt(process.env.TRACKER_WS_LOAD_PEERS || "200", 10));
const CHANNELS = intArg("--channels", Number.parseInt(process.env.TRACKER_WS_LOAD_CHANNELS || "1", 10));
const WIFI_PEERS = Math.floor(PEERS * 0.8);
const dockerImage = process.env.TRACKER_WS_DOCKER_IMAGE || "";
const trackerContainerName = `swarmcast-tracker-ws-load-${process.pid}`;

if (!Number.isInteger(PEERS) || PEERS <= 0) throw new Error("peer count must be positive");
if (!Number.isInteger(CHANNELS) || CHANNELS <= 0) throw new Error("channel count must be positive");
if (PEERS < CHANNELS) throw new Error("peer count must be >= channel count");

function channelFor(index) {
  if (CHANNELS === 1) return CHANNEL_ID;
  return `${CHANNEL_ID}-${index % CHANNELS}`;
}

function uWebSocketsSupportsCurrentNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  return major === 18 || major === 20 || major === 22 || major === 23;
}

if (!dockerImage && !uWebSocketsSupportsCurrentNode()) {
  console.log(`tracker websocket load smoke SKIPPED: uWebSockets.js v20.51.0 supports Node 18, 20, 22, and 23; current Node is ${process.versions.node}. Use TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local.`);
  process.exit(0);
}

function listen(server, port = 0) {
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

async function waitFor(fn, { timeoutMs = 15_000, intervalMs = 50 } = {}) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw lastError || new Error("timed out");
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("websocket failed to open")), { once: true });
  });
}

function waitForClose(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.addEventListener("close", resolve, { once: true });
    try {
      ws.close();
    } catch {
      resolve();
    }
  });
}

function metricValue(text, name) {
  const match = text.match(new RegExp(`^${name} ([0-9.]+)$`, "m"));
  if (!match) throw new Error(`missing metric ${name}`);
  return Number.parseFloat(match[1]);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

async function tokenFromAuth(baseUrl) {
  const response = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "x-app-key": APP_API_KEY }
  });
  if (!response.ok) throw new Error(`auth token request failed: ${response.status}`);
  return (await response.json()).token;
}

async function createClient({ trackerPort, token, index }) {
  const channelId = channelFor(index);
  const ws = new WebSocket(`ws://127.0.0.1:${trackerPort}/ws?token=${encodeURIComponent(token)}`);
  const messages = [];
  const openedAt = performance.now();
  ws.addEventListener("message", (event) => {
    messages.push(JSON.parse(event.data));
  });
  await waitForOpen(ws);
  ws.send(JSON.stringify({
    t: "join",
    channelId,
    caps: {
      transport: index < WIFI_PEERS ? "wifi" : "cell",
      upload: index < WIFI_PEERS,
      uplinkKbps: index < WIFI_PEERS ? 20_000 : 0
    }
  }));
  await waitFor(() => messages.some((message) => message.t === "joined"));
  const joinedAt = performance.now();
  const joined = messages.find((message) => message.t === "joined");
  ws.send(JSON.stringify({
    t: "stats",
    dl_p2p: 9000,
    dl_edge: 1000,
    ul: index < WIFI_PEERS ? 8000 : 0,
    stalls: 0
  }));
  return {
    channelId,
    peerId: joined.peerId,
    ws,
    messages,
    joinLatencyMs: joinedAt - openedAt
  };
}

const tempDir = mkdtempSync(join(tmpdir(), "swarmcast-tracker-ws-load-"));
let tracker = null;
let authServer = null;
let ingestServer = null;
const output = [];
const clients = [];

try {
  const demandCalls = [];
  ingestServer = http.createServer(async (req, res) => {
    const match = req.url?.match(/^\/channels\/([^/]+)\/demand$/);
    if (req.method === "POST" && match && req.headers["x-internal-token"] === INTERNAL_TOKEN) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      demandCalls.push({
        channelId: decodeURIComponent(match[1]),
        body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const ingestPort = await listen(ingestServer);

  authServer = await createAuthServer({
    keyPath: join(tempDir, "auth.pem"),
    appApiKey: APP_API_KEY
  });
  const authPort = await listen(authServer);
  const token = await tokenFromAuth(`http://127.0.0.1:${authPort}`);

  const trackerPort = await freePort();
  const trackerInternalPort = await freePort();
  const host = dockerImage ? "host.docker.internal" : "127.0.0.1";
  const trackerEnv = {
    INTERNAL_TOKEN,
    INGEST_URL: `http://${host}:${ingestPort}`,
    AUTH_JWKS_URL: `http://${host}:${authPort}/jwks`,
    TRACKER_PORT: String(trackerPort),
    TRACKER_INTERNAL_PORT: String(trackerInternalPort),
    TRACKER_MAX_CONNECTIONS: String(PEERS + 10),
    TRACKER_IDLE_TIMEOUT_SECONDS: "120",
    ORIGIN_BASE: "https://origin.example.tv",
    EDGE_BASE: "https://edge.example.tv"
  };

  if (dockerImage) {
    tracker = spawn("docker", [
      "run",
      "--rm",
      "--name", trackerContainerName,
      "--add-host", "host.docker.internal:host-gateway",
      "-p", `${trackerPort}:${trackerPort}`,
      "-p", `${trackerInternalPort}:${trackerInternalPort}`,
      ...Object.entries(trackerEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      dockerImage
    ], { stdio: ["ignore", "pipe", "pipe"] });
  } else {
    tracker = spawn(process.execPath, ["services/tracker/src/index.js"], {
      cwd: process.cwd(),
      env: { ...process.env, ...trackerEnv },
      stdio: ["ignore", "pipe", "pipe"]
    });
  }
  tracker.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  tracker.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));
  tracker.on("exit", (code) => {
    if (code !== null && code !== 0) output.push(`tracker exited with ${code}`);
  });

  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${trackerInternalPort}/metrics`);
    return response.ok;
  }, { timeoutMs: 10_000 });

  for (let start = 0; start < PEERS; start += 25) {
    const batch = [];
    for (let i = start; i < Math.min(PEERS, start + 25); i += 1) {
      batch.push(createClient({ trackerPort, token, index: i }));
    }
    clients.push(...await Promise.all(batch));
  }

  await waitFor(() => demandCalls.length === PEERS, { timeoutMs: 20_000 });
  const text = await waitFor(async () => {
    const metrics = await (await fetch(`http://127.0.0.1:${trackerInternalPort}/metrics`)).text();
    return metricValue(metrics, "swarmcast_tracker_peers") === PEERS &&
      metricValue(metrics, "swarmcast_tracker_offload_ratio") >= 0.9 &&
      metricValue(metrics, "swarmcast_tracker_offload_ratio_5m") >= 0.9 &&
      metrics;
  }, { timeoutMs: 20_000 });

  const p2pPeerLists = clients.filter((client) => client.messages.some((message) => message.t === "peers")).length;
  if (p2pPeerLists === 0) throw new Error("expected some clients to receive P2P peer candidates");

  const channelCounts = new Map();
  for (let i = 0; i < PEERS; i += 1) {
    const channelId = channelFor(i);
    channelCounts.set(channelId, (channelCounts.get(channelId) || 0) + 1);
  }
  const finalDemandByChannel = new Map();
  for (const call of demandCalls) finalDemandByChannel.set(call.channelId, call.body);
  if (finalDemandByChannel.size !== CHANNELS) {
    throw new Error(`expected demand for ${CHANNELS} channels, got ${finalDemandByChannel.size}`);
  }
  for (const [channelId, count] of channelCounts) {
    const demand = finalDemandByChannel.get(channelId);
    if (!demand) throw new Error(`missing demand for ${channelId}`);
    if (demand.swarmSize !== count) {
      throw new Error(`expected final swarm size ${count} for ${channelId}, got ${demand.swarmSize}`);
    }
  }

  const victims = clients.filter((_, index) => index % 10 < 3);
  const victimIds = new Set(victims.map((client) => client.peerId));
  await Promise.all(victims.map(({ ws }) => waitForClose(ws)));
  const survivors = clients.filter((client) => !victimIds.has(client.peerId));
  const survivorIds = new Set(survivors.map((client) => client.peerId));
  await waitFor(async () => {
    const metrics = await (await fetch(`http://127.0.0.1:${trackerInternalPort}/metrics`)).text();
    return metricValue(metrics, "swarmcast_tracker_peers") === survivors.length;
  });

  const churnProbes = survivors.filter((client) => {
    const initialPeers = client.messages.find((message) => message.t === "peers")?.peers || [];
    return initialPeers.some((peer) => victimIds.has(peer.id));
  }).slice(0, 20);
  if (churnProbes.length === 0) throw new Error("expected churn probes with at least one departed neighbor");

  await Promise.all(churnProbes.map(async (client) => {
    const initialPeers = client.messages.find((message) => message.t === "peers")?.peers || [];
    const excluded = initialPeers.map((peer) => peer.id);
    const messageOffset = client.messages.length;
    client.ws.send(JSON.stringify({ t: "need_peers", exclude: excluded }));
    const replacement = await waitFor(() =>
      client.messages.slice(messageOffset).find((message) => message.t === "peers")
    );
    const available = survivors.filter((candidate) =>
      candidate.channelId === client.channelId &&
      candidate.peerId !== client.peerId &&
      !excluded.includes(candidate.peerId)
    ).length;
    const expectedDegree = Math.min(12, available);
    if (replacement.peers.length !== expectedDegree) {
      throw new Error(`expected replacement degree ${expectedDegree}, got ${replacement.peers.length}`);
    }
    for (const peer of replacement.peers) {
      if (!survivorIds.has(peer.id) || excluded.includes(peer.id)) {
        throw new Error(`replacement list contains stale or excluded peer ${peer.id}`);
      }
    }
  }));

  const p95 = percentile(clients.map((client) => client.joinLatencyMs), 0.95);
  console.log(`tracker websocket load smoke OK: peers=${PEERS} channels=${CHANNELS} demandCalls=${demandCalls.length} rho=${metricValue(text, "swarmcast_tracker_offload_ratio").toFixed(3)} joinP95=${p95.toFixed(1)}ms p2pPeerLists=${p2pPeerLists} churnClosed=${victims.length} churnRecovered=${churnProbes.length}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (tracker) {
    console.error(`tracker command: ${tracker.spawnargs.join(" ")}`);
    console.error(`tracker output:\n${output.join("")}`);
  }
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map(({ ws }) => waitForClose(ws).catch(() => {})));
  if (tracker && !tracker.killed) {
    tracker.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => tracker.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000))
    ]);
    if (!tracker.killed) tracker.kill("SIGKILL");
  }
  if (dockerImage) {
    spawnSync("docker", ["rm", "-f", trackerContainerName], { stdio: "ignore" });
  }
  if (authServer) await closeServer(authServer);
  if (ingestServer) await closeServer(ingestServer);
  rmSync(tempDir, { recursive: true, force: true });
}
