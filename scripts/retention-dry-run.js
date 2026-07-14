import { readFileSync } from "node:fs";
import { formatRetentionMetrics, retentionPlan, validateRetentionPolicy } from "../packages/config/src/retention.js";

const policy = validateRetentionPolicy(JSON.parse(readFileSync("config/data-retention.json", "utf8")));
const now = new Date(process.env.RETENTION_NOW || Date.now());

const sampleRecords = [
  { classId: "peer_stats", observedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() },
  { classId: "peer_stats", observedAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString() },
  { classId: "ip_related_logs", observedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString() },
  { classId: "auth_logs", observedAt: new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString() },
  { classId: "metrics", observedAt: new Date(now.getTime() - 500 * 24 * 60 * 60 * 1000).toISOString() }
];

const summary = retentionPlan({ policy, records: sampleRecords, now });

if (process.argv.includes("--prometheus")) {
  console.log(formatRetentionMetrics(summary, {
    failuresTotal: Number.parseInt(process.env.RETENTION_FAILURES_TOTAL || "0", 10) || 0,
    lastSuccessTimestampSeconds: Math.floor(now.getTime() / 1000)
  }));
} else {
  console.log(JSON.stringify({
    ok: true,
    now: now.toISOString(),
    policyReviewDate: policy.reviewDate,
    summary
  }, null, 2));
}
