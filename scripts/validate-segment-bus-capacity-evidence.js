import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePerformanceBudgets } from "../packages/config/src/performanceBudgets.js";
import {
  failSegmentBusCapacity,
  validateSegmentBusCapacityProbe,
  validateSegmentBusCapacityReviewers
} from "./segment-bus-capacity-contract.js";

const EVIDENCE_KEYS = new Set([
  "schemaVersion", "synthetic", "evidenceId", "environment", "commit", "releaseVersion", "clusterId",
  "rawProbeArtifact", "reviewers", "evidenceMarkers"
]);
const ARTIFACT_KEYS = new Set(["path", "sha256"]);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const REQUIRED_MARKERS = [
  "three-failure-domain-cluster", "projected-peak-sustained", "publish-delivery-reconciled",
  "leader-loss-quorum", "persistent-latest-replay", "credential-rotation", "subject-permission-denial",
  "hostname-verified-tls", "mutual-route-tls", "storage-recovery", "monitoring-reconciled",
  "raw-probe-artifact-sha256", "independent-reviewers"
];

function exactObject(name, value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) failSegmentBusCapacity(`${name} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.size || actual.some((key) => !keys.has(key))) {
    failSegmentBusCapacity(`${name} has unsupported or missing fields`);
  }
  return value;
}

function cleanString(name, value, pattern = null) {
  if (typeof value !== "string" || value.trim() === "") failSegmentBusCapacity(`${name} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) failSegmentBusCapacity(`${name} has invalid format`);
  return normalized;
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function loadRawProbe(record, evidenceFile, { allowSynthetic, capacityPlan, budgets }) {
  exactObject("rawProbeArtifact", record.rawProbeArtifact, ARTIFACT_KEYS);
  const relativePath = cleanString("rawProbeArtifact.path", record.rawProbeArtifact.path, /^[A-Za-z0-9._/-]+\.json$/);
  if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    failSegmentBusCapacity("rawProbeArtifact.path must stay within the evidence directory");
  }
  const expectedHash = cleanString("rawProbeArtifact.sha256", record.rawProbeArtifact.sha256, HASH_PATTERN);
  const evidenceDirectory = path.dirname(path.resolve(evidenceFile));
  const rawPath = path.resolve(evidenceDirectory, relativePath);
  if (rawPath !== evidenceDirectory && !rawPath.startsWith(`${evidenceDirectory}${path.sep}`)) {
    failSegmentBusCapacity("rawProbeArtifact.path escapes the evidence directory");
  }
  let stat;
  try {
    stat = lstatSync(rawPath);
  } catch (error) {
    failSegmentBusCapacity(`raw probe artifact is unavailable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) failSegmentBusCapacity("raw probe artifact must be a regular non-symlink file");
  if (stat.size <= 0 || stat.size > 64 * 1024 * 1024) failSegmentBusCapacity("raw probe artifact has invalid size");
  if (!record.synthetic && (stat.mode & 0o777) !== 0o600) failSegmentBusCapacity("raw probe artifact must use mode 0600");
  if (sha256File(rawPath) !== expectedHash) failSegmentBusCapacity("raw probe artifact SHA-256 mismatch");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(rawPath, "utf8"));
  } catch (error) {
    failSegmentBusCapacity(`raw probe artifact is invalid JSON: ${error.message}`);
  }
  return validateSegmentBusCapacityProbe(parsed, { allowSynthetic, capacityPlan, budgets, source: "raw probe artifact" });
}

export function validateSegmentBusCapacityEvidence(record, evidenceFile, {
  allowSynthetic = false,
  capacityPlan,
  budgets
} = {}) {
  exactObject("segment bus capacity evidence", record, EVIDENCE_KEYS);
  if (record.schemaVersion !== 1) failSegmentBusCapacity("schemaVersion must equal 1");
  const synthetic = record.synthetic === true;
  if (synthetic && !allowSynthetic) failSegmentBusCapacity("synthetic segment bus capacity evidence requires --allow-synthetic");
  cleanString("evidenceId", record.evidenceId, ID_PATTERN);
  const environment = cleanString("environment", record.environment, /^(staging|production)$/);
  if (!synthetic && environment !== "staging") failSegmentBusCapacity("non-synthetic segment bus capacity evidence must come from staging");
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("clusterId", record.clusterId, ID_PATTERN);
  if (!capacityPlan || !budgets) failSegmentBusCapacity("capacity plan and performance budgets are required");
  const probe = loadRawProbe(record, evidenceFile, { allowSynthetic, capacityPlan, budgets });
  for (const key of ["synthetic", "evidenceId", "environment", "commit", "releaseVersion", "clusterId"]) {
    if (record[key] !== probe[key]) failSegmentBusCapacity(`${key} does not match the raw probe artifact`);
  }
  validateSegmentBusCapacityReviewers(record.reviewers, probe.completedAt);
  if (!Array.isArray(record.evidenceMarkers) || record.evidenceMarkers.length !== REQUIRED_MARKERS.length) {
    failSegmentBusCapacity("evidenceMarkers must contain the complete unique marker set");
  }
  const markers = new Set(record.evidenceMarkers.map((value, index) => cleanString(`evidenceMarkers[${index}]`, value, ID_PATTERN)));
  if (markers.size !== record.evidenceMarkers.length) failSegmentBusCapacity("evidenceMarkers must be unique");
  for (const marker of REQUIRED_MARKERS) {
    if (!markers.has(marker)) failSegmentBusCapacity(`evidenceMarkers missing ${marker}`);
  }
  if (!synthetic) {
    if (capacityPlan.segmentBusCapacityMeasurementStatus !== "measured") {
      failSegmentBusCapacity("capacity plan segmentBusCapacityMeasurementStatus must be measured");
    }
    const configuredEvidence = cleanString("capacityPlan.segmentBusCapacityEvidence", capacityPlan.segmentBusCapacityEvidence);
    if (/pending|synthetic|modeled/i.test(configuredEvidence)) {
      failSegmentBusCapacity("capacity plan segmentBusCapacityEvidence must name measured evidence");
    }
    if (path.resolve(configuredEvidence) !== path.resolve(evidenceFile)) {
      failSegmentBusCapacity("capacity plan segmentBusCapacityEvidence must identify this evidence file");
    }
  }
  return { ...structuredClone(record), probe };
}

function parseCli(args) {
  const options = new Map();
  const allowed = new Set(["--allow-synthetic", "--budgets", "--capacity-plan"]);
  const files = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      files.push(value);
      continue;
    }
    if (!allowed.has(value)) failSegmentBusCapacity(`unknown option ${value}`);
    if (options.has(value)) failSegmentBusCapacity(`duplicate option ${value}`);
    if (value === "--allow-synthetic") {
      options.set(value, true);
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) failSegmentBusCapacity(`${value} requires a value`);
    options.set(value, next);
    index += 1;
  }
  if (files.length !== 1) failSegmentBusCapacity("exactly one evidence file is required");
  return { options, evidenceFile: files[0] };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const { options, evidenceFile } = parseCli(process.argv.slice(2));
    const capacityPlan = JSON.parse(readFileSync(options.get("--capacity-plan") || "config/capacity-plan.json", "utf8"));
    const budgets = validatePerformanceBudgets(JSON.parse(readFileSync(options.get("--budgets") || "config/performance-budgets.json", "utf8")));
    const record = JSON.parse(readFileSync(evidenceFile, "utf8"));
    const result = validateSegmentBusCapacityEvidence(record, evidenceFile, {
      allowSynthetic: options.get("--allow-synthetic") === true,
      capacityPlan,
      budgets
    });
    console.log(`Segment bus capacity evidence OK: cluster=${result.clusterId} target=${result.probe.capacityProfile.targetMessagesPerSecond}msg/s nodes=${result.probe.topology.length} synthetic=${result.synthetic}`);
  } catch (error) {
    console.error(`Segment bus capacity evidence failed: ${error.message}`);
    process.exit(1);
  }
}
