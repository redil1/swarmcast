import { EventEmitter } from "node:events";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { ChannelManager } from "../services/ingest/src/channelManager.js";
import { createIngestServer } from "../services/ingest/src/index.js";
import { watchSegments } from "../services/ingest/src/segmentWatcher.js";

const internalToken = "ingest-demand-smoke-token";
const fixtureInit = readFileSync("test-fixtures/media/fmp4/init.mp4");
const fixtureSegment = readFileSync("test-fixtures/media/fmp4/seg_00000000.m4s");

class SyntheticHlsProcess extends EventEmitter {
  constructor() {
    super();
    this.stderr = new PassThrough();
    this.killed = false;
  }

  kill() {
    if (this.killed) return;
    this.killed = true;
    this.emit("exit", 0);
  }
}

function syntheticHlsSpawn(_command, args) {
  const proc = new SyntheticHlsProcess();
  const playlistPath = args[args.length - 1];
  const outDir = dirname(playlistPath);
  const segmentPath = join(outDir, "seg_00000000.m4s");
  const initPath = join(outDir, "init.mp4");

  setTimeout(() => {
    if (proc.killed) return;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(initPath, fixtureInit);
    writeFileSync(segmentPath, fixtureSegment);
    writeFileSync(playlistPath, [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      "#EXT-X-TARGETDURATION:2",
      "#EXT-X-MAP:URI=\"init.mp4\"",
      "#EXTINF:2.000,",
      "seg_00000000.m4s",
      ""
    ].join("\n"));
  }, 50);

  return proc;
}

async function waitFor(predicate, label, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function createTrackerServer() {
  const announces = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/internal/segment") {
      res.writeHead(404).end();
      return;
    }
    if (req.headers["x-internal-token"] !== internalToken) {
      res.writeHead(401).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    announces.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(204).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, announces, url: `http://127.0.0.1:${server.address().port}` };
}

const root = mkdtempSync(join(tmpdir(), "swarmcast-ingest-demand-"));
const hlsRoot = join(root, "hls");
mkdirSync(hlsRoot, { recursive: true });

const tracker = await createTrackerServer();
const catalog = new Map([
  ["demo", {
    id: "demo",
    name: "Demo Channel",
    logo: "https://assets.swarmcast.tv/demo.png",
    group: "Demo",
    tvgId: "demo",
    sourceUrl: "https://source.allowed.test/live/demo.m3u8"
  }]
]);

const manager = new ChannelManager({
  catalog,
  spawnFn: syntheticHlsSpawn,
  config: {
    internalToken,
    hlsRoot,
    maxChannels: 1,
    idleTeardownMs: 60_000,
    tailIdleTeardownMs: 15_000,
    tailSwarmThreshold: 5,
    segmentSeconds: 2,
    windowSegments: 6,
    restartBackoffMs: [1000],
    ffmpegBin: "synthetic-hls"
  }
});

const { server } = createIngestServer({
  cfg: { internalToken },
  catalog,
  manager
});
const watcher = watchSegments({
  hlsRoot,
  trackerInternalUrl: tracker.url,
  internalToken,
  rlncK: 32,
  onSegment: (segment) => manager.recordSegment(segment.channelId, Date.now(), segment.seq)
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;

async function request(path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      "x-internal-token": internalToken,
      ...(options.headers || {})
    }
  });
}

try {
  const demandResponse = await request("/channels/demo/demand", {
    method: "POST",
    body: JSON.stringify({ swarmSize: 12 }),
    headers: { "content-type": "application/json" }
  });
  if (!demandResponse.ok) throw new Error(`demand failed: ${demandResponse.status}`);
  const demand = await demandResponse.json();
  if (!demand.ok || demand.state !== "starting") throw new Error("demand did not start the channel");

  const outDir = join(hlsRoot, "demo");
  const playlistPath = join(outDir, "playlist.m3u8");
  const segmentPath = join(outDir, "seg_00000000.m4s");
  await waitFor(() => existsSync(playlistPath) && existsSync(segmentPath), "playlist and first segment");

  const playlist = readFileSync(playlistPath, "utf8");
  if (!playlist.includes("seg_00000000.m4s") || !playlist.includes("#EXT-X-MAP")) {
    throw new Error("playlist missing fMP4 init map or media segment");
  }

  const announce = await waitFor(() => tracker.announces[0], "segment announce");
  if (announce.channelId !== "demo" || announce.seq !== 0 || announce.k !== 32 || announce.size <= 0 || !/^[a-f0-9]{64}$/.test(announce.sha256)) {
    throw new Error("segment announce metadata was invalid");
  }

  const statusResponse = await request("/channels/demo/status");
  const status = await statusResponse.json();
  if (status.state !== "live" || status.swarmSize !== 12 || !status.latestSegmentAt) {
    throw new Error("ingest status did not reflect live demanded channel and announced segment");
  }

  console.log(`ingest demand playlist smoke OK: state=${status.state} seq=${announce.seq} bytes=${announce.size}`);
} finally {
  watcher.close();
  manager.stopAll();
  server.close();
  tracker.server.close();
  rmSync(root, { recursive: true, force: true });
}
