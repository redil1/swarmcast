import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { createPeer, createTrackerState, handlePeerMessage } from "../services/tracker/src/index.js";
import { metricsForState } from "../services/tracker/src/metrics.js";

const PEERS = 200;
const CHANNEL_ID = "load-smoke";

function fakeWs() {
  return {
    sent: [],
    ended: [],
    send(message) {
      this.sent.push(JSON.parse(message));
    },
    end(code, reason) {
      this.ended.push({ code, reason });
    }
  };
}

function metricValue(text, name) {
  const match = text.match(new RegExp(`^${name} ([0-9.]+)$`, "m"));
  if (!match) throw new Error(`missing metric ${name}`);
  return Number.parseFloat(match[1]);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

const budgets = JSON.parse(readFileSync("config/performance-budgets.json", "utf8"));
const state = createTrackerState();
const fetches = [];
const latencies = [];
const peers = [];

const fetchFn = async (url, options) => {
  fetches.push({ url, options });
  return { ok: true, status: 200 };
};

async function timedHandle(input) {
  const start = performance.now();
  await handlePeerMessage(input);
  latencies.push(performance.now() - start);
}

for (let i = 0; i < PEERS; i += 1) {
  const peer = createPeer();
  const ws = fakeWs();
  peers.push({ peer, ws });
  const wifi = i < PEERS * 0.8;
  await timedHandle({
    state,
    peer,
    ws,
    fetchFn,
    raw: Buffer.from(JSON.stringify({
      t: "join",
      channelId: CHANNEL_ID,
      caps: {
        transport: wifi ? "wifi" : "cell",
        upload: wifi,
        uplinkKbps: wifi ? 20_000 : 0
      }
    }))
  });
}

for (const [index, { peer, ws }] of peers.entries()) {
  await timedHandle({
    state,
    peer,
    ws,
    fetchFn,
    raw: Buffer.from(JSON.stringify({
      t: "stats",
      dl_p2p: 9000,
      dl_edge: 1000,
      ul: peer.transport === "wifi" ? 8000 : 0,
      stalls: 0,
      startup_ms: 1200 + (index % 5) * 100,
      buffer_ms: 30_000
    }))
  });
}

const metrics = metricsForState(state);
const peerCount = metricValue(metrics, "swarmcast_tracker_peers");
const offload = metricValue(metrics, "swarmcast_tracker_offload_ratio");
const rollingOffload = metricValue(metrics, "swarmcast_tracker_offload_ratio_5m");
const stallRate = metricValue(metrics, "swarmcast_tracker_stall_rate_5m");
const startupLatency = metricValue(metrics, "swarmcast_tracker_startup_latency_ms_avg_5m");
const bufferMin = metricValue(metrics, "swarmcast_tracker_buffer_ms_min_5m");
const wifiFraction = metricValue(metrics, "swarmcast_tracker_wifi_fraction");
const superPeerFraction = metricValue(metrics, "swarmcast_tracker_super_peer_fraction");
const p95 = percentile(latencies, 0.95);
const budget = budgets.trackerCpuMsPerMessageP95;
const lastDemand = JSON.parse(fetches.at(-1).options.body);
const p2pJoins = peers.filter(({ ws }) => ws.sent.some((message) => message.t === "peers")).length;

if (peerCount !== PEERS) throw new Error(`expected ${PEERS} peers, got ${peerCount}`);
if (fetches.length !== PEERS) throw new Error(`expected ${PEERS} demand calls, got ${fetches.length}`);
if (lastDemand.swarmSize !== PEERS) throw new Error(`expected final swarm size ${PEERS}, got ${lastDemand.swarmSize}`);
if (offload < 0.9 || rollingOffload < 0.9) throw new Error(`offload below target: ${offload}/${rollingOffload}`);
if (stallRate > budgets.androidStallRateMax) throw new Error(`stall rate ${stallRate} exceeds ${budgets.androidStallRateMax}`);
if (startupLatency <= 0) throw new Error(`expected startup latency metric, got ${startupLatency}`);
if (bufferMin < budgets.androidBufferMsMin) throw new Error(`buffer min ${bufferMin} below ${budgets.androidBufferMsMin}`);
if (wifiFraction < 0.79 || superPeerFraction < 0.79) throw new Error(`unexpected peer mix: wifi=${wifiFraction} super=${superPeerFraction}`);
if (p2pJoins === 0) throw new Error("expected joins after the threshold to receive peer candidates");
if (p95 > budget) throw new Error(`tracker message p95 ${p95.toFixed(3)}ms exceeds ${budget}ms budget`);

console.log(`tracker load smoke OK: peers=${PEERS} messages=${latencies.length} p95=${p95.toFixed(3)}ms budget=${budget}ms rho=${offload.toFixed(3)} stallRate=${stallRate.toFixed(3)} bufferMinMs=${bufferMin} p2pJoins=${p2pJoins}`);
