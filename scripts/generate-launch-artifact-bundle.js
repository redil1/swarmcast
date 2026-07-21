import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  GATE_ARTIFACT_REQUIREMENTS,
  sha256LaunchArtifact,
  validateLaunchArtifactBundle
} from "./launch-evidence-artifact-contract.js";

const INVENTORY_KEYS = new Set([
  "schemaVersion", "synthetic", "releaseVersion", "commit", "generatedAt", "artifacts"
]);
const ARTIFACT_KEYS = new Set(["id", "path"]);
const args = process.argv.slice(2);
const allowSynthetic = args.includes("--allow-synthetic");

function fail(message) {
  throw new Error(message);
}

function option(name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith("--")) fail(`${name} is required`);
  return args[index + 1];
}

function exactObject(name, value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.size || actual.some((key) => !keys.has(key))) {
    fail(`${name} has unsupported or missing fields`);
  }
}

function repositoryPath(name, value, suffix = null) {
  if (typeof value !== "string" || value.trim() === "" || !/^[A-Za-z0-9._/-]+$/.test(value)) {
    fail(`${name} must be a repository-root relative path`);
  }
  const normalized = value.trim();
  if (path.isAbsolute(normalized) || normalized.split("/").includes("..") || (suffix && !normalized.endsWith(suffix))) {
    fail(`${name} must be a repository-root relative${suffix ? ` ${suffix}` : ""} path without traversal`);
  }
  const root = realpathSync(path.resolve(process.cwd()));
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) fail(`${name} escapes the repository root`);
  return { normalized, resolved };
}

function validateOutputParent(outputPath) {
  const root = realpathSync(path.resolve(process.cwd()));
  const parent = path.dirname(outputPath.resolved);
  const realParent = realpathSync(parent);
  if (realParent !== parent || (realParent !== root && !realParent.startsWith(`${root}${path.sep}`))) {
    fail("--output parent must not traverse symlinks or escape the repository root");
  }
}

function main() {
  const inventoryPath = repositoryPath("--inventory", option("--inventory"), ".json");
  const outputPath = repositoryPath("--output", option("--output"), ".json");
  if (inventoryPath.resolved === outputPath.resolved) fail("--output must differ from --inventory");
  validateOutputParent(outputPath);

  const inventory = JSON.parse(readFileSync(inventoryPath.resolved, "utf8"));
  exactObject("launch artifact inventory", inventory, INVENTORY_KEYS);
  if (inventory.schemaVersion !== 1) fail("inventory schemaVersion must equal 1");
  if (typeof inventory.synthetic !== "boolean") fail("inventory synthetic must be a boolean");
  if (inventory.synthetic === true && !allowSynthetic) fail("synthetic inventory requires --allow-synthetic");
  if (!Array.isArray(inventory.artifacts)) fail("inventory artifacts must be an array");

  const expectedArtifactIds = new Set([...GATE_ARTIFACT_REQUIREMENTS.values()].flat());
  const artifactIds = new Set();
  const artifacts = inventory.artifacts.map((artifact, index) => {
    exactObject(`artifacts[${index}]`, artifact, ARTIFACT_KEYS);
    if (typeof artifact.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(artifact.id)) {
      fail(`artifacts[${index}].id has invalid format`);
    }
    if (artifactIds.has(artifact.id)) fail(`duplicate artifact ${artifact.id}`);
    if (!expectedArtifactIds.has(artifact.id)) fail(`unexpected artifact ${artifact.id}`);
    artifactIds.add(artifact.id);
    const artifactPath = repositoryPath(`artifacts[${index}].path`, artifact.path);
    return {
      id: artifact.id,
      path: artifactPath.normalized,
      sha256: sha256LaunchArtifact(artifactPath.resolved)
    };
  });
  if (artifactIds.size !== expectedArtifactIds.size || [...expectedArtifactIds].some((id) => !artifactIds.has(id))) {
    fail(`inventory must contain the exact ${expectedArtifactIds.size}-artifact set`);
  }

  const bundle = {
    schemaVersion: 1,
    synthetic: inventory.synthetic === true,
    releaseVersion: inventory.releaseVersion,
    commit: inventory.commit,
    generatedAt: inventory.generatedAt,
    artifacts,
    gates: [...GATE_ARTIFACT_REQUIREMENTS].map(([id, artifactIdsForGate]) => ({
      id,
      artifactIds: artifactIdsForGate
    }))
  };
  validateLaunchArtifactBundle(bundle, inventory, {
    allowSynthetic,
    rootDirectory: process.cwd(),
    executeValidators: true
  });
  writeFileSync(outputPath.resolved, `${JSON.stringify(bundle, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(`${outputPath.normalized}: launch artifact bundle generated: artifacts=${artifacts.length}, gates=${bundle.gates.length}`);
}

try {
  main();
} catch (error) {
  console.error(`Launch artifact bundle generation failed: ${error.message}`);
  process.exit(1);
}
