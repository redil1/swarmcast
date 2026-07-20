import { readFileSync } from "node:fs";

const expectedImageScanEvidence = [
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
  { id: "android-ci-build", requiredEvidence: ["android:ci:evidence:validate", "swarmcast-android-debug-apk", "swarmcast-android-release-unsigned-apk"] },
  { id: "android-device-playback", requiredEvidence: ["android:playback:evidence:validate", "delivery-fleet-only", "30m-soak", "wifi", "cellular"] },
  {
    id: "android-p2p-transfer",
    requiredEvidence: ["android:p2p:evidence:validate", "webrtc-datachannel", "tracker-signaling-relay", "verified-segment-hash", "cellular-no-upload", "ice-network-class", "ice-selected-candidate-type"]
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
      "turn-rest-credentials",
      "turn-udp-relay",
      "turn-tls-relay",
      "turn-prometheus",
      "turn-private-peer-deny",
      "relay-egress-included"
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
  for (const gate of record.gates) {
    const id = cleanString("gate.id", gate.id, /^[a-z0-9-]+$/);
    if (byId.has(id)) fail(`duplicate gate ${id}`);
    byId.set(id, gate);
    cleanString(`${id}.owner`, gate.owner);
    if (!validStatuses.has(gate.status)) fail(`${id}.status must be complete, blocked, partial, or waived`);
  }

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

  const mode = incomplete.length === 0 ? (record.synthetic ? "synthetic-shape-ready" : "launch-ready") : `shape-only incomplete=${incomplete.length}`;
  return `${file}: Launch evidence OK: ${requiredGates.length} gates, status=${mode}`;
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
