import { randomBytes } from "node:crypto";
import { CodedSegmentReceiver } from "../packages/p2p/src/codedSegment.js";
import { RlncEncoder } from "../packages/p2p/src/rlnc.js";
import { sha256Hex } from "../packages/p2p/src/segmentStore.js";
import { PEER_EVENT, PeerReputationBook } from "../packages/p2p/src/peerReputation.js";

const segment = randomBytes(8192);
const encoder = new RlncEncoder(segment, 4);
const manifest = {
  seq: 1,
  size: segment.length,
  k: encoder.k,
  sha256: sha256Hex(segment)
};

function feedCorruptDecode() {
  const receiver = new CodedSegmentReceiver({
    ...manifest,
    sha256: "0".repeat(64)
  });
  let result = null;
  for (let i = 0; i < encoder.k; i += 1) {
    const coeffs = Buffer.alloc(encoder.k);
    coeffs[i] = 1;
    result = receiver.addPacket(encoder.generate(coeffs));
  }
  return result;
}

const reputation = new PeerReputationBook();
for (let offense = 0; offense < 2; offense += 1) {
  const result = feedCorruptDecode();
  if (result.verified !== false) {
    throw new Error("expected corrupt coded decode to fail verification");
  }
  reputation.record("poison-peer", PEER_EVENT.HASH_MISMATCH);
}

const state = reputation.get("poison-peer").snapshot();
if (!state.disconnected || state.poisonOffenses !== 2) {
  throw new Error("poison peer was not disconnected after two hash mismatches");
}

console.log(`poisoning defense smoke OK: ${state.peerId} disconnected after ${state.poisonOffenses} hash mismatches`);
