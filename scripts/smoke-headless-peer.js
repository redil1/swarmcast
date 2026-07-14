import { randomBytes } from "node:crypto";
import { basisCoeff, HeadlessPeer } from "../packages/p2p/src/headlessPeer.js";

const seed = new HeadlessPeer({ id: "seed" });
const peerA = new HeadlessPeer({ id: "peer-a" });
const peerB = new HeadlessPeer({ id: "peer-b" });
const viewer = new HeadlessPeer({ id: "viewer" });

const segment = randomBytes(128 * 1024 + 17);
const manifest = seed.seedSegment(100, segment, 16);

for (let i = 0; i < manifest.k / 2; i += 1) {
  peerA.receiveCodedPacket({
    fromPeerId: seed.id,
    manifest,
    packet: seed.codedPacket(manifest.seq, basisCoeff(manifest.k, i))
  });
}

for (let i = manifest.k / 2; i < manifest.k; i += 1) {
  peerB.receiveCodedPacket({
    fromPeerId: seed.id,
    manifest,
    packet: seed.codedPacket(manifest.seq, basisCoeff(manifest.k, i))
  });
}

let result = null;
for (let i = 0; i < peerA.receiverFor(manifest).rank; i += 1) {
  result = viewer.receiveCodedPacket({
    fromPeerId: peerA.id,
    manifest,
    packet: peerA.codedPacket(manifest.seq, basisCoeff(peerA.receiverFor(manifest).rank, i))
  });
}

for (let i = 0; i < peerB.receiverFor(manifest).rank; i += 1) {
  result = viewer.receiveCodedPacket({
    fromPeerId: peerB.id,
    manifest,
    packet: peerB.codedPacket(manifest.seq, basisCoeff(peerB.receiverFor(manifest).rank, i))
  });
}

if (!result?.verified || !viewer.has(manifest.seq)) {
  throw new Error("viewer did not reconstruct the segment from headless peers");
}

console.log(`headless peer smoke OK: viewer reconstructed seq=${manifest.seq} from two partial peers`);
