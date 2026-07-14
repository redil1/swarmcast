import { randomBytes } from "node:crypto";
import { div, scale, scaleXorInto } from "./gf256.js";

export class CodedPacket {
  constructor(coeffs, data) {
    this.coeffs = Buffer.from(coeffs);
    this.data = Buffer.from(data);
  }
}

function nonZeroRandomCoefficients(k) {
  while (true) {
    const coeffs = randomBytes(k);
    if (coeffs.some((value) => value !== 0)) return coeffs;
  }
}

export class RlncEncoder {
  constructor(segment, k) {
    if (!Number.isInteger(k) || k <= 0 || k > 255) throw new Error("k must be an integer in [1,255]");
    this.originalSize = segment.length;
    this.k = k;
    this.blockSize = Math.ceil(segment.length / k);
    this.blocks = Array.from({ length: k }, (_, index) => {
      const block = Buffer.alloc(this.blockSize);
      Buffer.from(segment).copy(block, 0, index * this.blockSize, Math.min((index + 1) * this.blockSize, segment.length));
      return block;
    });
  }

  generate(coeffs = nonZeroRandomCoefficients(this.k)) {
    if (coeffs.length !== this.k) throw new Error("coefficient vector length must equal k");
    const data = Buffer.alloc(this.blockSize);
    for (let i = 0; i < this.k; i += 1) {
      scaleXorInto(data, this.blocks[i], coeffs[i]);
    }
    return new CodedPacket(coeffs, data);
  }
}

export class RlncDecoder {
  constructor({ k, blockSize, originalSize }) {
    if (!Number.isInteger(k) || k <= 0 || k > 255) throw new Error("k must be an integer in [1,255]");
    this.k = k;
    this.blockSize = blockSize;
    this.originalSize = originalSize;
    this.rows = new Map();
  }

  get rank() {
    return this.rows.size;
  }

  get complete() {
    return this.rank === this.k;
  }

  add(packet) {
    let coeffs = Buffer.from(packet.coeffs);
    let data = Buffer.from(packet.data);
    if (coeffs.length !== this.k) throw new Error("coefficient vector length must equal k");
    if (data.length !== this.blockSize) throw new Error("coded payload length must equal blockSize");

    for (const pivot of [...this.rows.keys()].sort((a, b) => a - b)) {
      const factor = coeffs[pivot];
      if (factor === 0) continue;
      const row = this.rows.get(pivot);
      scaleXorInto(coeffs, row.coeffs, factor);
      scaleXorInto(data, row.data, factor);
    }

    const pivot = coeffs.findIndex((value) => value !== 0);
    if (pivot < 0) return false;

    const inverse = div(1, coeffs[pivot]);
    coeffs = scale(coeffs, inverse);
    data = scale(data, inverse);

    for (const [existingPivot, row] of this.rows) {
      const factor = row.coeffs[pivot];
      if (factor === 0) continue;
      scaleXorInto(row.coeffs, coeffs, factor);
      scaleXorInto(row.data, data, factor);
      this.rows.set(existingPivot, row);
    }

    this.rows.set(pivot, new CodedPacket(coeffs, data));
    return true;
  }

  recode(coeffs = null) {
    if (this.rows.size === 0) return null;
    const rowList = [...this.rows.values()];
    const localCoeffs = coeffs || nonZeroRandomCoefficients(rowList.length);
    if (localCoeffs.length !== rowList.length) throw new Error("recode coefficient vector length must equal rank");

    const outCoeffs = Buffer.alloc(this.k);
    const outData = Buffer.alloc(this.blockSize);
    rowList.forEach((row, index) => {
      scaleXorInto(outCoeffs, row.coeffs, localCoeffs[index]);
      scaleXorInto(outData, row.data, localCoeffs[index]);
    });
    return new CodedPacket(outCoeffs, outData);
  }

  decode() {
    if (!this.complete) return null;
    const out = Buffer.alloc(this.k * this.blockSize);
    for (let pivot = 0; pivot < this.k; pivot += 1) {
      const row = this.rows.get(pivot);
      if (!row) return null;
      row.data.copy(out, pivot * this.blockSize);
    }
    return out.subarray(0, this.originalSize);
  }
}
