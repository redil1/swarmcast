import { randomBytes } from "node:crypto";
import { basisCoeff, HeadlessPeer } from "../packages/p2p/src/headlessPeer.js";

const VIEWERS = 200;
const HELPERS = 20;
const K = 20;

const seed = new HeadlessPeer({ id: "seed" });
const helpers = Array.from({ length: HELPERS }, (_, index) => new HeadlessPeer({ id: `helper-${index}` }));
const segment = randomBytes(64 * 1024 + 31);
const manifest = seed.seedSegment(500, segment, K);

for (let rank = 0; rank < K; rank += 1) {
  const helper = helpers[rank % HELPERS];
  helper.receiveCodedPacket({
    fromPeerId: seed.id,
    manifest,
    packet: seed.codedPacket(manifest.seq, basisCoeff(K, rank))
  });
}

let reconstructed = 0;
for (let viewerIndex = 0; viewerIndex < VIEWERS; viewerIndex += 1) {
  const viewer = new HeadlessPeer({ id: `viewer-${viewerIndex}` });
  let result = null;

  for (let rank = 0; rank < K; rank += 1) {
    const helper = helpers[rank % HELPERS];
    result = viewer.receiveCodedPacket({
      fromPeerId: helper.id,
      manifest,
      packet: helper.codedPacket(manifest.seq, basisCoeff(helper.receiverFor(manifest).rank, 0))
    });
  }

  if (!result?.verified || !viewer.has(manifest.seq)) {
    throw new Error(`viewer ${viewerIndex} failed to reconstruct segment`);
  }
  reconstructed += 1;
}

console.log(`headless 200-peer smoke OK: ${reconstructed}/${VIEWERS} viewers reconstructed seq=${manifest.seq}`);
