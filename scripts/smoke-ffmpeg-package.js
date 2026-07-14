import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChannelManager } from "../services/ingest/src/channelManager.js";
import { describeSegment } from "../services/ingest/src/segmentWatcher.js";

function hasCommand(name) {
  const result = spawnSync("sh", ["-lc", `command -v ${name}`], { encoding: "utf8" });
  return result.status === 0;
}

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
}

if (!hasCommand("ffmpeg")) {
  console.log("ffmpeg not available; skipping packaging smoke");
  process.exit(0);
}

const root = mkdtempSync(path.join(tmpdir(), "swarmcast-ffmpeg-"));
const source = path.join(root, "source.mp4");
const hlsRoot = path.join(root, "hls");
const outDir = path.join(hlsRoot, "demo");
await mkdir(outDir, { recursive: true });

run("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=320x180:rate=25",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=1000:sample_rate=48000",
  "-t",
  "6",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-g",
  "50",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
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

const playlist = path.join(outDir, "playlist.m3u8");
const init = path.join(outDir, "init.mp4");
const segments = readdirSync(outDir).filter((name) => name.endsWith(".m4s"));

if (!existsSync(playlist)) throw new Error("playlist.m3u8 was not produced");
if (!existsSync(init)) throw new Error("init.mp4 was not produced");
if (segments.length === 0) throw new Error("no fMP4 media segments were produced");

const firstSegment = segments.sort()[0];
const meta = await describeSegment({
  fullPath: path.join(outDir, firstSegment),
  relativePath: path.join("demo", firstSegment),
  rlncK: 32
});

if (!meta || meta.channelId !== "demo" || meta.size <= 0 || meta.k !== 32) {
  throw new Error("segment metadata validation failed");
}

console.log(`ffmpeg packaging smoke OK: ${segments.length} segment(s), first seq=${meta.seq}, bytes=${meta.size}`);
