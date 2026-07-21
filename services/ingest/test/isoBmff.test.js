import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  inspectFmp4InitSegment,
  inspectFmp4MediaSegment,
  parseIsoBmffBoxes
} from "../src/isoBmff.js";

function fixture(name) {
  return readFileSync(new URL(`../../../test-fixtures/media/fmp4/${name}`, import.meta.url));
}

function box(type, payload = Buffer.alloc(0)) {
  const output = Buffer.alloc(8 + payload.length);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, "latin1");
  payload.copy(output, 8);
  return output;
}

test("committed fMP4 init fixture has two tracks", () => {
  assert.deepEqual(inspectFmp4InitSegment(fixture("init.mp4")), {
    kind: "init",
    bytes: 1352,
    topLevelBoxes: ["ftyp", "moov"],
    trackCount: 2,
    tracks: [
      { trackId: 1, handlerType: "vide" },
      { trackId: 2, handlerType: "soun" }
    ]
  });
});

test("committed fMP4 media fixtures contain ordered moof and mdat boxes", () => {
  for (const name of ["seg_00000000.m4s", "seg_00000001.m4s"]) {
    const result = inspectFmp4MediaSegment(fixture(name));
    assert.deepEqual(result.topLevelBoxes, ["styp", "sidx", "sidx", "moof", "mdat"]);
    assert.equal(result.trackFragmentCount, 2);
    assert.deepEqual(result.trackIds, [1, 2]);
    assert.ok(result.mediaPayloadBytes > 40_000);
  }
});

test("fMP4 init validation rejects a non-audio/video handler", () => {
  const init = Buffer.from(fixture("init.mp4"));
  const handlerTypeOffset = init.indexOf(Buffer.from("vide"));
  assert.ok(handlerTypeOffset > 0);
  init.write("meta", handlerTypeOffset, 4, "latin1");
  assert.throws(() => inspectFmp4InitSegment(init), /must describe video or audio/);
});

test("ISO-BMFF parser returns exact box boundaries", () => {
  const bytes = Buffer.concat([box("free", Buffer.from("abc")), box("skip", Buffer.from("d"))]);
  assert.deepEqual(parseIsoBmffBoxes(bytes), [
    { type: "free", offset: 0, size: 11, headerSize: 8, dataStart: 8, end: 11 },
    { type: "skip", offset: 11, size: 9, headerSize: 8, dataStart: 19, end: 20 }
  ]);
});

test("ISO-BMFF parser rejects truncated headers and box overruns", () => {
  assert.throws(() => parseIsoBmffBoxes(Buffer.alloc(7)), /truncated ISO-BMFF box header/);
  const overrun = box("free");
  overrun.writeUInt32BE(100, 0);
  assert.throws(() => parseIsoBmffBoxes(overrun), /overruns its parent/);
});

test("fMP4 init validation rejects media-only bytes", () => {
  assert.throws(() => inspectFmp4InitSegment(fixture("seg_00000000.m4s")), /must start with ftyp/);
});

test("fMP4 media validation rejects truncated and initialization bytes", () => {
  const segment = fixture("seg_00000000.m4s");
  assert.throws(() => inspectFmp4MediaSegment(segment.subarray(0, -1)), /overruns its parent/);
  assert.throws(() => inspectFmp4MediaSegment(fixture("init.mp4")), /must not contain initialization boxes/);
});

test("fMP4 media validation rejects an empty mdat payload", () => {
  const traf = box("traf", Buffer.concat([box("tfhd"), box("trun")]));
  const moof = box("moof", Buffer.concat([box("mfhd"), traf]));
  assert.throws(() => inspectFmp4MediaSegment(Buffer.concat([moof, box("mdat")])), /mdat payload must not be empty/);
});
