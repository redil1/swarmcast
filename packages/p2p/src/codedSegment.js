import { RlncDecoder } from "./rlnc.js";
import { sha256Hex } from "./segmentStore.js";

export class CodedSegmentReceiver {
  constructor({ seq, size, k, sha256 }) {
    this.seq = seq;
    this.size = size;
    this.k = k;
    this.sha256 = sha256;
    this.blockSize = Math.ceil(size / k);
    this.decoder = new RlncDecoder({
      k,
      blockSize: this.blockSize,
      originalSize: size
    });
    this.verifiedBytes = null;
    this.failedVerification = false;
  }

  get rank() {
    return this.decoder.rank;
  }

  get complete() {
    return this.verifiedBytes !== null;
  }

  addPacket(packet) {
    if (this.complete || this.failedVerification) {
      return { useful: false, complete: this.complete, verified: this.complete };
    }

    const useful = this.decoder.add(packet);
    if (!this.decoder.complete) return { useful, complete: false, verified: false };

    const decoded = this.decoder.decode();
    if (!decoded || sha256Hex(decoded) !== this.sha256) {
      this.failedVerification = true;
      return { useful, complete: true, verified: false };
    }

    this.verifiedBytes = Buffer.from(decoded);
    return { useful, complete: true, verified: true, bytes: this.verifiedBytes };
  }

  recode(coeffs = null) {
    return this.decoder.recode(coeffs);
  }
}
