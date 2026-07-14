import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = process.argv[2] || "infra/monitoring/alertmanager.yml";

function strip(value = "") {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseReceivers(lines) {
  const receivers = new Map();
  let current = null;

  for (const raw of lines) {
    const name = raw.trim().match(/^-\s+name:\s*"?([^"]+)"?$/);
    if (name) {
      current = { name: name[1], urls: [], sendResolved: false };
      receivers.set(current.name, current);
      continue;
    }
    if (!current) continue;
    const url = raw.trim().match(/^(?:-\s+)?url:\s*"?([^"]+)"?$/);
    if (url) current.urls.push(strip(url[1]));
    const resolved = raw.trim().match(/^send_resolved:\s*(true|false)$/i);
    if (resolved) current.sendResolved = resolved[1].toLowerCase() === "true";
  }

  return receivers;
}

function parseRoute(lines) {
  const route = { receiver: "", repeatInterval: "", routes: [] };
  let inRoute = false;
  let current = null;

  for (const raw of lines) {
    if (raw.startsWith("route:")) {
      inRoute = true;
      continue;
    }
    if (raw.startsWith("receivers:")) break;
    if (!inRoute) continue;

    const rootReceiver = raw.match(/^  receiver:\s*(.+)$/);
    if (rootReceiver) route.receiver = strip(rootReceiver[1]);
    const rootRepeat = raw.match(/^  repeat_interval:\s*(.+)$/);
    if (rootRepeat) route.repeatInterval = strip(rootRepeat[1]);

    if (raw.match(/^    -\s+matchers:/)) {
      current = { matchers: [], receiver: "", repeatInterval: "" };
      route.routes.push(current);
      continue;
    }
    if (!current) continue;
    const matcher = raw.match(/^        -\s+(.+)$/);
    if (matcher) current.matchers.push(matcher[1].trim());
    const childReceiver = raw.match(/^      receiver:\s*(.+)$/);
    if (childReceiver) current.receiver = strip(childReceiver[1]);
    const childRepeat = raw.match(/^      repeat_interval:\s*(.+)$/);
    if (childRepeat) current.repeatInterval = strip(childRepeat[1]);
  }

  return route;
}

function matcherMatches(matcher, labels) {
  const match = matcher.match(/^([A-Za-z_][A-Za-z0-9_]*)="([^"]+)"$/);
  if (!match) return false;
  return labels[match[1]] === match[2];
}

function routeAlert(route, labels) {
  const child = route.routes.find((candidate) => candidate.matchers.every((matcher) => matcherMatches(matcher, labels)));
  return child?.receiver || route.receiver;
}

function assertDelivered({ alert, route, receivers }) {
  const receiverName = routeAlert(route, alert.labels);
  const receiver = receivers.get(receiverName);
  assert.ok(receiver, `missing routed receiver ${receiverName}`);
  assert.equal(receiver.urls.length, 1, `${receiverName} must have one webhook URL`);
  if (alert.status === "resolved") {
    assert.equal(receiver.sendResolved, true, `${receiverName} must send resolved alerts`);
  }
  return receiverName;
}

const text = readFileSync(file, "utf8");
const lines = text.split(/\r?\n/);
const route = parseRoute(lines);
const receivers = parseReceivers(lines);

assert.equal(route.receiver, "oncall-default");
assert.equal(route.repeatInterval, "4h");
assert.equal(receivers.get("oncall-default")?.sendResolved, true);
assert.equal(receivers.get("oncall-critical")?.sendResolved, true);

const warning = assertDelivered({
  route,
  receivers,
  alert: { status: "firing", labels: { alertname: "SwarmcastLowOffloadRatio", severity: "warning" } }
});
const critical = assertDelivered({
  route,
  receivers,
  alert: { status: "firing", labels: { alertname: "SwarmcastHighStallRate", severity: "critical" } }
});
const resolvedCritical = assertDelivered({
  route,
  receivers,
  alert: { status: "resolved", labels: { alertname: "SwarmcastHighStallRate", severity: "critical" } }
});

assert.equal(warning, "oncall-default");
assert.equal(critical, "oncall-critical");
assert.equal(resolvedCritical, "oncall-critical");
assert.equal(route.routes.find((candidate) => candidate.receiver === "oncall-critical")?.repeatInterval, "30m");

console.log(`alertmanager routing smoke OK: warning=${warning} critical=${critical} resolvedCritical=true file=${file}`);
