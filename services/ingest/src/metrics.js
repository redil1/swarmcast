export function ingestStats(manager, nowMs = Date.now()) {
  const states = {};
  let failures = 0;
  let segmentAgeSeconds = 0;

  for (const entry of manager.active.values()) {
    states[entry.state] = (states[entry.state] || 0) + 1;
    failures += entry.failures || 0;
    if (Number.isFinite(entry.latestSegmentAt)) {
      segmentAgeSeconds = Math.max(segmentAgeSeconds, Math.max(0, (nowMs - entry.latestSegmentAt) / 1000));
    }
  }

  return {
    activeChannels: manager.active.size,
    liveChannels: states.live || 0,
    degradedChannels: states.degraded || 0,
    startingChannels: states.starting || 0,
    ffmpegFailures: failures,
    segmentAgeSeconds
  };
}

function line(name, value, help, type = "gauge") {
  return `# HELP ${name} ${help}
# TYPE ${name} ${type}
${name} ${Number.isFinite(value) ? value : 0}`;
}

export function formatIngestMetrics(stats) {
  return [
    line("swarmcast_ingest_active_channels", stats.activeChannels, "Active ingested channels"),
    line("swarmcast_ingest_live_channels", stats.liveChannels, "Channels currently live"),
    line("swarmcast_ingest_starting_channels", stats.startingChannels, "Channels currently starting"),
    line("swarmcast_ingest_degraded_channels", stats.degradedChannels, "Channels in degraded state"),
    line("swarmcast_ingest_segment_age_seconds", stats.segmentAgeSeconds || 0, "Oldest latest segment age across active ingest channels"),
    line("swarmcast_ingest_ffmpeg_failures_total", stats.ffmpegFailures, "Accumulated ffmpeg failures on active channels", "counter"),
    line("swarmcast_ingest_segment_bus_healthy", stats.segmentBusHealthy ? 1 : 0, "Whether the durable segment metadata publisher is connected"),
    line("swarmcast_ingest_segment_bus_published_total", stats.segmentBusPublished || 0, "Segment metadata messages persisted by JetStream", "counter"),
    line("swarmcast_ingest_segment_bus_duplicates_total", stats.segmentBusDuplicates || 0, "Duplicate segment metadata publishes suppressed by JetStream", "counter"),
    line("swarmcast_ingest_segment_bus_failures_total", stats.segmentBusFailures || 0, "Failed durable segment metadata publishes", "counter")
  ].join("\n") + "\n";
}
