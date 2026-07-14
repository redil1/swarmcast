import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const manifestFile = "test-fixtures/security/image-scan-release-manifest.synthetic.json";
const scanDir = "test-fixtures/security/scans";
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-image-scans-"));

const scanFiles = manifest.artifacts.expectedImageScans.map((scanPath) => (
  path.join(scanDir, path.basename(scanPath))
));

function validate(files) {
  return spawnSync(process.execPath, [
    "scripts/validate-image-scan-bundle.js",
    "--allow-synthetic",
    "--manifest",
    manifestFile,
    ...files
  ], {
    encoding: "utf8"
  });
}

function expectPass(label, files) {
  const result = validate(files);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, files, pattern) {
  const result = validate(files);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

function writeReportVariant(service, transform) {
  const source = path.join(scanDir, `${service}.trivy.json`);
  const report = JSON.parse(readFileSync(source, "utf8"));
  transform(report);
  const file = path.join(tempRoot, `${service}.trivy.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

function replaceReport(files, service, replacement) {
  return files.map((file) => (path.basename(file) === `${service}.trivy.json` ? replacement : file));
}

expectPass("complete synthetic image scan bundle", scanFiles);
expectFailure(
  "missing infrastructure scan report",
  scanFiles.filter((file) => path.basename(file) !== "node-exporter.trivy.json"),
  /missing scan report for node-exporter/
);
expectFailure(
  "scan artifact does not match manifest image",
  replaceReport(scanFiles, "node-exporter", writeReportVariant("node-exporter", (report) => {
    report.ArtifactName = "prom/node-exporter:v1.8.0@sha256:0000000000000000000000000000000000000000000000000000000000000000";
  })),
  /node-exporter\.trivy\.json ArtifactName must match release manifest image for node-exporter/
);
expectFailure(
  "blocked high severity finding",
  replaceReport(scanFiles, "prometheus", writeReportVariant("prometheus", (report) => {
    report.Results[0].Vulnerabilities[0].Severity = "HIGH";
    report.Results[0].Vulnerabilities[0].VulnerabilityID = "CVE-2099-9999";
  })),
  /image scan bundle has 1 blocked findings/
);

console.log("image scan bundle validation smoke OK: pass=1 failures=3");
