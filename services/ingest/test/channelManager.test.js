import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChannelManager } from "../src/channelManager.js";

function fakeProc() {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = (signal) => {
    proc.killedWith = signal;
    proc.emit("exit", 0);
  };
  return proc;
}

function testConfig(overrides = {}) {
  return {
    hlsRoot: mkdtempSync(path.join(tmpdir(), "swarmcast-")),
    maxChannels: 1,
    idleTeardownMs: 1,
    tailIdleTeardownMs: 1,
    tailAdmissionMaxChannels: 0,
    tailDownscaleEnabled: false,
    tailDownscaleVideoKbps: 900,
    tailDownscaleAudioKbps: 64,
    tailSwarmThreshold: 5,
    segmentSeconds: 2,
    windowSegments: 30,
    restartBackoffMs: [1],
    ffmpegBin: "ffmpeg",
    ...overrides
  };
}

async function waitFor(fn, { timeoutMs = 1000, intervalMs = 5 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("timed out");
}

test("demand starts an unknown idle channel and enforces capacity", () => {
  const catalog = new Map([
    ["a", { id: "a", sourceUrl: "https://source.test/a.m3u8" }],
    ["b", { id: "b", sourceUrl: "https://source.test/b.m3u8" }]
  ]);
  const spawned = [];
  const manager = new ChannelManager({
    catalog,
    config: testConfig(),
    spawnFn: (...args) => {
      spawned.push(args);
      return fakeProc();
    }
  });

  assert.deepEqual(manager.demand("missing"), { ok: false, error: "unknown_channel" });
  assert.equal(manager.demand("a").ok, true);
  assert.equal(spawned.length, 1);
  assert.deepEqual(manager.demand("b"), { ok: false, error: "capacity" });
});

test("demand returns source_unavailable when the HLS directory cannot be created", () => {
  const catalog = new Map([["a", { id: "a", sourceUrl: "https://source.test/a.m3u8" }]]);
  const parent = mkdtempSync(path.join(tmpdir(), "swarmcast-unwritable-"));
  const hlsRoot = path.join(parent, "not-a-directory");
  const errors = [];
  writeFileSync(hlsRoot, "occupied");

  const manager = new ChannelManager({
    catalog,
    config: testConfig({ hlsRoot }),
    logger: { error: (...args) => errors.push(args) },
    spawnFn: () => {
      throw new Error("spawn must not be reached");
    }
  });

  assert.deepEqual(manager.demand("a"), { ok: false, error: "source_unavailable" });
  assert.equal(manager.status("a").state, "idle");
  assert.equal(errors[0][0], "ffmpeg_worker_start_failed");
  assert.equal(errors[0][1].channel_id, "a");
});

test("asynchronous worker errors use bounded restart handling", async () => {
  const catalog = new Map([["a", { id: "a", sourceUrl: "https://source.test/a.m3u8" }]]);
  const procs = [];
  const errors = [];
  const manager = new ChannelManager({
    catalog,
    config: testConfig({ idleTeardownMs: 10_000, restartBackoffMs: [1] }),
    logger: { error: (...args) => errors.push(args) },
    spawnFn: () => {
      const proc = fakeProc();
      procs.push(proc);
      return proc;
    }
  });

  assert.equal(manager.demand("a").ok, true);
  const processError = new Error("ffmpeg unavailable");
  processError.code = "ENOENT";
  procs[0].emit("error", processError);
  procs[0].emit("exit", -1);

  await waitFor(() => procs.length === 2);
  assert.equal(manager.status("a").failures, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "ffmpeg_worker_process_error");
  assert.equal(errors[0][1].error_class, "ENOENT");
});

test("reapIdle stops stale ffmpeg process", async () => {
  const catalog = new Map([["a", { id: "a", sourceUrl: "https://source.test/a.m3u8" }]]);
  let proc;
  const manager = new ChannelManager({
    catalog,
    config: testConfig(),
    spawnFn: () => {
      proc = fakeProc();
      return proc;
    }
  });

  manager.demand("a");
  await new Promise((resolve) => setTimeout(resolve, 5));
  manager.reapIdle();

  assert.equal(proc.killedWith, "SIGTERM");
  assert.equal(manager.status("a").state, "idle");
});

test("ffmpegArgs uses reconnect only for HTTP sources", () => {
  const manager = new ChannelManager({
    catalog: new Map(),
    config: testConfig()
  });

  const httpArgs = manager.ffmpegArgs("https://source.test/live.m3u8", "/tmp/out");
  assert.equal(httpArgs.includes("-reconnect"), true);
  assert.equal(httpArgs.includes("aac_adtstoasc"), true);

  const fileArgs = manager.ffmpegArgs("/tmp/source.mp4", "/tmp/out");
  assert.equal(fileArgs.includes("-reconnect"), false);
});

test("ffmpegArgs can package cold tail channels at lower bitrate", () => {
  const manager = new ChannelManager({
    catalog: new Map(),
    config: testConfig({
      tailDownscaleVideoKbps: 700,
      tailDownscaleAudioKbps: 48
    })
  });

  const args = manager.ffmpegArgs("https://source.test/live.m3u8", "/tmp/out", { downscale: true });
  assert.equal(args.includes("-reconnect"), true);
  assert.equal(args.includes("libx264"), true);
  assert.equal(args.includes("aac"), true);
  assert.equal(args.includes("700k"), true);
  assert.equal(args.includes("48k"), true);
  assert.equal(args.includes("copy"), false);
});

test("demand stores swarm size and tail channels use tail idle timeout", async () => {
  const catalog = new Map([["a", { id: "a", sourceUrl: "https://source.test/a.m3u8" }]]);
  let proc;
  const manager = new ChannelManager({
    catalog,
    config: testConfig({ idleTeardownMs: 10_000, tailIdleTeardownMs: 1, tailSwarmThreshold: 5 }),
    spawnFn: () => {
      proc = fakeProc();
      return proc;
    }
  });

  manager.demand("a", { swarmSize: 2 });
  assert.equal(manager.status("a").swarmSize, 2);
  await new Promise((resolve) => setTimeout(resolve, 5));
  manager.reapIdle();

  assert.equal(proc.killedWith, "SIGTERM");
  assert.equal(manager.status("a").state, "idle");
});

test("tail downscale restarts channel back to source copy when demand rises", () => {
  const catalog = new Map([["a", { id: "a", sourceUrl: "https://source.test/a.m3u8" }]]);
  const procs = [];
  const spawned = [];
  const manager = new ChannelManager({
    catalog,
    config: testConfig({
      idleTeardownMs: 10_000,
      tailDownscaleEnabled: true,
      tailSwarmThreshold: 5,
      tailDownscaleVideoKbps: 700,
      tailDownscaleAudioKbps: 48
    }),
    spawnFn: (...args) => {
      const proc = fakeProc();
      procs.push(proc);
      spawned.push(args);
      return proc;
    }
  });

  assert.equal(manager.demand("a", { swarmSize: 2 }).ok, true);
  assert.equal(manager.status("a").downscaled, true);
  assert.equal(manager.status("a").packagingMode, "tail_downscale");
  assert.equal(spawned[0][1].includes("libx264"), true);

  assert.equal(manager.demand("a", { swarmSize: 8 }).ok, true);
  assert.equal(procs[0].killedWith, "SIGTERM");
  assert.equal(manager.status("a").downscaled, false);
  assert.equal(manager.status("a").packagingMode, "source_copy");
  assert.equal(spawned.length, 2);
  assert.equal(spawned[1][1].includes("copy"), true);
});

test("tail admission budget rejects new cold channels before spawn", () => {
  const catalog = new Map([
    ["a", { id: "a", sourceUrl: "https://source.test/a.m3u8" }],
    ["b", { id: "b", sourceUrl: "https://source.test/b.m3u8" }],
    ["hot", { id: "hot", sourceUrl: "https://source.test/hot.m3u8" }]
  ]);
  const spawned = [];
  const manager = new ChannelManager({
    catalog,
    config: testConfig({
      maxChannels: 10,
      tailSwarmThreshold: 5,
      tailAdmissionMaxChannels: 1
    }),
    spawnFn: (...args) => {
      spawned.push(args);
      return fakeProc();
    }
  });

  assert.equal(manager.demand("a", { swarmSize: 2 }).ok, true);
  assert.deepEqual(manager.demand("b", { swarmSize: 2 }), { ok: false, error: "capacity" });
  assert.equal(spawned.length, 1);
  assert.equal(manager.demand("hot", { swarmSize: 8 }).ok, true);
  assert.equal(spawned.length, 2);
});

test("recordSegment stores latest segment timestamp for active channels", () => {
  const catalog = new Map([["a", { id: "a", sourceUrl: "https://source.test/a.m3u8" }]]);
  const manager = new ChannelManager({
    catalog,
    config: testConfig(),
    spawnFn: () => fakeProc()
  });

  assert.equal(manager.recordSegment("a", 1234), false);
  assert.equal(manager.demand("a").ok, true);
  assert.equal(manager.recordSegment("a", 5678), true);
  assert.equal(manager.status("a").latestSegmentAt, 5678);
});

test("ffmpeg failures persist across restarts and degrade the channel", async () => {
  const catalog = new Map([["a", { id: "a", sourceUrl: "https://source.test/a.m3u8" }]]);
  const procs = [];
  const errors = [];
  const manager = new ChannelManager({
    catalog,
    config: testConfig({ idleTeardownMs: 10_000, restartBackoffMs: [1] }),
    logger: {
      error: (...args) => errors.push(args)
    },
    spawnFn: () => {
      const proc = fakeProc();
      procs.push(proc);
      return proc;
    }
  });

  assert.equal(manager.demand("a", { swarmSize: 3 }).ok, true);

  for (let i = 0; i < 4; i += 1) {
    procs[i].emit("exit", 1);
    await waitFor(() => procs.length === i + 2);
    assert.equal(manager.status("a").failures, i + 1);
    assert.equal(manager.status("a").swarmSize, 3);
  }

  procs[4].emit("exit", 1);
  await waitFor(() => manager.status("a").state === "degraded");

  assert.equal(procs.length, 5);
  assert.equal(manager.status("a").failures, 5);
  assert.equal(manager.status("a").swarmSize, 3);
  assert.equal(errors[0][0], "ffmpeg_worker_failed");
});
