import { readFileSync } from "node:fs";
import path from "node:path";

const requiredServices = [
  "segment-bus",
  "segment-bus-exporter",
  "auth",
  "ingest",
  "tracker",
  "control-plane",
  "web",
  "retention-worker",
  "nginx",
  "prometheus",
  "alertmanager",
  "grafana",
  "edge-nginx",
  "edge-metrics",
  "node-exporter",
  "turn"
];
const args = process.argv.slice(2);
const allowHigh = args.includes("--allow-high");
const allowSynthetic = args.includes("--allow-synthetic");
const blockedSeverities = new Set(allowHigh ? ["CRITICAL"] : ["HIGH", "CRITICAL"]);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function reportFilesFromArgs() {
  const files = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--manifest") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    files.push(arg);
  }
  return files;
}

function fail(message) {
  throw new Error(message);
}

function cleanString(name, value, pattern) {
  if (typeof value !== "string" || value.trim() === "") fail(`${name} is required`);
  const normalized = value.trim();
  if (/\s/.test(normalized)) fail(`${name} must not contain whitespace`);
  if (pattern && !pattern.test(normalized)) fail(`${name} has invalid format`);
  return normalized;
}

function validateManifest(manifest) {
  if (manifest.synthetic && !allowSynthetic) fail("synthetic image scan bundle requires --allow-synthetic");
  if (manifest.schemaVersion !== 1) fail("manifest schemaVersion must be 1");
  if (manifest.project !== "swarmcast") fail("manifest project must be swarmcast");
  cleanString("manifest.version", manifest.version, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("manifest.environment", manifest.environment, /^(staging|production)$/);
  cleanString("manifest.commit", manifest.commit, /^[a-fA-F0-9]{7,40}$/);
  if (!Array.isArray(manifest.images)) fail("manifest.images must be an array");
  if (!Array.isArray(manifest.artifacts?.expectedImageScans)) fail("manifest.artifacts.expectedImageScans must be an array");

  const imagesByService = new Map();
  for (const image of manifest.images) {
    const service = cleanString("image.service", image.service, /^[a-z0-9][a-z0-9-]*$/);
    const imageRef = cleanString(`${service}.image`, image.image);
    if (!/@sha256:[a-fA-F0-9]{64}$/.test(imageRef)) fail(`${service}.image must be digest-pinned`);
    imagesByService.set(service, imageRef);
  }

  const expectedScansByService = new Map();
  for (const scanPath of manifest.artifacts.expectedImageScans) {
    const value = cleanString("expectedImageScans[]", scanPath);
    const match = path.basename(value).match(/^(.+)\.trivy\.json$/);
    if (!match) fail(`invalid expected scan report path: ${value}`);
    expectedScansByService.set(match[1], value);
  }

  for (const service of requiredServices) {
    if (!imagesByService.has(service)) fail(`manifest missing image for ${service}`);
    if (!expectedScansByService.has(service)) fail(`manifest missing expected scan report for ${service}`);
  }

  const joinedChecks = Array.isArray(manifest.checks) ? manifest.checks.join("\n") : "";
  for (const required of [
    "npm run image:scan:validate -- var/scans/*.json",
    "npm run image:scan:bundle:validate -- --manifest var/release/swarmcast-release-manifest.json var/scans/*.trivy.json",
    "npm run release:images:check"
  ]) {
    if (!joinedChecks.includes(required)) fail(`manifest checks must include ${required}`);
  }

  return { imagesByService, expectedScansByService };
}

function serviceFromReportPath(file) {
  const match = path.basename(file).match(/^(.+)\.trivy\.json$/);
  if (!match) fail(`${file} must be named <service>.trivy.json`);
  return match[1];
}

function validateReport(file, service, expectedImage) {
  const report = JSON.parse(readFileSync(file, "utf8"));
  if (report.Synthetic && !allowSynthetic) fail("synthetic image scan report requires --allow-synthetic");
  if (report.SchemaVersion !== 2) fail(`${file} SchemaVersion must be 2`);
  if (report.ArtifactType !== "container_image") fail(`${file} ArtifactType must be container_image`);
  if (cleanString(`${file}.ArtifactName`, report.ArtifactName) !== expectedImage) {
    fail(`${file} ArtifactName must match release manifest image for ${service}`);
  }
  const results = Array.isArray(report.Results) ? report.Results : [];
  let vulnerabilities = 0;
  let blocked = 0;
  for (const result of results) {
    const items = Array.isArray(result.Vulnerabilities) ? result.Vulnerabilities : [];
    for (const vulnerability of items) {
      vulnerabilities += 1;
      const severity = cleanString(`${file}.Vulnerabilities[].Severity`, vulnerability.Severity).toUpperCase();
      if (!blockedSeverities.has(severity)) continue;
      blocked += 1;
      const id = vulnerability.VulnerabilityID || "unknown";
      const pkg = vulnerability.PkgName || result.Target || "unknown package";
      console.error(`${file}: ${severity} ${id} in ${pkg}`);
    }
  }
  return { vulnerabilities, blocked };
}

const manifestPath = argValue("--manifest");
const reportFiles = reportFilesFromArgs();

if (!manifestPath || reportFiles.length === 0) {
  console.error("Usage: node scripts/validate-image-scan-bundle.js [--allow-high] [--allow-synthetic] --manifest <release-manifest.json> <service.trivy.json> [...]");
  process.exit(2);
}

try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { imagesByService, expectedScansByService } = validateManifest(manifest);
  const providedServices = new Set();
  let vulnerabilityCount = 0;
  let blockedCount = 0;

  for (const file of reportFiles) {
    const service = serviceFromReportPath(file);
    if (providedServices.has(service)) fail(`duplicate scan report for ${service}`);
    if (!requiredServices.includes(service)) fail(`unexpected scan report service ${service}`);
    const expectedPath = expectedScansByService.get(service);
    if (path.basename(file) !== path.basename(expectedPath)) fail(`${file} does not match expected scan path ${expectedPath}`);
    const result = validateReport(file, service, imagesByService.get(service));
    providedServices.add(service);
    vulnerabilityCount += result.vulnerabilities;
    blockedCount += result.blocked;
  }

  for (const service of requiredServices) {
    if (!providedServices.has(service)) fail(`missing scan report for ${service}`);
  }
  if (blockedCount > 0) fail(`image scan bundle has ${blockedCount} blocked findings`);

  const status = manifest.environment === "production" && !manifest.synthetic ? "launch-ready" : "shape-only";
  console.log(`Image scan bundle OK: images=${requiredServices.length}, reports=${reportFiles.length}, vulnerabilities=${vulnerabilityCount}, blocked=${blockedCount}, status=${status}`);
} catch (error) {
  console.error(`Image scan bundle validation failed: ${error.message}`);
  process.exit(1);
}
