export const Wire = Object.freeze({
  MAGIC: 0x5c,
  REQUEST: 0x01,
  DATA: 0x02,
  DATA_END: 0x03,
  CANCEL: 0x04,
  BITFIELD: 0x05,
  REJECT: 0x06,
  CHUNK: 16 * 1024
});

export function frame(type, seq, payload = new Uint8Array()) {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const out = new Uint8Array(10 + bytes.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, Wire.MAGIC);
  view.setUint8(1, type);
  view.setInt32(2, seq, false);
  view.setInt32(6, bytes.byteLength, false);
  out.set(bytes, 10);
  return out.buffer;
}

export function parseFrame(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.byteLength < 10 || bytes[0] !== Wire.MAGIC) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getInt32(6, false);
  if (length < 0 || length !== bytes.byteLength - 10) return null;
  return { type: bytes[1], seq: view.getInt32(2, false), payload: bytes.slice(10) };
}

export function encodeBitfield(seqs) {
  const safe = [...seqs].filter(Number.isInteger).slice(-64);
  const out = new Uint8Array(safe.length * 4);
  const view = new DataView(out.buffer);
  safe.forEach((seq, index) => view.setInt32(index * 4, seq, false));
  return out;
}

export function parseBitfield(payload) {
  if (payload.byteLength % 4 !== 0) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const out = new Set();
  for (let offset = 0; offset < payload.byteLength; offset += 4) out.add(view.getInt32(offset, false));
  return out;
}
