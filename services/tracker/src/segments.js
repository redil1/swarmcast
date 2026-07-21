import { validateSegmentEnvelope } from "@swarmcast/segment-bus";

export function validateSegmentAnnounce(input) {
  return validateSegmentEnvelope(input);
}

export function announceSegmentToState({ state, segment, send, originBootstrapCellId = null }) {
  try {
    if (typeof send !== "function") throw new Error("send must be a function");
    const validated = validateSegmentAnnounce(segment);
    const keys = state.channelSwarms?.get(validated.channelId);
    const swarms = keys
      ? [...keys].map((key) => state.swarms.get(key)).filter(Boolean)
      : [state.swarms.get(validated.channelId)].filter(Boolean);
    if (swarms.length === 0) {
      return {
        ok: true,
        segment: validated,
        recipients: 0,
        cells: 0,
        originSeedAssignments: 0,
        edgeSeedAssignments: 0
      };
    }
    const hasNamedCells = swarms.some((swarm) => swarm.cellId !== "default");
    if (originBootstrapCellId === null && hasNamedCells) {
      throw new Error("originBootstrapCellId is required for named tracker cells");
    }
    const selectedOriginCellId = originBootstrapCellId === null ? "default" : String(originBootstrapCellId);
    if (!selectedOriginCellId) throw new Error("originBootstrapCellId must not be empty");

    let recipients = 0;
    let originSeedAssignments = 0;
    let edgeSeedAssignments = 0;
    for (const swarm of swarms) {
      if (state.delivery) state.delivery.segmentPayloadsEncoded += 2;
      const assignments = swarm.announceSegment(validated, (peer, message, encoded) => {
        if (send(peer, message, encoded) !== false) recipients += 1;
      }, {
        bootstrapSource: swarm.cellId === selectedOriginCellId ? "origin" : "edge"
      });
      originSeedAssignments += assignments.originSeedAssignments;
      edgeSeedAssignments += assignments.edgeSeedAssignments;
    }

    if (state.delivery) {
      state.delivery.originSeedAssignments += originSeedAssignments;
      state.delivery.edgeSeedAssignments += edgeSeedAssignments;
    }

    return {
      ok: true,
      segment: validated,
      recipients,
      cells: swarms.length,
      originSeedAssignments,
      edgeSeedAssignments
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
