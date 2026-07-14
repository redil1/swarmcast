import { CodedSegmentReceiver } from "./codedSegment.js";
import { RlncEncoder } from "./rlnc.js";
import { sha256Hex, SegmentStore } from "./segmentStore.js";
import { PEER_EVENT, PeerReputationBook } from "./peerReputation.js";

export class HeadlessPeer {
  constructor({ id, store = new SegmentStore(), reputation = new PeerReputationBook() }) {
    this.id = id;
    this.store = store;
    this.reputation = reputation;
    this.receivers = new Map();
    this.encoders = new Map();
  }

  seedSegment(seq, bytes, k) {
    const body = Buffer.from(bytes);
    const sha256 = sha256Hex(body);
    if (!this.store.putVerified(seq, body, sha256)) throw new Error("failed to seed verified segment");
    this.encoders.set(seq, new RlncEncoder(body, k));
    return { seq, size: body.length, k, sha256 };
  }

  receiverFor(manifest) {
    if (!this.receivers.has(manifest.seq)) {
      this.receivers.set(manifest.seq, new CodedSegmentReceiver(manifest));
    }
    return this.receivers.get(manifest.seq);
  }

  codedPacket(seq, coeffs = null) {
    const encoder = this.encoders.get(seq);
    if (encoder) return encoder.generate(coeffs || undefined);

    const receiver = this.receivers.get(seq);
    return receiver?.recode(coeffs) || null;
  }

  receiveCodedPacket({ fromPeerId, manifest, packet }) {
    const receiver = this.receiverFor(manifest);
    const result = receiver.addPacket(packet);

    if (result.verified) {
      this.store.putVerified(manifest.seq, result.bytes, manifest.sha256);
      this.encoders.set(manifest.seq, new RlncEncoder(result.bytes, manifest.k));
      this.reputation.record(fromPeerId, PEER_EVENT.SUCCESS);
    } else if (result.complete && result.verified === false) {
      this.reputation.record(fromPeerId, PEER_EVENT.HASH_MISMATCH);
    } else if (result.useful) {
      this.reputation.get(fromPeerId);
    }

    return result;
  }

  has(seq) {
    return this.store.get(seq) !== null;
  }
}

export function basisCoeff(k, index) {
  const coeffs = Buffer.alloc(k);
  coeffs[index] = 1;
  return coeffs;
}
