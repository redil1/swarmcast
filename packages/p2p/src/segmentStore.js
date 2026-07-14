import { createHash } from "node:crypto";

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export class SegmentStore {
  constructor({ maxBytes = 64 * 1024 * 1024 } = {}) {
    this.maxBytes = maxBytes;
    this.map = new Map();
    this.totalBytes = 0;
  }

  get(seq) {
    const entry = this.map.get(seq);
    if (!entry) return null;
    this.map.delete(seq);
    this.map.set(seq, entry);
    return entry;
  }

  heldSeqs() {
    return new Set(this.map.keys());
  }

  putVerified(seq, bytes, expectedSha256) {
    const body = Buffer.from(bytes);
    const actual = sha256Hex(body);
    if (actual !== expectedSha256) return false;

    const existing = this.map.get(seq);
    if (existing) {
      this.totalBytes -= existing.bytes.length;
      this.map.delete(seq);
    }

    const entry = { seq, bytes: body, sha256: actual };
    this.map.set(seq, entry);
    this.totalBytes += body.length;
    this.evict();
    return true;
  }

  evict() {
    while (this.totalBytes > this.maxBytes && this.map.size > 0) {
      const [seq, entry] = this.map.entries().next().value;
      this.map.delete(seq);
      this.totalBytes -= entry.bytes.length;
    }
  }
}
