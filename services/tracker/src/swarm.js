import { candidatePeers, electSeeders } from "./scoring.js";

export class Swarm {
  constructor(channelId) {
    this.channelId = channelId;
    this.peers = new Map();
    this.segments = new Map();
    this.seedRotation = 0;
  }

  addPeer(peer) {
    this.peers.set(peer.id, peer);
  }

  removePeer(peerId) {
    this.peers.delete(peerId);
  }

  get size() {
    return this.peers.size;
  }

  peersFor(peer, count = 12) {
    return candidatePeers(this, peer, count);
  }

  announceSegment({ seq, sha256, size, k }, send) {
    this.segments.set(seq, { sha256, size, k, ts: Date.now() });
    for (const oldSeq of this.segments.keys()) {
      if (oldSeq < seq - 60) this.segments.delete(oldSeq);
    }

    const seederCount = Math.max(2, Math.ceil(k / 12));
    const seeders = new Set(electSeeders(this, seederCount).map((peer) => peer.id));

    for (const peer of this.peers.values()) {
      send(peer, {
        t: "segment",
        seq,
        sha256,
        size,
        k,
        seedTier: seeders.has(peer.id)
      });
    }
  }
}
