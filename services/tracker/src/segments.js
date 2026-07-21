import { validateSegmentEnvelope } from "@swarmcast/segment-bus";

export function validateSegmentAnnounce(input) {
  return validateSegmentEnvelope(input);
}

export function announceSegmentToState({ state, segment, send }) {
  try {
    if (typeof send !== "function") throw new Error("send must be a function");
    const validated = validateSegmentAnnounce(segment);
    const keys = state.channelSwarms?.get(validated.channelId);
    const swarms = keys
      ? [...keys].map((key) => state.swarms.get(key)).filter(Boolean)
      : [state.swarms.get(validated.channelId)].filter(Boolean);
    if (swarms.length === 0) return { ok: true, segment: validated, recipients: 0, cells: 0 };

    let recipients = 0;
    for (const swarm of swarms) {
      if (state.delivery) state.delivery.segmentPayloadsEncoded += 2;
      swarm.announceSegment(validated, (peer, message, encoded) => {
        if (send(peer, message, encoded) !== false) recipients += 1;
      });
    }

    return { ok: true, segment: validated, recipients, cells: swarms.length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
