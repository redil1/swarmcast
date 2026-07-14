import { randomBytes } from "node:crypto";
import { CodedSegmentReceiver } from "../packages/p2p/src/codedSegment.js";
import { RlncEncoder } from "../packages/p2p/src/rlnc.js";
import { sha256Hex } from "../packages/p2p/src/segmentStore.js";

const segment = randomBytes(64 * 1024 + 13);
const k = 16;
const encoder = new RlncEncoder(segment, k);
const manifest = {
  seq: 42,
  size: segment.length,
  k,
  sha256: sha256Hex(segment)
};

const peerA = new CodedSegmentReceiver(manifest);
const peerB = new CodedSegmentReceiver(manifest);
const downstream = new CodedSegmentReceiver(manifest);

for (let i = 0; i < k / 2; i += 1) {
  const coeffs = Buffer.alloc(k);
  coeffs[i] = 1;
  peerA.addPacket(encoder.generate(coeffs));
}

for (let i = k / 2; i < k; i += 1) {
  const coeffs = Buffer.alloc(k);
  coeffs[i] = 1;
  peerB.addPacket(encoder.generate(coeffs));
}

for (let i = 0; i < peerA.rank; i += 1) {
  const coeffs = Buffer.alloc(peerA.rank);
  coeffs[i] = 1;
  downstream.addPacket(peerA.recode(coeffs));
}

let result = null;
for (let i = 0; i < peerB.rank; i += 1) {
  const coeffs = Buffer.alloc(peerB.rank);
  coeffs[i] = 1;
  result = downstream.addPacket(peerB.recode(coeffs));
}

if (!result?.verified || !downstream.complete) {
  throw new Error("downstream receiver did not reconstruct verified segment");
}
if (!Buffer.from(result.bytes).equals(segment)) {
  throw new Error("reconstructed segment differed from original");
}

console.log(`RLNC swarm smoke OK: downstream reconstructed seq=${manifest.seq} from peer ranks ${peerA.rank}+${peerB.rank}`);
