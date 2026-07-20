import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const image = process.env.TURN_SMOKE_IMAGE || "swarmcast-turn:local";
const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const name = `swarmcast-turn-smoke-${process.pid}`;
const directory = mkdtempSync(path.join(tmpdir(), "swarmcast-turn-"));
const cert = path.join(directory, "fullchain.pem");
const key = path.join(directory, "privkey.pem");
const renderScript = path.resolve("infra/turn/render-config.sh");

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: options.stdio || "pipe",
      timeout: options.timeoutMs ?? 15_000
    });
  } catch (error) {
    const detail = `${error.stdout || ""}${error.stderr || ""}`.replaceAll(secret, "[redacted]").trim();
    const timedOut = error.code === "ETIMEDOUT" ? ` after ${options.timeoutMs ?? 15_000}ms` : "";
    throw new Error(`${command} failed${timedOut}${detail ? `: ${detail}` : ""}`);
  }
}

function dockerAvailable() {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  return result.status === 0;
}

if (!dockerAvailable()) {
  console.log("TURN smoke skipped: Docker is unavailable");
  process.exit(0);
}

try {
  if (spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status !== 0) {
    run("docker", ["build", "--pull", "-f", "infra/turn/Dockerfile", "-t", image, "."], {
      timeoutMs: 300_000
    });
  }
  run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-keyout", key, "-out", cert
  ]);
  chmodSync(directory, 0o755);
  chmodSync(cert, 0o644);
  chmodSync(key, 0o644);

  run("docker", [
    "run", "-d", "--name", name,
    "--read-only",
    "--tmpfs", "/run:size=1m,mode=0700,uid=65534,gid=65534",
    "--tmpfs", "/tmp:size=16m,mode=1777",
    "--cap-drop=ALL", "--cap-add=NET_BIND_SERVICE",
    "-e", "TURN_REALM=turn.smoke.local",
    "-e", `TURN_SHARED_SECRET=${secret}`,
    "-e", "TURN_LISTENING_PORT=3478",
    "-e", "TURN_TLS_LISTENING_PORT=5349",
    "-e", "TURN_MIN_PORT=55000",
    "-e", "TURN_MAX_PORT=55099",
    "-e", "TURN_USER_QUOTA=4",
    "-e", "TURN_TOTAL_QUOTA=50",
    "-e", "TURN_MAX_BPS=1250000",
    "-e", "TURN_BPS_CAPACITY=100000000",
    "-e", "TURN_PROMETHEUS_PORT=9641",
    "-e", "TURN_ALLOW_PRIVATE_PEERS=1",
    "-p", "127.0.0.1::9641/tcp",
    "-v", `${renderScript}:/etc/swarmcast/render-config.sh:ro`,
    "-v", `${directory}:/certs:ro`,
    "--entrypoint", "/bin/sh",
    image,
    "/etc/swarmcast/render-config.sh"
  ], { timeoutMs: 60_000 });

  let running = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = run("docker", ["inspect", "--format", "{{.State.Running}}", name]).trim();
    if (state === "true") {
      try {
        run("docker", ["exec", name, "turnutils_stunclient", "-p", "3478", "127.0.0.1"], { timeoutMs: 3_000 });
        running = true;
        break;
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      }
    }
  }
  if (!running) throw new Error("coturn did not become STUN-ready");

  run("docker", [
    "exec", name, "turnutils_uclient", "-W", secret, "-y", "-c", "-n", "1",
    "-p", "3478", "127.0.0.1"
  ], { timeoutMs: 30_000 });
  run("docker", [
    "exec", name, "turnutils_uclient", "-W", secret, "-y", "-c", "-n", "1",
    "-t", "-S", "-p", "5349", "127.0.0.1"
  ], { timeoutMs: 30_000 });

  const metricsBinding = run("docker", ["port", name, "9641/tcp"]).trim();
  const metricsPort = Number.parseInt(metricsBinding.slice(metricsBinding.lastIndexOf(":") + 1), 10);
  const metricsResponse = await fetch(`http://127.0.0.1:${metricsPort}/metrics`, {
    signal: AbortSignal.timeout(5_000)
  });
  const metricsText = await metricsResponse.text();
  if (!metricsResponse.ok || !metricsText.includes("# HELP") || !metricsText.includes("turn_")) {
    throw new Error("coturn Prometheus endpoint did not return TURN metrics");
  }
  if (process.env.TURN_SMOKE_PRINT_METRICS === "1") {
    const names = [...metricsText.matchAll(/^([a-zA-Z_:][a-zA-Z0-9_:]*)/gm)].map((match) => match[1]);
    console.log([...new Set(names)].sort().join("\n"));
  }

  console.log("TURN smoke OK: STUN, authenticated UDP/TLS relay, and Prometheus metrics passed");
} catch (error) {
  let state = "";
  let logs = "";
  try {
    state = run("docker", ["inspect", "--format", "{{json .State}}", name]).trim();
  } catch {}
  try {
    const result = spawnSync("docker", ["logs", name], { encoding: "utf8" });
    logs = `${result.stdout || ""}${result.stderr || ""}`.slice(-4000);
  } catch {}
  if (state) console.error(state);
  if (logs) console.error(logs);
  console.error(`TURN smoke failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  rmSync(directory, { recursive: true, force: true });
}
