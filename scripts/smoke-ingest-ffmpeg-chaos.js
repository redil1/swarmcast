import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChannelManager, CHANNEL_STATE, MAX_FFMPEG_FAILURES } from "../services/ingest/src/channelManager.js";

function fakeProc() {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = (signal) => {
    proc.killedWith = signal;
    proc.emit("exit", 0);
  };
  return proc;
}

async function waitFor(fn, { timeoutMs = 2000, intervalMs = 5 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("timed out");
}

const hlsRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-ingest-chaos-"));
const procs = [];
const errors = [];

const manager = new ChannelManager({
  catalog: new Map([
    ["chaos", { id: "chaos", sourceUrl: "https://source.example/live/chaos.m3u8" }]
  ]),
  config: {
    hlsRoot,
    maxChannels: 1,
    idleTeardownMs: 30_000,
    tailIdleTeardownMs: 1000,
    tailSwarmThreshold: 5,
    segmentSeconds: 2,
    windowSegments: 30,
    restartBackoffMs: [1],
    ffmpegBin: "ffmpeg"
  },
  logger: {
    error: (...args) => errors.push(args)
  },
  spawnFn: () => {
    const proc = fakeProc();
    procs.push(proc);
    return proc;
  }
});

try {
  const demand = manager.demand("chaos", { swarmSize: 2 });
  if (!demand.ok || demand.state !== CHANNEL_STATE.STARTING) {
    throw new Error(`unexpected initial demand response: ${JSON.stringify(demand)}`);
  }

  for (let i = 0; i < MAX_FFMPEG_FAILURES - 1; i += 1) {
    procs[i].emit("exit", 1);
    await waitFor(() => procs.length === i + 2);
    const status = manager.status("chaos");
    if (status.failures !== i + 1) throw new Error(`expected ${i + 1} failures, got ${status.failures}`);
    if (status.swarmSize !== 2) throw new Error(`swarmSize was not preserved across restart: ${status.swarmSize}`);
    if (status.state !== CHANNEL_STATE.LIVE) throw new Error(`channel degraded too early at failure ${status.failures}`);
  }

  procs[MAX_FFMPEG_FAILURES - 1].emit("exit", 1);
  await waitFor(() => manager.status("chaos").state === CHANNEL_STATE.DEGRADED);

  const degraded = manager.status("chaos");
  if (degraded.failures !== MAX_FFMPEG_FAILURES) {
    throw new Error(`expected ${MAX_FFMPEG_FAILURES} failures, got ${degraded.failures}`);
  }
  if (procs.length !== MAX_FFMPEG_FAILURES) {
    throw new Error(`expected restart loop to stop after ${MAX_FFMPEG_FAILURES} processes, got ${procs.length}`);
  }
  if (errors[0]?.[0] !== "ffmpeg_worker_failed") {
    throw new Error("expected degraded-state ffmpeg_worker_failed log");
  }

  const followupDemand = manager.demand("chaos", { swarmSize: 4 });
  if (!followupDemand.ok || followupDemand.state !== CHANNEL_STATE.DEGRADED) {
    throw new Error(`degraded channel did not report degraded demand state: ${JSON.stringify(followupDemand)}`);
  }
  if (manager.status("chaos").swarmSize !== 4) {
    throw new Error("degraded channel did not keep latest demand swarm size");
  }

  console.log(`ingest ffmpeg chaos smoke OK: restarts=${procs.length - 1} failures=${degraded.failures} state=${degraded.state} swarmSize=${manager.status("chaos").swarmSize}`);
} finally {
  manager.stopAll();
  rmSync(hlsRoot, { recursive: true, force: true });
}
