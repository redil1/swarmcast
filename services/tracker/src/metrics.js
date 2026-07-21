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

function labeledCounterFamily(name, help, samples) {
  const rows = samples.map(({ value, labels }) => {
    const rendered = Object.entries(labels).map(([key, label]) => `${key}="${label}"`).join(",");
    return `${name}{${rendered}} ${Number.isFinite(value) ? value : 0}`;
  });
  return [`# HELP ${name} ${help}`, `# TYPE ${name} counter`, ...rows].join("\n");
}

function iceMetricsByNetwork(iceByNetwork = {}) {
  const attempts = [];
  const successes = [];
  const failures = [];
  const candidates = [];
  for (const networkClass of ["wifi", "cellular", "ethernet", "unknown"]) {
    const stats = iceByNetwork[networkClass] || {};
    attempts.push({ value: stats.iceAttempts || 0, labels: { network_class: networkClass } });
    successes.push({ value: stats.iceSuccesses || 0, labels: { network_class: networkClass } });
    failures.push({ value: stats.iceFailures || 0, labels: { network_class: networkClass } });
    for (const [candidateType, key] of [["host", "iceCandidateHost"], ["srflx", "iceCandidateSrflx"], ["prflx", "iceCandidatePrflx"], ["relay", "iceCandidateRelay"], ["unknown", "iceCandidateUnknown"]]) {
      candidates.push({ value: stats[key] || 0, labels: { network_class: networkClass, candidate_type: candidateType } });
    }
  }
  return [
    labeledCounterFamily("swarmcast_tracker_ice_attempts_total", "Client ICE attempts by network class", attempts),
    labeledCounterFamily("swarmcast_tracker_ice_successes_total", "Client ICE successes by network class", successes),
    labeledCounterFamily("swarmcast_tracker_ice_failures_total", "Client ICE failures by network class", failures),
    labeledCounterFamily("swarmcast_tracker_ice_selected_candidate_total", "Successful ICE connections by network class and selected candidate type", candidates)
  ];
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
    line("swarmcast_tracker_join_timeouts_total", stats.trackerJoinTimeouts ?? 0, "Client-reported tracker join acknowledgement timeouts", "counter"),
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
    line("swarmcast_tracker_join_timeouts_5m", stats.rollingTrackerJoinTimeouts ?? 0, "Client-reported tracker join acknowledgement timeouts in the rolling 5 minute window"),
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
    line("swarmcast_tracker_origin_seed_assignments_total", stats.originSeedAssignments || 0, "Peers assigned direct-origin bootstrap capability", "counter"),
    line("swarmcast_tracker_edge_seed_assignments_total", stats.edgeSeedAssignments || 0, "Peers assigned owned-edge bootstrap capability", "counter"),
    line("swarmcast_tracker_messages_dropped_total", stats.messagesDropped || 0, "Tracker messages dropped before delivery", "counter"),
    line("swarmcast_tracker_backpressure_drops_total", stats.backpressureDrops || 0, "Tracker messages dropped by the backpressure budget", "counter"),
    line("swarmcast_tracker_cell_capacity_spillovers_total", stats.cellCapacitySpillovers || 0, "Tracker joins redirected from a full swarm cell", "counter"),
    line("swarmcast_tracker_cell_capacity_rejections_total", stats.cellCapacityRejections || 0, "Tracker joins rejected by a full swarm cell", "counter"),
    line("swarmcast_tracker_segment_bus_healthy", stats.segmentBusHealthy ? 1 : 0, "Whether the durable segment metadata subscriber is connected"),
    line("swarmcast_tracker_segment_bus_active_channels", stats.segmentBusActiveChannels || 0, "Channel-specific segment metadata subscriptions"),
    line("swarmcast_tracker_segment_bus_received_total", stats.segmentBusReceived || 0, "Live segment metadata received from the durable bus", "counter"),
    line("swarmcast_tracker_segment_bus_replayed_total", stats.segmentBusReplayed || 0, "Persisted segment metadata replayed from the durable bus", "counter"),
    line("swarmcast_tracker_segment_bus_duplicates_total", stats.segmentBusDuplicates || 0, "Duplicate or out-of-order segment metadata suppressed", "counter"),
    line("swarmcast_tracker_segment_bus_failures_total", stats.segmentBusFailures || 0, "Segment metadata subscriber failures", "counter"),
    ...iceMetricsByNetwork(stats.iceByNetwork)
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
    rollingTrackerJoinTimeouts: rolling.trackerJoinTimeouts,
    rollingStartupLatencyMsAvg: rolling.startupLatencyMsAvg,
    rollingBufferMsAvg: rolling.bufferMsAvg,
    rollingBufferMsMin: rolling.bufferMsMin,
    segmentBusHealthy: state.segmentSubscriber?.isHealthy() || false,
    segmentBusActiveChannels: state.segmentSubscriber?.activeChannels() || 0,
    segmentBusReceived: state.segmentSubscriber?.stats.received || 0,
    segmentBusReplayed: state.segmentSubscriber?.stats.replayed || 0,
    segmentBusDuplicates: state.segmentSubscriber?.stats.duplicates || 0,
    segmentBusFailures: state.segmentSubscriber?.stats.failures || 0
  });
}
