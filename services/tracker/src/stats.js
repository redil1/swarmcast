export const STATS_WINDOW_MS = 5 * 60 * 1000;
const STATS_BUCKET_MS = 1000;
const MAX_ROLLING_BUCKETS = Math.ceil(STATS_WINDOW_MS / STATS_BUCKET_MS) + 2;

class MinHeap {
  constructor() {
    this.values = [];
    this.positions = new Map();
  }

  set(peerId, value) {
    const existing = this.positions.get(peerId);
    if (existing !== undefined) {
      const previous = this.values[existing].value;
      this.values[existing].value = value;
      if (value < previous) this.#bubbleUp(existing);
      else this.#bubbleDown(existing);
      return;
    }
    const entry = { peerId, value };
    this.values.push(entry);
    this.positions.set(peerId, this.values.length - 1);
    this.#bubbleUp(this.values.length - 1);
  }

  remove(peerId) {
    const index = this.positions.get(peerId);
    if (index === undefined) return;
    const last = this.values.pop();
    this.positions.delete(peerId);
    if (index < this.values.length) {
      this.values[index] = last;
      this.positions.set(last.peerId, index);
      this.#bubbleUp(index);
      this.#bubbleDown(this.positions.get(last.peerId));
    }
  }

  peek() {
    return this.values[0] || null;
  }

  #bubbleUp(start) {
    let index = start;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].value <= this.values[index].value) break;
      this.#swap(index, parent);
      index = parent;
    }
  }

  #bubbleDown(start) {
    let index = start;
    while (index < this.values.length) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.values[right].value < this.values[left].value ? right : left;
      if (this.values[index].value <= this.values[child].value) break;
      this.#swap(index, child);
      index = child;
    }
  }

  #swap(left, right) {
    [this.values[left], this.values[right]] = [this.values[right], this.values[left]];
    this.positions.set(this.values[left].peerId, left);
    this.positions.set(this.values[right].peerId, right);
  }
}

function emptyCounters() {
  return {
    dlP2p: 0,
    dlEdge: 0,
    dlBootstrapOrigin: 0,
    dlRelay: 0,
    ul: 0,
    stalls: 0,
    peerTimeouts: 0,
    peerHashFailures: 0,
    peerDisconnects: 0,
    startupLatencyMsTotal: 0,
    startupLatencySamples: 0,
    bufferMsTotal: 0,
    bufferSamples: 0,
    bufferMsMin: null
  };
}

export function createTrackerStats() {
  return {
    peers: 0,
    wifi: 0,
    superPeers: 0,
    cumulative: emptyCounters(),
    rollingBuckets: new Map(),
    bufferByPeer: new Map(),
    bufferMinHeap: new MinHeap(),
    bufferMsTotal: 0
  };
}

export function addPeerToTrackerStats(stats, peer) {
  stats.peers += 1;
  if (peer.transport === "wifi") stats.wifi += 1;
  if (peer.superPeer) stats.superPeers += 1;
}

export function removePeerFromTrackerStats(stats, peer) {
  stats.peers = Math.max(0, stats.peers - 1);
  if (peer.transport === "wifi") stats.wifi = Math.max(0, stats.wifi - 1);
  if (peer.superPeer) stats.superPeers = Math.max(0, stats.superPeers - 1);
  const previous = stats.bufferByPeer.get(peer.id);
  if (previous !== undefined) {
    stats.bufferByPeer.delete(peer.id);
    stats.bufferMsTotal -= previous;
    stats.bufferMinHeap.remove(peer.id);
  }
}

function addSample(target, sample) {
  for (const key of [
    "dlP2p", "dlEdge", "dlBootstrapOrigin", "dlRelay", "ul", "stalls",
    "peerTimeouts", "peerHashFailures", "peerDisconnects"
  ]) target[key] += sample[key] || 0;
  if (sample.startupLatencyMs !== undefined) {
    target.startupLatencyMsTotal += sample.startupLatencyMs;
    target.startupLatencySamples += 1;
  }
  if (sample.bufferMs !== undefined) {
    target.bufferMsTotal += sample.bufferMs;
    target.bufferSamples += 1;
    target.bufferMsMin = minMetric(target.bufferMsMin, sample.bufferMs);
  }
}

export function recordTrackerStats(stats, peer, sample, nowMs = sample.ts) {
  addSample(stats.cumulative, sample);
  const bucketStart = Math.floor(nowMs / STATS_BUCKET_MS) * STATS_BUCKET_MS;
  const bucket = stats.rollingBuckets.get(bucketStart) || emptyCounters();
  addSample(bucket, sample);
  stats.rollingBuckets.set(bucketStart, bucket);
  while (stats.rollingBuckets.size > MAX_ROLLING_BUCKETS) {
    stats.rollingBuckets.delete(stats.rollingBuckets.keys().next().value);
  }

  if (sample.bufferMs !== undefined) {
    const previous = stats.bufferByPeer.get(peer.id);
    if (previous !== undefined) stats.bufferMsTotal -= previous;
    stats.bufferByPeer.set(peer.id, sample.bufferMs);
    stats.bufferMsTotal += sample.bufferMs;
    stats.bufferMinHeap.set(peer.id, sample.bufferMs);
  }
}

function currentBufferMin(stats) {
  return stats.bufferMinHeap.peek()?.value || 0;
}

function snapshotCounters(stats, counters, { currentBuffers = false } = {}) {
  const bufferSamples = currentBuffers ? stats.bufferByPeer.size : counters.bufferSamples;
  const bufferMsTotal = currentBuffers ? stats.bufferMsTotal : counters.bufferMsTotal;
  const bufferMsMin = currentBuffers ? currentBufferMin(stats) : counters.bufferMsMin;
  return summary({
    peers: stats.peers,
    ...counters,
    wifi: stats.wifi,
    superPeers: stats.superPeers,
    bufferSamples,
    bufferMsTotal,
    bufferMsMin
  });
}

export function snapshotTrackerStats(stats) {
  return snapshotCounters(stats, stats.cumulative, { currentBuffers: true });
}

export function snapshotRollingTrackerStats(stats, nowMs = Date.now(), windowMs = STATS_WINDOW_MS) {
  const cutoff = nowMs - windowMs;
  const counters = emptyCounters();
  for (const [bucketStart, bucket] of stats.rollingBuckets) {
    if (bucketStart < cutoff) {
      stats.rollingBuckets.delete(bucketStart);
      continue;
    }
    addSample(counters, {
      ...bucket,
      startupLatencyMs: undefined,
      bufferMs: undefined
    });
    counters.startupLatencyMsTotal += bucket.startupLatencyMsTotal;
    counters.startupLatencySamples += bucket.startupLatencySamples;
    counters.bufferMsTotal += bucket.bufferMsTotal;
    counters.bufferSamples += bucket.bufferSamples;
    counters.bufferMsMin = minMetric(counters.bufferMsMin, bucket.bufferMsMin);
  }
  return snapshotCounters(stats, counters);
}

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
  dlBootstrapOrigin = 0,
  dlRelay = 0,
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
  const totalDownload = dlP2p + dlEdge + dlBootstrapOrigin + dlRelay;
  return {
    peers,
    dlP2p,
    dlEdge,
    dlBootstrapOrigin,
    dlRelay,
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
    dlBootstrapOrigin: nonNegativeInt(msg.dl_bootstrap_origin ?? msg.dlBootstrapOrigin),
    dlRelay: nonNegativeInt(msg.dl_relay ?? msg.dlRelay),
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
  peer.bytesDownBootstrapOrigin = (peer.bytesDownBootstrapOrigin || 0) + sample.dlBootstrapOrigin;
  peer.bytesDownRelay = (peer.bytesDownRelay || 0) + sample.dlRelay;
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
  return sample;
}

export function aggregatePeerStats(peers) {
  let dlP2p = 0;
  let dlEdge = 0;
  let dlBootstrapOrigin = 0;
  let dlRelay = 0;
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
    dlBootstrapOrigin += peer.bytesDownBootstrapOrigin || 0;
    dlRelay += peer.bytesDownRelay || 0;
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
    dlBootstrapOrigin,
    dlRelay,
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
  let dlBootstrapOrigin = 0;
  let dlRelay = 0;
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
      dlBootstrapOrigin += sample.dlBootstrapOrigin || 0;
      dlRelay += sample.dlRelay || 0;
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
    dlBootstrapOrigin,
    dlRelay,
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
