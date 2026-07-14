import { basisCoeff, HeadlessPeer } from "../packages/p2p/src/headlessPeer.js";

const PEERS = 500;
const K = 20;
const SEGMENT_SIZE = 128 * 1024 + 17;
const UPLOAD_PACKETS_PER_SUPER_PEER = 150;
const SUPER_PEER_FRACTIONS = [0.05, 0.10, 0.15, 0.20, 0.25];

function deterministicSegment(size) {
  const out = Buffer.alloc(size);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = (index * 31 + 17) % 251;
  }
  return out;
}

function codedPacketBytes(manifest) {
  return manifest.k + Math.ceil(manifest.size / manifest.k);
}

function nextHelperWithBudget(budgets, startIndex) {
  for (let offset = 0; offset < budgets.length; offset += 1) {
    const index = (startIndex + offset) % budgets.length;
    if (budgets[index] > 0) return index;
  }
  return -1;
}

function runFraction(fraction, segment) {
  const superPeerCount = Math.round(PEERS * fraction);
  const viewerCount = PEERS - superPeerCount;
  const seed = new HeadlessPeer({ id: `edge-seed-${fraction}` });
  const manifest = seed.seedSegment(900 + superPeerCount, segment, K);
  const superPeers = Array.from({ length: superPeerCount }, (_, index) => {
    const peer = new HeadlessPeer({ id: `super-${superPeerCount}-${index}` });
    peer.seedSegment(manifest.seq, segment, K);
    return peer;
  });
  const budgets = Array.from({ length: superPeerCount }, () => UPLOAD_PACKETS_PER_SUPER_PEER);
  const helperUploads = Array.from({ length: superPeerCount }, () => 0);
  const cursorByRank = Array.from({ length: K }, (_, rank) => rank % superPeerCount);
  const packetBytes = codedPacketBytes(manifest);
  const edgeBootstrapPackets = K;
  let p2pPackets = 0;
  let edgeFallbackPackets = 0;

  for (let viewerIndex = 0; viewerIndex < viewerCount; viewerIndex += 1) {
    const viewer = new HeadlessPeer({ id: `viewer-${superPeerCount}-${viewerIndex}` });
    let result = null;

    for (let rank = 0; rank < K; rank += 1) {
      const helperIndex = nextHelperWithBudget(budgets, cursorByRank[rank]);
      let fromPeerId = "edge-fallback";
      let packet;

      if (helperIndex >= 0) {
        const helper = superPeers[helperIndex];
        packet = helper.codedPacket(manifest.seq, basisCoeff(K, rank));
        budgets[helperIndex] -= 1;
        helperUploads[helperIndex] += 1;
        cursorByRank[rank] = (helperIndex + 1) % superPeerCount;
        fromPeerId = helper.id;
        p2pPackets += 1;
      } else {
        packet = seed.codedPacket(manifest.seq, basisCoeff(K, rank));
        edgeFallbackPackets += 1;
      }

      result = viewer.receiveCodedPacket({ fromPeerId, manifest, packet });
    }

    if (!result?.verified || !viewer.has(manifest.seq)) {
      throw new Error(`viewer ${viewer.id} failed to reconstruct at super-peer fraction ${fraction}`);
    }
  }

  const edgePackets = edgeBootstrapPackets + edgeFallbackPackets;
  const totalPackets = edgePackets + p2pPackets;
  const offload = p2pPackets / totalPackets;
  const edgeBytes = edgePackets * packetBytes;
  const p2pBytes = p2pPackets * packetBytes;
  const maxHelperUploads = Math.max(...helperUploads);

  return {
    fraction,
    superPeerCount,
    viewerCount,
    reconstructed: viewerCount,
    p2pPackets,
    edgeFallbackPackets,
    edgeBootstrapPackets,
    edgeBytes,
    p2pBytes,
    offload,
    maxHelperUploads
  };
}

const segment = deterministicSegment(SEGMENT_SIZE);
const results = SUPER_PEER_FRACTIONS.map((fraction) => runFraction(fraction, segment));
const flatten = results.find((result) => result.edgeFallbackPackets === 0);

if (!flatten) {
  throw new Error("edge fallback did not flatten to zero in the configured super-peer sweep");
}

for (const result of results) {
  if (result.reconstructed !== result.viewerCount) {
    throw new Error(`expected every viewer to reconstruct at fraction ${result.fraction}`);
  }
  if (result.maxHelperUploads > UPLOAD_PACKETS_PER_SUPER_PEER) {
    throw new Error(`helper upload budget exceeded at fraction ${result.fraction}`);
  }
}

const minOffloadAfterFlatten = Math.min(
  ...results.filter((result) => result.fraction >= flatten.fraction).map((result) => result.offload)
);

if (minOffloadAfterFlatten < 0.90) {
  throw new Error(`offload after flatten ${minOffloadAfterFlatten.toFixed(3)} is below target`);
}

const summary = results.map((result) => (
  `${Math.round(result.fraction * 100)}%:edgeFallback=${result.edgeFallbackPackets},rho=${result.offload.toFixed(3)}`
)).join(" ");

console.log(
  `headless super-peer sweep smoke OK: peers=${PEERS} k=${K} uploadBudget=${UPLOAD_PACKETS_PER_SUPER_PEER} flatten=${Math.round(flatten.fraction * 100)}% ${summary}`
);
