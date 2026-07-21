import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createAuthServer } from "../services/auth/src/index.js";

const mode = process.argv[2] || "";
const supportedModes = new Set(["", "--expect-hash-mismatch", "--force-turn-relay", "--expect-turn-auth-rejection"]);
if (process.argv.length > (mode ? 3 : 2) || !supportedModes.has(mode)) {
  throw new Error(`unsupported WebRTC smoke arguments: ${process.argv.slice(2).join(" ")}`);
}
const HASH_MISMATCH_SELF_TEST = mode === "--expect-hash-mismatch";
const FORCE_TURN_RELAY = mode === "--force-turn-relay";
const TURN_AUTH_REJECTION_SELF_TEST = mode === "--expect-turn-auth-rejection";
const USE_TURN = FORCE_TURN_RELAY || TURN_AUTH_REJECTION_SELF_TEST;
const PEER_COUNT = HASH_MISMATCH_SELF_TEST || USE_TURN ? 2 : 200;
const PAIR_COUNT = PEER_COUNT / 2;
const PAYLOAD_BYTES = 64 * 1024;
const RUN_TIMEOUT_MS = 120_000;
const loadSlug = HASH_MISMATCH_SELF_TEST
  ? "hash-rejection"
  : FORCE_TURN_RELAY
    ? "turn-relay"
    : TURN_AUTH_REJECTION_SELF_TEST
      ? "turn-auth-rejection"
      : "200";
const CHANNEL_ID = `webrtc-headless-${loadSlug}`;
const INTERNAL_TOKEN = `webrtc-headless-${loadSlug}-internal`;
const APP_API_KEY = `webrtc-headless-${loadSlug}-app-key`;
const dockerImage = process.env.TRACKER_WEBRTC_DOCKER_IMAGE || "";
const containerName = `swarmcast-tracker-webrtc-200-${process.pid}-${Date.now()}`;
const turnImage = process.env.TURN_WEBRTC_DOCKER_IMAGE || "swarmcast-turn:local";
const turnContainerName = `swarmcast-turn-webrtc-${process.pid}-${Date.now()}`;
const TURN_SHARED_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function uWebSocketsSupportsCurrentNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  return major === 18 || major === 20 || major === 22 || major === 23;
}

if (!dockerImage && !uWebSocketsSupportsCurrentNode()) {
  throw new Error(`200-peer WebRTC smoke cannot run the tracker on Node ${process.versions.node}; set TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local`);
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
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
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
  return response.json();
}

function run(command, args, { timeoutMs = 15_000 } = {}) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: "pipe", timeout: timeoutMs });
  } catch (error) {
    const detail = `${error.stdout || ""}${error.stderr || ""}`.replaceAll(TURN_SHARED_SECRET, "[redacted]").trim();
    const timedOut = error.code === "ETIMEDOUT" ? ` after ${timeoutMs}ms` : "";
    throw new Error(`${command} failed${timedOut}${detail ? `: ${detail}` : ""}`);
  }
}

function dockerAvailable() {
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
}

async function startTurn({ turnPort, turnTlsPort, turnMetricsPort, relayMinPort, relayMaxPort, certDirectory }) {
  if (!dockerAvailable()) throw new Error("forced TURN WebRTC smoke requires Docker");
  if (spawnSync("docker", ["image", "inspect", turnImage], { stdio: "ignore" }).status !== 0) {
    run("docker", ["build", "--pull", "-f", "infra/turn/Dockerfile", "-t", turnImage, "."], {
      timeoutMs: 300_000
    });
  }

  const cert = join(certDirectory, "fullchain.pem");
  const key = join(certDirectory, "privkey.pem");
  run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-keyout", key, "-out", cert
  ]);
  chmodSync(certDirectory, 0o755);
  chmodSync(cert, 0o644);
  chmodSync(key, 0o644);

  run("docker", [
    "run", "-d", "--name", turnContainerName,
    "--read-only",
    "--tmpfs", "/run:size=1m,mode=0700,uid=65534,gid=65534",
    "--tmpfs", "/tmp:size=16m,mode=1777",
    "--cap-drop=ALL", "--cap-add=NET_BIND_SERVICE",
    "-p", `127.0.0.1:${turnPort}:${turnPort}/udp`,
    "-p", `127.0.0.1:${turnMetricsPort}:${turnMetricsPort}/tcp`,
    "-p", `127.0.0.1:${relayMinPort}-${relayMaxPort}:${relayMinPort}-${relayMaxPort}/udp`,
    "-e", "TURN_REALM=turn.webrtc.local",
    "-e", `TURN_SHARED_SECRET=${TURN_SHARED_SECRET}`,
    "-e", `TURN_LISTENING_PORT=${turnPort}`,
    "-e", `TURN_TLS_LISTENING_PORT=${turnTlsPort}`,
    "-e", `TURN_MIN_PORT=${relayMinPort}`,
    "-e", `TURN_MAX_PORT=${relayMaxPort}`,
    "-e", "TURN_USER_QUOTA=4",
    "-e", "TURN_TOTAL_QUOTA=20",
    "-e", "TURN_MAX_BPS=1250000",
    "-e", "TURN_BPS_CAPACITY=100000000",
    "-e", `TURN_PROMETHEUS_PORT=${turnMetricsPort}`,
    "-e", "TURN_ALLOW_PRIVATE_PEERS=1",
    "-e", "TURN_EXTERNAL_IP=127.0.0.1",
    "-v", `${join(process.cwd(), "infra/turn/render-config.sh")}:/etc/swarmcast/render-config.sh:ro`,
    "-v", `${certDirectory}:/certs:ro`,
    "--entrypoint", "/bin/sh",
    turnImage,
    "/etc/swarmcast/render-config.sh"
  ], { timeoutMs: 60_000 });

  await waitFor(async () => {
    const state = run("docker", ["inspect", "--format", "{{.State.Running}}", turnContainerName]).trim();
    if (state !== "true") throw new Error(`coturn exited before readiness: ${run("docker", ["logs", turnContainerName])}`);
    const probe = spawnSync("docker", [
      "exec", turnContainerName, "turnutils_stunclient", "-p", String(turnPort), "127.0.0.1"
    ], { stdio: "ignore", timeout: 3_000 });
    return probe.status === 0;
  }, { timeoutMs: 15_000, intervalMs: 250 });
  const metricsResponse = await fetch(`http://127.0.0.1:${turnMetricsPort}/metrics`, {
    signal: AbortSignal.timeout(5_000)
  });
  const metricsText = await metricsResponse.text();
  if (!metricsResponse.ok || !metricsText.includes("# HELP") || !metricsText.includes("turn_")) {
    throw new Error("coturn Prometheus endpoint did not return TURN metrics");
  }
}

function stopTurn() {
  spawnSync("docker", ["rm", "-f", turnContainerName], { stdio: "ignore", timeout: 10_000 });
}

function spawnTracker({ trackerPort, trackerInternalPort, authPort, ingestPort }) {
  const host = dockerImage ? "host.docker.internal" : "127.0.0.1";
  const env = {
    INTERNAL_TOKEN,
    AUTH_JWKS_URL: `http://${host}:${authPort}/jwks`,
    INGEST_URL: `http://${host}:${ingestPort}`,
    ORIGIN_BASE: "https://origin.example.tv",
    EDGE_BASE: "https://edge.example.tv",
    P2P_MIN_SWARM_SIZE: "2",
    TRACKER_PORT: String(trackerPort),
    TRACKER_INTERNAL_PORT: String(trackerInternalPort),
    TRACKER_MAX_CONNECTIONS: String(PEER_COUNT + 20),
    TRACKER_CELL_MAX_PEERS: String(PEER_COUNT + 20),
    TRACKER_IDLE_TIMEOUT_SECONDS: "120",
    TRACKER_DEMAND_HEARTBEAT_SECONDS: "3600",
    TRACKER_RATE_LIMIT_CAPACITY: "100",
    TRACKER_RATE_LIMIT_REFILL_PER_SECOND: "100"
  };
  const child = dockerImage
    ? spawn("docker", [
        "run",
        "--rm",
        "--name", containerName,
        "--add-host", "host.docker.internal:host-gateway",
        "-p", `${trackerPort}:${trackerPort}`,
        "-p", `${trackerInternalPort}:${trackerInternalPort}`,
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
    diagnostics = `${diagnostics}${chunk.toString("utf8")}`.slice(-256 * 1024);
  };
  child.stdout.on("data", appendDiagnostics);
  child.stderr.on("data", appendDiagnostics);
  return { child, diagnostics: () => diagnostics };
}

async function stopTracker(tracker) {
  if (!tracker || tracker.child.exitCode !== null) return;
  if (dockerImage) {
    const stopped = spawnSync("docker", ["stop", "--time", "3", containerName], {
      encoding: "utf8",
      timeout: 10_000
    });
    if (stopped.status !== 0) throw new Error(stopped.stderr || stopped.stdout || "tracker container stop failed");
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
  if (dockerImage) spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  else if (tracker.child.exitCode === null) tracker.child.kill("SIGKILL");
}

const payload = Buffer.allocUnsafe(PAYLOAD_BYTES);
for (let index = 0; index < payload.length; index += 1) payload[index] = (index * 31 + 17) & 0xff;
const expectedHash = createHash("sha256").update(payload).digest("hex");
if (HASH_MISMATCH_SELF_TEST) payload[payload.length - 1] ^= 0xff;
const tempDir = mkdtempSync(join(tmpdir(), "swarmcast-webrtc-200-"));
const turnCertDir = USE_TURN ? mkdtempSync(join(tempDir, "turn-certs-")) : null;
let authServer;
let browserPageServer;
let browser;
let tracker;
let portReservations;
let demandCalls = 0;
let trackerInternalPort;

try {
  portReservations = await reservePorts(USE_TURN ? 5 : 2);
  const [trackerPort, reservedTrackerInternalPort, turnPort, turnTlsPort, turnMetricsPort] = portReservations.ports;
  trackerInternalPort = reservedTrackerInternalPort;

  if (USE_TURN) {
    const relayMinPort = 55_000 + (process.pid % 100) * 20;
    const relayMaxPort = relayMinPort + 19;
    await portReservations.release(turnPort);
    await portReservations.release(turnTlsPort);
    await portReservations.release(turnMetricsPort);
    await startTurn({
      turnPort,
      turnTlsPort,
      turnMetricsPort,
      relayMinPort,
      relayMaxPort,
      certDirectory: turnCertDir
    });
  }

  authServer = await createAuthServer({
    keyPath: join(tempDir, "auth.pem"),
    appApiKey: APP_API_KEY,
    stunUrls: [],
    turnEnabled: USE_TURN,
    turnUrls: USE_TURN ? [`turn:127.0.0.1:${turnPort}?transport=udp`] : [],
    turnSharedSecret: USE_TURN ? TURN_SHARED_SECRET : "",
    turnCredentialTtlSeconds: 300
  });
  const authPort = await listen(authServer);
  const authSession = await tokenFromAuth(`http://127.0.0.1:${authPort}`);
  const token = authSession.token;
  const iceServers = (authSession.iceServers || []).filter((server) =>
    Array.isArray(server.urls) ? server.urls.length > 0 : Boolean(server.urls)
  );
  if (USE_TURN && iceServers.length !== 1) throw new Error(`expected one issued TURN server, got ${iceServers.length}`);
  if (TURN_AUTH_REJECTION_SELF_TEST) iceServers[0].credential = `${iceServers[0].credential}-invalid`;

  browserPageServer = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end("<!doctype html><meta charset=utf-8><title>SwarmCast WebRTC smoke</title>");
      return;
    }
    if (req.method === "POST" && req.url === `/channels/${CHANNEL_ID}/demand` &&
        req.headers["x-internal-token"] === INTERNAL_TOKEN) {
      for await (const _chunk of req) void _chunk;
      demandCalls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const browserPagePort = await listen(browserPageServer);

  await portReservations.release(trackerPort);
  await portReservations.release(trackerInternalPort);
  tracker = spawnTracker({ trackerPort, trackerInternalPort, authPort, ingestPort: browserPagePort });
  await waitFor(async () => {
    if (tracker.child.exitCode !== null) throw new Error(`tracker exited before readiness:\n${tracker.diagnostics()}`);
    return (await fetch(`http://127.0.0.1:${trackerInternalPort}/ready`)).ok;
  });

  const launchOptions = {
    headless: true,
    args: ["--disable-dev-shm-usage"]
  };
  if (process.env.WEBRTC_BROWSER_EXECUTABLE) launchOptions.executablePath = process.env.WEBRTC_BROWSER_EXECUTABLE;
  else launchOptions.channel = process.env.WEBRTC_BROWSER_CHANNEL || "chrome";
  browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${browserPagePort}/`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async ({
    channelId,
    expectedHash,
    expectTurnAuthRejection,
    forceTurnRelay,
    iceServers,
    payloadBase64,
    peerCount,
    runTimeoutMs,
    token,
    trackerUrl
  }) => {
    const startedAt = performance.now();
    const payloadText = atob(payloadBase64);
    const transferPayload = Uint8Array.from(payloadText, (character) => character.charCodeAt(0));
    const pairCount = peerCount / 2;
    const clients = [];
    const byPeerId = new Map();
    let runFailureReject;
    const runFailure = new Promise((_, reject) => { runFailureReject = reject; });
    const runTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`WebRTC run exceeded ${runTimeoutMs} ms`)), runTimeoutMs);
    });
    let closing = false;

    function deferred() {
      let resolve;
      let reject;
      const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    }

    function fail(error) {
      if (!closing) runFailureReject(error instanceof Error ? error : new Error(String(error)));
    }

    function percentile(values, p) {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
    }

    async function withFailure(promise) {
      return Promise.race([promise, runFailure, runTimeout]);
    }

    async function waitForCondition(predicate, label, timeoutMs = 60_000) {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`${label} timed out`);
    }

    async function sha256(bytes) {
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    }

    function sendSignal(client, data) {
      if (!client.partner?.peerId) throw new Error(`peer ${client.index} has no signaling target`);
      client.signalSent += 1;
      client.ws.send(JSON.stringify({ t: "signal", to: client.partner.peerId, data }));
    }

    function acknowledgeSender(client) {
      if (client.acknowledged) return;
      client.acknowledged = true;
      client.acknowledgedAt = performance.now();
      client.ws.send(JSON.stringify({ t: "stats", dl_p2p: 0, dl_edge: 0, dl_relay: 0, ul: transferPayload.byteLength }));
      client.transferAck.resolve();
    }

    function wireChannel(client, channel) {
      client.channel = channel;
      channel.binaryType = "arraybuffer";
      channel.bufferedAmountLowThreshold = 256 * 1024;
      channel.onopen = () => {
        client.channelOpenedAt = performance.now();
        client.channelOpen.resolve();
      };
      channel.onerror = () => fail(new Error(`DataChannel error for peer ${client.index}`));
      channel.onclose = () => {
        if (!closing && !client.transferVerified && !client.acknowledged) {
          fail(new Error(`DataChannel closed before verified transfer for peer ${client.index}`));
        }
      };
      channel.onmessage = async (event) => {
        try {
          if (typeof event.data === "string") {
            if (event.data !== `ack:${expectedHash}`) throw new Error(`invalid transfer acknowledgement for peer ${client.index}`);
            acknowledgeSender(client);
            return;
          }
          if (client.index % 2 === 0) throw new Error(`sender peer ${client.index} received unexpected binary payload`);
          const bytes = new Uint8Array(event.data);
          client.receivedChunks.push(bytes);
          client.receivedBytes += bytes.byteLength;
          if (client.receivedBytes > transferPayload.byteLength) throw new Error(`peer ${client.index} received excess payload bytes`);
          if (client.receivedBytes === transferPayload.byteLength) {
            const assembled = new Uint8Array(client.receivedBytes);
            let offset = 0;
            for (const chunk of client.receivedChunks) {
              assembled.set(chunk, offset);
              offset += chunk.byteLength;
            }
            const actualHash = await sha256(assembled);
            if (actualHash !== expectedHash) throw new Error(`SHA-256 mismatch for peer ${client.index}`);
            client.transferVerified = true;
            client.ws.send(JSON.stringify({
              t: "stats",
              dl_p2p: forceTurnRelay ? 0 : assembled.byteLength,
              dl_edge: 0,
              dl_relay: forceTurnRelay ? assembled.byteLength : 0,
              ul: 0
            }));
            if (forceTurnRelay) acknowledgeSender(client.partner);
            else channel.send(`ack:${actualHash}`);
          }
        } catch (error) {
          fail(error);
        }
      };
    }

    function createPeerConnection(client, createDataChannel) {
      if (client.pc) return client.pc;
      const pc = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: forceTurnRelay || expectTurnAuthRejection ? "relay" : "all"
      });
      client.pc = pc;
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        sendSignal(client, {
          kind: "ice",
          cand: event.candidate.candidate,
          mid: event.candidate.sdpMid,
          mline: event.candidate.sdpMLineIndex
        });
      };
      pc.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(pc.connectionState) && !closing) {
          fail(new Error(`peer connection ${client.index} entered ${pc.connectionState}`));
        }
      };
      pc.onicecandidateerror = (event) => {
        if (expectTurnAuthRejection && event.errorCode === 401) {
          fail(new Error("TURN authentication rejected (401)"));
        } else if (!expectTurnAuthRejection) {
          fail(new Error(`ICE candidate error ${event.errorCode}: ${event.errorText || "unknown"}`));
        }
      };
      pc.ondatachannel = (event) => wireChannel(client, event.channel);
      if (createDataChannel) wireChannel(client, pc.createDataChannel("swarmcast-segment", { ordered: true }));
      return pc;
    }

    async function applyRemoteDescription(client, description) {
      await client.pc.setRemoteDescription(description);
      const pending = client.pendingCandidates.splice(0);
      for (const candidate of pending) await client.pc.addIceCandidate(candidate);
    }

    async function handleSignal(client, message) {
      client.signalReceived += 1;
      if (message.from !== client.partner?.peerId) throw new Error(`peer ${client.index} received signal outside its pair`);
      const data = message.data || {};
      if (data.kind === "offer") {
        createPeerConnection(client, false);
        await applyRemoteDescription(client, { type: "offer", sdp: data.sdp });
        const answer = await client.pc.createAnswer();
        await client.pc.setLocalDescription(answer);
        sendSignal(client, { kind: "answer", sdp: client.pc.localDescription.sdp });
        return;
      }
      if (data.kind === "answer") {
        if (!client.pc) throw new Error(`peer ${client.index} received an answer before creating a connection`);
        await applyRemoteDescription(client, { type: "answer", sdp: data.sdp });
        return;
      }
      if (data.kind === "ice") {
        const candidate = new RTCIceCandidate({
          candidate: data.cand,
          sdpMid: data.mid,
          sdpMLineIndex: data.mline
        });
        if (client.pc?.remoteDescription) await client.pc.addIceCandidate(candidate);
        else client.pendingCandidates.push(candidate);
        return;
      }
      throw new Error(`peer ${client.index} received unknown signal kind`);
    }

    for (let index = 0; index < peerCount; index += 1) {
      const joined = deferred();
      const channelOpen = deferred();
      const transferAck = deferred();
      const client = {
        index,
        ws: null,
        peerId: "",
        partner: null,
        pc: null,
        channel: null,
        joined,
        channelOpen,
        transferAck,
        pendingCandidates: [],
        receivedChunks: [],
        receivedBytes: 0,
        signalSent: 0,
        signalReceived: 0,
        joinStartedAt: performance.now(),
        joinedAt: 0,
        offerStartedAt: 0,
        channelOpenedAt: 0,
        transferStartedAt: 0,
        acknowledgedAt: 0,
        transferVerified: false,
        acknowledged: false
      };
      const ws = new WebSocket(`${trackerUrl}?token=${encodeURIComponent(token)}`);
      client.ws = ws;
      ws.onerror = () => fail(new Error(`tracker WebSocket error for peer ${index}`));
      ws.onclose = (event) => {
        if (!closing) fail(new Error(`tracker WebSocket closed for peer ${index}: ${event.code}`));
      };
      ws.onopen = () => ws.send(JSON.stringify({
        t: "join",
        channelId,
        assignmentKey: `webrtc-viewer-${index}`,
        caps: {
          transport: index % 2 === 0 ? "wifi" : "cellular",
          upload: index % 2 === 0,
          uplinkKbps: index % 2 === 0 ? 20_000 : 0
        }
      }));
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.t === "joined") {
            client.peerId = message.peerId;
            client.joinedAt = performance.now();
            byPeerId.set(message.peerId, client);
            joined.resolve();
          } else if (message.t === "signal") {
            void handleSignal(client, message).catch(fail);
          } else if (message.t === "error") {
            fail(new Error(`tracker rejected peer ${index}: ${message.code || "unknown"}`));
          }
        } catch (error) {
          fail(error);
        }
      };
      clients.push(client);
    }

    await withFailure(Promise.all(clients.map((client) => client.joined.promise)));
    if (byPeerId.size !== peerCount) throw new Error(`expected ${peerCount} unique tracker peer IDs, got ${byPeerId.size}`);
    for (let index = 0; index < peerCount; index += 2) {
      clients[index].partner = clients[index + 1];
      clients[index + 1].partner = clients[index];
    }

    await withFailure(Promise.all(clients.filter((client) => client.index % 2 === 0).map(async (client) => {
      client.offerStartedAt = performance.now();
      const pc = createPeerConnection(client, true);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(client, { kind: "offer", sdp: pc.localDescription.sdp });
    })));
    await withFailure(Promise.all(clients.map((client) => client.channelOpen.promise)));

    await withFailure(Promise.all(clients.filter((client) => client.index % 2 === 0).map(async (client) => {
      client.transferStartedAt = performance.now();
      for (let offset = 0; offset < transferPayload.byteLength; offset += 16 * 1024) {
        await waitForCondition(() => client.channel.bufferedAmount < 512 * 1024, `DataChannel buffer for peer ${client.index}`);
        client.channel.send(transferPayload.slice(offset, Math.min(transferPayload.byteLength, offset + 16 * 1024)));
      }
      await client.transferAck.promise;
    })));
    if (clients.filter((client) => client.index % 2 === 1 && client.transferVerified).length !== pairCount) {
      throw new Error("not every receiving peer verified the binary payload");
    }

    async function selectedCandidateTypes(pc) {
      const stats = await pc.getStats();
      let pair;
      for (const report of stats.values()) {
        if (report.type === "transport" && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId);
      }
      if (!pair) {
        for (const report of stats.values()) {
          if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) pair = report;
        }
      }
      if (!pair) throw new Error("selected ICE candidate pair is missing");
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      if (!local?.candidateType || !remote?.candidateType) throw new Error("selected ICE candidate types are missing");
      return `${local.candidateType}/${remote.candidateType}`;
    }

    const candidateTypes = await withFailure(Promise.all(
      clients.filter((client) => client.index % 2 === 0).map((client) => selectedCandidateTypes(client.pc))
    ));
    const expectedCandidatePath = forceTurnRelay ? "relay/relay" : "host/host";
    if (candidateTypes.some((value) => value !== expectedCandidatePath)) {
      throw new Error(`WebRTC smoke selected unexpected ICE paths: ${[...new Set(candidateTypes)].join(",")}`);
    }

    const joinP95Ms = percentile(clients.map((client) => client.joinedAt - client.joinStartedAt), 0.95);
    const channelOpenP95Ms = percentile(
      clients.filter((client) => client.index % 2 === 0).map((client) => client.channelOpenedAt - client.offerStartedAt),
      0.95
    );
    const transferP95Ms = percentile(
      clients.filter((client) => client.index % 2 === 0).map((client) => client.acknowledgedAt - client.transferStartedAt),
      0.95
    );
    const signalingMessages = clients.reduce((total, client) => total + client.signalSent, 0);
    await waitForCondition(
      () => clients.every((client) => client.ws.bufferedAmount === 0),
      "tracker stats flush",
      10_000
    );
    closing = true;
    for (const client of clients) {
      client.channel?.close();
      client.pc?.close();
      client.ws.close(1000, "smoke complete");
    }
    return {
      peers: peerCount,
      pairs: pairCount,
      verifiedTransfers: pairCount,
      bytesPerTransfer: transferPayload.byteLength,
      signalingMessages,
      candidatePath: expectedCandidatePath,
      candidatePathCount: candidateTypes.length,
      joinP95Ms,
      channelOpenP95Ms,
      transferP95Ms,
      durationMs: performance.now() - startedAt
    };
  }, {
    channelId: CHANNEL_ID,
    expectedHash,
    expectTurnAuthRejection: TURN_AUTH_REJECTION_SELF_TEST,
    forceTurnRelay: FORCE_TURN_RELAY,
    iceServers,
    payloadBase64: payload.toString("base64"),
    peerCount: PEER_COUNT,
    runTimeoutMs: RUN_TIMEOUT_MS,
    token,
    trackerUrl: `ws://127.0.0.1:${trackerPort}/ws`
  });

  const expectedTransferredBytes = PAIR_COUNT * PAYLOAD_BYTES;
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${trackerInternalPort}/metrics`);
    if (!response.ok) return false;
    const text = await response.text();
    return metricValue(text, FORCE_TURN_RELAY
      ? "swarmcast_tracker_download_relay_bytes_total"
      : "swarmcast_tracker_download_p2p_bytes_total") === expectedTransferredBytes &&
      metricValue(text, "swarmcast_tracker_upload_bytes_total") === expectedTransferredBytes;
  }, { timeoutMs: 10_000 });
  const metrics = await (await fetch(`http://127.0.0.1:${trackerInternalPort}/metrics`)).text();
  const expectedP2pBytes = FORCE_TURN_RELAY ? 0 : expectedTransferredBytes;
  const expectedRelayBytes = FORCE_TURN_RELAY ? expectedTransferredBytes : 0;
  const expectedOffloadRatio = FORCE_TURN_RELAY ? 0 : 1;
  if (metricValue(metrics, "swarmcast_tracker_download_p2p_bytes_total") !== expectedP2pBytes ||
      metricValue(metrics, "swarmcast_tracker_download_edge_bytes_total") !== 0 ||
      metricValue(metrics, "swarmcast_tracker_download_relay_bytes_total") !== expectedRelayBytes ||
      metricValue(metrics, "swarmcast_tracker_offload_ratio") !== expectedOffloadRatio ||
      metricValue(metrics, "swarmcast_tracker_messages_dropped_total") !== 0 ||
      metricValue(metrics, "swarmcast_tracker_backpressure_drops_total") !== 0 ||
      metricValue(metrics, "swarmcast_tracker_cell_capacity_rejections_total") !== 0) {
    throw new Error("tracker metrics did not reconcile the WebRTC transfer cleanly");
  }
  if (demandCalls < PEER_COUNT) throw new Error(`expected at least ${PEER_COUNT} demand calls, got ${demandCalls}`);

  const label = FORCE_TURN_RELAY ? "WebRTC TURN relay smoke" : "WebRTC 200-peer smoke";
  console.log(
    `${label} OK: peers=${result.peers} pairs=${result.pairs} verifiedTransfers=${result.verifiedTransfers} ` +
    `bytesPerTransfer=${result.bytesPerTransfer} sha256=${expectedHash} signalingMessages=${result.signalingMessages} ` +
    `selectedIce=${result.candidatePath}:${result.candidatePathCount} joinP95Ms=${result.joinP95Ms.toFixed(1)} ` +
    `channelOpenP95Ms=${result.channelOpenP95Ms.toFixed(1)} transferP95Ms=${result.transferP95Ms.toFixed(1)} ` +
    `durationMs=${result.durationMs.toFixed(1)} trackerP2pBytes=${expectedP2pBytes} trackerRelayBytes=${expectedRelayBytes} ` +
    `trackerUploadBytes=${expectedTransferredBytes} ` +
    "trackerSignaling=pass dataChannel=pass hashVerification=pass accounting=pass drops=0 capacityRejections=0"
  );
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  if ((HASH_MISMATCH_SELF_TEST && message.includes("SHA-256 mismatch")) ||
      (TURN_AUTH_REJECTION_SELF_TEST && message.includes("TURN authentication rejected (401)"))) {
    try {
      const metrics = await (await fetch(`http://127.0.0.1:${trackerInternalPort}/metrics`)).text();
      if (metricValue(metrics, "swarmcast_tracker_download_p2p_bytes_total") !== 0 ||
          metricValue(metrics, "swarmcast_tracker_download_relay_bytes_total") !== 0 ||
          metricValue(metrics, "swarmcast_tracker_upload_bytes_total") !== 0) {
        throw new Error("rejected transfer changed tracker byte accounting");
      }
      console.log(TURN_AUTH_REJECTION_SELF_TEST
        ? "WebRTC TURN auth rejection smoke OK: invalid credentials rejected with zero direct/relay/upload accounting"
        : "WebRTC hash rejection smoke OK: tampered DataChannel payload rejected with zero direct/relay/upload accounting");
    } catch (accountingError) {
      console.error(accountingError instanceof Error ? accountingError.stack || accountingError.message : String(accountingError));
      process.exitCode = 1;
    }
  } else {
    console.error(message);
    if (tracker) console.error(`tracker diagnostics:\n${tracker.diagnostics()}`);
    process.exitCode = 1;
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (tracker) {
    try {
      await stopTracker(tracker);
    } catch {
      forceRemoveTracker(tracker);
    }
    forceRemoveTracker(tracker);
  }
  if (portReservations) await portReservations.close();
  if (authServer) await closeServer(authServer);
  if (browserPageServer) await closeServer(browserPageServer);
  if (USE_TURN) stopTurn();
  rmSync(tempDir, { recursive: true, force: true });
}
