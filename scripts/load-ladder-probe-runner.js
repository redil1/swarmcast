import { spawn } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import {
  LOAD_STAGE_EXPECTATIONS,
  cleanLoadString,
  failLoadContract,
  loadInteger,
  loadTime,
  sha256File,
  validateLoadProbe
} from "./load-ladder-contract.js";

const DRIVER_OUTPUT_KEYS = new Set([
  "startedAt",
  "completedAt",
  "joinedPeers",
  "joinFailures",
  "dataChannelEndpoints",
  "successfulConnections",
  "failedConnections",
  "verifiedSendTransfers",
  "verifiedReceiveTransfers",
  "failedTransfers",
  "crossGeneratorEndpoints",
  "remoteGeneratorIds",
  "signalingMessages",
  "clientP2pBytes",
  "clientEdgeBytes",
  "clientBootstrapOriginBytes",
  "clientRelayBytes",
  "clientUploadBytes",
  "verifiedPayloadBytesSent",
  "verifiedPayloadBytesReceived",
  "candidateSelections",
  "playbackSamples",
  "stallEvents",
  "startupLatencyMsP95",
  "bufferMsMin",
  "joinLatencyMsP95",
  "channelOpenMsP95",
  "transferMsP95",
  "trackerCellIds",
  "evidenceMarkers"
]);
const MAX_DRIVER_OUTPUT_BYTES = 16 * 1024 * 1024;

function validateTargetUrl(value, synthetic) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    failLoadContract("target.trackerUrl must be an absolute URL");
  }
  const local = ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "wss:" && !(synthetic && local && parsed.protocol === "ws:")) {
    failLoadContract("target.trackerUrl must use wss, except localhost synthetic probes");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    failLoadContract("target.trackerUrl must not contain credentials, query parameters, or fragments");
  }
  return parsed;
}

export function isPrivateLoadAddress(address) {
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

export function validateLoadProbeManifest(input, { allowSynthetic = false, nowMs = Date.now() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) failLoadContract("load probe manifest is required");
  const manifest = structuredClone(input);
  if (manifest.schemaVersion !== 1) failLoadContract("schemaVersion must equal 1");
  const synthetic = manifest.synthetic === true;
  if (synthetic && !allowSynthetic) failLoadContract("synthetic load probes require --allow-synthetic");
  cleanLoadString("probeId", manifest.probeId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanLoadString("runId", manifest.runId, /^[a-z0-9][a-z0-9._-]*$/);
  const stageId = cleanLoadString("stageId", manifest.stageId, /^[a-z0-9][a-z0-9._-]*$/);
  const expectation = LOAD_STAGE_EXPECTATIONS.get(stageId);
  if (!expectation?.distributed) failLoadContract("stageId must identify a distributed load stage");
  cleanLoadString("environment", manifest.environment, /^(staging|production)$/);
  cleanLoadString("commit", manifest.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanLoadString("releaseVersion", manifest.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  const startAtMs = loadTime("startAt", manifest.startAt);
  if (!synthetic && (startAtMs < nowMs + 15_000 || startAtMs > nowMs + 30 * 60 * 1000)) {
    failLoadContract("startAt must be between 15 seconds and 30 minutes in the future");
  }
  const minimumDuration = synthetic ? 1 : expectation.minDurationSeconds;
  loadInteger("durationSeconds", manifest.durationSeconds, { min: minimumDuration, max: 7200 });
  cleanLoadString("target.id", manifest.target?.id, /^[a-z0-9][a-z0-9._-]*$/);
  const trackerUrl = validateTargetUrl(manifest.target?.trackerUrl, synthetic);
  cleanLoadString("target.channelId", manifest.target?.channelId, /^[A-Za-z0-9._-]+$/);
  cleanLoadString("generator.id", manifest.generator?.id, /^[a-z0-9][a-z0-9._-]*$/);
  cleanLoadString("generator.provider", manifest.generator?.provider, /^[a-z0-9][a-z0-9._-]*$/);
  cleanLoadString("generator.region", manifest.generator?.region, /^[a-z0-9][a-z0-9._-]*$/);
  cleanLoadString("generator.failureDomain", manifest.generator?.failureDomain, /^[a-z0-9][a-z0-9._-]*$/);
  cleanLoadString("generator.networkEgressFingerprintSha256", manifest.generator?.networkEgressFingerprintSha256, /^[a-f0-9]{64}$/);
  loadInteger("assignment.peerStart", manifest.assignment?.peerStart, { min: 0, max: expectation.peers - 1 });
  const peerCount = loadInteger("assignment.peerCount", manifest.assignment?.peerCount, { min: 2, max: expectation.peers });
  if (manifest.assignment.peerStart + peerCount > expectation.peers) {
    failLoadContract("assignment peer range exceeds the stage peer count");
  }
  cleanLoadString("driver.sha256", manifest.driver?.sha256, /^[a-f0-9]{64}$/);
  cleanLoadString("driver.imageDigest", manifest.driver?.imageDigest, /^sha256:[a-f0-9]{64}$/);
  return { ...manifest, synthetic, expectation, startAtMs, trackerUrl };
}

async function requirePublicTarget(parsed, resolveHost) {
  let addresses;
  try {
    addresses = await resolveHost(parsed.hostname);
  } catch {
    failLoadContract("target.trackerUrl hostname did not resolve");
  }
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(({ address }) => isPrivateLoadAddress(address))) {
    failLoadContract("target.trackerUrl must resolve only to public addresses");
  }
}

function driverEnvironment(env) {
  const output = {};
  for (const key of ["HOME", "PATH", "SSL_CERT_FILE", "SSL_CERT_DIR", "WEBRTC_BROWSER_CHANNEL", "WEBRTC_BROWSER_EXECUTABLE"]) {
    if (typeof env[key] === "string") output[key] = env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("SWARMCAST_LOAD_DRIVER_") && typeof value === "string") output[key] = value;
  }
  return output;
}

function sensitiveDriverValues(env) {
  return Object.entries(env)
    .filter(([key, value]) => key.startsWith("SWARMCAST_LOAD_DRIVER_") && /secret|token|password|credential|key/i.test(key) && value)
    .map(([, value]) => value);
}

function redact(value, secrets) {
  let output = String(value || "");
  for (const secret of secrets) output = output.replaceAll(secret, "[redacted]");
  return output;
}

export function executeLoadDriver({ executable, request, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      cwd: process.cwd(),
      env: driverEnvironment(env),
      stdio: ["pipe", "pipe", "pipe"]
    });
    const secrets = sensitiveDriverValues(env);
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const append = (current, chunk, streamName) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > MAX_DRIVER_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(new Error(`load driver ${streamName} exceeded ${MAX_DRIVER_OUTPUT_BYTES} bytes`));
      }
      return next;
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk, "stdout"); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk, "stderr"); });
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        const detail = redact(stderr.toString("utf8"), secrets).trim();
        finish(new Error(`load driver failed with ${signal ? `signal ${signal}` : `exit ${code}`}${detail ? `: ${detail}` : ""}`));
        return;
      }
      try {
        finish(null, JSON.parse(stdout.toString("utf8")));
      } catch (error) {
        finish(new Error(`load driver returned invalid JSON: ${error.message}`));
      }
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      finish(new Error(`load driver exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function validateDriverOutput(output) {
  if (!output || typeof output !== "object" || Array.isArray(output)) failLoadContract("load driver output must be an object");
  for (const key of Object.keys(output)) {
    if (!DRIVER_OUTPUT_KEYS.has(key)) failLoadContract(`load driver output contains unsupported key ${key}`);
  }
  return output;
}

export async function runLoadLadderProbe({
  manifest: input,
  driverPath,
  allowSynthetic = false,
  env = process.env,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  resolveHost = (hostname) => lookup(hostname, { all: true, verbatim: true }),
  executeDriver = executeLoadDriver
}) {
  const manifest = validateLoadProbeManifest(input, { allowSynthetic, nowMs: now() });
  const executable = path.resolve(cleanLoadString("driverPath", driverPath));
  try {
    accessSync(executable, constants.R_OK | constants.X_OK);
  } catch {
    failLoadContract(`load driver is not readable and executable: ${executable}`);
  }
  if (sha256File(executable) !== manifest.driver.sha256) failLoadContract("load driver SHA-256 does not match manifest");
  if (!manifest.synthetic) await requirePublicTarget(manifest.trackerUrl, resolveHost);
  const waitMs = manifest.startAtMs - now();
  if (waitMs < (manifest.synthetic ? -1_000 : -2_000)) failLoadContract("startAt elapsed before the load probe was ready");
  if (waitMs > 0) await sleep(waitMs);
  const request = {
    schemaVersion: 1,
    runId: manifest.runId,
    stageId: manifest.stageId,
    target: {
      id: manifest.target.id,
      trackerUrl: manifest.trackerUrl.toString(),
      channelId: manifest.target.channelId
    },
    assignment: manifest.assignment,
    generatorId: manifest.generator.id,
    durationSeconds: manifest.durationSeconds,
    startAt: manifest.startAt
  };
  const raw = validateDriverOutput(await executeDriver({
    executable,
    request,
    env,
    timeoutMs: (manifest.durationSeconds + 120) * 1000
  }));
  const startedAtMs = loadTime("driver.startedAt", raw.startedAt);
  if (Math.abs(startedAtMs - manifest.startAtMs) > (manifest.synthetic ? 1_000 : 5_000)) {
    failLoadContract("load driver start differs from synchronized startAt by more than five seconds");
  }
  const durationSeconds = Math.round((loadTime("driver.completedAt", raw.completedAt) - startedAtMs) / 1000);
  if (Math.abs(durationSeconds - manifest.durationSeconds) > 2) {
    failLoadContract("load driver duration does not match the manifest durationSeconds");
  }
  const validatedProbe = validateLoadProbe({
    schemaVersion: 1,
    synthetic: manifest.synthetic,
    probeId: manifest.probeId,
    runId: manifest.runId,
    stageId: manifest.stageId,
    environment: manifest.environment,
    commit: manifest.commit,
    releaseVersion: manifest.releaseVersion,
    targetId: manifest.target.id,
    generatorId: manifest.generator.id,
    generatorProvider: manifest.generator.provider,
    generatorRegion: manifest.generator.region,
    generatorFailureDomain: manifest.generator.failureDomain,
    networkEgressFingerprintSha256: manifest.generator.networkEgressFingerprintSha256,
    driverSha256: manifest.driver.sha256,
    driverImageDigest: manifest.driver.imageDigest,
    transport: "webrtc-datachannel",
    signalingPath: "tracker-signaling-relay",
    authMode: "per-viewer-short-lived",
    assignedPeerStart: manifest.assignment.peerStart,
    assignedPeerCount: manifest.assignment.peerCount,
    durationSeconds,
    ...raw
  }, { allowSynthetic, source: "probe" });
  const {
    startedAtMs: _startedAtMs,
    completedAtMs: _completedAtMs,
    deliveryBytes: _deliveryBytes,
    ...probe
  } = validatedProbe;
  return { schemaVersion: 1, synthetic: manifest.synthetic, probes: [probe] };
}
