import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import {
  expectedSegmentBusCapacityProfile,
  failSegmentBusCapacity,
  validateSegmentBusCapacityProbe
} from "./segment-bus-capacity-contract.js";

const MANIFEST_KEYS = new Set([
  "schemaVersion", "synthetic", "evidenceId", "environment", "commit", "releaseVersion", "clusterId",
  "startAt", "durationSeconds", "capacityProfile", "topology", "driver"
]);
const MANIFEST_NODE_KEYS = new Set([
  "nodeId", "provider", "region", "failureDomain", "serverName", "endpoint", "serverImageDigest"
]);
const DRIVER_KEYS = new Set(["sha256", "imageDigest"]);
const DRIVER_OUTPUT_KEYS = new Set([
  "startedAt", "completedAt", "observedNodes", "transport", "stream", "load", "failover", "recovery",
  "permissions", "credentialRotation", "monitoring", "evidenceMarkers"
]);
const OBSERVED_NODE_KEYS = new Set([
  "nodeId", "endpointHost", "observedServerName", "serverVersion", "serverImageDigest", "certificateSha256",
  "storageVolumeFingerprintSha256", "monitoringFingerprintSha256"
]);
const PROFILE_KEYS = new Set([
  "activeChannelsPeak", "segmentDurationSeconds", "projectedMessagesPerSecond", "headroomRatio",
  "targetMessagesPerSecond"
]);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const DNS_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_DRIVER_OUTPUT_BYTES = 16 * 1024 * 1024;

function exactObject(name, value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) failSegmentBusCapacity(`${name} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.size || actual.some((key) => !keys.has(key))) {
    failSegmentBusCapacity(`${name} has unsupported or missing fields`);
  }
  return value;
}

function cleanString(name, value, pattern = null) {
  if (typeof value !== "string" || value.trim() === "") failSegmentBusCapacity(`${name} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) failSegmentBusCapacity(`${name} has invalid format`);
  return normalized;
}

function integer(name, value, { min, max }) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    failSegmentBusCapacity(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseTime(name, value) {
  const parsed = Date.parse(cleanString(name, value));
  if (!Number.isFinite(parsed)) failSegmentBusCapacity(`${name} must be ISO-8601 parseable`);
  return parsed;
}

function validateProfile(value, capacityPlan) {
  exactObject("capacityProfile", value, PROFILE_KEYS);
  const expected = expectedSegmentBusCapacityProfile(capacityPlan);
  for (const key of PROFILE_KEYS) {
    if (value[key] !== expected[key]) failSegmentBusCapacity(`capacityProfile.${key} does not match the capacity plan`);
  }
  return expected;
}

function validateEndpoint(name, value, synthetic) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    failSegmentBusCapacity(`${name} must be an absolute tls URL`);
  }
  if (parsed.protocol !== "tls:") failSegmentBusCapacity(`${name} must use tls`);
  if (!DNS_PATTERN.test(parsed.hostname)) failSegmentBusCapacity(`${name} must use a DNS hostname`);
  if (!parsed.port) failSegmentBusCapacity(`${name} must include an explicit port`);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "") {
    failSegmentBusCapacity(`${name} must not contain credentials, paths, queries, or fragments`);
  }
  if (!synthetic && ["localhost", "example.com"].includes(parsed.hostname)) {
    failSegmentBusCapacity(`${name} must identify a staging broker`);
  }
  return parsed;
}

export function isPrivateSegmentBusAddress(address) {
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

export function validateSegmentBusCapacityManifest(input, {
  allowSynthetic = false,
  capacityPlan,
  nowMs = Date.now()
} = {}) {
  exactObject("segment bus capacity manifest", input, MANIFEST_KEYS);
  if (input.schemaVersion !== 1) failSegmentBusCapacity("schemaVersion must equal 1");
  const synthetic = input.synthetic === true;
  if (synthetic && !allowSynthetic) failSegmentBusCapacity("synthetic segment bus capacity probes require --allow-synthetic");
  cleanString("evidenceId", input.evidenceId, ID_PATTERN);
  const environment = cleanString("environment", input.environment, /^(staging|production)$/);
  if (!synthetic && environment !== "staging") failSegmentBusCapacity("non-synthetic segment bus capacity probes must run in staging");
  cleanString("commit", input.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", input.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  cleanString("clusterId", input.clusterId, ID_PATTERN);
  const startAtMs = parseTime("startAt", input.startAt);
  if (!synthetic && (startAtMs < nowMs + 15_000 || startAtMs > nowMs + 30 * 60 * 1000)) {
    failSegmentBusCapacity("startAt must be between 15 seconds and 30 minutes in the future");
  }
  integer("durationSeconds", input.durationSeconds, { min: synthetic ? 1 : 900, max: 7200 });
  const capacityProfile = validateProfile(input.capacityProfile, capacityPlan);
  if (!Array.isArray(input.topology) || input.topology.length !== 3) {
    failSegmentBusCapacity("topology must contain exactly three broker nodes");
  }
  const nodeIds = new Set();
  const providers = new Set();
  const failureDomains = new Set();
  const endpoints = new Set();
  const serverNames = new Set();
  const topology = input.topology.map((node, index) => {
    const name = `topology[${index}]`;
    exactObject(name, node, MANIFEST_NODE_KEYS);
    const nodeId = cleanString(`${name}.nodeId`, node.nodeId, ID_PATTERN);
    const provider = cleanString(`${name}.provider`, node.provider, ID_PATTERN);
    cleanString(`${name}.region`, node.region, ID_PATTERN);
    const failureDomain = cleanString(`${name}.failureDomain`, node.failureDomain, ID_PATTERN);
    const serverName = cleanString(`${name}.serverName`, node.serverName, ID_PATTERN);
    const endpoint = validateEndpoint(`${name}.endpoint`, node.endpoint, synthetic);
    cleanString(`${name}.serverImageDigest`, node.serverImageDigest, IMAGE_PATTERN);
    for (const [set, item, label] of [
      [nodeIds, nodeId, "nodeId"], [endpoints, endpoint.toString(), "endpoint"], [serverNames, serverName, "serverName"]
    ]) {
      if (set.has(item)) failSegmentBusCapacity(`topology has duplicate ${label}`);
      set.add(item);
    }
    providers.add(provider);
    failureDomains.add(failureDomain);
    return { ...node, parsedEndpoint: endpoint };
  });
  if (providers.size < 2) failSegmentBusCapacity("topology must span at least two providers");
  if (failureDomains.size !== 3) failSegmentBusCapacity("topology must span exactly three failure domains");
  exactObject("driver", input.driver, DRIVER_KEYS);
  cleanString("driver.sha256", input.driver.sha256, HASH_PATTERN);
  cleanString("driver.imageDigest", input.driver.imageDigest, IMAGE_PATTERN);
  return { ...structuredClone(input), synthetic, startAtMs, capacityProfile, topology };
}

async function requirePublicEndpoints(topology, resolveHost) {
  for (const node of topology) {
    let addresses;
    try {
      addresses = await resolveHost(node.parsedEndpoint.hostname);
    } catch {
      failSegmentBusCapacity(`topology endpoint ${node.nodeId} did not resolve`);
    }
    if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(({ address }) => isPrivateSegmentBusAddress(address))) {
      failSegmentBusCapacity(`topology endpoint ${node.nodeId} must resolve only to public addresses`);
    }
  }
}

function driverEnvironment(env) {
  const output = {};
  for (const key of ["HOME", "PATH", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"]) {
    if (typeof env[key] === "string") output[key] = env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("SWARMCAST_SEGMENT_BUS_DRIVER_") && typeof value === "string") output[key] = value;
  }
  return output;
}

function sensitiveValues(env) {
  return Object.entries(env)
    .filter(([key, value]) => key.startsWith("SWARMCAST_SEGMENT_BUS_DRIVER_") && /secret|token|password|credential|key/i.test(key) && value)
    .map(([, value]) => value);
}

function redact(value, secrets) {
  let output = String(value || "");
  for (const secret of secrets) output = output.replaceAll(secret, "[redacted]");
  return output;
}

export function executeSegmentBusCapacityDriver({ executable, request, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      cwd: process.cwd(),
      env: driverEnvironment(env),
      stdio: ["pipe", "pipe", "pipe"]
    });
    const secrets = sensitiveValues(env);
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
        finish(new Error(`segment bus capacity driver ${streamName} exceeded ${MAX_DRIVER_OUTPUT_BYTES} bytes`));
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
        finish(new Error(`segment bus capacity driver failed with ${signal ? `signal ${signal}` : `exit ${code}`}${detail ? `: ${detail}` : ""}`));
        return;
      }
      try {
        finish(null, JSON.parse(stdout.toString("utf8")));
      } catch (error) {
        finish(new Error(`segment bus capacity driver returned invalid JSON: ${error.message}`));
      }
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      finish(new Error(`segment bus capacity driver exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function validateDriverOutput(output) {
  exactObject("segment bus capacity driver output", output, DRIVER_OUTPUT_KEYS);
  if (!Array.isArray(output.observedNodes) || output.observedNodes.length !== 3) {
    failSegmentBusCapacity("driver observedNodes must contain exactly three nodes");
  }
  for (const [index, node] of output.observedNodes.entries()) {
    exactObject(`driver observedNodes[${index}]`, node, OBSERVED_NODE_KEYS);
  }
  return output;
}

function assertSecretFree(value, env) {
  const serialized = JSON.stringify(value);
  for (const secret of sensitiveValues(env)) {
    if (secret.length >= 4 && serialized.includes(secret)) failSegmentBusCapacity("driver output contains a configured secret");
  }
  if (/(?:bearer\s+[A-Za-z0-9._~-]+|-----BEGIN|(?:token|secret|password|authorization|cookie)=)/i.test(serialized)) {
    failSegmentBusCapacity("driver output contains sensitive material");
  }
}

export async function runSegmentBusCapacityProbe({
  manifest: input,
  driverPath,
  capacityPlan,
  budgets,
  allowSynthetic = false,
  env = process.env,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  resolveHost = (hostname) => lookup(hostname, { all: true, verbatim: true }),
  executeDriver = executeSegmentBusCapacityDriver
}) {
  const manifest = validateSegmentBusCapacityManifest(input, { allowSynthetic, capacityPlan, nowMs: now() });
  const executable = path.resolve(cleanString("driverPath", driverPath));
  try {
    accessSync(executable, constants.R_OK | constants.X_OK);
  } catch {
    failSegmentBusCapacity(`segment bus capacity driver is not readable and executable: ${executable}`);
  }
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const actualDriverHash = createHash("sha256").update(readFileSync(executable)).digest("hex");
  if (actualDriverHash !== manifest.driver.sha256) failSegmentBusCapacity("segment bus capacity driver SHA-256 does not match manifest");
  if (!manifest.synthetic) await requirePublicEndpoints(manifest.topology, resolveHost);
  const waitMs = manifest.startAtMs - now();
  if (waitMs < (manifest.synthetic ? -1_000 : -2_000)) failSegmentBusCapacity("startAt elapsed before the capacity probe was ready");
  if (waitMs > 0) await sleep(waitMs);
  const request = {
    schemaVersion: 1,
    evidenceId: manifest.evidenceId,
    clusterId: manifest.clusterId,
    startAt: manifest.startAt,
    durationSeconds: manifest.durationSeconds,
    capacityProfile: manifest.capacityProfile,
    endpoints: manifest.topology.map((node) => ({ nodeId: node.nodeId, endpoint: node.parsedEndpoint.toString() }))
  };
  const raw = validateDriverOutput(await executeDriver({
    executable,
    request,
    env,
    timeoutMs: (manifest.durationSeconds + 300) * 1000
  }));
  assertSecretFree(raw, env);
  const startedAtMs = parseTime("driver.startedAt", raw.startedAt);
  if (Math.abs(startedAtMs - manifest.startAtMs) > (manifest.synthetic ? 1_000 : 5_000)) {
    failSegmentBusCapacity("capacity driver start differs from synchronized startAt by more than five seconds");
  }
  const actualDuration = (parseTime("driver.completedAt", raw.completedAt) - startedAtMs) / 1000;
  if (Math.abs(actualDuration - manifest.durationSeconds) > 2) {
    failSegmentBusCapacity("capacity driver duration does not match manifest durationSeconds");
  }
  const observed = new Map(raw.observedNodes.map((node) => [node.nodeId, node]));
  if (observed.size !== 3) failSegmentBusCapacity("driver observedNodes contains duplicate node IDs");
  const topology = manifest.topology.map((node) => {
    const runtime = observed.get(node.nodeId);
    if (!runtime) failSegmentBusCapacity(`driver did not observe topology node ${node.nodeId}`);
    if (runtime.endpointHost !== node.parsedEndpoint.hostname || runtime.observedServerName !== node.serverName ||
        runtime.serverImageDigest !== node.serverImageDigest) {
      failSegmentBusCapacity(`driver observation does not match manifest topology for ${node.nodeId}`);
    }
    return {
      nodeId: node.nodeId,
      provider: node.provider,
      region: node.region,
      failureDomain: node.failureDomain,
      serverName: node.serverName,
      endpointHost: runtime.endpointHost,
      serverVersion: runtime.serverVersion,
      serverImageDigest: runtime.serverImageDigest,
      certificateSha256: runtime.certificateSha256,
      storageVolumeFingerprintSha256: runtime.storageVolumeFingerprintSha256,
      monitoringFingerprintSha256: runtime.monitoringFingerprintSha256
    };
  });
  const probe = {
    schemaVersion: 1,
    synthetic: manifest.synthetic,
    evidenceId: manifest.evidenceId,
    environment: manifest.environment,
    commit: manifest.commit,
    releaseVersion: manifest.releaseVersion,
    clusterId: manifest.clusterId,
    driverSha256: manifest.driver.sha256,
    driverImageDigest: manifest.driver.imageDigest,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
    durationSeconds: manifest.durationSeconds,
    capacityProfile: manifest.capacityProfile,
    topology,
    transport: raw.transport,
    stream: raw.stream,
    load: raw.load,
    failover: raw.failover,
    recovery: raw.recovery,
    permissions: raw.permissions,
    credentialRotation: raw.credentialRotation,
    monitoring: raw.monitoring,
    evidenceMarkers: raw.evidenceMarkers
  };
  assertSecretFree(probe, env);
  return validateSegmentBusCapacityProbe(probe, { allowSynthetic, capacityPlan, budgets });
}
