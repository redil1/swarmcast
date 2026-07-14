export const MAGIC = 0x5c;

export const FRAME = Object.freeze({
  REQUEST: 0x01,
  DATA: 0x02,
  DATA_END: 0x03,
  CANCEL: 0x04,
  BITFIELD: 0x05,
  REJECT: 0x06,
  CODED: 0x07,
  RANK: 0x08
});

export const REJECT_REASON = Object.freeze({
  DONT_HAVE: 1,
  BUSY: 2,
  QUOTA: 3
});

export function frame(type, seq, payload = Buffer.alloc(0)) {
  const body = Buffer.from(payload);
  const out = Buffer.alloc(10 + body.length);
  out[0] = MAGIC;
  out[1] = type;
  out.writeUInt32BE(seq >>> 0, 2);
  out.writeUInt32BE(body.length, 6);
  body.copy(out, 10);
  return out;
}

export function parseFrame(buf) {
  const input = Buffer.from(buf);
  if (input.length < 10 || input[0] !== MAGIC) return null;
  const type = input[1];
  const seq = input.readUInt32BE(2);
  const length = input.readUInt32BE(6);
  if (length !== input.length - 10) return null;
  return {
    type,
    seq,
    payload: input.subarray(10)
  };
}

export function bitfieldPayload(seqs) {
  const values = [...seqs].map((seq) => seq >>> 0);
  const out = Buffer.alloc(values.length * 4);
  values.forEach((seq, index) => out.writeUInt32BE(seq, index * 4));
  return out;
}

export function parseBitfieldPayload(payload) {
  const input = Buffer.from(payload);
  if (input.length % 4 !== 0) return null;
  const out = new Set();
  for (let offset = 0; offset < input.length; offset += 4) {
    out.add(input.readUInt32BE(offset));
  }
  return out;
}

export function codedPayload(packet) {
  if (packet.coeffs.length > 255) throw new Error("coefficient vector too large");
  const coeffs = Buffer.from(packet.coeffs);
  const data = Buffer.from(packet.data);
  return Buffer.concat([Buffer.from([coeffs.length]), coeffs, data]);
}

export function parseCodedPayload(payload) {
  const input = Buffer.from(payload);
  if (input.length < 1) return null;
  const k = input[0];
  if (input.length < 1 + k) return null;
  return {
    coeffs: input.subarray(1, 1 + k),
    data: input.subarray(1 + k)
  };
}

export function rankPayload(seq, rank) {
  const out = Buffer.alloc(6);
  out.writeUInt32BE(seq >>> 0, 0);
  out.writeUInt16BE(rank & 0xffff, 4);
  return out;
}

export function parseRankPayload(payload) {
  const input = Buffer.from(payload);
  if (input.length !== 6) return null;
  return {
    seq: input.readUInt32BE(0),
    rank: input.readUInt16BE(4)
  };
}
