import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { validatePerformanceBudgets } from "../packages/config/src/performanceBudgets.js";
import { runSegmentBusCapacityProbe } from "./segment-bus-capacity-probe-runner.js";

const args = process.argv.slice(2);
const allowed = new Set([
  "--acknowledge-staging-disruption", "--allow-synthetic", "--budgets", "--capacity-plan", "--driver",
  "--manifest", "--output"
]);

function fail(message) {
  throw new Error(message);
}

function parseOptions() {
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!allowed.has(key)) fail(`unknown option ${key}`);
    if (options.has(key)) fail(`duplicate option ${key}`);
    if (key === "--acknowledge-staging-disruption" || key === "--allow-synthetic") {
      options.set(key, true);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`${key} requires a value`);
    options.set(key, value);
    index += 1;
  }
  return options;
}

function reserveExclusiveEvidence(outputPath) {
  const noFollow = constants.O_NOFOLLOW || 0;
  const descriptor = openSync(
    outputPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
    0o600
  );
  fchmodSync(descriptor, 0o600);
  return descriptor;
}

let outputDescriptor;
let reservedOutputPath;
try {
  const options = parseOptions();
  if (options.get("--acknowledge-staging-disruption") !== true) {
    fail("--acknowledge-staging-disruption is required because this command stops a leader and restarts the cluster");
  }
  const manifestPath = options.get("--manifest");
  const driverPath = options.get("--driver");
  const outputPath = options.get("--output");
  if (!manifestPath || !driverPath || !outputPath) {
    fail("Usage: node scripts/run-segment-bus-capacity-probe.js --acknowledge-staging-disruption --manifest <probe.json> --driver <executable> --output <raw.json> [--capacity-plan <json>] [--budgets <json>] [--allow-synthetic]");
  }
  const capacityPlanPath = options.get("--capacity-plan") || "config/capacity-plan.json";
  const budgetsPath = options.get("--budgets") || "config/performance-budgets.json";
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const capacityPlan = JSON.parse(readFileSync(capacityPlanPath, "utf8"));
  const budgets = validatePerformanceBudgets(JSON.parse(readFileSync(budgetsPath, "utf8")));
  outputDescriptor = reserveExclusiveEvidence(outputPath);
  reservedOutputPath = outputPath;
  const probe = await runSegmentBusCapacityProbe({
    manifest,
    driverPath,
    capacityPlan,
    budgets,
    allowSynthetic: options.get("--allow-synthetic") === true
  });
  writeFileSync(outputDescriptor, `${JSON.stringify(probe, null, 2)}\n`, "utf8");
  fsyncSync(outputDescriptor);
  closeSync(outputDescriptor);
  outputDescriptor = undefined;
  console.log(`Segment bus capacity probe OK: cluster=${probe.clusterId} target=${probe.capacityProfile.targetMessagesPerSecond}msg/s nodes=${probe.topology.length} synthetic=${probe.synthetic}`);
} catch (error) {
  if (outputDescriptor !== undefined) {
    closeSync(outputDescriptor);
    try {
      unlinkSync(reservedOutputPath);
    } catch {
      // Preserve the original probe failure.
    }
  }
  console.error(`Segment bus capacity probe failed: ${error.message}`);
  process.exit(1);
}
