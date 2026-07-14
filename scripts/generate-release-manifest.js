import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const releaseImages = [
  ["auth", "SWARMCAST_AUTH_IMAGE", ({ repository, version, service }) => `ghcr.io/${repository}/${service}:${version}`],
  ["ingest", "SWARMCAST_INGEST_IMAGE", ({ repository, version, service }) => `ghcr.io/${repository}/${service}:${version}`],
  ["tracker", "SWARMCAST_TRACKER_IMAGE", ({ repository, version, service }) => `ghcr.io/${repository}/${service}:${version}`],
  ["control-plane", "SWARMCAST_CONTROL_PLANE_IMAGE", ({ repository, version, service }) => `ghcr.io/${repository}/${service}:${version}`],
  ["retention-worker", "SWARMCAST_RETENTION_WORKER_IMAGE", ({ repository, version, service }) => `ghcr.io/${repository}/${service}:${version}`],
  ["nginx", "SWARMCAST_NGINX_IMAGE", () => "nginx:1.27"],
  ["prometheus", "SWARMCAST_PROMETHEUS_IMAGE", () => "prom/prometheus:v2.53.0"],
  ["alertmanager", "SWARMCAST_ALERTMANAGER_IMAGE", () => "prom/alertmanager:v0.27.0"],
  ["grafana", "SWARMCAST_GRAFANA_IMAGE", () => "grafana/grafana:11.1.0"],
  ["edge-nginx", "SWARMCAST_EDGE_NGINX_IMAGE", () => "nginx:1.27"],
  ["edge-metrics", "SWARMCAST_EDGE_METRICS_IMAGE", () => "node:22-slim"],
  ["node-exporter", "SWARMCAST_NODE_EXPORTER_IMAGE", () => "prom/node-exporter:v1.8.0"]
];

const args = process.argv.slice(2);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function hasArg(name) {
  return args.includes(name);
}

function requireCleanValue(name, value, pattern) {
  if (!value) throw new Error(`${name} is required`);
  if (/\s/.test(value)) throw new Error(`${name} must not contain whitespace`);
  if (pattern && !pattern.test(value)) throw new Error(`${name} has invalid format`);
  return value;
}

function normalizeRepository(value) {
  const repository = requireCleanValue("repository", value, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  return repository.toLowerCase();
}

function imageForService(service, envName, repository, version, fallback) {
  const explicit = process.env[envName];
  const image = explicit || fallback({ repository, version, service });
  requireCleanValue(envName, image);
  if (!/^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9_.-]+)?(?:@sha256:[a-fA-F0-9]{64})?$/.test(image)) {
    throw new Error(`${envName} is not a valid container image reference`);
  }
  if (hasArg("--require-digests") && !/@sha256:[a-f0-9]{64}$/i.test(image)) {
    throw new Error(`${envName} must be digest-pinned with @sha256:<64 hex chars>`);
  }
  return image;
}

function createManifest() {
  const version = requireCleanValue(
    "version",
    argValue("--version") || process.env.RELEASE_VERSION || process.env.GITHUB_REF_NAME,
    /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/
  );
  const environment = requireCleanValue(
    "environment",
    argValue("--environment") || process.env.RELEASE_ENVIRONMENT || "staging",
    /^(staging|production)$/
  );
  const commit = requireCleanValue(
    "commit",
    argValue("--commit") || process.env.GITHUB_SHA,
    /^[a-fA-F0-9]{7,40}$/
  ).toLowerCase();
  const repository = normalizeRepository(argValue("--repository") || process.env.GITHUB_REPOSITORY);

  return {
    schemaVersion: 1,
    project: "swarmcast",
    version,
    environment,
    commit,
    repository,
    artifacts: {
      sbom: {
        name: "swarmcast-sbom",
        path: "var/sbom/swarmcast-sbom.json"
      },
      releaseManifest: {
        name: "swarmcast-release-manifest",
        path: "var/release/swarmcast-release-manifest.json"
      },
      expectedImageScans: releaseImages.map(([service]) => `var/scans/${service}.trivy.json`)
    },
    checks: [
      "npm run verify",
      "npm audit --audit-level=moderate",
      "npm run sbom:generate -- --check",
      "npm run image:scan:validate -- var/scans/*.json",
      "npm run image:scan:bundle:validate -- --manifest var/release/swarmcast-release-manifest.json var/scans/*.trivy.json",
      "npm run release:images:check"
    ],
    images: releaseImages.map(([service, envName, fallback]) => ({
      service,
      env: envName,
      image: imageForService(service, envName, repository, version, fallback)
    }))
  };
}

function assertManifest(manifest) {
  if (manifest.schemaVersion !== 1) throw new Error("manifest schemaVersion must be 1");
  if (manifest.project !== "swarmcast") throw new Error("manifest project must be swarmcast");
  if (!Array.isArray(manifest.images) || manifest.images.length !== releaseImages.length) {
    throw new Error(`manifest must include ${releaseImages.length} release images`);
  }
  for (const [service, envName] of releaseImages) {
    const entry = manifest.images.find((image) => image.service === service);
    if (!entry) throw new Error(`manifest missing image for ${service}`);
    if (entry.env !== envName) throw new Error(`manifest image ${service} uses wrong env name`);
    requireCleanValue(`${envName} image`, entry.image);
  }
  for (const scan of manifest.artifacts?.expectedImageScans || []) {
    if (!scan.startsWith("var/scans/") || !scan.endsWith(".trivy.json")) {
      throw new Error(`invalid expected scan report path: ${scan}`);
    }
  }
}

try {
  const inputPath = argValue("--input");
  const manifest = inputPath
    ? JSON.parse(readFileSync(inputPath, "utf8"))
    : createManifest();
  assertManifest(manifest);

  if (hasArg("--check")) {
    console.log(`Release manifest OK: ${manifest.images.length} images for ${manifest.version} (${manifest.environment})`);
    process.exit(0);
  }

  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  const outputPath = argValue("--output");
  if (outputPath) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, output);
  } else {
    process.stdout.write(output);
  }
} catch (error) {
  console.error(`Release manifest failed: ${error.message}`);
  process.exit(1);
}
