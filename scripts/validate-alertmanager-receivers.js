import { readFileSync } from "node:fs";

const requiredReceivers = ["oncall-default", "oncall-critical"];
const args = process.argv.slice(2);
const allowLocal = args.includes("--allow-local");
const files = args.filter((arg) => !arg.startsWith("--"));
const placeholderHostPattern = /(^|\.)example\.|localhost|127\.0\.0\.1|0\.0\.0\.0|alert-webhook|webhook\.invalid/i;

function fail(message) {
  throw new Error(message);
}

function parseReceivers(text) {
  const receivers = new Map();
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const nameMatch = line.match(/^-\s+name:\s*"?([^"]+)"?$/);
    if (nameMatch) {
      current = { name: nameMatch[1], urls: [], sendResolved: [] };
      receivers.set(current.name, current);
      continue;
    }
    if (!current) continue;
    const urlMatch = line.match(/^-\s+url:\s*"?([^"]+)"?$|^url:\s*"?([^"]+)"?$/);
    if (urlMatch) {
      current.urls.push((urlMatch[1] || urlMatch[2]).trim());
      continue;
    }
    const resolvedMatch = line.match(/^send_resolved:\s*(true|false)$/i);
    if (resolvedMatch) current.sendResolved.push(resolvedMatch[1].toLowerCase() === "true");
  }

  return receivers;
}

function validateReceiverUrl(receiver, rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    fail(`${receiver} has invalid webhook URL`);
  }
  if (!allowLocal && parsed.protocol !== "https:") fail(`${receiver} webhook URL must use https`);
  if (parsed.username || parsed.password) fail(`${receiver} webhook URL must not contain credentials`);
  if (parsed.search) fail(`${receiver} webhook URL must not contain query-string secrets`);
  if (!allowLocal && placeholderHostPattern.test(parsed.hostname)) {
    fail(`${receiver} webhook URL still points to a placeholder or local host`);
  }
  return parsed.toString();
}

function validateAlertmanagerReceivers(file) {
  const receivers = parseReceivers(readFileSync(file, "utf8"));
  const urls = new Map();

  for (const name of requiredReceivers) {
    const receiver = receivers.get(name);
    if (!receiver) fail(`missing receiver ${name}`);
    if (receiver.urls.length !== 1) fail(`${name} must define exactly one webhook URL`);
    if (!receiver.sendResolved.includes(true)) fail(`${name} must set send_resolved: true`);
    urls.set(name, validateReceiverUrl(name, receiver.urls[0]));
  }

  if (urls.get("oncall-default") === urls.get("oncall-critical")) {
    fail("oncall-default and oncall-critical must use distinct webhook URLs");
  }

  return `${file}: Alertmanager receivers OK: ${requiredReceivers.length} receivers`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-alertmanager-receivers.js [--allow-local] <alertmanager.yml> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    console.log(validateAlertmanagerReceivers(file));
  }
} catch (error) {
  console.error(`Alertmanager receiver validation failed: ${error.message}`);
  process.exit(1);
}
