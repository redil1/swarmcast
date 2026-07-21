import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  GATE_ARTIFACT_REQUIREMENTS,
  sha256LaunchArtifact,
  validateLaunchArtifactBundle
} from "./launch-evidence-artifact-contract.js";

const RECORD_KEYS = new Set([
  "schemaVersion", "releaseVersion", "commit", "environment", "reviewedAt", "synthetic", "artifactBundle",
  "reviewers", "gates"
]);
const GATE_KEYS = new Set(["id", "owner", "status", "evidence"]);
const WAIVED_GATE_KEYS = new Set([...GATE_KEYS, "waiver"]);
const ARTIFACT_BUNDLE_KEYS = new Set(["path", "sha256"]);
const REVIEWER_KEYS = new Set(["role", "reviewerId", "status", "reviewedAt"]);

const expectedImageScanEvidence = [
  "var/scans/segment-bus.trivy.json",
  "var/scans/segment-bus-exporter.trivy.json",
  "var/scans/auth.trivy.json",
  "var/scans/ingest.trivy.json",
  "var/scans/tracker.trivy.json",
  "var/scans/control-plane.trivy.json",
  "var/scans/retention-worker.trivy.json",
  "var/scans/nginx.trivy.json",
  "var/scans/prometheus.trivy.json",
  "var/scans/alertmanager.trivy.json",
  "var/scans/grafana.trivy.json",
  "var/scans/edge-nginx.trivy.json",
  "var/scans/edge-metrics.trivy.json",
  "var/scans/node-exporter.trivy.json",
  "var/scans/turn.trivy.json"
];

const requiredGates = [
  {
    id: "legal-approval",
    waivable: false,
    requiredEvidence: ["legal:approval:validate", "redistribution-rights", "peer-relay-rights", "viewer-device-retransmission", "privacy-disclosure"]
  },
  { id: "privacy-store-compliance", requiredEvidence: ["privacy:store:validate", "docs/privacy-store-compliance.md", "support-faq-reviewed", "app-store-notes-reviewed"] },
  { id: "release-artifacts", requiredEvidence: ["swarmcast-release-manifest", "swarmcast-sbom", "smoke:release-manifest-production"] },
  { id: "android-release-config", requiredEvidence: ["android:release-config:validate", "smoke:android-release-config-validation"] },
  {
    id: "android-app-attestation",
    requiredEvidence: [
      "android:attestation:evidence:validate",
      "play-console-linked",
      "play-integrity-api-enabled",
      "request-hash-match",
      "automatic-replay-protection",
      "play-recognized",
      "licensed",
      "meets-device-integrity",
      "auth-token-issued",
      "no-raw-integrity-token"
    ]
  },
  { id: "android-ci-build", requiredEvidence: ["android:ci:evidence:validate", "swarmcast-android-debug-apk", "swarmcast-android-release-unsigned-apk"] },
  { id: "android-device-playback", requiredEvidence: ["android:playback:evidence:validate", "delivery-fleet-only", "30m-soak", "wifi", "cellular"] },
  {
    id: "android-p2p-transfer",
    requiredEvidence: ["android:p2p:evidence:validate", "webrtc-datachannel", "tracker-signaling-relay", "verified-segment-hash", "cellular-no-upload", "ice-network-class", "ice-selected-candidate-type", "direct-relay-payload-attribution", "relay-egress-reconciled"]
  },
  { id: "android-rlnc-decision", requiredEvidence: ["android:rlnc:decision:validate"] },
  { id: "threat-model-signoff", requiredEvidence: ["threat:model:validate"] },
  { id: "security-review", requiredEvidence: ["security:review:validate"] },
  {
    id: "dependency-review",
    requiredEvidence: [
      "dependency:review:validate",
      "npm-audit",
      "sbom",
      "release-image-refs",
      "image-scans",
      "android-debug-build",
      "android-release-build",
      "inventory-decisions",
      "waiver-expiry"
    ]
  },
  {
    id: "repository-governance",
    requiredEvidence: [
      "repository:governance:evidence:validate",
      "branch-protection-enabled",
      "strict-required-checks",
      "pull-request-required",
      "admin-enforcement",
      "force-push-disabled",
      "deletion-disabled",
      "codeowners",
      "dependabot-version-updates",
      "dependabot-security-updates",
      "secret-scanning",
      "push-protection"
    ]
  },
  { id: "image-scan-reports", requiredEvidence: [...expectedImageScanEvidence, "image:scan:bundle:validate"] },
  { id: "data-retention-approval", requiredEvidence: ["retention:approval:validate", "retention:execution:evidence:validate"] },
  { id: "accessibility-ux-baseline", requiredEvidence: ["android:accessibility:validate", "talkback-focus-order", "large-font-200", "small-screen-layout", "touch-targets"] },
  {
    id: "host-provisioning",
    requiredEvidence: ["host:provisioning:evidence:validate", "public-dns-configured", "internal-ports-denied", "tls-certificates-issued", "monitoring"]
  },
  {
    id: "production-secrets",
    requiredEvidence: [
      "secrets:evidence:validate",
      "secret-storage",
      "rotation-policy",
      "runtime-injection",
      "access-review",
      "redaction-proof",
      "backup-restore",
      "no-raw-secret"
    ]
  },
  { id: "production-environment", requiredEvidence: ["env:production:validate", "smoke:production-env-validation", "smoke:compose-production-env"] },
  {
    id: "turn-relay",
    requiredEvidence: [
      "smoke:turn",
      "turn:capacity:evidence:validate",
      "turn-rest-credentials",
      "turn-udp-relay",
      "turn-tls-relay",
      "turn-prometheus",
      "turn-private-peer-deny",
      "android-relay-candidate-selected",
      "direct-relay-payload-attribution",
      "relay-egress-reconciled",
      "relay-egress-included",
      "turn-capacity-sustained",
      "independent-load-generators",
      "udp-tls-capacity",
      "provider-egress-reconciled"
    ]
  },
  {
    id: "deployment-execution",
    requiredEvidence: [
      "deployment:evidence:validate",
      "release-manifest-validated",
      "image-digests-pinned",
      "compose-rendered",
      "images-pulled",
      "deployed-up-no-build",
      "service-health",
      "post-deploy-smokes",
      "rollback-ready"
    ]
  },
  {
    id: "nginx-tls-smoke",
    requiredEvidence: [
      "nginx:tls:evidence:validate",
      "smoke:nginx-origin-playback",
      "smoke:nginx-edge-cache",
      "valid-certificate",
      "hostname-verified",
      "origin-auth-401",
      "origin-segment-200",
      "edge-cache-miss",
      "edge-cache-hit",
      "cross-token-hit",
      "no-third-party-cdn",
      "source-url-redaction",
      "cache-key-redaction"
    ]
  },
  { id: "source-allowlist", requiredEvidence: ["source:allowlist:evidence:validate", "SOURCE_ALLOWED_HOSTS"] },
  { id: "catalog-import", requiredEvidence: ["catalog:import:validate", "smoke:catalog-import-validation"] },
  {
    id: "production-smokes",
    requiredEvidence: [
      "production:smoke:evidence:validate",
      "source-preflight",
      "catalog-search-pagination",
      "ingest-demand-segments",
      "edge-cache-miss-hit",
      "tracker-join-peer-list-signal-stats-metrics",
      "retention-health-metrics",
      "offload-dashboard-alert-query"
    ]
  },
  { id: "canary-rollout", requiredEvidence: ["canary:rollout:evidence:validate", "canary:metrics:validate", "peerTimeouts5m", "peerHashFailures5m=0", "peerDisconnects5m=0"] },
  {
    id: "prometheus-alerts",
    requiredEvidence: [
      "prometheus:alerts:validate",
      "SwarmcastLowOffloadRatio",
      "SwarmcastPeerHashFailures",
      "SwarmcastHighPlaybackStallRate",
      "SwarmcastLowEdgeCacheHitRatio",
      "SwarmcastIngestDegradedChannels",
      "SwarmcastAuthVerifyFailures",
      "SwarmcastAppAttestationFailures",
      "SwarmcastRetentionJobFailures",
      "warning",
      "critical",
      "runbook-links"
    ]
  },
  { id: "grafana-dashboard", requiredEvidence: ["grafana:dashboard:validate"] },
  {
    id: "alert-receiver-fire-drill",
    requiredEvidence: [
      "alertmanager:receivers:validate",
      "alertmanager:fire-drill:validate",
      "smoke:alertmanager-routing",
      "warning-firing",
      "critical-firing",
      "critical-resolved",
      "oncall-default",
      "oncall-critical",
      "acknowledged"
    ]
  },
  {
    id: "segment-metadata-bus",
    waivable: false,
    requiredEvidence: [
      "segment-bus:capacity:evidence:validate",
      "three-failure-domain-cluster",
      "projected-peak-sustained",
      "publish-delivery-reconciled",
      "leader-loss-quorum",
      "persistent-latest-replay",
      "credential-rotation",
      "subject-permission-denial",
      "hostname-verified-tls",
      "mutual-route-tls",
      "storage-recovery",
      "monitoring-reconciled",
      "raw-probe-artifact-sha256",
      "independent-reviewers"
    ]
  },
  {
    id: "capacity-load-ladder",
    requiredEvidence: [
      "capacity:plan:validate",
      "load:ladder:validate",
      "direct-p2p-offload-measured",
      "edge-tls-throughput-measured",
      "provider-traffic-terms-approved",
      "relay-egress-included",
      "selfSustainingSweep",
      "webrtc-datachannel",
      "tracker-signaling-relay",
      "raw-probe-artifacts-sha256",
      "independent-generator-providers",
      "exact-peer-range-coverage",
      "cross-generator-webrtc",
      "single-channel-cell-ladder-1k",
      "single-channel-cell-ladder-10k",
      "single-channel-cell-ladder-100k"
    ]
  },
  {
    id: "staging-chaos-drills",
    requiredEvidence: [
      "chaos:staging:validate",
      "android-playback-continuity",
      "owned-edge-failover",
      "placement-failover",
      "durable-placement-restore",
      "peer-health-incident",
      "SwarmcastPeerHashFailures",
      "docs/runbooks/peer-health.md"
    ]
  },
  { id: "restore-drill", requiredEvidence: ["restore:evidence:validate", "docs/runbooks/restore-drill.md"] },
  {
    id: "rollback-drill",
    requiredEvidence: ["rollback:evidence:validate", "docs/runbooks/rollback-drill.md", "android-release-halt-ready", "app-incident-delivery-fleet-only", "tail-edge-only-mode"]
  }
];

const args = process.argv.slice(2);
const allowIncomplete = args.includes("--allow-incomplete");
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const validStatuses = new Set(["complete", "blocked", "partial", "waived"]);
const sensitiveEvidencePatterns = [
  /token=/i,
  /jwt=/i,
  /bearer\s+/i,
  /sourceurl/i,
  /source_url/i,
  /\.m3u8(?:\?|$)/i
];

function fail(message) {
  throw new Error(message);
}

function cleanString(name, value, pattern) {
  if (typeof value !== "string" || value.trim() === "") fail(`${name} is required`);
  if (/\s/.test(value.trim()) && pattern) fail(`${name} must not contain whitespace`);
  if (pattern && !pattern.test(value.trim())) fail(`${name} has invalid format`);
  return value.trim();
}

function exactObject(name, value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.size || actual.some((key) => !keys.has(key))) {
    fail(`${name} has unsupported or missing fields`);
  }
  return value;
}

function loadArtifactBundle(record) {
  exactObject("artifactBundle", record.artifactBundle, ARTIFACT_BUNDLE_KEYS);
  const relativePath = cleanString("artifactBundle.path", record.artifactBundle.path, /^[A-Za-z0-9._/-]+\.json$/);
  if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    fail("artifactBundle.path must be repository-root relative without traversal");
  }
  if (!record.synthetic && relativePath.startsWith("test-fixtures/")) {
    fail("non-synthetic launch evidence cannot use a test fixture artifact bundle");
  }
  const expectedHash = cleanString("artifactBundle.sha256", record.artifactBundle.sha256, /^[a-f0-9]{64}$/);
  const root = realpathSync(path.resolve(process.cwd()));
  const resolvedPath = path.resolve(root, relativePath);
  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${path.sep}`)) fail("artifactBundle.path escapes the repository root");
  let stat;
  try {
    stat = lstatSync(resolvedPath);
  } catch (error) {
    fail(`artifact bundle is unavailable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail("artifact bundle must be a regular non-symlink file");
  if (stat.size <= 0 || stat.size > 4 * 1024 * 1024) fail("artifact bundle has invalid size");
  const realRoot = root;
  const realBundlePath = realpathSync(resolvedPath);
  if (realBundlePath !== resolvedPath || (realBundlePath !== realRoot && !realBundlePath.startsWith(`${realRoot}${path.sep}`))) {
    fail("artifactBundle.path must not traverse symlinks or escape the repository root");
  }
  if (!record.synthetic && (stat.mode & 0o777) !== 0o600) fail("non-synthetic artifact bundle must use mode 0600");
  if (sha256LaunchArtifact(resolvedPath) !== expectedHash) fail("artifact bundle SHA-256 mismatch");
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    fail(`artifact bundle is invalid JSON: ${error.message}`);
  }
  try {
    const result = validateLaunchArtifactBundle(bundle, record, {
      allowSynthetic,
      rootDirectory: root,
      executeValidators: true
    });
    if (sha256LaunchArtifact(resolvedPath) !== expectedHash) fail("artifact bundle changed during validation");
    return result;
  } catch (error) {
    fail(`artifact bundle validation failed: ${error.message}`);
  }
}

function validateReviewers(record, bundleResult) {
  if (!Array.isArray(record.reviewers) || record.reviewers.length !== 3) {
    fail("reviewers must contain release, operations, and security approvals");
  }
  const roles = new Set();
  const identities = new Set();
  const bundleGeneratedAt = Date.parse(bundleResult.generatedAt);
  const launchReviewedAt = Date.parse(record.reviewedAt);
  for (const [index, reviewer] of record.reviewers.entries()) {
    const name = `reviewers[${index}]`;
    exactObject(name, reviewer, REVIEWER_KEYS);
    const role = cleanString(`${name}.role`, reviewer.role, /^(release|operations|security)$/);
    const reviewerId = cleanString(`${name}.reviewerId`, reviewer.reviewerId, /^[a-z0-9][a-z0-9._-]*$/);
    cleanString(`${name}.status`, reviewer.status, /^approved$/);
    const reviewedAt = Date.parse(cleanString(`${name}.reviewedAt`, reviewer.reviewedAt));
    if (!Number.isFinite(reviewedAt) || reviewedAt < bundleGeneratedAt || reviewedAt > launchReviewedAt) {
      fail(`${name}.reviewedAt must be between artifact generation and final launch review`);
    }
    if (roles.has(role) || identities.has(reviewerId)) fail("reviewer roles and identities must be distinct");
    roles.add(role);
    identities.add(reviewerId);
  }
  if (!["release", "operations", "security"].every((role) => roles.has(role))) {
    fail("reviewers must include release, operations, and security");
  }
}

function validateWaiver(gate, required) {
  if (required.waivable === false) fail(`${gate.id} cannot be waived`);
  if (!gate.waiver || typeof gate.waiver !== "object") fail(`${gate.id} waiver details are required`);
  cleanString(`${gate.id}.waiver.reason`, gate.waiver.reason);
  cleanString(`${gate.id}.waiver.approvedBy`, gate.waiver.approvedBy);
  const expiresAt = cleanString(`${gate.id}.waiver.expiresAt`, gate.waiver.expiresAt);
  if (Number.isNaN(Date.parse(expiresAt))) fail(`${gate.id}.waiver.expiresAt must be ISO-8601 parseable`);
}

function validateEvidence(gate, required) {
  if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) {
    fail(`${gate.id} must include at least one evidence reference`);
  }

  const joinedEvidence = gate.evidence.join("\n");
  for (const evidence of gate.evidence) {
    cleanString(`${gate.id}.evidence[]`, evidence);
    if (sensitiveEvidencePatterns.some((pattern) => pattern.test(evidence))) {
      fail(`${gate.id} evidence reference looks like it may contain sensitive stream or token material`);
    }
  }

  for (const requiredEvidence of required.requiredEvidence || []) {
    if (!joinedEvidence.includes(requiredEvidence)) {
      fail(`${gate.id} evidence must mention ${requiredEvidence}`);
    }
  }
}

function validateRecord(record, file) {
  exactObject("launch evidence", record, RECORD_KEYS);
  if (record.schemaVersion !== 2) fail("schemaVersion must equal 2");
  if (typeof record.synthetic !== "boolean") fail("synthetic must be a boolean");
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  if (Number.isNaN(Date.parse(cleanString("reviewedAt", record.reviewedAt)))) {
    fail("reviewedAt must be ISO-8601 parseable");
  }
  if (record.synthetic && !allowSynthetic) {
    fail("synthetic launch evidence requires --allow-synthetic");
  }
  if (!record.synthetic && record.environment !== "production") {
    fail("launch evidence environment must be production");
  }
  if (!Array.isArray(record.gates)) fail("gates must be an array");

  const byId = new Map();
  for (const [index, gate] of record.gates.entries()) {
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) fail(`gates[${index}] must be an object`);
    const id = cleanString("gate.id", gate.id, /^[a-z0-9-]+$/);
    if (!GATE_ARTIFACT_REQUIREMENTS.has(id)) fail(`unexpected gate ${id}`);
    if (byId.has(id)) fail(`duplicate gate ${id}`);
    exactObject(id, gate, gate.status === "waived" ? WAIVED_GATE_KEYS : GATE_KEYS);
    cleanString(`${id}.owner`, gate.owner);
    if (!validStatuses.has(gate.status)) fail(`${id}.status must be complete, blocked, partial, or waived`);
    byId.set(id, gate);
  }
  if (byId.size !== requiredGates.length) fail(`gates must contain exactly ${requiredGates.length} launch gates`);

  const incomplete = [];
  for (const required of requiredGates) {
    const gate = byId.get(required.id);
    if (!gate) fail(`missing required gate ${required.id}`);
    if (gate.status === "complete") {
      validateEvidence(gate, required);
    } else if (gate.status === "waived") {
      validateWaiver(gate, required);
      validateEvidence(gate, required);
      incomplete.push(gate.id);
      if (!allowIncomplete) fail(`${gate.id} is waived; launch evidence is not complete`);
    } else {
      incomplete.push(gate.id);
      if (!allowIncomplete) fail(`${gate.id} is ${gate.status}; launch evidence is not complete`);
    }
  }

  const bundleResult = loadArtifactBundle(record);
  validateReviewers(record, bundleResult);
  const mode = incomplete.length === 0 ? (record.synthetic ? "synthetic-shape-ready" : "launch-ready") : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Launch evidence OK: ${requiredGates.length} gates, artifacts=${bundleResult.artifactCount}, validators=${bundleResult.validatorCount}, status=${mode}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-launch-evidence.js [--allow-incomplete] [--allow-synthetic] <launch-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`Launch evidence validation failed: ${error.message}`);
  process.exit(1);
}
