import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthServer } from "../services/auth/src/index.js";

const CHANNEL_ID = "ws-smoke";
const INTERNAL_TOKEN = "tracker-smoke-internal";
const APP_API_KEY = "tracker-smoke-app-key";

function uWebSocketsSupportsCurrentNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  return major === 18 || major === 20 || major === 22 || major === 23;
}

const dockerImage = process.env.TRACKER_WS_DOCKER_IMAGE || "";
const useDockerTracker = Boolean(dockerImage);
const trackerContainerName = `swarmcast-tracker-ws-${process.pid}`;

if (!uWebSocketsSupportsCurrentNode() && !useDockerTracker) {
  console.log(`tracker websocket smoke SKIPPED: uWebSockets.js v20.51.0 supports Node 18, 20, 22, and 23; current Node is ${process.versions.node}. Use the Node 22 CI/Docker runtime for this smoke.`);
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

async function waitFor(fn, { timeoutMs = 5000, intervalMs = 50 } = {}) {
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

function expectRejectedWebSocket(url) {
  return new Promise((resolve, reject) => {
    let done = false;
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {}
      reject(new Error("websocket rejection timed out"));
    }, 5000);
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    ws.addEventListener("open", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      reject(new Error("websocket unexpectedly opened"));
    }, { once: true });
    ws.addEventListener("error", finish, { once: true });
    ws.addEventListener("close", finish, { once: true });
  });
}

function waitForClose(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket close timed out")), timeoutMs);
    ws.addEventListener("close", (event) => {
      clearTimeout(timer);
      resolve(event);
    }, { once: true });
  });
}

function waitForMessage(messages, predicate) {
  return waitFor(() => messages.find(predicate), { timeoutMs: 5000 });
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

const tempDir = mkdtempSync(join(tmpdir(), "swarmcast-tracker-ws-"));
let tracker = null;
let ws = null;
let signalWs = null;
let authServer = null;
let ingestServer = null;
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
  const requestedMaxConnections = Number.parseInt(process.env.TRACKER_WS_MAX_CONNECTIONS || "2", 10);
  const trackerMaxConnections = Math.max(2, Number.isFinite(requestedMaxConnections) ? requestedMaxConnections : 2);
  const trackerEnv = {
    INTERNAL_TOKEN,
    INGEST_URL: `http://${useDockerTracker ? "host.docker.internal" : "127.0.0.1"}:${ingestPort}`,
    AUTH_JWKS_URL: `http://${useDockerTracker ? "host.docker.internal" : "127.0.0.1"}:${authPort}/jwks`,
    TRACKER_PORT: String(trackerPort),
    TRACKER_INTERNAL_PORT: String(trackerInternalPort),
    TRACKER_MAX_CONNECTIONS: String(trackerMaxConnections),
    TRACKER_IDLE_TIMEOUT_SECONDS: process.env.TRACKER_WS_IDLE_TIMEOUT_SECONDS || "9",
    TRACKER_DEMAND_HEARTBEAT_SECONDS: "1",
    TRACKER_RATE_LIMIT_CAPACITY: "8",
    TRACKER_RATE_LIMIT_REFILL_PER_SECOND: "1",
    ORIGIN_BASE: "https://origin.example.tv",
    EDGE_BASE: "https://edge.example.tv"
  };

  if (useDockerTracker) {
    tracker = spawn("docker", [
      "run",
      "--rm",
      "--name", trackerContainerName,
      "--add-host", "host.docker.internal:host-gateway",
      "-p", `${trackerPort}:${trackerPort}`,
      "-p", `${trackerInternalPort}:${trackerInternalPort}`,
      ...Object.entries(trackerEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      dockerImage
    ], {
      stdio: ["ignore", "pipe", "pipe"]
    });
  } else {
    tracker = spawn(process.execPath, ["services/tracker/src/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...trackerEnv
      },
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

  await expectRejectedWebSocket(`ws://127.0.0.1:${trackerPort}/ws?token=bad-token`);

  const messages = [];
  ws = new WebSocket(`ws://127.0.0.1:${trackerPort}/ws?token=${encodeURIComponent(token)}`);
  ws.addEventListener("message", (event) => {
    messages.push(JSON.parse(event.data));
  });
  await waitForOpen(ws);
  ws.send(JSON.stringify({
    t: "join",
    channelId: CHANNEL_ID,
    caps: { transport: "wifi", upload: true, uplinkKbps: 20_000 }
  }));
  const joined = await waitForMessage(messages, (message) => message.t === "joined");
  if (joined.swarmSize !== 1) throw new Error(`expected swarm size 1, got ${joined.swarmSize}`);

  ws.send(JSON.stringify({ t: "ping" }));
  await waitForMessage(messages, (message) => message.t === "pong");

  ws.send(JSON.stringify({ t: "stats", dl_p2p: 90, dl_edge: 10, ul: 80, stalls: 0, startup_ms: 1100, buffer_ms: 30000 }));
  await waitFor(() => demandCalls.length >= 1);
  await waitFor(async () => {
    const text = await (await fetch(`http://127.0.0.1:${trackerInternalPort}/metrics`)).text();
    return metricValue(text, "swarmcast_tracker_peers") === 1 &&
      metricValue(text, "swarmcast_tracker_offload_ratio") >= 0.9 &&
      metricValue(text, "swarmcast_tracker_stall_rate_5m") === 0 &&
      metricValue(text, "swarmcast_tracker_startup_latency_ms_avg_5m") === 1100 &&
      metricValue(text, "swarmcast_tracker_buffer_ms_min_5m") === 30000;
  });

  const badSegment = await fetch(`http://127.0.0.1:${trackerInternalPort}/internal/segment`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": INTERNAL_TOKEN
    },
    body: JSON.stringify({ channelId: CHANNEL_ID, seq: 7, sha256: "bad", size: 1200, k: 32 })
  });
  if (badSegment.status !== 400) throw new Error(`expected bad segment announce rejection, got ${badSegment.status}`);

  const sha256 = "a".repeat(64);
  const segmentResponse = await fetch(`http://127.0.0.1:${trackerInternalPort}/internal/segment`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": INTERNAL_TOKEN
    },
    body: JSON.stringify({ channelId: CHANNEL_ID, seq: 7, sha256, size: 1200, k: 32 })
  });
  if (!segmentResponse.ok) throw new Error(`segment announce failed: ${segmentResponse.status}`);
  const segment = await waitForMessage(messages, (message) => message.t === "segment" && message.seq === 7);
  if (segment.sha256 !== sha256 || segment.size !== 1200 || segment.k !== 32) {
    throw new Error("segment announce payload did not reach websocket client");
  }

  const signalMessages = [];
  signalWs = new WebSocket(`ws://127.0.0.1:${trackerPort}/ws?token=${encodeURIComponent(token)}`);
  signalWs.addEventListener("message", (event) => {
    signalMessages.push(JSON.parse(event.data));
  });
  await waitForOpen(signalWs);
  signalWs.send(JSON.stringify({
    t: "join",
    channelId: CHANNEL_ID,
    caps: { transport: "wifi", upload: true, uplinkKbps: 18_000 }
  }));
  const signalJoined = await waitForMessage(signalMessages, (message) => message.t === "joined");
  if (signalJoined.swarmSize !== 2) throw new Error(`expected signaling peer to join swarm size 2, got ${signalJoined.swarmSize}`);

  const offer = { type: "offer", sdp: "v=0\r\ns=swarmcast-smoke-offer\r\n" };
  ws.send(JSON.stringify({ t: "signal", to: signalJoined.peerId, data: offer }));
  const relayedOffer = await waitForMessage(signalMessages, (message) => message.t === "signal" && message.from === joined.peerId && message.data?.type === "offer");
  if (relayedOffer.data.sdp !== offer.sdp) throw new Error("offer signal payload did not relay to target peer");

  const answer = { type: "answer", sdp: "v=0\r\ns=swarmcast-smoke-answer\r\n" };
  signalWs.send(JSON.stringify({ t: "signal", to: joined.peerId, data: answer }));
  const relayedAnswer = await waitForMessage(messages, (message) => message.t === "signal" && message.from === signalJoined.peerId && message.data?.type === "answer");
  if (relayedAnswer.data.sdp !== answer.sdp) throw new Error("answer signal payload did not relay to initiating peer");

  const candidate = { type: "ice", candidate: "candidate:1 1 udp 2122260223 192.0.2.1 12345 typ host" };
  ws.send(JSON.stringify({ t: "signal", to: signalJoined.peerId, data: candidate }));
  const relayedCandidate = await waitForMessage(signalMessages, (message) => message.t === "signal" && message.from === joined.peerId && message.data?.type === "ice");
  if (relayedCandidate.data.candidate !== candidate.candidate) throw new Error("ICE signal payload did not relay to target peer");

  await waitFor(() => demandCalls.length >= 2, { timeoutMs: 5000 });

  await expectRejectedWebSocket(`ws://127.0.0.1:${trackerPort}/ws?token=${encodeURIComponent(token)}`);
  signalWs.close();
  await waitForClose(signalWs);
  signalWs = null;
  ws.close();
  await waitForClose(ws);
  ws = null;
  await waitFor(async () => {
    const text = await (await fetch(`http://127.0.0.1:${trackerInternalPort}/metrics`)).text();
    return metricValue(text, "swarmcast_tracker_peers") === 0;
  });

  const rateMessages = [];
  const rateLimited = new WebSocket(`ws://127.0.0.1:${trackerPort}/ws?token=${encodeURIComponent(token)}`);
  rateLimited.addEventListener("message", (event) => {
    rateMessages.push(JSON.parse(event.data));
  });
  await waitForOpen(rateLimited);
  rateLimited.send(JSON.stringify({
    t: "join",
    channelId: CHANNEL_ID,
    caps: { transport: "wifi", upload: true, uplinkKbps: 20_000 }
  }));
  await waitForMessage(rateMessages, (message) => message.t === "joined");
  for (let i = 0; i < 20; i += 1) {
    rateLimited.send(JSON.stringify({ t: "ping", n: i }));
  }
  const rateClose = await waitForClose(rateLimited);
  if (rateClose.code !== 1008) throw new Error(`expected rate-limit close 1008, got ${rateClose.code}`);
  await waitFor(async () => {
    const text = await (await fetch(`http://127.0.0.1:${trackerInternalPort}/metrics`)).text();
    return metricValue(text, "swarmcast_tracker_peers") === 0;
  });

  const oversized = new WebSocket(`ws://127.0.0.1:${trackerPort}/ws?token=${encodeURIComponent(token)}`);
  await waitForOpen(oversized);
  oversized.send(JSON.stringify({ t: "ping", pad: "x".repeat(20 * 1024) }));
  await waitForClose(oversized);

  const idle = new WebSocket(`ws://127.0.0.1:${trackerPort}/ws?token=${encodeURIComponent(token)}`);
  await waitForOpen(idle);
  await waitForClose(idle, 20_000);

  console.log(`tracker websocket smoke OK: peerId=${joined.peerId} playlist=${joined.playlistUrl} demandCalls=${demandCalls.length} segmentAnnounced=true signalingRelayed=true invalidTokenRejected=true connectionLimitRejected=true rateLimitClosed=true oversizedClosed=true idleClosed=true`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (tracker) {
    console.error(`tracker command: ${tracker.spawnargs.join(" ")}`);
    console.error(`tracker output:\n${output.join("")}`);
  }
  process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {}
  try {
    signalWs?.close();
  } catch {}
  if (tracker && !tracker.killed) {
    tracker.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => tracker.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000))
    ]);
    if (!tracker.killed) tracker.kill("SIGKILL");
  }
  if (useDockerTracker) {
    spawnSync("docker", ["rm", "-f", trackerContainerName], { stdio: "ignore" });
  }
  if (authServer) await closeServer(authServer);
  if (ingestServer) await closeServer(ingestServer);
  rmSync(tempDir, { recursive: true, force: true });
}
