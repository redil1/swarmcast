import https from "node:https";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAuthServer } from "../services/auth/src/index.js";
import { ChannelManager } from "../services/ingest/src/channelManager.js";

const rootDir = process.cwd();
const IMAGE = process.env.SWARMCAST_NGINX_SMOKE_IMAGE || "nginx:1.29.8-alpine3.23-slim@sha256:c9366b8c560169b101ca0e5422ed063b20779e6454c2326b9c9704225c9b0c08";
const ORIGIN_HOST = "origin.example.tv";

function run(cmd, args, label, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    ...options
  });
  if (result.status !== 0 && label) {
    throw new Error(`${label} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result;
}

function commandExists(name) {
  return run("sh", ["-lc", `command -v ${name}`]).status === 0;
}

function dockerReady() {
  return commandExists("docker") && run("docker", ["info", "--format", "{{.ServerVersion}}"]).status === 0;
}

function imageExists(image) {
  return run("docker", ["image", "inspect", image, "--format", "{{.Id}}"]).status === 0;
}

function ensureCertTree(tempRoot, domains) {
  for (const domain of domains) {
    const dir = path.join(tempRoot, "letsencrypt", "live", domain);
    mkdirSync(dir, { recursive: true });
    const result = run("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-subj", `/CN=${domain}`,
      "-keyout", path.join(dir, "privkey.pem"),
      "-out", path.join(dir, "fullchain.pem"),
      "-days", "1"
    ]);
    if (result.status !== 0) {
      throw new Error(`openssl failed for ${domain}\nSTDERR:\n${result.stderr}`);
    }
  }
}

async function listenAllInterfaces(server) {
  server.listen(0, "0.0.0.0");
  await once(server, "listening");
  const port = server.address().port;
  return {
    port,
    localBase: `http://127.0.0.1:${port}`
  };
}

function httpsGet({ port, path: requestPath }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "127.0.0.1",
      port,
      path: requestPath,
      method: "GET",
      servername: ORIGIN_HOST,
      headers: { host: ORIGIN_HOST },
      rejectUnauthorized: false,
      timeout: 5000
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on("timeout", () => req.destroy(new Error("HTTPS request timed out")));
    req.on("error", reject);
    req.end();
  });
}

async function waitForNginx({ containerName, port }) {
  let lastError = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await httpsGet({ port, path: "/live/demo/playlist.m3u8" });
      if (response.statusCode === 401) return;
      lastError = new Error(`unexpected readiness status ${response.statusCode}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const logs = run("docker", ["logs", containerName]).stderr;
  throw new Error(`nginx container did not become ready: ${lastError?.message}\n${logs}`);
}

function containerPort(containerName) {
  const result = run("docker", ["port", containerName, "443/tcp"], "docker port");
  const line = result.stdout.trim().split(/\r?\n/)[0];
  const match = line.match(/:(\d+)$/);
  if (!match) throw new Error(`could not parse mapped nginx port from: ${line}`);
  return Number.parseInt(match[1], 10);
}

function startNginxContainer({ containerName, tempRoot, confDir, hlsRoot }) {
  const args = [
    "run", "-d",
    "--name", containerName,
    "--add-host", "host.docker.internal:host-gateway",
    "--add-host", "tracker:127.0.0.1",
    "--add-host", "control-plane:127.0.0.1",
    "-p", "127.0.0.1::443",
    "-v", `${path.join(rootDir, "infra/nginx/nginx.conf")}:/etc/nginx/nginx.conf:ro`,
    "-v", `${confDir}:/etc/nginx/conf.d:ro`,
    "-v", `${path.join(tempRoot, "letsencrypt")}:/etc/letsencrypt:ro`,
    "-v", `${path.join(tempRoot, "certbot")}:/var/www/certbot:ro`,
    "-v", `${hlsRoot}:/var/hls_alias:ro`,
    IMAGE
  ];

  let result = run("docker", args);
  if (result.status !== 0 && result.stderr.includes("host-gateway")) {
    const retryArgs = args.filter((value, index) => value !== "host.docker.internal:host-gateway" && args[index + 1] !== "host.docker.internal:host-gateway");
    result = run("docker", retryArgs);
  }
  if (result.status !== 0) {
    throw new Error(`docker run nginx origin playback failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
}

function hasRequiredTools() {
  if (!dockerReady()) {
    console.log("Docker daemon not available; skipping nginx origin playback smoke");
    return false;
  }
  if (!imageExists(IMAGE)) {
    console.log(`${IMAGE} image not present; skipping. Run 'docker pull ${IMAGE}' to enable this smoke.`);
    return false;
  }
  for (const command of ["openssl", "ffmpeg"]) {
    if (!commandExists(command)) {
      console.log(`${command} not available; skipping nginx origin playback smoke`);
      return false;
    }
  }
  return true;
}

if (!hasRequiredTools()) process.exit(0);

const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-nginx-origin-playback-"));
const source = path.join(tempRoot, "source.mp4");
const hlsRoot = path.join(tempRoot, "hls");
const outDir = path.join(hlsRoot, "demo");
const confDir = path.join(tempRoot, "conf");
const containerName = `swarmcast-nginx-origin-playback-${process.pid}`;
let authServer = null;

try {
  await mkdir(outDir, { recursive: true });
  mkdirSync(confDir, { recursive: true });
  mkdirSync(path.join(tempRoot, "certbot", ".well-known", "acme-challenge"), { recursive: true });
  ensureCertTree(tempRoot, ["origin.example.tv", "api.example.tv", "tracker.example.tv"]);

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

  authServer = await createAuthServer({
    keyPath: path.join(tempRoot, "es256.pem"),
    appApiKey: "app-key"
  });
  const auth = await listenAllInterfaces(authServer);

  const originConf = readFileSync(path.join(rootDir, "infra/nginx/swarmcast.conf"), "utf8")
    .replace("server auth:7003;", `server host.docker.internal:${auth.port};`);
  writeFileSync(path.join(confDir, "swarmcast.conf"), originConf);

  startNginxContainer({ containerName, tempRoot, confDir, hlsRoot });
  const tlsPort = containerPort(containerName);
  await waitForNginx({ containerName, port: tlsPort });

  const tokenResponse = await fetch(`${auth.localBase}/token`, {
    method: "POST",
    headers: { "x-app-key": "app-key" }
  });
  if (!tokenResponse.ok) throw new Error(`token failed: ${tokenResponse.status}`);
  const { token } = await tokenResponse.json();

  const denied = await httpsGet({ port: tlsPort, path: "/live/demo/playlist.m3u8" });
  if (denied.statusCode !== 401) throw new Error(`expected unauthorized playlist without token, got ${denied.statusCode}`);

  const playlist = await httpsGet({ port: tlsPort, path: `/live/demo/playlist.m3u8?token=${encodeURIComponent(token)}` });
  if (playlist.statusCode !== 200) throw new Error(`playlist fetch failed: ${playlist.statusCode}\n${playlist.body.toString("utf8")}`);
  const playlistText = playlist.body.toString("utf8");
  if (!playlistText.includes("#EXTM3U") || !playlistText.includes(".m4s")) {
    throw new Error("nginx-served playlist did not look like HLS fMP4 output");
  }
  if (!String(playlist.headers["cache-control"] || "").includes("no-cache")) {
    throw new Error("playlist cache-control header missing no-cache policy");
  }

  const firstSegment = readdirSync(outDir).filter((name) => name.endsWith(".m4s")).sort()[0];
  if (!firstSegment) throw new Error("HLS packaging did not produce a media segment");
  const segment = await httpsGet({ port: tlsPort, path: `/live/demo/${firstSegment}?token=${encodeURIComponent(token)}` });
  if (segment.statusCode !== 200) throw new Error(`segment fetch failed: ${segment.statusCode}`);
  if (segment.body.length === 0) throw new Error("segment body was empty");
  if (!String(segment.headers["cache-control"] || "").includes("immutable")) {
    throw new Error("segment cache-control header missing immutable policy");
  }

  console.log(`nginx origin playback smoke OK: tlsPort=${tlsPort} playlist=200 segment=${firstSegment} unauthorized=401`);
} finally {
  run("docker", ["rm", "-f", containerName]);
  if (authServer) await new Promise((resolve) => authServer.close(resolve));
  rmSync(tempRoot, { recursive: true, force: true });
}
