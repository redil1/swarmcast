import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { accessSync, chmodSync, constants, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { issueTurnCredentials } from "../services/auth/src/turnCredentials.js";

const ALLOWED_OPTIONS = new Set([
  "--acknowledge-staging-load",
  "--allocations",
  "--ca-file",
  "--commit",
  "--credential-ttl-seconds",
  "--expected-host-allocations",
  "--interval-ms",
  "--load-generator-failure-domain",
  "--load-generator-host-id",
  "--load-generator-provider",
  "--load-generator-region",
  "--message-bytes",
  "--metrics-sample-ms",
  "--metrics-url",
  "--output",
  "--peer-address",
  "--peer-port",
  "--phase-gap-seconds",
  "--port",
  "--release-version",
  "--run-id",
  "--server",
  "--start-at",
  "--sustained-seconds",
  "--transport",
  "--uclient-bin",
  "--warmup-seconds"
]);
const FLAG_OPTIONS = new Set(["--acknowledge-staging-load"]);
const METRIC_NAMES = [
  "turn_total_allocations",
  "turn_total_traffic_rcvb",
  "turn_total_traffic_sentb",
  "turn_total_traffic_peer_rcvb",
  "turn_total_traffic_peer_sentb"
];
const activeChildren = new Set();

function fail(message) {
  throw new Error(message);
}

function parseOptions(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith("--") || !ALLOWED_OPTIONS.has(key)) fail(`unknown option ${key}`);
    if (options.has(key)) fail(`duplicate option ${key}`);
    if (FLAG_OPTIONS.has(key)) {
      options.set(key, true);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`${key} requires a value`);
    options.set(key, value);
    index += 1;
  }
  return options;
}

function required(options, key, pattern = null) {
  const value = options.get(key);
  if (typeof value !== "string" || value.trim() === "") fail(`${key} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) fail(`${key} has invalid format`);
  return normalized;
}

function integerOption(options, key, { min, max, fallback } = {}) {
  const raw = options.get(key);
  if (raw === undefined && fallback !== undefined) return fallback;
  if (raw === undefined) fail(`${key} is required`);
  if (!/^[0-9]+$/.test(raw)) fail(`${key} must be an integer`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${key} must be between ${min} and ${max}`);
  }
  return value;
}

function validateMetricsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("--metrics-url must be an absolute URL");
  }
  const localHttp = parsed.protocol === "http:" && ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) {
    fail("--metrics-url must use HTTPS or a localhost HTTP monitoring tunnel");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail("--metrics-url must not contain credentials, query parameters, or fragments");
  }
  return parsed.toString();
}

export function isPrivateAddress(address) {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && (octets[1] === 0 || octets[1] === 168)) ||
      (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19 || (octets[1] === 51 && octets[2] === 100))) ||
      (octets[0] === 203 && octets[1] === 0 && octets[2] === 113);
  }
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") ||
    normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8");
}

async function requirePublicHost(name, value) {
  let addresses;
  try {
    addresses = await lookup(value, { all: true, verbatim: true });
  } catch {
    fail(`${name} did not resolve`);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    fail(`${name} must resolve only to public addresses`);
  }
  return addresses.map(({ address }) => address);
}

function resolveExecutable(command) {
  const candidate = command.includes(path.sep)
    ? path.resolve(command)
    : spawnSync("which", [command], { encoding: "utf8" }).stdout?.trim();
  if (!candidate) fail(`TURN client executable not found: ${command}`);
  try {
    accessSync(candidate, constants.R_OK | constants.X_OK);
  } catch {
    fail(`TURN client executable is not readable and executable: ${candidate}`);
  }
  return candidate;
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

export function parseTurnutilsOutput(output) {
  const totals = [...output.matchAll(/tot_send_msgs=(\d+), tot_recv_msgs=(\d+)/g)].at(-1);
  const loss = output.match(/Total lost packets (\d+) \(([0-9.]+)%\)/);
  const rtt = output.match(/Average round trip delay ([0-9.]+) ms/);
  if (!totals || !loss || !rtt) fail("turnutils_uclient output is missing transfer statistics");
  return {
    sentMessages: Number.parseInt(totals[1], 10),
    receivedMessages: Number.parseInt(totals[2], 10),
    lostPackets: Number.parseInt(loss[1], 10),
    reportedLossRatio: Number.parseFloat(loss[2]) / 100,
    averageRttMs: Number.parseFloat(rtt[1])
  };
}

export function prometheusMetricSum(text, name) {
  let total = 0;
  let found = false;
  for (const line of text.split("\n")) {
    if (!line.startsWith(name)) continue;
    const match = line.match(/^[^{\s]+(?:\{[^}]*\})?\s+(-?[0-9.eE+]+)$/);
    if (!match) continue;
    total += Number.parseFloat(match[1]);
    found = true;
  }
  if (!found || !Number.isFinite(total)) fail(`coturn metrics missing ${name}`);
  return total;
}

export function redactSensitive(value, secrets) {
  let redacted = String(value || "");
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(secret, "[redacted]");
  }
  return redacted;
}

function configFrom(options, env) {
  if (options.get("--acknowledge-staging-load") !== true) {
    fail("--acknowledge-staging-load is required because this command creates sustained relay traffic");
  }
  const testMode = env.NODE_ENV === "test" && env.SWARMCAST_TURN_PROBE_TEST_MODE === "1";
  const warmupSeconds = integerOption(options, "--warmup-seconds", { min: testMode ? 1 : 60, max: 900 });
  const sustainedSeconds = integerOption(options, "--sustained-seconds", { min: testMode ? 1 : 300, max: 3600 });
  const transport = required(options, "--transport", /^(udp|tls)$/);
  const credentialTtlSeconds = integerOption(options, "--credential-ttl-seconds", {
    min: testMode ? warmupSeconds + sustainedSeconds + 1 : warmupSeconds + sustainedSeconds + 300,
    max: 7200,
    fallback: Math.max(900, warmupSeconds + sustainedSeconds + 300)
  });
  const sharedSecret = env.TURN_SHARED_SECRET;
  if (typeof sharedSecret !== "string" || sharedSecret.length < 32) {
    fail("TURN_SHARED_SECRET must be supplied through the environment and contain at least 32 characters");
  }
  const caFile = options.get("--ca-file") ? path.resolve(options.get("--ca-file")) : null;
  if (transport === "tls" && !caFile) fail("--ca-file is required for TLS certificate verification");
  if (caFile) {
    try {
      accessSync(caFile, constants.R_OK);
    } catch {
      fail(`CA file is not readable: ${caFile}`);
    }
  }
  const startAtRaw = options.get("--start-at");
  if (!testMode && !startAtRaw) fail("--start-at is required to synchronize independent staging load generators");
  const startAtMs = startAtRaw ? Date.parse(startAtRaw) : Date.now();
  if (!Number.isFinite(startAtMs)) fail("--start-at must be ISO-8601 parseable");
  if (!testMode && (startAtMs < Date.now() + 10_000 || startAtMs > Date.now() + 30 * 60 * 1000)) {
    fail("--start-at must be between 10 seconds and 30 minutes in the future");
  }
  const allocations = integerOption(options, "--allocations", { min: 2, max: 1000 });
  const expectedHostAllocations = integerOption(options, "--expected-host-allocations", {
    min: allocations,
    max: 10_000,
    fallback: testMode ? allocations : undefined
  });
  const phaseGapSeconds = integerOption(options, "--phase-gap-seconds", {
    min: testMode ? 1 : 15,
    max: 120,
    fallback: testMode ? 2 : 30
  });
  return {
    allocations,
    caFile,
    commit: required(options, "--commit", /^[a-fA-F0-9]{40}$/).toLowerCase(),
    credentialTtlSeconds,
    expectedHostAllocations,
    intervalMs: integerOption(options, "--interval-ms", { min: 1, max: 1000 }),
    loadGenerator: {
      failureDomain: required(options, "--load-generator-failure-domain", /^[a-z0-9][a-z0-9._-]*$/),
      hostId: required(options, "--load-generator-host-id", /^[a-z0-9][a-z0-9._-]*$/),
      provider: required(options, "--load-generator-provider"),
      region: required(options, "--load-generator-region")
    },
    messageBytes: integerOption(options, "--message-bytes", { min: 64, max: 1200 }),
    metricsSampleMs: integerOption(options, "--metrics-sample-ms", { min: 250, max: 5000, fallback: 1000 }),
    metricsUrl: validateMetricsUrl(required(options, "--metrics-url")),
    output: options.get("--output") ? path.resolve(options.get("--output")) : null,
    peerAddress: required(options, "--peer-address"),
    peerPort: integerOption(options, "--peer-port", { min: 1, max: 65535 }),
    phaseGapSeconds,
    port: integerOption(options, "--port", { min: 1, max: 65535 }),
    releaseVersion: required(options, "--release-version", /^v[0-9A-Za-z][0-9A-Za-z._-]*$/),
    runId: required(options, "--run-id", /^[a-z0-9][a-z0-9._-]*$/),
    server: required(options, "--server"),
    sharedSecret,
    startAtMs,
    sustainedSeconds,
    testMode,
    transport,
    uclientBin: resolveExecutable(options.get("--uclient-bin") || env.TURN_UCLIENT_BIN || "turnutils_uclient"),
    warmupSeconds
  };
}

async function metricSnapshot(config) {
  const response = await fetch(config.metricsUrl, { signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  if (!response.ok) fail(`coturn metrics returned HTTP ${response.status}`);
  return Object.fromEntries(METRIC_NAMES.map((name) => [name, prometheusMetricSum(text, name)]));
}

function clientArgs(config, credentials, messages) {
  const args = [
    "-c",
    "-l", String(config.messageBytes),
    "-n", String(messages),
    "-z", String(config.intervalMs),
    "-u", credentials.username,
    "-w", credentials.credential,
    "-e", config.peerAddress,
    "-r", String(config.peerPort),
    "-p", String(config.port)
  ];
  if (config.transport === "tls") args.unshift("-t", "-S", "-E", config.caFile);
  args.push(config.server);
  return args;
}

function clientEnvironment() {
  const env = { ...process.env };
  delete env.TURN_SHARED_SECRET;
  delete env.TURN_PREVIOUS_SHARED_SECRET;
  return env;
}

function runClient(config, phase, index, messages, secrets) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const credentials = issueTurnCredentials({
    urls: [`turn:${config.server}:${config.port}`],
    sharedSecret: config.sharedSecret,
    ttlSeconds: config.credentialTtlSeconds,
    subject: `${config.runId}-${phase}-${index}`,
    nowSeconds
  });
  secrets.push(credentials.username, credentials.credential);
  const args = clientArgs(config, credentials, messages);
  const timeoutMs = messages * config.intervalMs + 120_000;
  return new Promise((resolve) => {
    const child = spawn(config.uclientBin, args, {
      env: clientEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    activeChildren.add(child);
    let output = "";
    let timedOut = false;
    const append = (chunk) => {
      output = `${output}${chunk}`.slice(-16_384);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => append(error.message));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      try {
        if (code !== 0 || timedOut) {
          const detail = redactSensitive(output, [config.sharedSecret, ...secrets]);
          return resolve({ ok: false, error: timedOut ? "client timed out" : `client exited ${code ?? signal}: ${detail}` });
        }
        resolve({ ok: true, stats: parseTurnutilsOutput(output) });
      } catch (error) {
        resolve({ ok: false, error: redactSensitive(error.message, [config.sharedSecret, ...secrets]) });
      }
    });
  });
}

async function runPhase(config, phase, seconds) {
  const messages = Math.ceil(seconds * 1000 / config.intervalMs);
  const secrets = [];
  const samples = [];
  const launchedAt = Date.now();
  const clients = [];
  for (let index = 0; index < config.allocations; index += 1) {
    clients.push(runClient(config, phase, index, messages, secrets));
  }
  const launchSpanMs = Date.now() - launchedAt;
  let sampling = false;
  const sample = async () => {
    if (sampling) return;
    sampling = true;
    try {
      samples.push({ at: new Date().toISOString(), metrics: await metricSnapshot(config) });
    } finally {
      sampling = false;
    }
  };
  await sample();
  const timer = setInterval(() => void sample(), config.metricsSampleMs);
  const results = await Promise.all(clients);
  const elapsedMs = Date.now() - launchedAt;
  clearInterval(timer);
  await sample();
  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  const sentMessages = successes.reduce((total, result) => total + result.stats.sentMessages, 0);
  const receivedMessages = successes.reduce((total, result) => total + result.stats.receivedMessages, 0);
  const lostPackets = successes.reduce((total, result) => total + result.stats.lostPackets, 0);
  return {
    allocationsAttempted: config.allocations,
    allocationsFailed: failures.length,
    allocationsSucceeded: successes.length,
    applicationPayloadBytes: receivedMessages * config.messageBytes,
    durationSeconds: seconds,
    errors: failures.slice(0, 20).map((result) => result.error),
    elapsedMs,
    launchSpanMs,
    lostPackets,
    messagesPerAllocation: messages,
    packetLossRatio: sentMessages === 0 ? 1 : lostPackets / sentMessages,
    p95AverageRttMs: percentile(successes.map((result) => result.stats.averageRttMs), 0.95),
    receivedMessages,
    sentMessages,
    samples
  };
}

async function waitForAllocationDrain(config, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let snapshot;
  while (Date.now() < deadline) {
    snapshot = await metricSnapshot(config);
    if (snapshot.turn_total_allocations === 0) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`TURN allocations did not return to zero; final count=${snapshot?.turn_total_allocations ?? "unknown"}`);
}

async function waitUntil(timestampMs) {
  const delayMs = timestampMs - Date.now();
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function requireScheduleWindow(name, timestampMs) {
  const latenessMs = Date.now() - timestampMs;
  if (latenessMs > 1000) fail(`${name} missed its synchronized start by ${latenessMs}ms`);
}

function trafficDelta(before, after) {
  const delta = {};
  for (const name of METRIC_NAMES.slice(1)) {
    delta[name] = after[name] - before[name];
    if (delta[name] < 0) fail(`coturn metric ${name} reset during sustained phase`);
  }
  delta.coturnIngressBytes = delta.turn_total_traffic_rcvb + delta.turn_total_traffic_peer_rcvb;
  delta.coturnEgressBytes = delta.turn_total_traffic_sentb + delta.turn_total_traffic_peer_sentb;
  return delta;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const config = configFrom(options, process.env);
  const [serverAddresses, peerAddresses] = await Promise.all([
    requirePublicHost("--server", config.server),
    requirePublicHost("--peer-address", config.peerAddress)
  ]);
  const baselineLeadMs = config.testMode ? 250 : 5000;
  await waitUntil(config.startAtMs - baselineLeadMs);
  const beforeWarmup = await metricSnapshot(config);
  if (beforeWarmup.turn_total_allocations !== 0) {
    fail(`TURN host is not idle before the probe; active allocations=${beforeWarmup.turn_total_allocations}`);
  }
  await waitUntil(config.startAtMs);
  requireScheduleWindow("warm-up", config.startAtMs);
  const startedAt = new Date().toISOString();
  const warmup = await runPhase(config, "warmup", config.warmupSeconds);
  await waitForAllocationDrain(config);
  if (warmup.elapsedMs < config.warmupSeconds * 900 || warmup.allocationsFailed !== 0 || warmup.packetLossRatio > 0.01) {
    fail(`TURN warm-up failed: allocationsFailed=${warmup.allocationsFailed} packetLossRatio=${warmup.packetLossRatio}`);
  }
  const sustainedStartAtMs = config.startAtMs + (config.warmupSeconds + config.phaseGapSeconds) * 1000;
  await waitUntil(sustainedStartAtMs - baselineLeadMs);
  const beforeSustained = await metricSnapshot(config);
  if (beforeSustained.turn_total_allocations !== 0) {
    fail(`TURN host is not idle before the sustained phase; active allocations=${beforeSustained.turn_total_allocations}`);
  }
  await waitUntil(sustainedStartAtMs);
  requireScheduleWindow("sustained phase", sustainedStartAtMs);
  const sustained = await runPhase(config, "sustained", config.sustainedSeconds);
  const afterSustained = await metricSnapshot(config);
  const afterDrain = await waitForAllocationDrain(config);
  const sustainedTraffic = trafficDelta(beforeSustained, afterSustained);
  const peakAllocations = Math.max(...sustained.samples.map((sample) => sample.metrics.turn_total_allocations));
  if (sustained.elapsedMs < config.sustainedSeconds * 900 || sustained.allocationsFailed !== 0 || sustained.packetLossRatio > 0.01) {
    fail(`TURN sustained phase failed: allocationsFailed=${sustained.allocationsFailed} packetLossRatio=${sustained.packetLossRatio}`);
  }
  if (peakAllocations !== config.expectedHostAllocations) {
    fail(`TURN peak allocations ${peakAllocations} did not equal host target ${config.expectedHostAllocations}`);
  }
  const evidence = {
    schemaVersion: 1,
    kind: "turn-capacity-raw-probe",
    environment: config.testMode ? "test" : "staging",
    synthetic: config.testMode,
    runId: config.runId,
    commit: config.commit,
    releaseVersion: config.releaseVersion,
    startedAt,
    scheduledStartAt: new Date(config.startAtMs).toISOString(),
    scheduledSustainedStartAt: new Date(sustainedStartAtMs).toISOString(),
    completedAt: new Date().toISOString(),
    server: {
      host: config.server,
      resolvedAddresses: serverAddresses,
      port: config.port,
      transport: config.transport
    },
    peerEcho: {
      host: config.peerAddress,
      resolvedAddresses: peerAddresses,
      port: config.peerPort
    },
    loadGenerator: config.loadGenerator,
    client: {
      executableSha256: sha256File(config.uclientBin),
      credentials: "unique-short-lived-turn-rest-per-allocation",
      credentialTtlSeconds: config.credentialTtlSeconds,
      sharedSecretRecorded: false
    },
    parameters: {
      allocations: config.allocations,
      expectedHostAllocations: config.expectedHostAllocations,
      intervalMs: config.intervalMs,
      messageBytes: config.messageBytes,
      metricsSampleMs: config.metricsSampleMs,
      phaseGapSeconds: config.phaseGapSeconds,
      sustainedSeconds: config.sustainedSeconds,
      warmupSeconds: config.warmupSeconds
    },
    warmup: { ...warmup, samples: undefined },
    sustained: { ...sustained, samples: undefined },
    metrics: {
      beforeWarmup,
      beforeSustained,
      afterSustained,
      afterDrain,
      peakAllocations,
      sustainedTraffic,
      measuredSustainedEgressMbps: sustainedTraffic.coturnEgressBytes * 8 / config.sustainedSeconds / 1_000_000
    },
    result: "pass",
    limitations: [
      "This is one load-generator-to-one-TURN-host raw probe, not final fleet evidence.",
      "Host NIC, provider billing, CPU, memory, restart, quota-rejection, and OOM evidence must be joined externally.",
      "Final evidence requires two independent load generators and UDP/TLS profiles on two TURN failure domains."
    ]
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (config.output) {
    writeFileSync(config.output, serialized, { mode: 0o600 });
    chmodSync(config.output, 0o600);
  }
  else process.stdout.write(serialized);
}

function terminateChildren() {
  for (const child of activeChildren) child.kill("SIGTERM");
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      terminateChildren();
      process.exitCode = 130;
    });
  }
  main().catch((error) => {
    terminateChildren();
    console.error(`TURN capacity probe failed: ${redactSensitive(error.message, [process.env.TURN_SHARED_SECRET])}`);
    process.exitCode = 1;
  });
}
