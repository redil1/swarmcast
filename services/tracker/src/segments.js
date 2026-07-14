const SHA256_HEX = /^[a-f0-9]{64}$/i;

function integerField(value, name, { min }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return parsed;
}

export function validateSegmentAnnounce(input) {
  if (!input || typeof input !== "object") throw new Error("segment must be an object");

  const channelId = String(input.channelId || "").trim();
  if (!channelId) throw new Error("channelId is required");

  const seq = integerField(input.seq, "seq", { min: 0 });
  const size = integerField(input.size, "size", { min: 1 });
  const k = integerField(input.k, "k", { min: 1 });
  const sha256 = String(input.sha256 || "").trim().toLowerCase();
  if (!SHA256_HEX.test(sha256)) throw new Error("sha256 must be a 64 character hex digest");

  return { channelId, seq, sha256, size, k };
}

export function announceSegmentToState({ state, segment, send }) {
  try {
    if (typeof send !== "function") throw new Error("send must be a function");
    const validated = validateSegmentAnnounce(segment);
    const swarm = state.swarms.get(validated.channelId);
    if (!swarm) return { ok: true, segment: validated, recipients: 0 };

    let recipients = 0;
    swarm.announceSegment(validated, (peer, message) => {
      recipients += 1;
      send(peer, message);
    });

    return { ok: true, segment: validated, recipients };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
