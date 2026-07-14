export const PEER_EVENT = Object.freeze({
  SUCCESS: "success",
  TIMEOUT: "timeout",
  REJECT: "reject",
  HASH_MISMATCH: "hash_mismatch"
});

export class PeerReputation {
  constructor({
    peerId,
    maxPoisonOffenses = 2,
    maxScore = 100,
    minScore = -100
  }) {
    this.peerId = peerId;
    this.maxPoisonOffenses = maxPoisonOffenses;
    this.maxScore = maxScore;
    this.minScore = minScore;
    this.score = 0;
    this.successes = 0;
    this.failures = 0;
    this.poisonOffenses = 0;
    this.disconnected = false;
  }

  record(event) {
    switch (event) {
      case PEER_EVENT.SUCCESS:
        this.successes += 1;
        this.score = Math.min(this.maxScore, this.score + 3);
        break;
      case PEER_EVENT.REJECT:
        this.failures += 1;
        this.score = Math.max(this.minScore, this.score - 1);
        break;
      case PEER_EVENT.TIMEOUT:
        this.failures += 1;
        this.score = Math.max(this.minScore, this.score - 3);
        break;
      case PEER_EVENT.HASH_MISMATCH:
        this.failures += 1;
        this.poisonOffenses += 1;
        this.score = Math.max(this.minScore, this.score - 25);
        if (this.poisonOffenses >= this.maxPoisonOffenses) this.disconnected = true;
        break;
      default:
        throw new Error(`unknown peer reputation event: ${event}`);
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      peerId: this.peerId,
      score: this.score,
      successes: this.successes,
      failures: this.failures,
      poisonOffenses: this.poisonOffenses,
      disconnected: this.disconnected
    };
  }
}

export class PeerReputationBook {
  constructor(options = {}) {
    this.options = options;
    this.peers = new Map();
  }

  get(peerId) {
    if (!this.peers.has(peerId)) {
      this.peers.set(peerId, new PeerReputation({ peerId, ...this.options }));
    }
    return this.peers.get(peerId);
  }

  record(peerId, event) {
    return this.get(peerId).record(event);
  }

  candidates() {
    return [...this.peers.values()]
      .filter((peer) => !peer.disconnected)
      .sort((a, b) => b.score - a.score)
      .map((peer) => peer.snapshot());
  }
}
