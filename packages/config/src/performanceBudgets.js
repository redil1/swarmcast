export const REQUIRED_PERFORMANCE_BUDGETS = Object.freeze([
  "trackerCpuMsPerMessageP95",
  "trackerMemoryBytesPerPeer",
  "segmentHashMsP95",
  "androidDecodeCpuMsPerSegmentP95",
  "androidBatteryDrainPctPerHour",
  "androidStartupLatencyMsP95",
  "androidStallRateMax",
  "androidBufferMsMin",
  "edgeCacheHitRatioMin",
  "segmentBusPublishAckMsP99",
  "segmentBusDeliveryMsP99",
  "segmentBusLeaderElectionMsMax",
  "segmentBusPublishRecoveryMsMax",
  "segmentBusDiskWriteMsP95",
  "segmentBusCpuPctP95Max",
  "segmentBusMemoryPctP95Max",
  "segmentBusStoragePctMax"
]);

export function validatePerformanceBudgets(budgets) {
  const missing = REQUIRED_PERFORMANCE_BUDGETS.filter((key) => !(key in budgets));
  if (missing.length > 0) {
    throw new Error(`missing performance budgets: ${missing.join(", ")}`);
  }

  for (const key of REQUIRED_PERFORMANCE_BUDGETS) {
    if (typeof budgets[key] !== "number" || !Number.isFinite(budgets[key]) || budgets[key] <= 0) {
      throw new Error(`${key} must be a positive number`);
    }
  }

  if (budgets.edgeCacheHitRatioMin > 1) {
    throw new Error("edgeCacheHitRatioMin must be between 0 and 1");
  }
  if (budgets.androidStallRateMax > 1) {
    throw new Error("androidStallRateMax must be between 0 and 1");
  }
  for (const key of ["segmentBusCpuPctP95Max", "segmentBusMemoryPctP95Max", "segmentBusStoragePctMax"]) {
    if (budgets[key] > 100) throw new Error(`${key} must be between 0 and 100`);
  }

  return budgets;
}
