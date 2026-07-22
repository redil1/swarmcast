export class SegmentStore {
  constructor({ maxBytes = 64 * 1024 * 1024, maxEntries = 90 } = {}) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.bytes = 0;
  }

  get(seq) {
    const entry = this.entries.get(seq);
    if (!entry) return null;
    this.entries.delete(seq);
    this.entries.set(seq, entry);
    return entry.bytes;
  }

  has(seq) {
    return this.entries.has(seq);
  }

  seqs() {
    return [...this.entries.keys()].slice(-64);
  }

  put(seq, bytes, sha256) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const previous = this.entries.get(seq);
    if (previous) this.bytes -= previous.bytes.byteLength;
    this.entries.delete(seq);
    this.entries.set(seq, { bytes: data, sha256 });
    this.bytes += data.byteLength;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      const removed = this.entries.get(oldest);
      this.entries.delete(oldest);
      this.bytes -= removed.bytes.byteLength;
    }
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}

export async function sha256Hex(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
