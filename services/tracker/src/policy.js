import { assertSafeProductionFlags, loadFeatureFlags } from "@swarmcast/config/flags";

export function swarmModeForSize(size, { minP2pPeers = 20, p2pEnabled = true, edgeOnlyMode = false } = {}) {
  if (edgeOnlyMode || !p2pEnabled) return "edge-only";
  return size >= minP2pPeers ? "p2p" : "edge-only";
}

export function parseTrackerPolicy(env = process.env) {
  const minP2pPeers = Number.parseInt(env.P2P_MIN_SWARM_SIZE || "20", 10);
  if (!Number.isFinite(minP2pPeers) || minP2pPeers < 1) {
    throw new Error("P2P_MIN_SWARM_SIZE must be a positive integer");
  }
  const flags = assertSafeProductionFlags(loadFeatureFlags(env));
  return Object.freeze({
    minP2pPeers,
    p2pEnabled: flags.p2pEnabled,
    edgeOnlyMode: flags.edgeOnlyMode
  });
}
