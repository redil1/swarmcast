import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { basisCoeff, HeadlessPeer } from "../src/headlessPeer.js";

test("HeadlessPeer receives coded packets and becomes a recoder after verification", () => {
  const seed = new HeadlessPeer({ id: "seed" });
  const viewer = new HeadlessPeer({ id: "viewer" });
  const segment = randomBytes(4096);
  const manifest = seed.seedSegment(1, segment, 4);

  let result = null;
  for (let i = 0; i < manifest.k; i += 1) {
    result = viewer.receiveCodedPacket({
      fromPeerId: "seed",
      manifest,
      packet: seed.codedPacket(manifest.seq, basisCoeff(manifest.k, i))
    });
  }

  assert.equal(result.verified, true);
  assert.equal(viewer.has(1), true);
  assert.notEqual(viewer.codedPacket(1), null);
});

test("HeadlessPeer reputation records poisoned coded packets", () => {
  const seed = new HeadlessPeer({ id: "seed" });
  const viewer = new HeadlessPeer({ id: "viewer" });
  const segment = randomBytes(2048);
  const manifest = seed.seedSegment(1, segment, 4);
  const badManifest = { ...manifest, sha256: "0".repeat(64) };

  for (let offense = 0; offense < 2; offense += 1) {
    const poisoned = new HeadlessPeer({ id: `viewer-${offense}`, reputation: viewer.reputation });
    for (let i = 0; i < badManifest.k; i += 1) {
      poisoned.receiveCodedPacket({
        fromPeerId: "seed",
        manifest: badManifest,
        packet: seed.codedPacket(badManifest.seq, basisCoeff(badManifest.k, i))
      });
    }
  }

  assert.equal(viewer.reputation.get("seed").snapshot().disconnected, true);
});
