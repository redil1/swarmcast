const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

let x = 1;
for (let i = 0; i < 255; i += 1) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];

export function add(a, b) {
  return (a ^ b) & 0xff;
}

export function mul(a, b) {
  a &= 0xff;
  b &= 0xff;
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

export function div(a, b) {
  a &= 0xff;
  b &= 0xff;
  if (b === 0) throw new Error("division by zero");
  if (a === 0) return 0;
  return EXP[LOG[a] - LOG[b] + 255];
}

export function scale(src, coefficient) {
  const c = coefficient & 0xff;
  const out = Buffer.alloc(src.length);
  if (c === 0) return out;
  if (c === 1) return Buffer.from(src);
  for (let i = 0; i < src.length; i += 1) out[i] = mul(src[i], c);
  return out;
}

export function scaleXorInto(target, src, coefficient) {
  const c = coefficient & 0xff;
  if (c === 0) return target;
  if (c === 1) {
    for (let i = 0; i < target.length; i += 1) target[i] ^= src[i];
    return target;
  }
  for (let i = 0; i < target.length; i += 1) target[i] ^= mul(src[i], c);
  return target;
}
