import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-image-scan-report-"));

function writeReport(name, vulnerabilities) {
  const report = {
    SchemaVersion: 2,
    ArtifactName: `ghcr.io/example/swarmcast-${name}@sha256:${"a".repeat(64)}`,
    ArtifactType: "container_image",
    Results: [
      {
        Target: "debian",
        Class: "os-pkgs",
        Type: "debian",
        Vulnerabilities: vulnerabilities
      }
    ]
  };
  const file = path.join(tempRoot, `${name}.trivy.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

function finding(id, severity) {
  return {
    VulnerabilityID: id,
    PkgName: "openssl",
    InstalledVersion: "1.0.0",
    FixedVersion: "1.0.1",
    Severity: severity
  };
}

const cleanReport = writeReport("clean", []);
const lowReport = writeReport("low", [finding("CVE-2099-0001", "LOW")]);
const highReport = writeReport("high", [finding("CVE-2099-0002", "HIGH")]);
const criticalReport = writeReport("critical", [finding("CVE-2099-0003", "CRITICAL")]);

function validate(args) {
  return spawnSync(process.execPath, [
    "scripts/validate-image-scan-report.js",
    ...args
  ], {
    encoding: "utf8"
  });
}

function expectPass(label, args, pattern) {
  const result = validate(args);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  assert.match(result.stdout, pattern, `${label} passed with unexpected output:\n${result.stdout}`);
}

function expectFailure(label, args, pattern) {
  const result = validate(args);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass("clean report", [cleanReport], /Image scan validation OK: 1 reports, 0 vulnerabilities, blocked=0/);
expectPass("low severity report", [lowReport], /Image scan validation OK: 1 reports, 1 vulnerabilities, blocked=0/);
expectPass("high allowed report", ["--allow-high", highReport], /Image scan validation OK: 1 reports, 1 vulnerabilities, blocked=0/);
expectFailure("high severity blocks by default", [highReport], /HIGH CVE-2099-0002[\s\S]*Image scan validation failed: 1 blocked findings across 1 reports/);
expectFailure("critical severity blocks by default", [criticalReport], /CRITICAL CVE-2099-0003[\s\S]*Image scan validation failed: 1 blocked findings across 1 reports/);
expectFailure("critical severity blocks with high allowance", ["--allow-high", criticalReport], /CRITICAL CVE-2099-0003[\s\S]*Image scan validation failed: 1 blocked findings across 1 reports/);

console.log("image scan report validation smoke OK: pass=3 failures=3");
