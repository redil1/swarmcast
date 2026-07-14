import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChannelManager } from "../services/ingest/src/channelManager.js";

function fakeProc() {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = (signal) => {
    proc.killedWith = signal;
    proc.emit("exit", 0);
  };
  return proc;
}

const catalog = new Map([["tail-news", { id: "tail-news", sourceUrl: "https://source.example.tv/tail-news.m3u8" }]]);
const procs = [];
const spawns = [];
const manager = new ChannelManager({
  catalog,
  config: {
    hlsRoot: mkdtempSync(path.join(tmpdir(), "swarmcast-tail-downscale-")),
    maxChannels: 2,
    idleTeardownMs: 10_000,
    tailIdleTeardownMs: 500,
    tailSwarmThreshold: 5,
    tailDownscaleEnabled: true,
    tailDownscaleVideoKbps: 700,
    tailDownscaleAudioKbps: 48,
    segmentSeconds: 2,
    windowSegments: 30,
    restartBackoffMs: [1],
    ffmpegBin: "ffmpeg"
  },
  spawnFn: (...args) => {
    const proc = fakeProc();
    procs.push(proc);
    spawns.push(args);
    return proc;
  }
});

assert.equal(manager.demand("tail-news", { swarmSize: 2 }).ok, true);
assert.equal(manager.status("tail-news").packagingMode, "tail_downscale");
assert.equal(spawns[0][1].includes("libx264"), true);
assert.equal(spawns[0][1].includes("700k"), true);
assert.equal(spawns[0][1].includes("48k"), true);

assert.equal(manager.demand("tail-news", { swarmSize: 12 }).ok, true);
assert.equal(procs[0].killedWith, "SIGTERM");
assert.equal(manager.status("tail-news").packagingMode, "source_copy");
assert.equal(spawns[1][1].includes("copy"), true);
assert.equal(spawns.length, 2);

console.log(`ingest tail downscale smoke OK: coldMode=tail_downscale promotedMode=source_copy restarts=${spawns.length - 1}`);
