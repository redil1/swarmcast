import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePerformanceBudgets } from "../src/performanceBudgets.js";

test("performance budget fixture validates", () => {
  const budgets = JSON.parse(readFileSync(new URL("../../../config/performance-budgets.json", import.meta.url), "utf8"));

  assert.equal(validatePerformanceBudgets(budgets), budgets);
});

test("validatePerformanceBudgets rejects missing or invalid values", () => {
  assert.throws(() => validatePerformanceBudgets({}), /missing performance budgets/);
  assert.throws(() => validatePerformanceBudgets({
    trackerCpuMsPerMessageP95: 2,
    trackerMemoryBytesPerPeer: 4096,
    segmentHashMsP95: 20,
    androidDecodeCpuMsPerSegmentP95: 100,
    androidBatteryDrainPctPerHour: 8,
    androidStartupLatencyMsP95: 5000,
    androidStallRateMax: 0.01,
    androidBufferMsMin: 10000,
    edgeCacheHitRatioMin: 2,
    segmentBusPublishAckMsP99: 100,
    segmentBusDeliveryMsP99: 250,
    segmentBusLeaderElectionMsMax: 10000,
    segmentBusPublishRecoveryMsMax: 15000,
    segmentBusDiskWriteMsP95: 20,
    segmentBusCpuPctP95Max: 70,
    segmentBusMemoryPctP95Max: 80,
    segmentBusStoragePctMax: 70
  }), /edgeCacheHitRatioMin/);
  assert.throws(() => validatePerformanceBudgets({
    trackerCpuMsPerMessageP95: 2,
    trackerMemoryBytesPerPeer: 4096,
    segmentHashMsP95: 20,
    androidDecodeCpuMsPerSegmentP95: 100,
    androidBatteryDrainPctPerHour: 8,
    androidStartupLatencyMsP95: 5000,
    androidStallRateMax: 2,
    androidBufferMsMin: 10000,
    edgeCacheHitRatioMin: 0.8,
    segmentBusPublishAckMsP99: 100,
    segmentBusDeliveryMsP99: 250,
    segmentBusLeaderElectionMsMax: 10000,
    segmentBusPublishRecoveryMsMax: 15000,
    segmentBusDiskWriteMsP95: 20,
    segmentBusCpuPctP95Max: 70,
    segmentBusMemoryPctP95Max: 80,
    segmentBusStoragePctMax: 70
  }), /androidStallRateMax/);
  assert.throws(() => validatePerformanceBudgets({
    ...JSON.parse(readFileSync(new URL("../../../config/performance-budgets.json", import.meta.url), "utf8")),
    segmentBusCpuPctP95Max: 101
  }), /segmentBusCpuPctP95Max/);
});
