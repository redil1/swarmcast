import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const token = "0123456789abcdef".repeat(4);
const fixtureCatalog = resolve("test-fixtures/catalog/sample.m3u");
const retentionPolicy = resolve("config/data-retention.json");
const tempDir = mkdtempSync(join(tmpdir(), "swarmcast-service-lifecycle-"));
const edgeLog = join(tempDir, "edge-access.log");
writeFileSync(edgeLog, "");

const services = [
  {
    id: "auth",
    image: process.env.AUTH_LIFECYCLE_IMAGE || "infra-auth:latest",
    env: {
      APP_API_KEY: token,
      ICE_SERVER_ALLOWED_HOSTS: "stun.example.tv",
      ICE_STUN_URLS: '["stun:stun.example.tv:3478"]'
    },
    tmpfs: ["/data:rw,noexec,nosuid,size=16m,uid=65532,gid=65532"]
  },
  {
    id: "control-plane",
    image: process.env.CONTROL_PLANE_LIFECYCLE_IMAGE || "infra-control-plane:latest",
    env: {
      INTERNAL_TOKEN: token,
      M3U_PATH: "/config/source.m3u",
      SOURCE_ALLOWED_HOSTS: "source.example",
      CATALOG_DB_PATH: "/data/catalog.sqlite",
      PLACEMENT_DB_PATH: "/data/placements.sqlite"
    },
    mounts: [`${fixtureCatalog}:/config/source.m3u:ro`],
    tmpfs: ["/data:rw,noexec,nosuid,size=32m,uid=65532,gid=65532"]
  },
  {
    id: "ingest",
    image: process.env.INGEST_LIFECYCLE_IMAGE || "infra-ingest:latest",
    env: {
      INTERNAL_TOKEN: token,
      M3U_PATH: "/config/source.m3u",
      SOURCE_ALLOWED_HOSTS: "source.example",
      TRACKER_INTERNAL_URL: "http://127.0.0.1:1"
    },
    mounts: [`${fixtureCatalog}:/config/source.m3u:ro`],
    tmpfs: ["/var/hls:rw,noexec,nosuid,size=64m,uid=1000,gid=1000"]
  },
  {
    id: "retention-worker",
    image: process.env.RETENTION_WORKER_LIFECYCLE_IMAGE || "infra-retention-worker:latest",
    env: {
      RETENTION_POLICY_FILE: "/config/data-retention.json",
      RETENTION_RUN_ON_START: "0",
      RETENTION_EXECUTE: "0",
      RETENTION_RECORDS_FILE: "/data/retention-records.jsonl",
      RETENTION_ACTION_LOG: "/data/retention-actions.jsonl"
    },
    mounts: [`${retentionPolicy}:/config/data-retention.json:ro`],
    tmpfs: ["/data:rw,noexec,nosuid,size=16m,uid=65532,gid=65532"]
  },
  {
    id: "tracker",
    image: process.env.TRACKER_LIFECYCLE_IMAGE || "infra-tracker:latest",
    env: {
      INTERNAL_TOKEN: token,
      AUTH_JWKS_URL: "http://127.0.0.1:1/jwks",
      ORIGIN_BASE: "https://origin.example.tv",
      EDGE_BASE: "https://edge.example.tv"
    }
  },
  {
    id: "edge-metrics",
    image: process.env.EDGE_METRICS_LIFECYCLE_IMAGE || "swarmcast-edge-metrics:local",
    env: { EDGE_ACCESS_LOG: "/var/log/nginx/edge-access.log" },
    mounts: [`${edgeLog}:/var/log/nginx/edge-access.log:ro`],
    structuredShutdown: false
  }
];

function docker(args, { allowFailure = false } = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function inspect(name, format) {
  return docker(["inspect", "--format", format, name]).stdout.trim();
}

async function waitHealthy(name, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = JSON.parse(inspect(name, "{{json .State}}"));
    if (!state.Running) {
      const logs = docker(["logs", name], { allowFailure: true });
      throw new Error(`${name} exited before healthy with code ${state.ExitCode}\n${logs.stdout}\n${logs.stderr}`);
    }
    if (state.Health?.Status === "healthy") return;
    if (state.Health?.Status === "unhealthy") {
      const logs = docker(["logs", name], { allowFailure: true });
      throw new Error(`${name} became unhealthy\n${logs.stdout}\n${logs.stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${name} did not become healthy within ${timeoutMs}ms`);
}

function containerArgs(service, name) {
  const args = [
    "run", "-d", "--name", name,
    "--init",
    "--read-only",
    "--stop-timeout", "15",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m"
  ];
  for (const value of service.tmpfs || []) args.push("--tmpfs", value);
  for (const value of service.mounts || []) args.push("--volume", value);
  for (const [key, value] of Object.entries(service.env || {})) args.push("--env", `${key}=${value}`);
  args.push(service.image);
  return args;
}

if (docker(["info"], { allowFailure: true }).status !== 0) {
  console.log("service lifecycle container smoke SKIPPED: Docker is unavailable");
  process.exit(0);
}

const names = [];
try {
  for (const service of services) {
    const name = `swarmcast-lifecycle-${service.id}-${process.pid}`;
    names.push(name);
    docker(containerArgs(service, name));
    await waitHealthy(name);

    const hostConfig = JSON.parse(inspect(name, "{{json .HostConfig}}"));
    if (!hostConfig.ReadonlyRootfs) throw new Error(`${service.id} root filesystem is writable`);
    if (!hostConfig.Init) throw new Error(`${service.id} does not use an init process`);
    if (!hostConfig.CapDrop?.includes("ALL")) throw new Error(`${service.id} does not drop all capabilities`);
    if (!hostConfig.SecurityOpt?.includes("no-new-privileges")) {
      throw new Error(`${service.id} does not set no-new-privileges`);
    }

    docker(["stop", "--time", "15", name]);
    const state = JSON.parse(inspect(name, "{{json .State}}"));
    if (state.ExitCode !== 0) throw new Error(`${service.id} stopped with exit code ${state.ExitCode}`);
    const logs = docker(["logs", name]).stdout;
    if (service.structuredShutdown !== false && !logs.includes('"event":"service_shutdown_completed"')) {
      throw new Error(`${service.id} did not log completed graceful shutdown`);
    }
  }
  console.log(`service lifecycle container smoke OK: services=${services.length} healthy=${services.length} graceful=${services.length}`);
} finally {
  for (const name of names) docker(["rm", "-f", name], { allowFailure: true });
  rmSync(tempDir, { recursive: true, force: true });
}
