import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { preflightM3uFile } from "./source-preflight.js";

function runSourcePreflightCli(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/source-preflight.js"], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/ok.m3u8") {
    res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
    res.end(req.method === "HEAD" ? "" : "#EXTM3U\n");
    return;
  }

  if (req.url === "/get-only.m3u8") {
    if (req.method === "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    res.writeHead(206, { "content-type": "application/vnd.apple.mpegurl" });
    res.end("#EXTM3U\n");
    return;
  }

  if (req.url === "/down.m3u8") {
    res.writeHead(503);
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(0, "127.0.0.1");
await once(server, "listening");

const tempDir = await mkdtemp(path.join(os.tmpdir(), "swarmcast-source-preflight-"));
try {
  const port = server.address().port;
  const healthyPath = path.join(tempDir, "healthy.m3u");
  const failingPath = path.join(tempDir, "failing.m3u");
  const healthyM3u = `#EXTM3U
#EXTINF:-1 group-title="News",Healthy News
http://127.0.0.1:${port}/ok.m3u8
#EXTINF:-1 group-title="News",Get Only News
http://127.0.0.1:${port}/get-only.m3u8
`;
  const failingM3u = `${healthyM3u}#EXTINF:-1 group-title="News",Down News
http://127.0.0.1:${port}/down.m3u8
`;
  const sourcePolicy = {
    allowedHosts: ["127.0.0.1"],
    allowPrivateNetworks: true
  };

  await writeFile(healthyPath, healthyM3u);
  await writeFile(failingPath, failingM3u);

  const healthy = await preflightM3uFile(healthyPath, {
    sourcePolicy,
    timeoutMs: 1000,
    maxConcurrency: 2
  });
  if (healthy.total !== 2 || healthy.failed !== 0) {
    throw new Error(`expected healthy sources to pass, got total=${healthy.total} failed=${healthy.failed}`);
  }
  if (!healthy.results.some((result) => result.method === "GET" && result.status === 206)) {
    throw new Error("expected GET fallback for source that rejects HEAD");
  }

  const failing = await preflightM3uFile(failingPath, {
    sourcePolicy,
    timeoutMs: 1000,
    maxConcurrency: 2
  });
  if (failing.total !== 3 || failing.failed !== 1) {
    throw new Error(`expected one failing source, got total=${failing.total} failed=${failing.failed}`);
  }
  if (failing.results.some((result) => "sourceUrl" in result)) {
    throw new Error("preflight results must not expose sourceUrl");
  }

  const cli = await runSourcePreflightCli({
    ...process.env,
    M3U_PATH: healthyPath,
    SOURCE_ALLOWED_HOSTS: "127.0.0.1",
    SOURCE_ALLOW_PRIVATE_NETWORKS: "1",
    SOURCE_PREFLIGHT_TIMEOUT_MS: "1000",
    SOURCE_PREFLIGHT_MAX_CONCURRENCY: "2"
  });
  if (cli.status !== 0 || !cli.stdout.includes("failed=0")) {
    throw new Error(`expected source preflight CLI to pass, status=${cli.status}, stdout=${cli.stdout}, stderr=${cli.stderr}`);
  }

  console.log(`catalog source preflight smoke OK: healthy=${healthy.healthy} failedDetected=${failing.failed}`);
} finally {
  server.close();
  await rm(tempDir, { recursive: true, force: true });
}
