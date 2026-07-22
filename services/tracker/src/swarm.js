import { candidatePeers, electSeeders } from "./scoring.js";
import { PeerIndex } from "./peerIndex.js";

export class Swarm {
  constructor(channelId, cellId = "default") {
    this.channelId = channelId;
    this.cellId = cellId;
    this.peers = new Map();
    this.peerIndex = new PeerIndex();
    this.segments = new Map();
    this.seedRotation = 0;
    this.mode = null;
  }

  addPeer(peer) {
    this.peers.set(peer.id, peer);
    this.peerIndex.add(peer);
  }

  removePeer(peerId) {
    this.peers.delete(peerId);
    this.peerIndex.remove(peerId);
  }

  refreshPeer(peer) {
    if (this.peers.has(peer.id)) this.peerIndex.add(peer);
  }

  get size() {
    return this.peers.size;
  }

  peersFor(peer, count = 12, excludedPeerIds = new Set()) {
    return candidatePeers(this, peer, count, excludedPeerIds);
  }

  announceSegment({ seq, sha256, size, k }, send, { bootstrapSource = "origin" } = {}) {
    if (!["origin", "edge"].includes(bootstrapSource)) {
      throw new Error("bootstrapSource must be origin or edge");
    }
    this.segments.set(seq, { sha256, size, k, ts: Date.now() });
    for (const oldSeq of this.segments.keys()) {
      if (oldSeq < seq - 60) this.segments.delete(oldSeq);
    }

    const seederCount = Math.max(2, Math.ceil(k / 12));
    const seeders = new Set(electSeeders(this, seederCount).map((peer) => peer.id));
    const regularMessage = { t: "segment", seq, sha256, size, k, seedTier: false, edgeSeedTier: false };
    const seedMessage = bootstrapSource === "origin"
      ? { ...regularMessage, seedTier: true }
      : { ...regularMessage, edgeSeedTier: true };
    const regularPayload = JSON.stringify(regularMessage);
    const seedPayload = JSON.stringify(seedMessage);

    for (const peer of this.peers.values()) {
      const bootstrapHelper = seeders.has(peer.id);
      send(peer, bootstrapHelper ? seedMessage : regularMessage, bootstrapHelper ? seedPayload : regularPayload);
    }

    return {
      originSeedAssignments: bootstrapSource === "origin" ? seeders.size : 0,
      edgeSeedAssignments: bootstrapSource === "edge" ? seeders.size : 0
    };
  }

  retainedSegmentMessages(limit = 30) {
    return [...this.segments.entries()]
      .sort(([left], [right]) => left - right)
      .slice(-limit)
      .map(([seq, { sha256, size, k }]) => ({
        t: "segment",
        seq,
        sha256,
        size,
        k,
        seedTier: false,
        edgeSeedTier: false
      }));
  }
}
