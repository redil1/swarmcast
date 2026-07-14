import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthServer } from "../services/auth/src/index.js";

const CHANNEL_ID = "ws-restart";
const INTERNAL_TOKEN = "tracker-ws-restart-internal";
const APP_API_KEY = "tracker-ws-restart-app-key";
const PEERS = Number.parseInt(process.env.TRACKER_WS_RESTART_PEERS || "24", 10);
const WIFI_PEERS = Math.floor(PEERS * 0.8);
const dockerImage = process.env.TRACKER_WS_DOCKER_IMAGE || "";
const trackerContainerBaseName = `swarmcast-tracker-ws-restart-${process.pid}`;

if (!Number.isInteger(PEERS) || PEERS < 4) throw new Error("restart smoke requires at least 4 peers");

function uWebSocketsSupportsCurrentNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  return major === 18 || major === 20 || major === 22 || major === 23;
}

if (!dockerImage && !uWebSocketsSupportsCurrentNode()) {
  console.log(`tracker websocket restart smoke SKIPPED: uWebSockets.js v20.51.0 supports Node 18, 20, 22, and 23; current Node is ${process.versions.node}. Use TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local.`);
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

async function waitFor(fn, { timeoutMs = 10_000, intervalMs = 50 } = {}) {
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

function waitForRemoteClose(ws, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => reject(new Error("websocket remote close timed out")), timeoutMs);
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function closeClient(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(resolve, 1000);
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    try {
      ws.close();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

function metricValue(text, name) {
  const match = text.match(new RegExp(`^${name} ([0-9.]+)$`, "m"));
  if (!match) throw new Error(`missing metric ${name}`);
  return Number.parseFloat(match[1]);
}

async function tokenFromAuth(baseUrl) {
  const response = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "x-app-key": APP_API_KEY }
  });
  if (!response.ok) throw new Error(`auth token request failed: ${response.status}`);
  return (await response.json()).token;
}

function spawnTracker({
  generation,
  trackerPort,
  trackerInternalPort,
  ingestPort,
  authPort
}) {
  const host = dockerImage ? "host.docker.internal" : "127.0.0.1";
  const trackerEnv = {
    INTERNAL_TOKEN,
    INGEST_URL: `http://${host}:${ingestPort}`,
    AUTH_JWKS_URL: `http://${host}:${authPort}/jwks`,
    TRACKER_PORT: String(trackerPort),
    TRACKER_INTERNAL_PORT: String(trackerInternalPort),
    TRACKER_MAX_CONNECTIONS: String(PEERS + 10),
    TRACKER_IDLE_TIMEOUT_SECONDS: "120",
    TRACKER_RATE_LIMIT_CAPACITY: "100",
    TRACKER_RATE_LIMIT_REFILL_PER_SECOND: "100",
    P2P_MIN_SWARM_SIZE: "3",
    ORIGIN_BASE: "https://origin.example.tv",
    EDGE_BASE: "https://edge.example.tv"
  };
  const containerName = `${trackerContainerBaseName}-${generation}`;

  const child = dockerImage
    ? spawn("docker", [
      "run",
      "--rm",
      "--name", containerName,
      "--add-host", "host.docker.internal:host-gateway",
      "-p", `${trackerPort}:${trackerPort}`,
      "-p", `${trackerInternalPort}:${trackerInternalPort}`,
      ...Object.entries(trackerEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      dockerImage
    ], { stdio: ["ignore", "pipe", "pipe"] })
    : spawn(process.execPath, ["services/tracker/src/index.js"], {
      cwd: process.cwd(),
      env: { ...process.env, ...trackerEnv },
      stdio: ["ignore", "pipe", "pipe"]
    });

  return { child, containerName };
}

async function stopTracker(tracker) {
  if (!tracker) return;
  if (dockerImage) {
    spawnSync("docker", ["rm", "-f", tracker.containerName], { stdio: "ignore" });
  } else if (tracker.child.exitCode === null && !tracker.child.killed) {
    tracker.child.kill("SIGTERM");
  }

  await Promise.race([
    new Promise((resolve) => tracker.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ]);

  if (!dockerImage && tracker.child.exitCode === null && !tracker.child.killed) {
    tracker.child.kill("SIGKILL");
  }
}

async function waitForTrackerReady(trackerInternalPort) {
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${trackerInternalPort}/metrics`);
    return response.ok;
  }, { timeoutMs: 15_000 });
}

async function createClient({ trackerPort, token, index }) {
  const ws = new WebSocket(`ws://127.0.0.1:${trackerPort}/ws?token=${encodeURIComponent(token)}`);
  const messages = [];
  ws.addEventListener("message", (event) => {
    messages.push(JSON.parse(event.data));
  });
  await waitForOpen(ws);
  ws.send(JSON.stringify({
    t: "join",
    channelId: CHANNEL_ID,
    caps: {
      transport: index < WIFI_PEERS ? "wifi" : "cell",
      upload: index < WIFI_PEERS,
      uplinkKbps: index < WIFI_PEERS ? 20_000 : 0
    }
  }));
  const joined = await waitFor(() => messages.find((message) => message.t === "joined"));
  ws.send(JSON.stringify({
    t: "stats",
    dl_p2p: 9000,
    dl_edge: 1000,
    ul: index < WIFI_PEERS ? 8000 : 0,
    stalls: 0
  }));
  return { ws, messages, joined };
}

async function connectRound({
  trackerPort,
  trackerInternalPort,
  token,
  demandCalls,
  expectedDemandCalls
}) {
  const clients = [];
  for (let start = 0; start < PEERS; start += 8) {
    const batch = [];
    for (let i = start; i < Math.min(PEERS, start + 8); i += 1) {
      batch.push(createClient({ trackerPort, token, index: i }));
    }
    clients.push(...await Promise.all(batch));
  }

  await waitFor(() => demandCalls.length >= expectedDemandCalls, { timeoutMs: 15_000 });
  const text = await waitFor(async () => {
    const metrics = await (await fetch(`http://127.0.0.1:${trackerInternalPort}/metrics`)).text();
    return metricValue(metrics, "swarmcast_tracker_peers") === PEERS &&
      metricValue(metrics, "swarmcast_tracker_offload_ratio") >= 0.9 &&
      metricValue(metrics, "swarmcast_tracker_offload_ratio_5m") >= 0.9 &&
      metrics;
  }, { timeoutMs: 15_000 });

  const p2pPeerLists = clients.filter((client) => client.messages.some((message) => message.t === "peers")).length;
  if (p2pPeerLists === 0) throw new Error("expected P2P peer candidates before restart drill completes");

  for (const client of clients) {
    if (!client.joined.playlistUrl?.startsWith(`https://edge.example.tv/live/${CHANNEL_ID}/`)) {
      throw new Error(`joined response did not include Delivery Fleet playlist URL: ${client.joined.playlistUrl}`);
    }
  }

  const latestDemand = demandCalls.at(-1);
  if (latestDemand?.swarmSize !== PEERS) {
    throw new Error(`expected final demand swarm size ${PEERS}, got ${latestDemand?.swarmSize}`);
  }

  return {
    clients,
    rho: metricValue(text, "swarmcast_tracker_offload_ratio"),
    p2pPeerLists
  };
}

const tempDir = mkdtempSync(join(tmpdir(), "swarmcast-tracker-ws-restart-"));
let tracker = null;
let authServer = null;
let ingestServer = null;
let activeClients = [];
const output = [];

try {
  const demandCalls = [];
  ingestServer = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === `/channels/${CHANNEL_ID}/demand` && req.headers["x-internal-token"] === INTERNAL_TOKEN) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      demandCalls.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
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

  tracker = spawnTracker({ generation: 1, trackerPort, trackerInternalPort, ingestPort, authPort });
  tracker.child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  tracker.child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));
  await waitForTrackerReady(trackerInternalPort);

  const before = await connectRound({
    trackerPort,
    trackerInternalPort,
    token,
    demandCalls,
    expectedDemandCalls: PEERS
  });
  activeClients = before.clients;

  await stopTracker(tracker);
  tracker = null;
  await Promise.all(activeClients.map((client) => waitForRemoteClose(client.ws)));
  const closedByRestart = activeClients.length;
  activeClients = [];

  tracker = spawnTracker({ generation: 2, trackerPort, trackerInternalPort, ingestPort, authPort });
  tracker.child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  tracker.child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));
  await waitForTrackerReady(trackerInternalPort);

  const after = await connectRound({
    trackerPort,
    trackerInternalPort,
    token,
    demandCalls,
    expectedDemandCalls: PEERS * 2
  });
  activeClients = after.clients;

  console.log(`tracker websocket restart smoke OK: peers=${PEERS} closedByRestart=${closedByRestart} rejoined=${after.clients.length} demandCalls=${demandCalls.length} rho=${after.rho.toFixed(3)} p2pPeerListsBefore=${before.p2pPeerLists} p2pPeerListsAfter=${after.p2pPeerLists}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (tracker) {
    console.error(`tracker command: ${tracker.child.spawnargs.join(" ")}`);
    console.error(`tracker output:\n${output.join("")}`);
  }
  process.exitCode = 1;
} finally {
  await Promise.all(activeClients.map(({ ws }) => closeClient(ws).catch(() => {})));
  await stopTracker(tracker);
  if (dockerImage) {
    spawnSync("docker", ["rm", "-f", `${trackerContainerBaseName}-1`, `${trackerContainerBaseName}-2`], { stdio: "ignore" });
  }
  if (authServer) await closeServer(authServer);
  if (ingestServer) await closeServer(ingestServer);
  rmSync(tempDir, { recursive: true, force: true });
}
