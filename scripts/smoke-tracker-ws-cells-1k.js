import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createAuthServer } from "../services/auth/src/index.js";
import { announceSegment } from "../services/ingest/src/segmentWatcher.js";
import { selectTrackerCell } from "../services/tracker/src/sharding.js";

const supportedOptions = new Set(["peers", "cells", "cell-max-peers", "join-batch-size", "max-join-retries"]);
const rawOptions = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([a-z-]+)=(\d+)$/);
  if (!match || !supportedOptions.has(match[1]) || rawOptions.has(match[1])) {
    throw new Error(`invalid or duplicate tracker cell load option: ${arg}`);
  }
  rawOptions.set(match[1], Number.parseInt(match[2], 10));
}

function positiveOption(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = rawOptions.get(name) ?? fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

const PEER_COUNT = positiveOption("peers", 1000, { min: 2 });
const CELL_COUNT = positiveOption("cells", 4, { min: 2, max: 26 });
const PEERS_PER_CELL = PEER_COUNT / CELL_COUNT;
const CELL_MAX_PEERS = positiveOption(
  "cell-max-peers",
  PEER_COUNT === 1000 && CELL_COUNT === 4 ? 300 : Math.ceil(PEERS_PER_CELL * 1.1)
);
const JOIN_BATCH_SIZE = positiveOption("join-batch-size", 25, { max: 100 });
const JOIN_ACK_TIMEOUT_MS = 1000;
const MAX_JOIN_ATTEMPTS = 3;
const MAX_TOTAL_JOIN_RETRIES = positiveOption("max-join-retries", Math.max(10, Math.ceil(PEER_COUNT / 100)));
const RECOVERY_P95_BUDGET_MS = 30_000;
const LOAD_LABEL = PEER_COUNT % 1000 === 0 ? `${PEER_COUNT / 1000}K` : String(PEER_COUNT);
const loadSlug = PEER_COUNT % 1000 === 0 ? `${PEER_COUNT / 1000}k` : `${PEER_COUNT}-peer`;
const CHANNEL_ID = `single-channel-cells-${loadSlug}`;
const INTERNAL_TOKEN = `tracker-cell-${loadSlug}-internal`;
const APP_API_KEY = `tracker-cell-${loadSlug}-app-key`;
const dockerImage = process.env.TRACKER_CELL_LOAD_DOCKER_IMAGE || "";
const runId = `${process.pid}-${Date.now()}`;

if (!Number.isInteger(PEERS_PER_CELL)) throw new Error("peer count must divide evenly across cells");
if (CELL_MAX_PEERS < PEERS_PER_CELL) throw new Error("cell max peers must be at least the exact peers-per-cell target");

function uWebSocketsSupportsCurrentNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  return major === 18 || major === 20 || major === 22 || major === 23;
}

if (!dockerImage && !uWebSocketsSupportsCurrentNode()) {
  throw new Error(`tracker cell ${LOAD_LABEL} WebSocket load cannot run: uWebSockets.js v20.51.0 does not support Node ${process.versions.node}; set TRACKER_CELL_LOAD_DOCKER_IMAGE=swarmcast-tracker:local`);
}

function listen(server, port = 0) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function reservePorts(count) {
  const reservations = [];
  for (let index = 0; index < count; index += 1) {
    const server = net.createServer();
    reservations.push({ port: await listen(server), server });
  }
  return {
    ports: reservations.map(({ port }) => port),
    async release(port) {
      const reservation = reservations.find((entry) => entry.port === port);
      if (reservation?.server.listening) await closeServer(reservation.server);
    },
    async close() {
      await Promise.all(reservations.map(({ server }) => server.listening ? closeServer(server) : null));
    }
  };
}

async function waitFor(fn, { timeoutMs = 30_000, intervalMs = 25 } = {}) {
  const started = performance.now();
  let lastError;
  while (performance.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw lastError || new Error(`timed out after ${timeoutMs} ms`);
}

function percentile(values, p) {
  if (values.length === 0) throw new Error("cannot calculate percentile for an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
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
  if (!response.ok) throw new Error(`token request failed: ${response.status}`);
  return (await response.json()).token;
}

function trackerEnvironment({ shard, shards, authPort, ingestPort }) {
  const host = dockerImage ? "host.docker.internal" : "127.0.0.1";
  return {
    INTERNAL_TOKEN,
    AUTH_JWKS_URL: `http://${host}:${authPort}/jwks`,
    INGEST_URL: `http://${host}:${ingestPort}`,
    ORIGIN_BASE: "https://origin.example.tv",
    EDGE_BASE: "https://edge.example.tv",
    P2P_MIN_SWARM_SIZE: "1",
    TRACKER_PORT: String(shard.port),
    TRACKER_INTERNAL_PORT: String(shard.internalPort),
    TRACKER_SHARD_ID: shard.id,
    TRACKER_SHARDS: JSON.stringify(shards.map(({ id, wsUrl, internalUrl }) => ({ id, wsUrl, internalUrl }))),
    TRACKER_CELL_MAX_PEERS: String(CELL_MAX_PEERS),
    TRACKER_MAX_CONNECTIONS: String(CELL_MAX_PEERS + 20),
    TRACKER_IDLE_TIMEOUT_SECONDS: "120",
    TRACKER_DEMAND_HEARTBEAT_SECONDS: "3600",
    TRACKER_RATE_LIMIT_CAPACITY: "100",
    TRACKER_RATE_LIMIT_REFILL_PER_SECOND: "100"
  };
}

function spawnTracker({ shard, shards, authPort, ingestPort }) {
  const env = trackerEnvironment({ shard, shards, authPort, ingestPort });
  const containerName = `swarmcast-tracker-cell-${loadSlug}-${shard.id}-${runId}`;
  const child = dockerImage
    ? spawn("docker", [
        "run",
        "--rm",
        "--name", containerName,
        "--add-host", "host.docker.internal:host-gateway",
        "-p", `${shard.port}:${shard.port}`,
        "-p", `${shard.internalPort}:${shard.internalPort}`,
        ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
        dockerImage
      ], { stdio: ["ignore", "pipe", "pipe"] })
    : spawn(process.execPath, ["services/tracker/src/index.js"], {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"]
      });

  let diagnostics = "";
  const appendDiagnostics = (chunk) => {
    diagnostics = `${diagnostics}${chunk.toString("utf8")}`.slice(-128 * 1024);
  };
  child.stdout.on("data", appendDiagnostics);
  child.stderr.on("data", appendDiagnostics);
  return { child, containerName, diagnostics: () => diagnostics };
}

async function waitTracker(shard, tracker) {
  await waitFor(async () => {
    if (tracker.child.exitCode !== null) {
      throw new Error(`tracker ${shard.id} exited before readiness:\n${tracker.diagnostics()}`);
    }
    const response = await fetch(`${shard.internalUrl}/ready`);
    return response.ok;
  });
}

async function stopTracker(tracker) {
  if (!tracker || tracker.child.exitCode !== null) return;
  if (dockerImage) {
    const stopped = spawnSync("docker", ["stop", "--time", "3", tracker.containerName], {
      encoding: "utf8",
      timeout: 10_000
    });
    if (stopped.status !== 0) {
      throw new Error(`failed to stop ${tracker.containerName}: ${stopped.stderr || stopped.stdout}`);
    }
  } else {
    tracker.child.kill("SIGTERM");
  }
  if (tracker.child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => tracker.child.once("exit", resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("tracker did not stop cleanly")), 10_000))
    ]);
  }
}

function forceRemoveTracker(tracker) {
  if (!tracker) return;
  if (dockerImage) {
    spawnSync("docker", ["rm", "-f", tracker.containerName], { stdio: "ignore" });
  } else if (tracker.child.exitCode === null) {
    tracker.child.kill("SIGKILL");
  }
}

function assignmentsByCell(shards) {
  const assignments = new Map(shards.map((shard) => [shard.id, []]));
  const searchLimit = Math.max(1_000_000, PEER_COUNT * CELL_COUNT * 2);
  for (let index = 0; index < searchLimit; index += 1) {
    const assignmentKey = `load-viewer-${index}`;
    const selected = selectTrackerCell({ channelId: CHANNEL_ID, assignmentKey, shards }).shard;
    const values = assignments.get(selected.id);
    if (values.length < PEERS_PER_CELL) values.push(assignmentKey);
    if ([...assignments.values()].every((items) => items.length === PEERS_PER_CELL)) return assignments;
  }
  throw new Error("could not generate balanced deterministic tracker assignments");
}

function waitForOpen(ws, shardId) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error(`WebSocket failed for ${shardId}`)), { once: true });
  });
}

async function connectClient({ shard, assignmentKey, token, recoveryStartedAt = null }) {
  const openedAt = performance.now();
  const joinPayload = JSON.stringify({
    t: "join",
    channelId: CHANNEL_ID,
    assignmentKey,
    caps: { transport: "wifi", upload: true, uplinkKbps: 20_000 }
  });
  let lastError;

  for (let joinAttempt = 1; joinAttempt <= MAX_JOIN_ATTEMPTS; joinAttempt += 1) {
    const ws = new WebSocket(`${shard.wsUrl}?token=${encodeURIComponent(token)}`);
    const messages = [];
    const segmentTimes = new Map();
    ws.addEventListener("error", () => {});
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      messages.push(message);
      if (message.t === "segment") segmentTimes.set(message.seq, performance.now());
    });
    try {
      await waitForOpen(ws, shard.id);
      ws.send(joinPayload);
      const joined = await Promise.race([
        waitFor(() => messages.find((message) => message.t === "joined"), {
          timeoutMs: JOIN_ACK_TIMEOUT_MS,
          intervalMs: 10
        }),
        new Promise((_, reject) => ws.addEventListener("close", (event) => {
          reject(new Error(`WebSocket closed before join acknowledgement for ${shard.id}: ${event.code}`));
        }, { once: true }))
      ]);
      if (joined.cellId !== shard.id) throw new Error(`expected ${shard.id}, got ${joined.cellId}`);
      if (!joined.edgeUrlTemplate.startsWith("https://edge.example.tv/")) {
        throw new Error(`${shard.id} did not return an owned edge fallback template`);
      }
      const joinedAt = performance.now();
      return {
        assignmentKey,
        joined,
        messages,
        segmentTimes,
        shardId: shard.id,
        ws,
        joinRetries: joinAttempt - 1,
        joinLatencyMs: joinedAt - openedAt,
        recoveryLatencyMs: recoveryStartedAt === null ? null : joinedAt - recoveryStartedAt
      };
    } catch (error) {
      lastError = error;
      await closeWebSocket(ws);
    }
  }
  throw new Error(`join failed after ${MAX_JOIN_ATTEMPTS} connection attempts for ${shard.id}: ${lastError?.message || "unknown error"}`);
}

async function connectCellClients({ shard, assignments, token, recoveryStartedAt = null }) {
  const clients = [];
  for (let start = 0; start < assignments.length; start += JOIN_BATCH_SIZE) {
    const batch = assignments.slice(start, start + JOIN_BATCH_SIZE).map((assignmentKey) =>
      connectClient({ shard, assignmentKey, token, recoveryStartedAt })
    );
    clients.push(...await Promise.all(batch));
  }
  return clients;
}

function closeEvent(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve({ code: 1006, reason: "already closed" });
    ws.addEventListener("close", resolve, { once: true });
  });
}

async function closeWebSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = closeEvent(ws);
  try {
    ws.close(1000, "connection retry");
  } catch {
    return;
  }
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1000))]);
}

async function closeClient(client) {
  if (!client || client.ws.readyState === WebSocket.CLOSED) return;
  await closeWebSocket(client.ws);
}

async function metricsFor(shard) {
  const response = await fetch(`${shard.internalUrl}/metrics`);
  if (!response.ok) throw new Error(`metrics request failed for ${shard.id}: ${response.status}`);
  return response.text();
}

async function assertCellMetrics({ shards, expectedPeerCounts, expectedEncodes }) {
  const counts = [];
  for (const shard of shards) {
    const text = await metricsFor(shard);
    const expectedPeers = expectedPeerCounts.get(shard.id);
    const peers = metricValue(text, "swarmcast_tracker_peers");
    if (peers !== expectedPeers) throw new Error(`${shard.id} expected ${expectedPeers} peers, got ${peers}`);
    if (metricValue(text, "swarmcast_tracker_cells") !== (expectedPeers > 0 ? 1 : 0)) {
      throw new Error(`${shard.id} has an invalid active-cell count`);
    }
    if (peers > CELL_MAX_PEERS) throw new Error(`${shard.id} exceeded its ${CELL_MAX_PEERS}-peer ceiling`);
    for (const metric of [
      "swarmcast_tracker_messages_dropped_total",
      "swarmcast_tracker_backpressure_drops_total",
      "swarmcast_tracker_cell_capacity_spillovers_total",
      "swarmcast_tracker_cell_capacity_rejections_total"
    ]) {
      if (metricValue(text, metric) !== 0) throw new Error(`${shard.id} reported nonzero ${metric}`);
    }
    if (expectedEncodes?.has(shard.id) &&
        metricValue(text, "swarmcast_tracker_segment_payload_encodes_total") !== expectedEncodes.get(shard.id)) {
      throw new Error(`${shard.id} reported an unexpected segment encode count`);
    }
    counts.push(peers);
  }
  if (counts.reduce((total, count) => total + count, 0) !== PEER_COUNT) {
    throw new Error(`cell peer counts do not reconcile to ${PEER_COUNT}`);
  }
  return counts;
}

async function announceAndMeasure({ shards, clients, seq, sha256 }) {
  const announcedAt = performance.now();
  await announceSegment({
    trackerInternalUrls: shards.map((shard) => shard.internalUrl),
    internalToken: INTERNAL_TOKEN,
    segment: { channelId: CHANNEL_ID, seq, sha256, size: 4096, k: 24 }
  });
  await waitFor(() => clients.every((client) => client.segmentTimes.has(seq)), { timeoutMs: 10_000 });
  const latencies = clients.map((client) => client.segmentTimes.get(seq) - announcedAt);
  return { p95: percentile(latencies, 0.95), max: Math.max(...latencies) };
}

async function proveSignalingIsolation(clientsByShard, shards) {
  const [sender, sameCellTarget] = clientsByShard.get(shards[0].id);
  const crossCellTarget = clientsByShard.get(shards[1].id)[0];
  const sameMarker = `same-cell-${runId}`;
  const crossMarker = `cross-cell-${runId}`;

  const sameOffset = sameCellTarget.messages.length;
  sender.ws.send(JSON.stringify({
    t: "signal",
    to: sameCellTarget.joined.peerId,
    data: { marker: sameMarker }
  }));
  await waitFor(() => sameCellTarget.messages.slice(sameOffset).some(
    (message) => message.t === "signal" && message.data?.marker === sameMarker
  ));

  const crossOffset = crossCellTarget.messages.length;
  sender.ws.send(JSON.stringify({
    t: "signal",
    to: crossCellTarget.joined.peerId,
    data: { marker: crossMarker }
  }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (crossCellTarget.messages.slice(crossOffset).some(
    (message) => message.t === "signal" && message.data?.marker === crossMarker
  )) {
    throw new Error("tracker relayed signaling across cell boundaries");
  }
}

const tempDir = mkdtempSync(join(tmpdir(), `swarmcast-tracker-cells-${loadSlug}-`));
let authServer;
let ingestServer;
let portReservations;
const running = new Map();
const allClients = [];

try {
  portReservations = await reservePorts(CELL_COUNT * 2);
  const { ports } = portReservations;
  const shards = Array.from({ length: CELL_COUNT }, (_, index) => ({
    id: `cell-${String.fromCharCode(97 + index)}`,
    port: ports[index * 2],
    internalPort: ports[index * 2 + 1],
    wsUrl: `ws://127.0.0.1:${ports[index * 2]}/ws`,
    internalUrl: `http://127.0.0.1:${ports[index * 2 + 1]}`
  }));
  const assignments = assignmentsByCell(shards);
  let demandCalls = 0;

  ingestServer = http.createServer(async (req, res) => {
    for await (const _chunk of req) void _chunk;
    if (req.method === "POST" && req.url?.startsWith(`/channels/${CHANNEL_ID}/demand`) &&
        req.headers["x-internal-token"] === INTERNAL_TOKEN) {
      demandCalls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const ingestPort = await listen(ingestServer);
  authServer = await createAuthServer({ keyPath: join(tempDir, "auth.pem"), appApiKey: APP_API_KEY });
  const authPort = await listen(authServer);
  const token = await tokenFromAuth(`http://127.0.0.1:${authPort}`);

  for (const shard of shards) {
    await portReservations.release(shard.port);
    await portReservations.release(shard.internalPort);
    const tracker = spawnTracker({ shard, shards, authPort, ingestPort });
    running.set(shard.id, tracker);
    await waitTracker(shard, tracker);
  }

  const clientsByShard = new Map();
  for (const shard of shards) {
    const cellClients = await connectCellClients({ shard, assignments: assignments.get(shard.id), token });
    clientsByShard.set(shard.id, cellClients);
    allClients.push(...cellClients);
  }
  await waitFor(() => demandCalls >= PEER_COUNT);

  const expectedPeerCounts = new Map(shards.map((shard) => [shard.id, PEERS_PER_CELL]));
  const initialCounts = await assertCellMetrics({
    shards,
    expectedPeerCounts,
    expectedEncodes: new Map(shards.map((shard) => [shard.id, 0]))
  });
  await proveSignalingIsolation(clientsByShard, shards);

  const firstFanout = await announceAndMeasure({
    shards,
    clients: [...clientsByShard.values()].flat(),
    seq: 1,
    sha256: "a".repeat(64)
  });
  await assertCellMetrics({
    shards,
    expectedPeerCounts,
    expectedEncodes: new Map(shards.map((shard) => [shard.id, 2]))
  });

  const failedShard = shards[1];
  const failedClients = clientsByShard.get(failedShard.id);
  const closePromises = failedClients.map((client) => closeEvent(client.ws));
  const recoveryStartedAt = performance.now();
  await stopTracker(running.get(failedShard.id));
  const closeEvents = await Promise.all(closePromises);
  if (closeEvents.some((event) => event.code !== 1012)) {
    const codes = [...new Set(closeEvents.map((event) => event.code))].join(",");
    throw new Error(`failed cell did not close every client with 1012; observed ${codes}`);
  }
  if (failedClients.some((client) => !client.joined.edgeUrlTemplate.startsWith("https://edge.example.tv/"))) {
    throw new Error("failed-cell clients did not retain owned edge fallback templates");
  }

  const replacement = spawnTracker({ shard: failedShard, shards, authPort, ingestPort });
  running.set(failedShard.id, replacement);
  await waitTracker(failedShard, replacement);
  const recoveredClients = await connectCellClients({
    shard: failedShard,
    assignments: assignments.get(failedShard.id),
    token,
    recoveryStartedAt
  });
  clientsByShard.set(failedShard.id, recoveredClients);
  allClients.push(...recoveredClients);
  await waitFor(() => demandCalls >= PEER_COUNT + PEERS_PER_CELL);
  const recoveryP95 = percentile(recoveredClients.map((client) => client.recoveryLatencyMs), 0.95);
  if (recoveryP95 > RECOVERY_P95_BUDGET_MS) {
    throw new Error(`cell recovery p95 ${recoveryP95.toFixed(1)} ms exceeds ${RECOVERY_P95_BUDGET_MS} ms`);
  }

  const currentClients = [...clientsByShard.values()].flat();
  const secondFanout = await announceAndMeasure({
    shards,
    clients: currentClients,
    seq: 2,
    sha256: "b".repeat(64)
  });
  const totalJoinRetries = allClients.reduce((total, client) => total + client.joinRetries, 0);
  if (totalJoinRetries > MAX_TOTAL_JOIN_RETRIES) {
    throw new Error(`join retries ${totalJoinRetries} exceed the run ceiling ${MAX_TOTAL_JOIN_RETRIES}`);
  }
  const finalCounts = await assertCellMetrics({
    shards,
    expectedPeerCounts,
    expectedEncodes: new Map(shards.map((shard) => [shard.id, shard.id === failedShard.id ? 2 : 4]))
  });
  const joinP95 = percentile(allClients.slice(0, PEER_COUNT).map((client) => client.joinLatencyMs), 0.95);

  console.log(
    `tracker cell ${LOAD_LABEL} WebSocket load OK: channel=${CHANNEL_ID} peers=${PEER_COUNT} cells=${CELL_COUNT} ` +
    `cellMaxPeers=${CELL_MAX_PEERS} initialCellPeerCounts=${initialCounts.join(",")} finalCellPeerCounts=${finalCounts.join(",")} ` +
    `joinP95Ms=${joinP95.toFixed(1)} fanout1P95Ms=${firstFanout.p95.toFixed(1)} fanout1MaxMs=${firstFanout.max.toFixed(1)} ` +
    `fanout2P95Ms=${secondFanout.p95.toFixed(1)} fanout2MaxMs=${secondFanout.max.toFixed(1)} ` +
    `joinRetries=${totalJoinRetries} sameCellSignal=relayed crossCellSignal=blocked backpressureDrops=0 capacityRejections=0 ` +
    `cellFailure=edge-fallback closeCode=1012 recoveryP95Ms=${recoveryP95.toFixed(1)} rejoin=pass`
  );
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  for (const [shardId, tracker] of running) {
    console.error(`tracker ${shardId} diagnostics:\n${tracker.diagnostics()}`);
  }
  process.exitCode = 1;
} finally {
  await Promise.all(allClients.map((client) => closeClient(client).catch(() => {})));
  for (const tracker of running.values()) {
    try {
      await stopTracker(tracker);
    } catch {
      forceRemoveTracker(tracker);
    }
  }
  for (const tracker of running.values()) forceRemoveTracker(tracker);
  if (portReservations) await portReservations.close();
  if (authServer) await closeServer(authServer);
  if (ingestServer) await closeServer(ingestServer);
  rmSync(tempDir, { recursive: true, force: true });
}
