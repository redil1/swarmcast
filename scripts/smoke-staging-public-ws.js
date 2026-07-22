import { readFileSync } from "node:fs";

const [trackerUrl, channelId, tokenFile] = process.argv.slice(2);
if (!trackerUrl || !channelId || !tokenFile) {
  throw new Error("usage: node scripts/smoke-staging-public-ws.js <wss-url> <channel-id> <token-file>");
}

const token = readFileSync(tokenFile, "utf8").trim();
if (!token) throw new Error("token file is empty");

function withToken(value) {
  const url = new URL(value);
  url.searchParams.set("token", token);
  return url;
}

function waitForEvent(target, type, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} timed out`)), timeoutMs);
    target.addEventListener(type, (event) => {
      clearTimeout(timer);
      resolve(event);
    }, { once: true });
  });
}

async function expectRejected() {
  const url = new URL(trackerUrl);
  url.searchParams.set("token", "invalid-token");
  const ws = new WebSocket(url);
  await Promise.race([
    waitForEvent(ws, "error"),
    waitForEvent(ws, "close")
  ]);
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
    throw new Error("invalid tracker token was accepted");
  }
}

async function createPeer() {
  const ws = new WebSocket(withToken(trackerUrl));
  const messages = [];
  ws.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
  await waitForEvent(ws, "open");
  ws.send(JSON.stringify({
    t: "join",
    channelId,
    caps: { transport: "wifi", upload: true, uplinkKbps: 20_000 }
  }));
  const joined = await waitForMessage(messages, (message) => message.t === "joined");
  return { ws, messages, joined };
}

async function waitForMessage(messages, predicate, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const message = messages.find(predicate);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("tracker message timed out");
}

async function closePeer(peer) {
  if (!peer || peer.ws.readyState === WebSocket.CLOSED) return;
  const closed = waitForEvent(peer.ws, "close");
  peer.ws.close();
  await closed;
}

let first;
let second;
try {
  await expectRejected();
  first = await createPeer();
  first.ws.send(JSON.stringify({ t: "ping" }));
  await waitForMessage(first.messages, (message) => message.t === "pong");

  second = await createPeer();
  if (second.joined.swarmSize < 2) throw new Error("second peer did not join the same swarm");

  const offer = { type: "offer", sdp: "v=0\r\ns=swarmcast-staging-offer\r\n" };
  first.ws.send(JSON.stringify({ t: "signal", to: second.joined.peerId, data: offer }));
  await waitForMessage(second.messages, (message) => (
    message.t === "signal" && message.from === first.joined.peerId && message.data?.type === "offer"
  ));

  const answer = { type: "answer", sdp: "v=0\r\ns=swarmcast-staging-answer\r\n" };
  second.ws.send(JSON.stringify({ t: "signal", to: first.joined.peerId, data: answer }));
  await waitForMessage(first.messages, (message) => (
    message.t === "signal" && message.from === second.joined.peerId && message.data?.type === "answer"
  ));

  const candidate = { type: "ice", candidate: "candidate:1 1 udp 2122260223 192.0.2.1 12345 typ host" };
  first.ws.send(JSON.stringify({ t: "signal", to: second.joined.peerId, data: candidate }));
  await waitForMessage(second.messages, (message) => (
    message.t === "signal" && message.from === first.joined.peerId && message.data?.type === "ice"
  ));

  const segment = await Promise.any([
    waitForMessage(first.messages, (message) => message.t === "segment"),
    waitForMessage(second.messages, (message) => message.t === "segment")
  ]);
  if (!Number.isInteger(segment.seq) || !/^[a-f0-9]{64}$/.test(segment.sha256) || segment.size <= 0) {
    throw new Error("tracker delivered invalid segment metadata");
  }

  first.ws.send(JSON.stringify({
    t: "stats",
    dl_p2p: 1,
    dl_edge: segment.size,
    ul: 0,
    stalls: 0,
    startup_ms: 1,
    buffer_ms: 30_000
  }));

  console.log(JSON.stringify({
    ok: true,
    invalidTokenRejected: true,
    peersJoined: 2,
    signalingRelayed: true,
    segmentAnnounced: true,
    segmentSeq: segment.seq,
    segmentBytes: segment.size
  }));
} finally {
  await Promise.allSettled([closePeer(first), closePeer(second)]);
}
