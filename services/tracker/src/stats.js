export const STATS_WINDOW_MS = 5 * 60 * 1000;

function nonNegativeInt(value) {
  return Math.max(0, Number.parseInt(value || 0, 10) || 0);
}

function optionalNonNegativeInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

function optionalNonNegativeMetric(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function minMetric(current, value) {
  return current === null ? value : Math.min(current, value);
}

function summary({
  peers,
  dlP2p,
  dlEdge,
  ul,
  stalls,
  peerTimeouts = 0,
  peerHashFailures = 0,
  peerDisconnects = 0,
  wifi,
  superPeers,
  startupLatencyMsTotal = 0,
  startupLatencySamples = 0,
  bufferMsTotal = 0,
  bufferSamples = 0,
  bufferMsMin = null
}) {
  const totalDownload = dlP2p + dlEdge;
  return {
    peers,
    dlP2p,
    dlEdge,
    ul,
    stalls,
    peerTimeouts,
    peerHashFailures,
    peerDisconnects,
    stallRate: peers === 0 ? 0 : stalls / peers,
    offloadRatio: totalDownload === 0 ? 0 : dlP2p / totalDownload,
    wifiFraction: peers === 0 ? 0 : wifi / peers,
    superPeerFraction: peers === 0 ? 0 : superPeers / peers,
    startupLatencyMsTotal,
    startupLatencySamples,
    startupLatencyMsAvg: startupLatencySamples === 0 ? 0 : startupLatencyMsTotal / startupLatencySamples,
    bufferSamples,
    bufferMsAvg: bufferSamples === 0 ? 0 : bufferMsTotal / bufferSamples,
    bufferMsMin: bufferSamples === 0 ? 0 : bufferMsMin ?? 0
  };
}

export function recordPeerStats(peer, msg, nowMs = Date.now(), windowMs = STATS_WINDOW_MS) {
  const startupLatencyMs = optionalNonNegativeInt(msg.startup_ms ?? msg.startupMs);
  const bufferMs = optionalNonNegativeInt(msg.buffer_ms ?? msg.bufferMs);
  const peerTimeouts = nonNegativeInt(msg.peer_timeouts ?? msg.peerTimeouts);
  const peerHashFailures = nonNegativeInt(msg.hash_failures ?? msg.hashFailures);
  const peerDisconnects = nonNegativeInt(msg.peer_disconnects ?? msg.peerDisconnects);
  const sample = {
    ts: nowMs,
    dlP2p: nonNegativeInt(msg.dl_p2p),
    dlEdge: nonNegativeInt(msg.dl_edge),
    ul: nonNegativeInt(msg.ul),
    stalls: nonNegativeInt(msg.stalls),
    peerTimeouts,
    peerHashFailures,
    peerDisconnects
  };
  if (startupLatencyMs !== null) sample.startupLatencyMs = startupLatencyMs;
  if (bufferMs !== null) sample.bufferMs = bufferMs;

  peer.bytesUp = (peer.bytesUp || 0) + sample.ul;
  peer.bytesDownP2p = (peer.bytesDownP2p || 0) + sample.dlP2p;
  peer.bytesDownEdge = (peer.bytesDownEdge || 0) + sample.dlEdge;
  peer.stalls = (peer.stalls || 0) + sample.stalls;
  peer.peerTimeouts = (peer.peerTimeouts || 0) + peerTimeouts;
  peer.peerHashFailures = (peer.peerHashFailures || 0) + peerHashFailures;
  peer.peerDisconnects = (peer.peerDisconnects || 0) + peerDisconnects;
  if (startupLatencyMs !== null) {
    peer.startupLatencyMsTotal = (peer.startupLatencyMsTotal || 0) + startupLatencyMs;
    peer.startupLatencySamples = (peer.startupLatencySamples || 0) + 1;
    peer.startupLatencyMsLast = startupLatencyMs;
  }
  if (bufferMs !== null) {
    peer.bufferMsLast = bufferMs;
  }

  if (!Array.isArray(peer.statsWindow)) peer.statsWindow = [];
  peer.statsWindow.push(sample);
  const cutoff = nowMs - windowMs;
  peer.statsWindow = peer.statsWindow.filter((entry) => entry.ts >= cutoff);
}

export function aggregatePeerStats(peers) {
  let dlP2p = 0;
  let dlEdge = 0;
  let ul = 0;
  let stalls = 0;
  let peerTimeouts = 0;
  let peerHashFailures = 0;
  let peerDisconnects = 0;
  let wifi = 0;
  let superPeers = 0;
  let startupLatencyMsTotal = 0;
  let startupLatencySamples = 0;
  let bufferMsTotal = 0;
  let bufferSamples = 0;
  let bufferMsMin = null;

  for (const peer of peers) {
    dlP2p += peer.bytesDownP2p || 0;
    dlEdge += peer.bytesDownEdge || 0;
    ul += peer.bytesUp || 0;
    stalls += peer.stalls || 0;
    peerTimeouts += peer.peerTimeouts || 0;
    peerHashFailures += peer.peerHashFailures || 0;
    peerDisconnects += peer.peerDisconnects || 0;
    if ((peer.startupLatencySamples || 0) > 0) {
      startupLatencyMsTotal += peer.startupLatencyMsTotal || 0;
      startupLatencySamples += peer.startupLatencySamples || 0;
    }
    const bufferMs = optionalNonNegativeMetric(peer.bufferMsLast);
    if (bufferMs !== null) {
      bufferMsTotal += bufferMs;
      bufferSamples += 1;
      bufferMsMin = minMetric(bufferMsMin, bufferMs);
    }
    if (peer.transport === "wifi") wifi += 1;
    if (peer.superPeer) superPeers += 1;
  }

  return summary({
    peers: peers.length,
    dlP2p,
    dlEdge,
    ul,
    stalls,
    peerTimeouts,
    peerHashFailures,
    peerDisconnects,
    wifi,
    superPeers,
    startupLatencyMsTotal,
    startupLatencySamples,
    bufferMsTotal,
    bufferSamples,
    bufferMsMin
  });
}

export function aggregateRollingPeerStats(peers, nowMs = Date.now(), windowMs = STATS_WINDOW_MS) {
  let dlP2p = 0;
  let dlEdge = 0;
  let ul = 0;
  let stalls = 0;
  let peerTimeouts = 0;
  let peerHashFailures = 0;
  let peerDisconnects = 0;
  let wifi = 0;
  let superPeers = 0;
  let startupLatencyMsTotal = 0;
  let startupLatencySamples = 0;
  let bufferMsTotal = 0;
  let bufferSamples = 0;
  let bufferMsMin = null;
  const cutoff = nowMs - windowMs;

  for (const peer of peers) {
    if (peer.transport === "wifi") wifi += 1;
    if (peer.superPeer) superPeers += 1;
    for (const sample of peer.statsWindow || []) {
      if (sample.ts < cutoff) continue;
      dlP2p += sample.dlP2p || 0;
      dlEdge += sample.dlEdge || 0;
      ul += sample.ul || 0;
      stalls += sample.stalls || 0;
      peerTimeouts += sample.peerTimeouts || 0;
      peerHashFailures += sample.peerHashFailures || 0;
      peerDisconnects += sample.peerDisconnects || 0;
      const startupLatencyMs = optionalNonNegativeMetric(sample.startupLatencyMs);
      if (startupLatencyMs !== null) {
        startupLatencyMsTotal += startupLatencyMs;
        startupLatencySamples += 1;
      }
      const bufferMs = optionalNonNegativeMetric(sample.bufferMs);
      if (bufferMs !== null) {
        bufferMsTotal += bufferMs;
        bufferSamples += 1;
        bufferMsMin = minMetric(bufferMsMin, bufferMs);
      }
    }
  }

  return summary({
    peers: peers.length,
    dlP2p,
    dlEdge,
    ul,
    stalls,
    peerTimeouts,
    peerHashFailures,
    peerDisconnects,
    wifi,
    superPeers,
    startupLatencyMsTotal,
    startupLatencySamples,
    bufferMsTotal,
    bufferSamples,
    bufferMsMin
  });
}

export function aggregateStateStats(state) {
  const peers = [];
  for (const swarm of state.swarms.values()) {
    peers.push(...swarm.peers.values());
  }
  return aggregatePeerStats(peers);
}

export function aggregateStateRollingStats(state, nowMs = Date.now(), windowMs = STATS_WINDOW_MS) {
  const peers = [];
  for (const swarm of state.swarms.values()) {
    peers.push(...swarm.peers.values());
  }
  return aggregateRollingPeerStats(peers, nowMs, windowMs);
}
