import {
  aggregateStateRollingStats,
  aggregateStateStats,
  snapshotRollingTrackerStats,
  snapshotTrackerStats
} from "./stats.js";

function line(name, value, help, type = "gauge") {
  return `# HELP ${name} ${help}
# TYPE ${name} ${type}
${name} ${Number.isFinite(value) ? value : 0}`;
}

export function formatPrometheusMetrics(stats) {
  return [
    line("swarmcast_tracker_peers", stats.peers, "Connected tracker peers"),
    line("swarmcast_tracker_cells", stats.cells || 0, "Active tracker swarm cells"),
    line("swarmcast_tracker_download_p2p_bytes_total", stats.dlP2p, "Client-reported P2P download bytes", "counter"),
    line("swarmcast_tracker_download_edge_bytes_total", stats.dlEdge, "Client-reported edge download bytes", "counter"),
    line("swarmcast_tracker_download_bootstrap_origin_bytes_total", stats.dlBootstrapOrigin || 0, "Client-reported designated origin bootstrap bytes", "counter"),
    line("swarmcast_tracker_download_relay_bytes_total", stats.dlRelay || 0, "Client-reported relayed delivery bytes", "counter"),
    line("swarmcast_tracker_upload_bytes_total", stats.ul, "Client-reported upload bytes", "counter"),
    line("swarmcast_tracker_stalls_total", stats.stalls, "Client-reported playback stalls", "counter"),
    line("swarmcast_tracker_playback_stalls_total", stats.stalls, "Client-reported playback stalls", "counter"),
    line("swarmcast_tracker_peer_timeouts_total", stats.peerTimeouts ?? 0, "Client-reported peer transfer timeouts", "counter"),
    line("swarmcast_tracker_peer_hash_failures_total", stats.peerHashFailures ?? 0, "Client-reported peer hash verification failures", "counter"),
    line("swarmcast_tracker_peer_disconnects_total", stats.peerDisconnects ?? 0, "Client-reported peer disconnects after local policy", "counter"),
    line("swarmcast_tracker_offload_ratio", stats.offloadRatio, "P2P offload ratio"),
    line("swarmcast_tracker_download_p2p_bytes_5m", stats.rollingDlP2p || 0, "Client-reported P2P download bytes in the rolling 5 minute window"),
    line("swarmcast_tracker_download_edge_bytes_5m", stats.rollingDlEdge || 0, "Client-reported edge download bytes in the rolling 5 minute window"),
    line("swarmcast_tracker_download_bootstrap_origin_bytes_5m", stats.rollingDlBootstrapOrigin || 0, "Client-reported designated origin bootstrap bytes in the rolling 5 minute window"),
    line("swarmcast_tracker_download_relay_bytes_5m", stats.rollingDlRelay || 0, "Client-reported relayed delivery bytes in the rolling 5 minute window"),
    line("swarmcast_tracker_offload_ratio_5m", stats.rollingOffloadRatio ?? 0, "P2P offload ratio in the rolling 5 minute window"),
    line("swarmcast_tracker_stall_rate_5m", stats.rollingStallRate ?? 0, "Playback stalls per connected peer in the rolling 5 minute window"),
    line("swarmcast_tracker_peer_timeouts_5m", stats.rollingPeerTimeouts ?? 0, "Client-reported peer transfer timeouts in the rolling 5 minute window"),
    line("swarmcast_tracker_peer_hash_failures_5m", stats.rollingPeerHashFailures ?? 0, "Client-reported peer hash verification failures in the rolling 5 minute window"),
    line("swarmcast_tracker_peer_disconnects_5m", stats.rollingPeerDisconnects ?? 0, "Client-reported peer disconnects in the rolling 5 minute window"),
    line("swarmcast_tracker_startup_latency_ms_avg", stats.startupLatencyMsAvg ?? 0, "Average client-reported playback startup latency"),
    line("swarmcast_tracker_startup_latency_ms_avg_5m", stats.rollingStartupLatencyMsAvg ?? 0, "Average client-reported playback startup latency in the rolling 5 minute window"),
    line("swarmcast_tracker_startup_latency_samples_total", stats.startupLatencySamples ?? 0, "Client-reported startup latency sample count", "counter"),
    line("swarmcast_tracker_buffer_ms_avg", stats.bufferMsAvg ?? 0, "Average latest client-reported playback buffer depth"),
    line("swarmcast_tracker_buffer_ms_min", stats.bufferMsMin ?? 0, "Minimum latest client-reported playback buffer depth"),
    line("swarmcast_tracker_buffer_ms_avg_5m", stats.rollingBufferMsAvg ?? 0, "Average client-reported playback buffer depth in the rolling 5 minute window"),
    line("swarmcast_tracker_buffer_ms_min_5m", stats.rollingBufferMsMin ?? 0, "Minimum client-reported playback buffer depth in the rolling 5 minute window"),
    line("swarmcast_tracker_wifi_fraction", stats.wifiFraction, "Fraction of peers on WiFi"),
    line("swarmcast_tracker_super_peer_fraction", stats.superPeerFraction, "Fraction of peers promoted to super-peer"),
    line("swarmcast_tracker_segment_payload_encodes_total", stats.segmentPayloadsEncoded || 0, "Pre-encoded segment payload variants", "counter"),
    line("swarmcast_tracker_messages_dropped_total", stats.messagesDropped || 0, "Tracker messages dropped before delivery", "counter"),
    line("swarmcast_tracker_backpressure_drops_total", stats.backpressureDrops || 0, "Tracker messages dropped by the backpressure budget", "counter"),
    line("swarmcast_tracker_cell_capacity_rejections_total", stats.cellCapacityRejections || 0, "Tracker joins rejected by a full swarm cell", "counter")
  ].join("\n") + "\n";
}

export function metricsForState(state) {
  const cumulative = state.stats ? snapshotTrackerStats(state.stats) : aggregateStateStats(state);
  const rolling = state.stats ? snapshotRollingTrackerStats(state.stats) : aggregateStateRollingStats(state);
  return formatPrometheusMetrics({
    ...cumulative,
    ...state.delivery,
    cells: state.swarms.size,
    rollingDlP2p: rolling.dlP2p,
    rollingDlEdge: rolling.dlEdge,
    rollingDlBootstrapOrigin: rolling.dlBootstrapOrigin,
    rollingDlRelay: rolling.dlRelay,
    rollingOffloadRatio: rolling.offloadRatio,
    rollingStallRate: rolling.stallRate,
    rollingPeerTimeouts: rolling.peerTimeouts,
    rollingPeerHashFailures: rolling.peerHashFailures,
    rollingPeerDisconnects: rolling.peerDisconnects,
    rollingStartupLatencyMsAvg: rolling.startupLatencyMsAvg,
    rollingBufferMsAvg: rolling.bufferMsAvg,
    rollingBufferMsMin: rolling.bufferMsMin
  });
}
