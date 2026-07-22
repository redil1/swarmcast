import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const BUNDLE_KEYS = new Set([
  "schemaVersion", "synthetic", "releaseVersion", "commit", "generatedAt", "artifacts", "gates"
]);
const ARTIFACT_KEYS = new Set(["id", "path", "sha256"]);
const GATE_KEYS = new Set(["id", "artifactIds"]);
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_VALIDATOR_OUTPUT_BYTES = 4 * 1024 * 1024;

const imageScanIds = [
  "segment-bus", "segment-bus-exporter", "auth", "ingest", "tracker", "control-plane",
  "web", "retention-worker", "nginx", "prometheus", "alertmanager", "grafana", "edge-nginx", "edge-metrics",
  "node-exporter", "turn"
].map((service) => `image-scan-${service}`);

export const GATE_ARTIFACT_REQUIREMENTS = new Map([
  ["legal-approval", ["legal-approval"]],
  ["privacy-store-compliance", ["privacy-store-compliance"]],
  ["release-artifacts", ["release-manifest"]],
  ["android-release-config", ["android-release-config"]],
  ["android-app-attestation", ["android-app-attestation"]],
  ["android-ci-build", ["android-ci-build"]],
  ["android-device-playback", ["android-device-playback"]],
  ["android-p2p-transfer", ["android-p2p-transfer"]],
  ["android-rlnc-decision", ["android-rlnc-decision"]],
  ["threat-model-signoff", ["threat-model-review"]],
  ["security-review", ["security-review"]],
  ["dependency-review", ["dependency-review"]],
  ["repository-governance", ["repository-governance"]],
  ["image-scan-reports", ["release-manifest", ...imageScanIds]],
  ["data-retention-approval", ["retention-approval", "retention-execution"]],
  ["accessibility-ux-baseline", ["android-accessibility"]],
  ["host-provisioning", ["host-provisioning"]],
  ["production-secrets", ["production-secrets"]],
  ["production-environment", ["production-environment"]],
  ["turn-relay", ["turn-capacity"]],
  ["deployment-execution", ["deployment-execution"]],
  ["nginx-tls-smoke", ["nginx-tls-smoke"]],
  ["source-allowlist", ["source-allowlist"]],
  ["catalog-import", ["catalog-import"]],
  ["production-smokes", ["production-smokes"]],
  ["canary-rollout", ["canary-metrics", "canary-rollout"]],
  ["prometheus-alerts", ["prometheus-alerts"]],
  ["grafana-dashboard", ["grafana-dashboard"]],
  ["alert-receiver-fire-drill", ["alertmanager-config", "alertmanager-fire-drill"]],
  ["segment-metadata-bus", ["segment-bus-capacity"]],
  ["capacity-load-ladder", ["capacity-plan", "load-ladder"]],
  ["staging-chaos-drills", ["staging-chaos"]],
  ["restore-drill", ["restore-drill"]],
  ["rollback-drill", ["rollback-drill"]]
]);

function exactObject(name, value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.size || actual.some((key) => !keys.has(key))) {
    throw new Error(`${name} has unsupported or missing fields`);
  }
  return value;
}

function cleanString(name, value, pattern = null) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) throw new Error(`${name} has invalid format`);
  return normalized;
}

function parseTime(name, value) {
  const normalized = cleanString(name, value);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${name} must be ISO-8601 parseable`);
  return normalized;
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function fixedEnvironment(env) {
  const output = {};
  for (const key of ["HOME", "PATH", "TMPDIR"]) {
    if (typeof env[key] === "string") output[key] = env[key];
  }
  return output;
}

function single(script, artifactId, { synthetic = true, syntheticFlag = "--allow-synthetic", args = [] } = {}) {
  return {
    id: artifactId,
    artifactIds: [artifactId],
    command: (artifacts, isSynthetic) => [
      script,
      ...(synthetic && isSynthetic ? [syntheticFlag] : []),
      ...args,
      artifacts.get(artifactId).resolvedPath
    ]
  };
}

const VALIDATIONS = [
  single("scripts/validate-legal-approval.js", "legal-approval"),
  single("scripts/validate-privacy-store-compliance.js", "privacy-store-compliance"),
  {
    id: "release-manifest",
    artifactIds: ["release-manifest"],
    command: (artifacts) => [
      "scripts/generate-release-manifest.js", "--input", artifacts.get("release-manifest").resolvedPath, "--check"
    ]
  },
  single("scripts/validate-android-release-config.js", "android-release-config", { synthetic: false }),
  single("scripts/validate-android-attestation-evidence.js", "android-app-attestation"),
  single("scripts/validate-android-ci-evidence.js", "android-ci-build"),
  single("scripts/validate-android-playback-evidence.js", "android-device-playback"),
  single("scripts/validate-android-p2p-evidence.js", "android-p2p-transfer"),
  single("scripts/validate-android-rlnc-decision.js", "android-rlnc-decision"),
  single("scripts/validate-threat-model-review.js", "threat-model-review"),
  single("scripts/validate-security-review.js", "security-review"),
  single("scripts/validate-dependency-review.js", "dependency-review"),
  single("scripts/validate-repository-governance-evidence.js", "repository-governance"),
  {
    id: "image-scan-bundle",
    artifactIds: ["release-manifest", ...imageScanIds],
    command: (artifacts, synthetic) => [
      "scripts/validate-image-scan-bundle.js",
      ...(synthetic ? ["--allow-synthetic"] : []),
      "--manifest", artifacts.get("release-manifest").resolvedPath,
      ...imageScanIds.map((id) => artifacts.get(id).resolvedPath)
    ]
  },
  single("scripts/validate-retention-approval.js", "retention-approval"),
  single("scripts/validate-retention-execution-evidence.js", "retention-execution"),
  single("scripts/validate-android-accessibility-evidence.js", "android-accessibility"),
  single("scripts/validate-host-provisioning-evidence.js", "host-provisioning"),
  single("scripts/validate-secrets-evidence.js", "production-secrets"),
  {
    id: "production-environment",
    artifactIds: ["production-environment"],
    command: (artifacts, synthetic) => [
      "scripts/validate-production-env.js",
      ...(synthetic ? ["--allow-example"] : []),
      artifacts.get("production-environment").resolvedPath
    ]
  },
  single("scripts/validate-turn-capacity-evidence.js", "turn-capacity"),
  single("scripts/validate-deployment-evidence.js", "deployment-execution"),
  single("scripts/validate-nginx-tls-evidence.js", "nginx-tls-smoke"),
  single("scripts/validate-source-allowlist-evidence.js", "source-allowlist"),
  single("scripts/validate-catalog-import.js", "catalog-import"),
  single("scripts/validate-production-smoke-evidence.js", "production-smokes"),
  single("scripts/validate-canary-metrics.js", "canary-metrics", { synthetic: false }),
  single("scripts/validate-canary-rollout-evidence.js", "canary-rollout"),
  {
    id: "prometheus-alerts",
    artifactIds: ["prometheus-alerts"],
    command: (artifacts) => [
      "scripts/validate-prometheus-alerts.js", "--require-launch-coverage", artifacts.get("prometheus-alerts").resolvedPath
    ]
  },
  single("scripts/validate-grafana-dashboard.js", "grafana-dashboard", { synthetic: false }),
  {
    id: "alertmanager-config",
    artifactIds: ["alertmanager-config"],
    command: (artifacts, synthetic) => [
      "scripts/validate-alertmanager-receivers.js",
      ...(synthetic ? ["--allow-local"] : []),
      artifacts.get("alertmanager-config").resolvedPath
    ]
  },
  single("scripts/validate-alertmanager-fire-drill.js", "alertmanager-fire-drill"),
  single("scripts/validate-segment-bus-capacity-evidence.js", "segment-bus-capacity"),
  {
    id: "capacity-plan",
    artifactIds: ["capacity-plan"],
    command: (artifacts, synthetic) => [
      "scripts/validate-capacity-plan.js",
      ...(synthetic ? ["--allow-draft"] : []),
      artifacts.get("capacity-plan").resolvedPath
    ]
  },
  single("scripts/validate-load-ladder-evidence.js", "load-ladder"),
  single("scripts/validate-staging-chaos-evidence.js", "staging-chaos"),
  single("scripts/validate-restore-evidence.js", "restore-drill"),
  single("scripts/validate-rollback-evidence.js", "rollback-drill")
];

function validateArtifactPath(value, synthetic, rootDirectory) {
  const relativePath = cleanString("artifact.path", value, /^[A-Za-z0-9._/-]+$/);
  if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    throw new Error("artifact.path must be repository-root relative without traversal");
  }
  if (!synthetic && relativePath.startsWith("test-fixtures/")) {
    throw new Error("non-synthetic launch artifacts cannot come from test-fixtures");
  }
  const resolvedPath = path.resolve(rootDirectory, relativePath);
  if (resolvedPath !== rootDirectory && !resolvedPath.startsWith(`${rootDirectory}${path.sep}`)) {
    throw new Error("artifact.path escapes the repository root");
  }
  return { relativePath, resolvedPath };
}

function validateArtifactContent(artifact, bundle, launchRecord) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(artifact.resolvedPath, "utf8"));
  } catch {
    return;
  }
  if (!bundle.synthetic && (parsed.synthetic === true || parsed.Synthetic === true)) {
    throw new Error(`${artifact.id} contains synthetic evidence in a non-synthetic bundle`);
  }
  if (!bundle.synthetic && typeof parsed.commit === "string" && parsed.commit.toLowerCase() !== launchRecord.commit.toLowerCase()) {
    throw new Error(`${artifact.id} commit does not match launch evidence`);
  }
  const artifactVersion = typeof parsed.releaseVersion === "string"
    ? parsed.releaseVersion
    : (typeof parsed.version === "string" ? parsed.version : null);
  if (!bundle.synthetic && artifactVersion && artifactVersion !== launchRecord.releaseVersion) {
    throw new Error(`${artifact.id} release version does not match launch evidence`);
  }
}

function executeValidation(validation, artifacts, synthetic, env, rootDirectory) {
  const args = validation.command(artifacts, synthetic);
  const result = spawnSync(process.execPath, args, {
    cwd: rootDirectory,
    env: fixedEnvironment(env),
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: MAX_VALIDATOR_OUTPUT_BYTES
  });
  if (result.error) throw new Error(`${validation.id} validator failed to execute: ${result.error.message}`);
  if (result.status !== 0) {
    const output = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
    const bounded = output.slice(0, 2_000);
    throw new Error(`${validation.id} validator rejected its artifacts${bounded ? `: ${bounded}` : ""}`);
  }
}

export function validateLaunchArtifactBundle(input, launchRecord, {
  allowSynthetic = false,
  rootDirectory = process.cwd(),
  executeValidators = true,
  env = process.env
} = {}) {
  const canonicalRoot = realpathSync(path.resolve(rootDirectory));
  exactObject("launch artifact bundle", input, BUNDLE_KEYS);
  if (input.schemaVersion !== 1) throw new Error("artifact bundle schemaVersion must equal 1");
  if (typeof input.synthetic !== "boolean") throw new Error("artifact bundle synthetic must be a boolean");
  const synthetic = input.synthetic === true;
  if (synthetic && !allowSynthetic) throw new Error("synthetic launch artifact bundle requires --allow-synthetic");
  const releaseVersion = cleanString("artifact bundle releaseVersion", input.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  const commit = cleanString("artifact bundle commit", input.commit, /^[a-fA-F0-9]{7,40}$/);
  parseTime("artifact bundle generatedAt", input.generatedAt);
  if (synthetic !== (launchRecord.synthetic === true)) throw new Error("artifact bundle synthetic flag does not match launch evidence");
  if (releaseVersion !== launchRecord.releaseVersion || commit.toLowerCase() !== launchRecord.commit.toLowerCase()) {
    throw new Error("artifact bundle release binding does not match launch evidence");
  }
  if (!Array.isArray(input.artifacts)) throw new Error("artifact bundle artifacts must be an array");
  const artifacts = new Map();
  const paths = new Map();
  for (const [index, artifact] of input.artifacts.entries()) {
    exactObject(`artifacts[${index}]`, artifact, ARTIFACT_KEYS);
    const id = cleanString(`artifacts[${index}].id`, artifact.id, ID_PATTERN);
    if (artifacts.has(id)) throw new Error(`duplicate launch artifact ${id}`);
    const expectedHash = cleanString(`artifacts[${index}].sha256`, artifact.sha256, HASH_PATTERN);
    const { relativePath, resolvedPath } = validateArtifactPath(artifact.path, synthetic, canonicalRoot);
    let stat;
    try {
      stat = lstatSync(resolvedPath);
    } catch (error) {
      throw new Error(`${id} artifact is unavailable: ${error.message}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${id} artifact must be a regular non-symlink file`);
    if (stat.size <= 0 || stat.size > MAX_ARTIFACT_BYTES) throw new Error(`${id} artifact has invalid size`);
    const realRoot = canonicalRoot;
    const realArtifactPath = realpathSync(resolvedPath);
    if (realArtifactPath !== resolvedPath || (realArtifactPath !== realRoot && !realArtifactPath.startsWith(`${realRoot}${path.sep}`))) {
      throw new Error(`${id} artifact path must not traverse symlinks or escape the repository root`);
    }
    const actualHash = sha256File(resolvedPath);
    if (actualHash !== expectedHash) throw new Error(`${id} artifact SHA-256 mismatch`);
    if (paths.has(relativePath)) throw new Error(`artifact path ${relativePath} is assigned to more than one artifact`);
    paths.set(relativePath, actualHash);
    artifacts.set(id, { id, relativePath, resolvedPath, sha256: actualHash });
  }

  if (!Array.isArray(input.gates)) throw new Error("artifact bundle gates must be an array");
  const gates = new Map();
  const usedArtifactIds = new Set();
  for (const [index, gate] of input.gates.entries()) {
    exactObject(`gates[${index}]`, gate, GATE_KEYS);
    const id = cleanString(`gates[${index}].id`, gate.id, ID_PATTERN);
    if (gates.has(id)) throw new Error(`duplicate artifact gate ${id}`);
    const expected = GATE_ARTIFACT_REQUIREMENTS.get(id);
    if (!expected) throw new Error(`unexpected artifact gate ${id}`);
    if (!Array.isArray(gate.artifactIds) || gate.artifactIds.length !== expected.length) {
      throw new Error(`${id}.artifactIds must contain the exact required artifact set`);
    }
    const actualIds = new Set(gate.artifactIds.map((value, artifactIndex) => (
      cleanString(`${id}.artifactIds[${artifactIndex}]`, value, ID_PATTERN)
    )));
    if (actualIds.size !== gate.artifactIds.length || expected.some((artifactId) => !actualIds.has(artifactId))) {
      throw new Error(`${id}.artifactIds must contain the exact required artifact set`);
    }
    for (const artifactId of actualIds) {
      if (!artifacts.has(artifactId)) throw new Error(`${id} references missing artifact ${artifactId}`);
      usedArtifactIds.add(artifactId);
    }
    gates.set(id, actualIds);
  }
  if (gates.size !== GATE_ARTIFACT_REQUIREMENTS.size) throw new Error("artifact bundle does not cover every launch gate");
  for (const gateId of GATE_ARTIFACT_REQUIREMENTS.keys()) {
    if (!gates.has(gateId)) throw new Error(`artifact bundle missing gate ${gateId}`);
  }
  if (usedArtifactIds.size !== artifacts.size) throw new Error("artifact bundle contains unused artifacts");
  const validationArtifactIds = new Set(VALIDATIONS.flatMap((validation) => validation.artifactIds));
  if (validationArtifactIds.size !== artifacts.size || [...artifacts.keys()].some((id) => !validationArtifactIds.has(id))) {
    throw new Error("artifact bundle does not match the fixed validator inventory");
  }
  for (const artifact of artifacts.values()) validateArtifactContent(artifact, input, launchRecord);
  if (executeValidators) {
    for (const validation of VALIDATIONS) executeValidation(validation, artifacts, synthetic, env, canonicalRoot);
  }
  for (const artifact of artifacts.values()) {
    if (sha256File(artifact.resolvedPath) !== artifact.sha256) {
      throw new Error(`${artifact.id} artifact changed during validation`);
    }
  }
  return {
    artifactCount: artifacts.size,
    gateCount: gates.size,
    validatorCount: VALIDATIONS.length,
    generatedAt: input.generatedAt
  };
}

export function sha256LaunchArtifact(file) {
  return sha256File(file);
}
