import http from "node:http";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAuthServer } from "../services/auth/src/index.js";
import { ChannelManager } from "../services/ingest/src/channelManager.js";

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
}

function hasCommand(name) {
  return spawnSync("sh", ["-lc", `command -v ${name}`]).status === 0;
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

function createOriginServer({ hlsRoot, authBase, originHits }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://origin.local");
    const token = url.searchParams.get("token") || "";
    const verify = await fetch(`${authBase}/verify`, { headers: { "x-auth-token": token } });
    if (verify.status !== 204) {
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }

    const relative = url.pathname.replace(/^\/live\//, "");
    const fullPath = path.join(hlsRoot, relative);
    if (!url.pathname.startsWith("/live/") || !fullPath.startsWith(hlsRoot) || !existsSync(fullPath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    originHits.count += 1;
    res.setHeader("cache-control", fullPath.endsWith(".m3u8") ? "no-cache" : "public, max-age=300, immutable");
    res.writeHead(200);
    createReadStream(fullPath).pipe(res);
  });
}

function createEdgeServer({ originBase, authBase }) {
  const cache = new Map();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://edge.local");
    if (!url.pathname.startsWith("/live/")) {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    const token = url.searchParams.get("token") || "";
    const verify = await fetch(`${authBase}/verify`, { headers: { "x-auth-token": token } });
    if (verify.status !== 204) {
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }

    const key = url.pathname;
    const cached = cache.get(key);
    if (cached) {
      res.setHeader("x-cache", "HIT");
      res.setHeader("cache-control", cached.cacheControl);
      res.writeHead(200);
      res.end(cached.body);
      return;
    }

    const upstream = await fetch(`${originBase}${url.pathname}?token=${token}`);
    if (!upstream.ok) {
      res.writeHead(upstream.status);
      res.end(await upstream.text());
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    const cacheControl = upstream.headers.get("cache-control") || "";
    if (!url.pathname.endsWith(".m3u8")) {
      cache.set(key, { body, cacheControl });
    }

    res.setHeader("x-cache", "MISS");
    res.setHeader("cache-control", cacheControl);
    res.writeHead(200);
    res.end(body);
  });
}

if (!hasCommand("ffmpeg")) {
  console.log("ffmpeg not available; skipping edge cache smoke");
  process.exit(0);
}

const root = mkdtempSync(path.join(tmpdir(), "swarmcast-edge-cache-"));
const source = path.join(root, "source.mp4");
const hlsRoot = path.join(root, "hls");
const outDir = path.join(hlsRoot, "demo");
await mkdir(outDir, { recursive: true });

run("ffmpeg", [
  "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25",
  "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000",
  "-t", "6",
  "-c:v", "libx264", "-preset", "ultrafast", "-g", "50", "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  source
], "source generation");

const manager = new ChannelManager({
  catalog: new Map(),
  config: {
    hlsRoot,
    maxChannels: 1,
    idleTeardownMs: 60_000,
    segmentSeconds: 2,
    windowSegments: 6,
    restartBackoffMs: [1000],
    ffmpegBin: "ffmpeg"
  }
});
run("ffmpeg", manager.ffmpegArgs(source, outDir), "hls packaging");

const authServer = await createAuthServer({
  keyPath: path.join(root, "es256.pem"),
  appApiKey: "app-key"
});
const authBase = await listen(authServer);
const originHits = { count: 0 };
const originServer = createOriginServer({ hlsRoot, authBase, originHits });
const originBase = await listen(originServer);
const edgeServer = createEdgeServer({ originBase, authBase });
const edgeBase = await listen(edgeServer);

try {
  const tokenResponse = await fetch(`${authBase}/token`, {
    method: "POST",
    headers: { "x-app-key": "app-key" }
  });
  const { token } = await tokenResponse.json();
  const firstSegment = readdirSync(outDir).filter((name) => name.endsWith(".m4s")).sort()[0];

  const denied = await fetch(`${edgeBase}/live/demo/${firstSegment}`);
  if (denied.status !== 401) throw new Error(`expected unauthorized edge fetch, got ${denied.status}`);

  const first = await fetch(`${edgeBase}/live/demo/${firstSegment}?token=${token}`);
  if (!first.ok || first.headers.get("x-cache") !== "MISS") {
    throw new Error(`expected first edge fetch MISS, got ${first.status} ${first.headers.get("x-cache")}`);
  }
  const firstBytes = Buffer.from(await first.arrayBuffer());

  const second = await fetch(`${edgeBase}/live/demo/${firstSegment}?token=${token}`);
  if (!second.ok || second.headers.get("x-cache") !== "HIT") {
    throw new Error(`expected second edge fetch HIT, got ${second.status} ${second.headers.get("x-cache")}`);
  }
  const secondBytes = Buffer.from(await second.arrayBuffer());

  if (!firstBytes.equals(secondBytes)) throw new Error("cached segment body differed from origin fill");
  if (originHits.count !== 1) throw new Error(`expected one origin fill, got ${originHits.count}`);

  console.log(`edge cache smoke OK: ${firstSegment} MISS then HIT with one origin fill`);
} finally {
  await new Promise((resolve) => edgeServer.close(resolve));
  await new Promise((resolve) => originServer.close(resolve));
  await new Promise((resolve) => authServer.close(resolve));
}
