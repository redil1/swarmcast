export const MAX_MSG_BYTES = 16 * 1024;

export function parseMessage(buf) {
  if (buf.byteLength > MAX_MSG_BYTES) return null;
  try {
    const text = Buffer.from(buf).toString("utf8");
    const msg = JSON.parse(text);
    if (!msg || typeof msg.t !== "string") return null;
    return msg;
  } catch {
    return null;
  }
}

export function encodeMessage(msg) {
  return JSON.stringify(msg);
}
