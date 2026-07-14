import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FEATURE_FLAGS, assertSafeProductionFlags, loadFeatureFlags } from "../src/flags.js";

test("loadFeatureFlags uses conservative defaults", () => {
  assert.deepEqual(loadFeatureFlags({}), DEFAULT_FEATURE_FLAGS);
});

test("loadFeatureFlags parses booleans and threshold", () => {
  assert.deepEqual(loadFeatureFlags({
    P2P_ENABLED: "false",
    RLNC_ENABLED: "1",
    TAIL_DOWNSCALE_ENABLED: "yes",
    EDGE_ONLY_MODE: "on",
    CONTRIBUTION_ENFORCEMENT_ENABLED: "0",
    SUPER_PEER_THRESHOLD_KBPS: "25000"
  }), {
    p2pEnabled: false,
    rlncEnabled: true,
    tailDownscaleEnabled: true,
    edgeOnlyMode: true,
    contributionEnforcementEnabled: false,
    superPeerThresholdKbps: 25_000
  });
});

test("loadFeatureFlags rejects malformed values", () => {
  assert.throws(() => loadFeatureFlags({ P2P_ENABLED: "maybe" }), /P2P_ENABLED must be a boolean flag/);
  assert.throws(() => loadFeatureFlags({ SUPER_PEER_THRESHOLD_KBPS: "1" }), /SUPER_PEER_THRESHOLD_KBPS/);
});

test("assertSafeProductionFlags blocks RLNC without review gate", () => {
  assert.throws(() => assertSafeProductionFlags({ ...DEFAULT_FEATURE_FLAGS, rlncEnabled: true }), /RLNC_ENABLED requires/);
  assert.deepEqual(assertSafeProductionFlags(DEFAULT_FEATURE_FLAGS), DEFAULT_FEATURE_FLAGS);
});
