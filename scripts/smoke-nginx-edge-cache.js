import https from "node:https";
import http from "node:http";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  createReadStream
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAuthServer } from "../services/auth/src/index.js";
import { ChannelManager } from "../services/ingest/src/channelManager.js";

const rootDir = process.cwd();
const IMAGE = process.env.SWARMCAST_NGINX_SMOKE_IMAGE || "nginx:1.29.8-alpine3.23-slim@sha256:c9366b8c560169b101ca0e5422ed063b20779e6454c2326b9c9704225c9b0c08";
const EDGE_HOST = "edge.example.tv";

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

function dockerHostGateway() {
  const result = run("docker", [
    "run", "--rm",
    "--add-host", "host.docker.internal:host-gateway",
    IMAGE,
    "getent", "hosts", "host.docker.internal"
  ]);
  const ip = result.stdout.trim().split(/\s+/)[0];
  return ip || "host.docker.internal";
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
    if (result.status !== 0) throw new Error(`openssl failed for ${domain}\n${result.stderr}`);
  }
}

async function listenAllInterfaces(server) {
  server.listen(0, "0.0.0.0");
  await once(server, "listening");
  return {
    port: server.address().port,
    localBase: `http://127.0.0.1:${server.address().port}`
  };
}

function httpsGet({ port, path: requestPath }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "127.0.0.1",
      port,
      path: requestPath,
      method: "GET",
      servername: EDGE_HOST,
      headers: { host: EDGE_HOST },
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

async function waitForEdge({ containerName, port }) {
  let lastError = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await httpsGet({ port, path: "/live/demo/missing.m4s" });
      if (response.statusCode === 401) return;
      lastError = new Error(`unexpected readiness status ${response.statusCode}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const logs = run("docker", ["logs", containerName]);
  throw new Error(`edge nginx did not become ready: ${lastError?.message}\n${logs.stdout}\n${logs.stderr}`);
}

function containerPort(containerName) {
  const result = run("docker", ["port", containerName, "443/tcp"], "docker port");
  const line = result.stdout.trim().split(/\r?\n/)[0];
  const match = line.match(/:(\d+)$/);
  if (!match) throw new Error(`could not parse mapped edge port from: ${line}`);
  return Number.parseInt(match[1], 10);
}

function startEdgeContainer({ containerName, tempRoot, confDir, mainConfig }) {
  const args = [
    "run", "-d",
    "--name", containerName,
    "--add-host", "host.docker.internal:host-gateway",
    "-p", "127.0.0.1::443",
    "-v", `${mainConfig}:/etc/nginx/nginx.conf:ro`,
    "-v", `${confDir}:/etc/nginx/conf.d:ro`,
    "-v", `${path.join(tempRoot, "letsencrypt")}:/etc/letsencrypt:ro`,
    "-v", `${path.join(tempRoot, "certbot")}:/var/www/certbot:ro`,
    "-v", `${path.join(tempRoot, "logs")}:/var/log/nginx`,
    "--tmpfs", "/dev/shm/edgecache:size=32m",
    IMAGE
  ];

  let result = run("docker", args);
  if (result.status !== 0 && result.stderr.includes("host-gateway")) {
    const retryArgs = args.filter((value, index) => value !== "host.docker.internal:host-gateway" && args[index + 1] !== "host.docker.internal:host-gateway");
    result = run("docker", retryArgs);
  }
  if (result.status !== 0) {
    throw new Error(`docker run edge nginx failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
}

function hasRequiredTools() {
  if (!dockerReady()) {
    console.log("Docker daemon not available; skipping nginx edge cache smoke");
    return false;
  }
  if (!imageExists(IMAGE)) {
    console.log(`${IMAGE} image not present; skipping. Run 'docker pull ${IMAGE}' to enable this smoke.`);
    return false;
  }
  for (const command of ["openssl", "ffmpeg"]) {
    if (!commandExists(command)) {
      console.log(`${command} not available; skipping nginx edge cache smoke`);
      return false;
    }
  }
  return true;
}

if (!hasRequiredTools()) process.exit(0);

const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-nginx-edge-cache-"));
const source = path.join(tempRoot, "source.mp4");
const hlsRoot = path.join(tempRoot, "hls");
const outDir = path.join(hlsRoot, "demo");
const confDir = path.join(tempRoot, "conf");
const mainConfig = path.join(tempRoot, "nginx.conf");
const containerName = `swarmcast-nginx-edge-cache-${process.pid}`;
let authServer = null;
let originServer = null;

try {
  await mkdir(outDir, { recursive: true });
  mkdirSync(confDir, { recursive: true });
  mkdirSync(path.join(tempRoot, "logs"), { recursive: true });
  mkdirSync(path.join(tempRoot, "certbot", ".well-known", "acme-challenge"), { recursive: true });
  ensureCertTree(tempRoot, ["edge.example.tv"]);

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
  const originHits = { count: 0 };
  originServer = createOriginServer({ hlsRoot, authBase: auth.localBase, originHits });
  const origin = await listenAllInterfaces(originServer);
  const hostGateway = dockerHostGateway();

  const edgeConf = readFileSync(path.join(rootDir, "infra/edge/nginx-edge.conf"), "utf8")
    .replace("proxy_pass https://auth.example.tv/verify;", `proxy_pass http://${hostGateway}:${auth.port}/verify;`)
    .replace("proxy_pass https://origin.example.tv/live/$rest$is_args$args;", `proxy_pass http://${hostGateway}:${origin.port}/live/$rest$is_args$args;`)
    .replace("proxy_pass https://$node.origin.example.tv/live/$rest$is_args$args;", `proxy_pass http://${hostGateway}:${origin.port}/live/$rest$is_args$args;`);
  writeFileSync(path.join(confDir, "edge.conf"), edgeConf);
  writeFileSync(mainConfig, `
worker_processes auto;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  include /etc/nginx/conf.d/*.conf;
}
`);

  startEdgeContainer({ containerName, tempRoot, confDir, mainConfig });
  const tlsPort = containerPort(containerName);
  await waitForEdge({ containerName, port: tlsPort });

  const tokenResponse = await fetch(`${auth.localBase}/token`, {
    method: "POST",
    headers: { "x-app-key": "app-key" }
  });
  if (!tokenResponse.ok) throw new Error(`token failed: ${tokenResponse.status}`);
  const { token } = await tokenResponse.json();
  const secondTokenResponse = await fetch(`${auth.localBase}/token`, {
    method: "POST",
    headers: { "x-app-key": "app-key" }
  });
  if (!secondTokenResponse.ok) throw new Error(`second token failed: ${secondTokenResponse.status}`);
  const { token: secondToken } = await secondTokenResponse.json();
  const firstSegment = readdirSync(outDir).filter((name) => name.endsWith(".m4s")).sort()[0];
  if (!firstSegment) throw new Error("HLS packaging did not produce a media segment");

  const denied = await httpsGet({ port: tlsPort, path: `/live/demo/${firstSegment}` });
  if (denied.statusCode !== 401) throw new Error(`expected unauthorized edge fetch, got ${denied.statusCode}`);

  const first = await httpsGet({ port: tlsPort, path: `/live/demo/${firstSegment}?token=${encodeURIComponent(token)}` });
  if (first.statusCode !== 200 || String(first.headers["x-cache"] || "") !== "MISS") {
    throw new Error(`expected first edge fetch MISS, got ${first.statusCode} ${first.headers["x-cache"]}`);
  }

  const second = await httpsGet({ port: tlsPort, path: `/live/demo/${firstSegment}?token=${encodeURIComponent(secondToken)}` });
  if (second.statusCode !== 200 || String(second.headers["x-cache"] || "") !== "HIT") {
    throw new Error(`expected second edge fetch HIT, got ${second.statusCode} ${second.headers["x-cache"]}`);
  }

  if (!first.body.equals(second.body)) throw new Error("cached segment body differed from origin fill");
  if (originHits.count !== 1) throw new Error(`expected one origin fill, got ${originHits.count}`);

  console.log(`nginx edge cache smoke OK: tlsPort=${tlsPort} ${firstSegment} unauthorized=401 MISS then crossTokenHIT originFills=1`);
} finally {
  run("docker", ["rm", "-f", containerName]);
  if (originServer) await new Promise((resolve) => originServer.close(resolve));
  if (authServer) await new Promise((resolve) => authServer.close(resolve));
  rmSync(tempRoot, { recursive: true, force: true });
}
