const MAX_SAFE_BOX_SIZE = BigInt(Number.MAX_SAFE_INTEGER);

function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError("ISO-BMFF input must be a Buffer or Uint8Array");
}

function boxType(buffer, offset) {
  const value = buffer.toString("latin1", offset + 4, offset + 8);
  if (!/^[\x20-\x7e]{4}$/.test(value)) throw new Error(`invalid ISO-BMFF box type at offset ${offset}`);
  return value;
}

export function parseIsoBmffBoxes(input, start = 0, end = null) {
  const buffer = asBuffer(input);
  const limit = end == null ? buffer.length : end;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(limit) || start < 0 || limit < start || limit > buffer.length) {
    throw new RangeError("invalid ISO-BMFF box range");
  }

  const boxes = [];
  let offset = start;
  while (offset < limit) {
    if (limit - offset < 8) throw new Error(`truncated ISO-BMFF box header at offset ${offset}`);
    const size32 = buffer.readUInt32BE(offset);
    const type = boxType(buffer, offset);
    let headerSize = 8;
    let size;
    if (size32 === 1) {
      if (limit - offset < 16) throw new Error(`truncated extended ISO-BMFF box header at offset ${offset}`);
      const extendedSize = buffer.readBigUInt64BE(offset + 8);
      if (extendedSize > MAX_SAFE_BOX_SIZE) throw new Error(`ISO-BMFF box ${type} is too large`);
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size32 === 0) {
      size = limit - offset;
    } else {
      size = size32;
    }
    if (size < headerSize) throw new Error(`ISO-BMFF box ${type} has invalid size ${size}`);
    const boxEnd = offset + size;
    if (!Number.isSafeInteger(boxEnd) || boxEnd > limit) throw new Error(`ISO-BMFF box ${type} overruns its parent`);
    boxes.push({
      type,
      offset,
      size,
      headerSize,
      dataStart: offset + headerSize,
      end: boxEnd
    });
    offset = boxEnd;
  }
  return boxes;
}

function children(buffer, box) {
  return parseIsoBmffBoxes(buffer, box.dataStart, box.end);
}

function requireCount(boxes, type, minimum, context) {
  const matches = boxes.filter((box) => box.type === type);
  if (matches.length < minimum) throw new Error(`${context} must contain ${type}`);
  return matches;
}

function requireExactlyOne(boxes, type, context) {
  const matches = requireCount(boxes, type, 1, context);
  if (matches.length !== 1) throw new Error(`${context} must contain exactly one ${type}`);
  return matches[0];
}

function readTrackId(buffer, box, offset, context) {
  if (offset + 4 > box.end) throw new Error(`${context} is truncated`);
  const trackId = buffer.readUInt32BE(offset);
  if (trackId === 0) throw new Error(`${context} track ID must be non-zero`);
  return trackId;
}

function inspectTrack(buffer, track, index) {
  const context = `trak[${index}]`;
  const trackChildren = children(buffer, track);
  const trackHeader = requireExactlyOne(trackChildren, "tkhd", context);
  if (trackHeader.dataStart + 4 > trackHeader.end) throw new Error(`${context}.tkhd is truncated`);
  const version = buffer[trackHeader.dataStart];
  if (version !== 0 && version !== 1) throw new Error(`${context}.tkhd has unsupported version ${version}`);
  const trackIdOffset = trackHeader.dataStart + (version === 1 ? 20 : 12);
  const trackId = readTrackId(buffer, trackHeader, trackIdOffset, `${context}.tkhd`);

  const media = requireExactlyOne(trackChildren, "mdia", context);
  const mediaChildren = children(buffer, media);
  requireExactlyOne(mediaChildren, "mdhd", `${context}.mdia`);
  const handler = requireExactlyOne(mediaChildren, "hdlr", `${context}.mdia`);
  requireExactlyOne(mediaChildren, "minf", `${context}.mdia`);
  if (handler.dataStart + 12 > handler.end) throw new Error(`${context}.mdia.hdlr is truncated`);
  const handlerType = buffer.toString("latin1", handler.dataStart + 8, handler.dataStart + 12);
  if (handlerType !== "vide" && handlerType !== "soun") {
    throw new Error(`${context}.mdia.hdlr must describe video or audio`);
  }
  return { trackId, handlerType };
}

export function inspectFmp4InitSegment(input) {
  const buffer = asBuffer(input);
  if (buffer.length < 16) throw new Error("fMP4 init segment is too small");
  const topLevel = parseIsoBmffBoxes(buffer);
  if (topLevel[0]?.type !== "ftyp") throw new Error("fMP4 init segment must start with ftyp");
  const moov = requireCount(topLevel, "moov", 1, "fMP4 init segment");
  if (moov.length !== 1) throw new Error("fMP4 init segment must contain exactly one moov");
  if (topLevel.some((box) => box.type === "moof" || box.type === "mdat")) {
    throw new Error("fMP4 init segment must not contain media fragments");
  }

  const moovChildren = children(buffer, moov[0]);
  requireExactlyOne(moovChildren, "mvhd", "moov");
  requireExactlyOne(moovChildren, "mvex", "moov");
  const tracks = requireCount(moovChildren, "trak", 1, "moov");
  const trackDetails = tracks.map((track, index) => inspectTrack(buffer, track, index));
  const trackIds = trackDetails.map((track) => track.trackId);
  if (new Set(trackIds).size !== trackIds.length) throw new Error("fMP4 init segment track IDs must be unique");
  return {
    kind: "init",
    bytes: buffer.length,
    topLevelBoxes: topLevel.map((box) => box.type),
    trackCount: tracks.length,
    tracks: trackDetails
  };
}

export function inspectFmp4MediaSegment(input) {
  const buffer = asBuffer(input);
  if (buffer.length < 24) throw new Error("fMP4 media segment is too small");
  const topLevel = parseIsoBmffBoxes(buffer);
  if (topLevel.some((box) => box.type === "ftyp" || box.type === "moov")) {
    throw new Error("fMP4 media segment must not contain initialization boxes");
  }
  const fragments = requireCount(topLevel, "moof", 1, "fMP4 media segment");
  const mediaData = requireCount(topLevel, "mdat", 1, "fMP4 media segment");
  if (fragments.length !== 1 || mediaData.length !== 1) {
    throw new Error("fMP4 media segment must contain exactly one moof and one mdat");
  }
  if (fragments[0].offset > mediaData[0].offset) throw new Error("fMP4 moof must precede mdat");
  if (mediaData[0].size <= mediaData[0].headerSize) throw new Error("fMP4 mdat payload must not be empty");

  const moofChildren = children(buffer, fragments[0]);
  requireExactlyOne(moofChildren, "mfhd", "moof");
  const trackFragments = requireCount(moofChildren, "traf", 1, "moof");
  const trackIds = [];
  for (const [index, trackFragment] of trackFragments.entries()) {
    const trackChildren = children(buffer, trackFragment);
    const trackHeader = requireExactlyOne(trackChildren, "tfhd", `traf[${index}]`);
    requireCount(trackChildren, "trun", 1, `traf[${index}]`);
    trackIds.push(readTrackId(buffer, trackHeader, trackHeader.dataStart + 4, `traf[${index}].tfhd`));
  }
  if (new Set(trackIds).size !== trackIds.length) throw new Error("fMP4 media segment track IDs must be unique");
  return {
    kind: "media",
    bytes: buffer.length,
    topLevelBoxes: topLevel.map((box) => box.type),
    trackFragmentCount: trackFragments.length,
    trackIds,
    mediaPayloadBytes: mediaData[0].size - mediaData[0].headerSize
  };
}
