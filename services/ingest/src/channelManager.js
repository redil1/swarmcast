import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ERROR_CODES } from "@swarmcast/config/errors";
import { createLogger } from "@swarmcast/config/logging";

export const CHANNEL_STATE = Object.freeze({
  IDLE: "idle",
  STARTING: "starting",
  LIVE: "live",
  DEGRADED: "degraded"
});

export const MAX_FFMPEG_FAILURES = 5;

export class ChannelManager {
  constructor({
    catalog,
    config,
    spawnFn = spawn,
    logger = createLogger({ service: "ingest" }),
    nowMs = Date.now
  } = {}) {
    if (!catalog) throw new Error("catalog is required");
    if (!config) throw new Error("config is required");
    this.catalog = catalog;
    this.config = config;
    this.spawnFn = spawnFn;
    this.logger = logger;
    this.nowMs = nowMs;
    this.active = new Map();
    this.lastSegmentSeqByChannel = new Map();
  }

  demand(channelId, { swarmSize = 0 } = {}) {
    const meta = this.catalog.get(channelId);
    if (!meta) return { ok: false, error: ERROR_CODES.UNKNOWN_CHANNEL };

    const existing = this.active.get(channelId);
    if (existing) {
      existing.lastDemand = Date.now();
      existing.swarmSize = swarmSize;
      const downscaled = this.shouldDownscale(swarmSize);
      if (existing.downscaled !== downscaled && existing.state !== CHANNEL_STATE.DEGRADED) {
        this.restartForPackaging(channelId, meta, existing, { swarmSize });
      }
      return { ok: true, state: existing.state };
    }

    if (this.active.size >= this.config.maxChannels) {
      return { ok: false, error: ERROR_CODES.CAPACITY };
    }
    if (!this.canAdmitTail(swarmSize)) {
      return { ok: false, error: ERROR_CODES.CAPACITY };
    }

    const started = this.startSafely(channelId, meta, { swarmSize });
    if (!started.ok) return { ok: false, error: ERROR_CODES.SOURCE_UNAVAILABLE };
    return { ok: true, state: CHANNEL_STATE.STARTING };
  }

  startSafely(channelId, meta, options = {}) {
    try {
      return { ok: true, entry: this.start(channelId, meta, options) };
    } catch (error) {
      this.active.delete(channelId);
      try {
        rmSync(path.join(this.config.hlsRoot, channelId), { recursive: true, force: true });
      } catch {
        // Cleanup must not hide the original worker startup failure.
      }
      this.logger?.error?.("ffmpeg_worker_start_failed", {
        channel_id: channelId,
        error_class: typeof error?.code === "string" ? error.code : "worker_start"
      }, "channel worker could not start");
      return { ok: false, error: ERROR_CODES.SOURCE_UNAVAILABLE };
    }
  }

  start(channelId, meta, { swarmSize = 0, failures = 0 } = {}) {
    const outDir = path.join(this.config.hlsRoot, channelId);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    const downscaled = this.shouldDownscale(swarmSize);
    const startNumber = this.nextSegmentStartNumber(channelId);
    const args = this.ffmpegArgs(meta.sourceUrl, outDir, { downscale: downscaled, startNumber });
    const proc = this.spawnFn(this.config.ffmpegBin, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });

    const entry = {
      proc,
      state: CHANNEL_STATE.STARTING,
      lastDemand: Date.now(),
      swarmSize,
      failures,
      downscaled,
      stderrTail: [],
      latestSegmentAt: null,
      outDir,
      exitHandled: false
    };

    this.active.set(channelId, entry);

    proc.stderr?.on?.("data", (chunk) => {
      entry.stderrTail.push(chunk.toString());
      if (entry.stderrTail.length > 20) entry.stderrTail.shift();
    });

    proc.on?.("error", (error) => this.handleProcessError(channelId, meta, proc, error));
    proc.on?.("exit", (code) => this.handleExit(channelId, meta, proc, code));

    entry.state = CHANNEL_STATE.LIVE;
    return entry;
  }

  recordSegment(channelId, nowMs = Date.now(), seq = null) {
    const entry = this.active.get(channelId);
    if (!entry) return false;
    entry.latestSegmentAt = nowMs;
    if (Number.isSafeInteger(seq) && seq >= 0) {
      const previous = this.lastSegmentSeqByChannel.get(channelId) ?? -1;
      this.lastSegmentSeqByChannel.set(channelId, Math.max(previous, seq));
    }
    return true;
  }

  ffmpegArgs(sourceUrl, outDir, { downscale = false, startNumber = 0 } = {}) {
    const reconnectArgs = /^https?:\/\//i.test(sourceUrl)
      ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
      : [];

    const codecArgs = downscale ? [
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-b:v",
      `${this.config.tailDownscaleVideoKbps}k`,
      "-maxrate",
      `${this.config.tailDownscaleVideoKbps}k`,
      "-bufsize",
      `${this.config.tailDownscaleVideoKbps * 2}k`,
      "-c:a",
      "aac",
      "-b:a",
      `${this.config.tailDownscaleAudioKbps}k`
    ] : ["-c", "copy"];

    return [
      "-hide_banner",
      "-loglevel",
      "warning",
      ...reconnectArgs,
      "-i",
      sourceUrl,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      ...codecArgs,
      "-bsf:a",
      "aac_adtstoasc",
      "-f",
      "hls",
      "-hls_time",
      String(this.config.segmentSeconds),
      "-hls_list_size",
      String(this.config.windowSegments),
      "-start_number",
      String(startNumber),
      "-hls_flags",
      "delete_segments+independent_segments+program_date_time",
      "-hls_segment_type",
      "fmp4",
      "-hls_fmp4_init_filename",
      "init.mp4",
      "-hls_segment_filename",
      path.join(outDir, "seg_%08d.m4s"),
      path.join(outDir, "playlist.m3u8")
    ];
  }

  nextSegmentStartNumber(channelId) {
    const clockNumber = Math.floor(this.nowMs() / (this.config.segmentSeconds * 1000));
    const previous = this.lastSegmentSeqByChannel.get(channelId) ?? -1;
    const next = Math.max(clockNumber, previous + 1);
    this.lastSegmentSeqByChannel.set(channelId, next);
    return next;
  }

  shouldDownscale(swarmSize = 0) {
    return Boolean(
      this.config.tailDownscaleEnabled &&
      this.isTailDemand(swarmSize)
    );
  }

  isTailDemand(swarmSize = 0) {
    return swarmSize > 0 && swarmSize < this.config.tailSwarmThreshold;
  }

  activeTailCount() {
    let count = 0;
    for (const entry of this.active.values()) {
      if (this.isTailDemand(entry.swarmSize)) count += 1;
    }
    return count;
  }

  canAdmitTail(swarmSize = 0) {
    const limit = this.config.tailAdmissionMaxChannels || 0;
    if (limit <= 0 || !this.isTailDemand(swarmSize)) return true;
    return this.activeTailCount() < limit;
  }

  restartForPackaging(channelId, meta, existing, { swarmSize }) {
    const previousProc = existing.proc;
    const failures = existing.failures;
    existing.proc = null;
    existing.state = CHANNEL_STATE.STARTING;
    existing.swarmSize = swarmSize;
    existing.downscaled = this.shouldDownscale(swarmSize);

    const restart = () => {
      if (this.active.get(channelId) !== existing) return;
      this.active.delete(channelId);
      this.startSafely(channelId, meta, { swarmSize, failures });
    };

    previousProc.once?.("exit", restart);
    previousProc.kill?.("SIGTERM");
    if (!previousProc.once) restart();
  }

  handleExit(channelId, meta, proc, code) {
    const entry = this.active.get(channelId);
    if (!entry || entry.proc !== proc || entry.exitHandled) return;
    entry.exitHandled = true;

    const recentDemand = Date.now() - entry.lastDemand < this.config.idleTeardownMs;
    if (recentDemand && code !== 0) {
      const failures = entry.failures + 1;
      entry.failures = failures;
      if (failures >= MAX_FFMPEG_FAILURES) {
        entry.state = CHANNEL_STATE.DEGRADED;
        this.logger?.error?.("ffmpeg_worker_failed", {
          channel_id: channelId,
          error_class: "ffmpeg_exit",
          exit_code: code
        }, "channel degraded after repeated ffmpeg failures");
        return;
      }

      const backoff = this.config.restartBackoffMs[Math.min(entry.failures - 1, this.config.restartBackoffMs.length - 1)];
      setTimeout(() => {
        if (this.active.get(channelId) === entry) {
          this.active.delete(channelId);
          this.startSafely(channelId, meta, { swarmSize: entry.swarmSize, failures });
        }
      }, backoff);
      return;
    }

    this.active.delete(channelId);
    rmSync(entry.outDir, { recursive: true, force: true });
  }

  handleProcessError(channelId, meta, proc, error) {
    const entry = this.active.get(channelId);
    if (!entry || entry.proc !== proc || entry.exitHandled) return;
    this.logger?.error?.("ffmpeg_worker_process_error", {
      channel_id: channelId,
      error_class: typeof error?.code === "string" ? error.code : "worker_process"
    }, "channel worker process error");
    this.handleExit(channelId, meta, proc, -1);
  }

  reapIdle() {
    const now = Date.now();
    for (const [id, entry] of this.active) {
      const idleLimit = this.isTailDemand(entry.swarmSize)
        ? this.config.tailIdleTeardownMs
        : this.config.idleTeardownMs;
      if (now - entry.lastDemand > idleLimit) {
        entry.proc.kill?.("SIGTERM");
        this.active.delete(id);
        rmSync(entry.outDir, { recursive: true, force: true });
      }
    }
  }

  status(channelId) {
    const entry = this.active.get(channelId);
    if (!entry) return { state: CHANNEL_STATE.IDLE };
    return {
      state: entry.state,
      failures: entry.failures,
      swarmSize: entry.swarmSize,
      downscaled: entry.downscaled,
      packagingMode: entry.downscaled ? "tail_downscale" : "source_copy",
      lastDemand: entry.lastDemand,
      latestSegmentAt: entry.latestSegmentAt
    };
  }

  stopAll(signal = "SIGTERM") {
    for (const [id, entry] of this.active) {
      entry.proc.kill?.(signal);
      rmSync(entry.outDir, { recursive: true, force: true });
      this.active.delete(id);
    }
  }
}
