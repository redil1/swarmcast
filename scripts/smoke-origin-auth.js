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

async function createOriginServer({ hlsRoot, authBase }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://origin.local");
    if (!url.pathname.startsWith("/live/")) {
      res.writeHead(404);
      res.end();
      return;
    }

    const token = url.searchParams.get("token") || "";
    const verify = await fetch(`${authBase}/verify`, { headers: { "x-auth-token": token } });
    if (verify.status !== 204) {
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }

    const relative = url.pathname.replace(/^\/live\//, "");
    const fullPath = path.join(hlsRoot, relative);
    if (!fullPath.startsWith(hlsRoot) || !existsSync(fullPath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    if (fullPath.endsWith(".m3u8")) {
      res.setHeader("cache-control", "no-cache");
      res.setHeader("content-type", "application/vnd.apple.mpegurl");
    } else {
      res.setHeader("cache-control", "public, max-age=300, immutable");
      res.setHeader("content-type", "video/mp4");
    }
    res.writeHead(200);
    createReadStream(fullPath).pipe(res);
  });
}

if (!hasCommand("ffmpeg")) {
  console.log("ffmpeg not available; skipping authenticated origin smoke");
  process.exit(0);
}

const root = mkdtempSync(path.join(tmpdir(), "swarmcast-origin-auth-"));
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
const originServer = await createOriginServer({ hlsRoot, authBase });
const originBase = await listen(originServer);

try {
  const tokenResponse = await fetch(`${authBase}/token`, {
    method: "POST",
    headers: { "x-app-key": "app-key" }
  });
  if (!tokenResponse.ok) throw new Error(`token failed: ${tokenResponse.status}`);
  const { token } = await tokenResponse.json();

  const denied = await fetch(`${originBase}/live/demo/playlist.m3u8`);
  if (denied.status !== 401) throw new Error(`expected unauthorized playlist without token, got ${denied.status}`);

  const playlist = await fetch(`${originBase}/live/demo/playlist.m3u8?token=${token}`);
  if (!playlist.ok) throw new Error(`playlist fetch failed: ${playlist.status}`);
  const playlistText = await playlist.text();
  if (!playlistText.includes("#EXTM3U") || !playlistText.includes(".m4s")) {
    throw new Error("playlist did not look like HLS fMP4 output");
  }

  const firstSegment = readdirSync(outDir).filter((name) => name.endsWith(".m4s")).sort()[0];
  const segment = await fetch(`${originBase}/live/demo/${firstSegment}?token=${token}`);
  if (!segment.ok) throw new Error(`segment fetch failed: ${segment.status}`);
  const bytes = Buffer.from(await segment.arrayBuffer());
  if (bytes.length === 0) throw new Error("segment body was empty");
  if (!segment.headers.get("cache-control")?.includes("immutable")) {
    throw new Error("segment cache-control header missing immutable policy");
  }

  console.log(`authenticated origin smoke OK: playlist and ${firstSegment} fetched`);
} finally {
  await new Promise((resolve) => originServer.close(resolve));
  await new Promise((resolve) => authServer.close(resolve));
}
