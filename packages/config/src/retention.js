const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION_ACTIONS = Object.freeze({
  KEEP_RAW: "keep_raw",
  AGGREGATE_THEN_DELETE_RAW: "aggregate_then_delete_raw",
  DELETE_AGGREGATE: "delete_aggregate"
});

export function validateRetentionPolicy(policy) {
  if (!policy || !Array.isArray(policy.classes)) {
    throw new Error("retention policy must include classes");
  }

  const ids = new Set();
  for (const item of policy.classes) {
    if (!item.id || ids.has(item.id)) throw new Error(`invalid retention class id: ${item.id}`);
    ids.add(item.id);
    for (const key of ["rawRetentionDays", "aggregateRetentionDays"]) {
      if (typeof item[key] !== "number" || !Number.isFinite(item[key]) || item[key] <= 0) {
        throw new Error(`${item.id} has invalid ${key}`);
      }
    }
    if (item.aggregateRetentionDays < item.rawRetentionDays) {
      throw new Error(`${item.id} aggregate retention must be >= raw retention`);
    }
    if (!Array.isArray(item.prohibitedFields) || item.prohibitedFields.length === 0) {
      throw new Error(`${item.id} must list prohibited fields`);
    }
  }

  return policy;
}

export function retentionClass(policy, classId) {
  validateRetentionPolicy(policy);
  const item = policy.classes.find((entry) => entry.id === classId);
  if (!item) throw new Error(`unknown retention class: ${classId}`);
  return item;
}

export function cutoffDate(now, days) {
  return new Date(new Date(now).getTime() - days * DAY_MS);
}

export function retentionDecision({ policy, classId, observedAt, now = new Date() }) {
  const item = retentionClass(policy, classId);
  const observed = new Date(observedAt);
  if (Number.isNaN(observed.getTime())) throw new Error("observedAt must be a valid date");

  if (observed <= cutoffDate(now, item.aggregateRetentionDays)) {
    return RETENTION_ACTIONS.DELETE_AGGREGATE;
  }
  if (observed <= cutoffDate(now, item.rawRetentionDays)) {
    return RETENTION_ACTIONS.AGGREGATE_THEN_DELETE_RAW;
  }
  return RETENTION_ACTIONS.KEEP_RAW;
}

export function retentionPlan({ policy, records, now = new Date() }) {
  validateRetentionPolicy(policy);
  const summary = {};
  for (const record of records) {
    const action = retentionDecision({ policy, classId: record.classId, observedAt: record.observedAt, now });
    const key = `${record.classId}:${action}`;
    summary[key] = (summary[key] || 0) + 1;
  }
  return summary;
}

export async function runRetentionJob({ policy, store, now = new Date(), dryRun = true }) {
  const validatedPolicy = validateRetentionPolicy(policy);
  const effectiveNow = new Date(now);
  if (Number.isNaN(effectiveNow.getTime())) throw new Error("now must be a valid date");
  if (!store || typeof store.listRetentionRecords !== "function" || typeof store.applyRetentionAction !== "function") {
    throw new Error("retention store must implement listRetentionRecords and applyRetentionAction");
  }

  const summary = {};
  const failures = [];
  let scannedRecords = 0;
  let appliedRecords = 0;

  for (const policyClass of validatedPolicy.classes) {
    let records;
    try {
      records = await store.listRetentionRecords({
        classId: policyClass.id,
        policyClass,
        rawCutoff: cutoffDate(effectiveNow, policyClass.rawRetentionDays),
        aggregateCutoff: cutoffDate(effectiveNow, policyClass.aggregateRetentionDays),
        now: effectiveNow,
        dryRun
      });
    } catch (error) {
      failures.push({
        classId: policyClass.id,
        stage: "list",
        error: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    if (!Array.isArray(records)) {
      failures.push({
        classId: policyClass.id,
        stage: "list",
        error: "listRetentionRecords must return an array"
      });
      continue;
    }

    for (const record of records) {
      scannedRecords += 1;
      const normalizedRecord = { ...record, classId: record.classId || policyClass.id };
      const recordId = normalizedRecord.id ?? null;

      try {
        if (normalizedRecord.classId !== policyClass.id) {
          throw new Error(`record class mismatch: ${normalizedRecord.classId}`);
        }
        if (!normalizedRecord.observedAt) throw new Error("record observedAt is required");

        const action = retentionDecision({
          policy: validatedPolicy,
          classId: policyClass.id,
          observedAt: normalizedRecord.observedAt,
          now: effectiveNow
        });
        await store.applyRetentionAction({
          record: normalizedRecord,
          action,
          dryRun,
          policyClass,
          now: effectiveNow
        });

        const key = `${policyClass.id}:${action}`;
        summary[key] = (summary[key] || 0) + 1;
        appliedRecords += 1;
      } catch (error) {
        failures.push({
          classId: policyClass.id,
          recordId,
          stage: "apply",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return {
    ok: failures.length === 0,
    dryRun: Boolean(dryRun),
    now: effectiveNow.toISOString(),
    scannedRecords,
    appliedRecords,
    summary,
    failures
  };
}

function labelValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

export function formatRetentionMetrics(summary, {
  lastSuccessTimestampSeconds,
  failuresTotal = 0
} = {}) {
  const lines = [
    "# HELP swarmcast_retention_records_total Records handled by retention class and action.",
    "# TYPE swarmcast_retention_records_total counter"
  ];

  for (const [key, count] of Object.entries(summary).sort()) {
    const [classId, action] = key.split(":");
    lines.push(`swarmcast_retention_records_total{class="${labelValue(classId)}",action="${labelValue(action)}"} ${count}`);
  }

  lines.push(
    "# HELP swarmcast_retention_failures_total Retention job failures.",
    "# TYPE swarmcast_retention_failures_total counter",
    `swarmcast_retention_failures_total ${failuresTotal}`,
    "# HELP swarmcast_retention_last_success_timestamp_seconds Unix timestamp of the last successful retention run.",
    "# TYPE swarmcast_retention_last_success_timestamp_seconds gauge",
    `swarmcast_retention_last_success_timestamp_seconds ${lastSuccessTimestampSeconds ?? 0}`
  );

  return `${lines.join("\n")}\n`;
}
