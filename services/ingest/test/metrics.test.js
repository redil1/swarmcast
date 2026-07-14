import test from "node:test";
import assert from "node:assert/strict";
import { formatIngestMetrics, ingestStats } from "../src/metrics.js";

test("ingestStats summarizes channel manager active entries", () => {
  const manager = {
    active: new Map([
      ["a", { state: "live", failures: 1, latestSegmentAt: 88_000 }],
      ["b", { state: "degraded", failures: 5, latestSegmentAt: 95_000 }]
    ])
  };

  assert.deepEqual(ingestStats(manager, 100_000), {
    activeChannels: 2,
    liveChannels: 1,
    degradedChannels: 1,
    startingChannels: 0,
    ffmpegFailures: 6,
    segmentAgeSeconds: 12
  });
});

test("formatIngestMetrics emits prometheus text", () => {
  const text = formatIngestMetrics({
    activeChannels: 2,
    liveChannels: 1,
    startingChannels: 0,
    degradedChannels: 1,
    ffmpegFailures: 6,
    segmentAgeSeconds: 12
  });

  assert.match(text, /swarmcast_ingest_active_channels 2/);
  assert.match(text, /swarmcast_ingest_degraded_channels 1/);
  assert.match(text, /swarmcast_ingest_segment_age_seconds 12/);
  assert.match(text, /swarmcast_ingest_ffmpeg_failures_total 6/);
});
