import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/monitoring/alertmanager-production.yml";
const baseText = readFileSync(fixture, "utf8");
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-alertmanager-receivers-"));

function writeVariant(name, transform) {
  const file = path.join(tempRoot, `${name}.yml`);
  writeFileSync(file, transform(baseText));
  return file;
}

function validate(file) {
  return spawnSync(process.execPath, ["scripts/validate-alertmanager-receivers.js", file], {
    encoding: "utf8"
  });
}

function expectPass(label, file) {
  const result = validate(file);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, file, pattern) {
  const result = validate(file);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

const defaultUrl = "https://alerts.swarmcast.tv/webhooks/default";
const criticalUrl = "https://alerts.swarmcast.tv/webhooks/critical";

expectPass("synthetic production Alertmanager receivers", fixture);
expectFailure(
  "non-https webhook",
  writeVariant("http-webhook", (text) => text.replace(defaultUrl, "http://alerts.swarmcast.tv/webhooks/default")),
  /oncall-default webhook URL must use https/
);
expectFailure(
  "placeholder webhook host",
  writeVariant("placeholder-host", (text) => text.replace(defaultUrl, "https://webhook.invalid/default")),
  /oncall-default webhook URL still points to a placeholder or local host/
);
expectFailure(
  "webhook credentials",
  writeVariant("credentials", (text) => text.replace(defaultUrl, "https://user:pass@alerts.swarmcast.tv/webhooks/default")),
  /oncall-default webhook URL must not contain credentials/
);
expectFailure(
  "query-string secret",
  writeVariant("query-secret", (text) => text.replace(defaultUrl, "https://alerts.swarmcast.tv/webhooks/default?token=secret")),
  /oncall-default webhook URL must not contain query-string secrets/
);
expectFailure(
  "shared receiver url",
  writeVariant("shared-url", (text) => text.replace(criticalUrl, defaultUrl)),
  /oncall-default and oncall-critical must use distinct webhook URLs/
);
expectFailure(
  "send resolved disabled",
  writeVariant("send-resolved-false", (text) => text.replace("send_resolved: true", "send_resolved: false")),
  /oncall-default must set send_resolved: true/
);

console.log("Alertmanager receiver validation smoke OK: pass=1 failures=6");
