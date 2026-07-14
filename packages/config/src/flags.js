export const FEATURE_FLAGS = Object.freeze({
  P2P_ENABLED: "P2P_ENABLED",
  RLNC_ENABLED: "RLNC_ENABLED",
  TAIL_DOWNSCALE_ENABLED: "TAIL_DOWNSCALE_ENABLED",
  EDGE_ONLY_MODE: "EDGE_ONLY_MODE",
  CONTRIBUTION_ENFORCEMENT_ENABLED: "CONTRIBUTION_ENFORCEMENT_ENABLED",
  SUPER_PEER_THRESHOLD_KBPS: "SUPER_PEER_THRESHOLD_KBPS"
});

export const DEFAULT_FEATURE_FLAGS = Object.freeze({
  p2pEnabled: true,
  rlncEnabled: false,
  tailDownscaleEnabled: false,
  edgeOnlyMode: false,
  contributionEnforcementEnabled: true,
  superPeerThresholdKbps: 15_000
});

function boolFlag(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${key} must be a boolean flag`);
}

function intFlag(env, key, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function loadFeatureFlags(env = process.env) {
  return {
    p2pEnabled: boolFlag(env, FEATURE_FLAGS.P2P_ENABLED, DEFAULT_FEATURE_FLAGS.p2pEnabled),
    rlncEnabled: boolFlag(env, FEATURE_FLAGS.RLNC_ENABLED, DEFAULT_FEATURE_FLAGS.rlncEnabled),
    tailDownscaleEnabled: boolFlag(env, FEATURE_FLAGS.TAIL_DOWNSCALE_ENABLED, DEFAULT_FEATURE_FLAGS.tailDownscaleEnabled),
    edgeOnlyMode: boolFlag(env, FEATURE_FLAGS.EDGE_ONLY_MODE, DEFAULT_FEATURE_FLAGS.edgeOnlyMode),
    contributionEnforcementEnabled: boolFlag(
      env,
      FEATURE_FLAGS.CONTRIBUTION_ENFORCEMENT_ENABLED,
      DEFAULT_FEATURE_FLAGS.contributionEnforcementEnabled
    ),
    superPeerThresholdKbps: intFlag(
      env,
      FEATURE_FLAGS.SUPER_PEER_THRESHOLD_KBPS,
      DEFAULT_FEATURE_FLAGS.superPeerThresholdKbps,
      { min: 1000, max: 1_000_000 }
    )
  };
}

export function assertSafeProductionFlags(flags) {
  if (flags.rlncEnabled && process.env.ALLOW_UNREVIEWED_ANDROID_RLNC !== "true") {
    throw new Error("RLNC_ENABLED requires Android RLNC library review gate");
  }
  return flags;
}
