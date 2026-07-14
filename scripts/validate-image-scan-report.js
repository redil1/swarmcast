import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowHigh = args.includes("--allow-high");
const files = args.filter((arg) => !arg.startsWith("--"));

if (files.length === 0) {
  console.error("Usage: node scripts/validate-image-scan-report.js <trivy-report.json> [...]");
  process.exit(2);
}

const blockedSeverities = new Set(allowHigh ? ["CRITICAL"] : ["HIGH", "CRITICAL"]);
let failed = false;
let reportCount = 0;
let vulnerabilityCount = 0;
let blockedCount = 0;

for (const file of files) {
  reportCount += 1;
  const report = JSON.parse(readFileSync(file, "utf8"));
  const results = Array.isArray(report.Results) ? report.Results : [];
  for (const result of results) {
    const vulnerabilities = Array.isArray(result.Vulnerabilities) ? result.Vulnerabilities : [];
    for (const vulnerability of vulnerabilities) {
      vulnerabilityCount += 1;
      const severity = String(vulnerability.Severity || "").toUpperCase();
      if (!blockedSeverities.has(severity)) continue;
      blockedCount += 1;
      failed = true;
      console.error(`${file}: ${severity} ${vulnerability.VulnerabilityID || "unknown"} in ${vulnerability.PkgName || result.Target || "unknown package"}`);
    }
  }
}

if (failed) {
  console.error(`Image scan validation failed: ${blockedCount} blocked findings across ${reportCount} reports`);
  process.exit(1);
}

console.log(`Image scan validation OK: ${reportCount} reports, ${vulnerabilityCount} vulnerabilities, blocked=${blockedCount}`);
