import { isSuperPeer, score } from "./scoring.js";

const SCORE_BUCKETS = 8;

class PeerPool {
  constructor() {
    this.entries = [];
    this.positions = new Map();
    this.cursor = 0;
  }

  add(peer) {
    const position = this.positions.get(peer.id);
    if (position !== undefined) {
      this.entries[position] = peer;
      return;
    }
    this.positions.set(peer.id, this.entries.length);
    this.entries.push(peer);
  }

  remove(peerId) {
    const position = this.positions.get(peerId);
    if (position === undefined) return;
    const last = this.entries.pop();
    this.positions.delete(peerId);
    if (position < this.entries.length) {
      this.entries[position] = last;
      this.positions.set(last.id, position);
    }
    if (this.entries.length === 0) this.cursor = 0;
    else this.cursor %= this.entries.length;
  }

  take(limit, excludedPeerIds, requesterId, selectedIds) {
    if (limit <= 0 || this.entries.length === 0) return [];
    const selected = [];
    const length = this.entries.length;
    const start = this.cursor % length;
    let inspected = 0;
    while (inspected < length && selected.length < limit) {
      const peer = this.entries[(start + inspected) % length];
      inspected += 1;
      if (peer.id === requesterId || excludedPeerIds.has(peer.id) || selectedIds.has(peer.id)) continue;
      selected.push(peer);
      selectedIds.add(peer.id);
    }
    this.cursor = (start + Math.max(inspected, 1)) % length;
    return selected;
  }
}

function bucketFor(peer) {
  return Math.max(0, Math.min(SCORE_BUCKETS - 1, Math.floor(score(peer) * SCORE_BUCKETS)));
}

export class PeerIndex {
  constructor() {
    this.superBuckets = Array.from({ length: SCORE_BUCKETS }, () => new PeerPool());
    this.normalBuckets = Array.from({ length: SCORE_BUCKETS }, () => new PeerPool());
    this.membership = new Map();
  }

  add(peer) {
    const superPeer = !!(peer.superPeer || isSuperPeer(peer));
    const bucket = bucketFor(peer);
    const previous = this.membership.get(peer.id);
    if (previous && previous.superPeer === superPeer && previous.bucket === bucket) {
      this.#pool(previous).add(peer);
      return;
    }
    if (previous) this.#pool(previous).remove(peer.id);
    const membership = { superPeer, bucket };
    this.membership.set(peer.id, membership);
    this.#pool(membership).add(peer);
  }

  remove(peerId) {
    const membership = this.membership.get(peerId);
    if (!membership) return;
    this.#pool(membership).remove(peerId);
    this.membership.delete(peerId);
  }

  takeSuper(limit, excludedPeerIds = new Set(), requesterId = "", selectedIds = new Set()) {
    return this.#takeFrom(this.superBuckets, limit, excludedPeerIds, requesterId, selectedIds);
  }

  takeNormal(limit, excludedPeerIds = new Set(), requesterId = "", selectedIds = new Set()) {
    return this.#takeFrom(this.normalBuckets, limit, excludedPeerIds, requesterId, selectedIds);
  }

  #takeFrom(buckets, limit, excludedPeerIds, requesterId, selectedIds) {
    const selected = [];
    for (let index = buckets.length - 1; index >= 0 && selected.length < limit; index -= 1) {
      selected.push(...buckets[index].take(
        limit - selected.length,
        excludedPeerIds,
        requesterId,
        selectedIds
      ));
    }
    return selected;
  }

  #pool(membership) {
    return (membership.superPeer ? this.superBuckets : this.normalBuckets)[membership.bucket];
  }
}
