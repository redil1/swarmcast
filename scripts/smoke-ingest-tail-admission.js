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

const catalog = new Map([
  ["tail-a", { id: "tail-a", sourceUrl: "https://source.example.tv/tail-a.m3u8" }],
  ["tail-b", { id: "tail-b", sourceUrl: "https://source.example.tv/tail-b.m3u8" }],
  ["hot-a", { id: "hot-a", sourceUrl: "https://source.example.tv/hot-a.m3u8" }]
]);
const spawns = [];
const manager = new ChannelManager({
  catalog,
  config: {
    hlsRoot: mkdtempSync(path.join(tmpdir(), "swarmcast-tail-admission-")),
    maxChannels: 10,
    idleTeardownMs: 10_000,
    tailIdleTeardownMs: 500,
    tailSwarmThreshold: 5,
    tailAdmissionMaxChannels: 1,
    tailDownscaleEnabled: false,
    tailDownscaleVideoKbps: 900,
    tailDownscaleAudioKbps: 64,
    segmentSeconds: 2,
    windowSegments: 30,
    restartBackoffMs: [1],
    ffmpegBin: "ffmpeg"
  },
  spawnFn: (...args) => {
    spawns.push(args);
    return fakeProc();
  }
});

assert.equal(manager.demand("tail-a", { swarmSize: 2 }).ok, true);
assert.deepEqual(manager.demand("tail-b", { swarmSize: 2 }), { ok: false, error: "capacity" });
assert.equal(spawns.length, 1);
assert.equal(manager.activeTailCount(), 1);
assert.equal(manager.demand("hot-a", { swarmSize: 8 }).ok, true);
assert.equal(spawns.length, 2);
assert.equal(manager.status("tail-b").state, "idle");

console.log(`ingest tail admission smoke OK: admittedTail=1 rejectedTail=1 activeTail=${manager.activeTailCount()} totalSpawns=${spawns.length}`);
