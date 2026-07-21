import { createHash, createHmac } from "node:crypto";

export const SNAPSHOT_ACTION = "tv.swarmcast.action.DEVICE_LAB_SNAPSHOT";
export const SET_P2P_ACTION = "tv.swarmcast.action.DEVICE_LAB_SET_P2P";
const WIRE_PREFIX = "scdl1:";
const COUNTERS = [
  "downloadedFromPeers",
  "downloadedFromEdge",
  "downloadedFromBootstrapOrigin",
  "downloadedFromRelay",
  "uploadedToPeers",
  "peerTimeouts",
  "peerHashFailures",
  "peerDisconnects",
  "iceAttempts",
  "iceSuccesses",
  "iceFailures",
  "iceCandidateHost",
  "iceCandidateSrflx",
  "iceCandidatePrflx",
  "iceCandidateRelay",
  "iceCandidateUnknown"
];
const FORBIDDEN_SNAPSHOT_KEYS = /token|secret|password|url|peer.?id|device.?id|carrier|ssid|bssid|serial/i;

function fail(message) {
  throw new Error(message);
}

function stringField(name, value, pattern) {
  if (typeof value !== "string" || value.trim() === "") fail(`${name} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) fail(`${name} has invalid format`);
  return normalized;
}

function integerField(name, value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function booleanField(name, value) {
  if (typeof value !== "boolean") fail(`${name} must be a boolean`);
  return value;
}

export function validateDeviceLabManifest(input, { allowSynthetic = false } = {}) {
  if (!input || typeof input !== "object") fail("device-lab manifest is required");
  const manifest = structuredClone(input);
  if (manifest.schemaVersion !== 1) fail("schemaVersion must equal 1");
  stringField("runId", manifest.runId, /^[a-z0-9][a-z0-9._-]*$/);
  stringField("environment", manifest.environment, /^(staging|production)$/);
  stringField("commit", manifest.commit, /^[a-fA-F0-9]{7,40}$/);
  stringField("appVersion", manifest.appVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  stringField("releaseApkSha256", manifest.releaseApkSha256, /^[a-fA-F0-9]{64}$/);
  stringField("packageName", manifest.packageName, /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/);
  stringField("channelId", manifest.channelId, /^[A-Za-z0-9._-]+$/);
  const synthetic = manifest.synthetic === true;
  if (synthetic && !allowSynthetic) fail("synthetic device-lab runs require --allow-synthetic");
  const minimumDuration = synthetic ? 2 : 1800;
  manifest.durationSeconds = integerField("durationSeconds", manifest.durationSeconds, { min: minimumDuration });
  manifest.sampleIntervalSeconds = integerField("sampleIntervalSeconds", manifest.sampleIntervalSeconds, {
    min: 1,
    max: synthetic ? manifest.durationSeconds : 30
  });
  manifest.policySettleSeconds = integerField("policySettleSeconds", manifest.policySettleSeconds, {
    min: synthetic ? 0 : 15,
    max: 120
  });
  manifest.edgeFallbackSeconds = integerField("edgeFallbackSeconds", manifest.edgeFallbackSeconds, {
    min: synthetic ? 0 : 15,
    max: 120
  });
  if (!Array.isArray(manifest.devices) || manifest.devices.length < 4) {
    fail("devices must include at least four physical devices");
  }
  const ids = new Set();
  const serialEnvs = new Set();
  const wifiNetworks = new Set();
  const carriers = new Set();
  for (const device of manifest.devices) {
    const id = stringField("device.id", device.id, /^[a-z0-9][a-z0-9-]*$/);
    if (ids.has(id)) fail(`duplicate device id ${id}`);
    ids.add(id);
    const serialEnv = stringField(`${id}.serialEnv`, device.serialEnv, /^SWARMCAST_DEVICE_[A-Z0-9_]+_SERIAL$/);
    if (serialEnvs.has(serialEnv)) fail(`duplicate device serial environment ${serialEnv}`);
    serialEnvs.add(serialEnv);
    const network = stringField(`${id}.network`, device.network, /^(wifi|cellular)$/);
    if (network === "wifi") {
      wifiNetworks.add(stringField(`${id}.wifiNetworkId`, device.wifiNetworkId, /^[a-z0-9][a-z0-9._-]*$/));
      if (device.carrierId !== undefined) fail(`${id}.carrierId must be omitted for wifi devices`);
    } else {
      carriers.add(stringField(`${id}.carrierId`, device.carrierId, /^[a-z0-9][a-z0-9._-]*$/));
      if (device.wifiNetworkId !== undefined) fail(`${id}.wifiNetworkId must be omitted for cellular devices`);
    }
  }
  if (wifiNetworks.size < 2) fail("manifest must include two WiFi network failure domains");
  if (carriers.size < 2) fail("manifest must include two cellular carrier failure domains");
  return manifest;
}

export function parseDeviceLabSnapshot(output) {
  const text = Buffer.isBuffer(output) ? output.toString("utf8") : String(output);
  const match = text.match(/data="?(scdl1:[A-Za-z0-9_-]+)"?/);
  if (!match) fail("ADB broadcast did not return a device-lab snapshot");
  const json = Buffer.from(match[1].slice(WIRE_PREFIX.length), "base64url").toString("utf8");
  const snapshot = JSON.parse(json);
  for (const key of Object.keys(snapshot)) {
    if (FORBIDDEN_SNAPSHOT_KEYS.test(key)) fail(`device-lab snapshot contains forbidden key ${key}`);
  }
  if (snapshot.schemaVersion !== 1) fail("device-lab snapshot schemaVersion must equal 1");
  stringField("snapshot.channelId", snapshot.channelId, /^[A-Za-z0-9._-]+$/);
  stringField("snapshot.networkClass", snapshot.networkClass, /^(wifi|cellular|ethernet|unknown)$/);
  stringField("snapshot.swarmMode", snapshot.swarmMode, /^(p2p|edge-only)$/);
  integerField("snapshot.capturedAtElapsedRealtimeMs", snapshot.capturedAtElapsedRealtimeMs, { min: 0 });
  integerField("snapshot.activePeerLinks", snapshot.activePeerLinks, { min: 0 });
  integerField("snapshot.batteryPercent", snapshot.batteryPercent, { min: 0, max: 100 });
  integerField("snapshot.rebufferCount", snapshot.rebufferCount, { min: 0 });
  integerField("snapshot.bufferMs", snapshot.bufferMs, { min: 0 });
  integerField("snapshot.uplinkKbps", snapshot.uplinkKbps, { min: 0 });
  booleanField("snapshot.p2pEnabled", snapshot.p2pEnabled);
  booleanField("snapshot.p2pDownloadAllowed", snapshot.p2pDownloadAllowed);
  booleanField("snapshot.uploadAllowed", snapshot.uploadAllowed);
  booleanField("snapshot.metered", snapshot.metered);
  booleanField("snapshot.charging", snapshot.charging);
  booleanField("snapshot.playbackStarted", snapshot.playbackStarted);
  for (const counter of COUNTERS) integerField(`snapshot.${counter}`, snapshot[counter], { min: 0 });
  return snapshot;
}

function delta(start, end) {
  const result = {};
  for (const counter of COUNTERS) {
    if (end[counter] < start[counter]) fail(`device counter ${counter} regressed during the run`);
    result[counter] = end[counter] - start[counter];
  }
  return result;
}

async function inspectDevice({ device, manifest, serial, fingerprintSalt, adb }) {
  const state = String(await adb(serial, ["get-state"])).trim();
  if (state !== "device") fail(`${device.id} is not an authorized online ADB device`);
  const qemu = String(await adb(serial, ["shell", "getprop", "ro.kernel.qemu"])).trim();
  const bootQemu = String(await adb(serial, ["shell", "getprop", "ro.boot.qemu"])).trim();
  if (qemu === "1" || bootQemu === "1") fail(`${device.id} is an emulator`);
  const model = stringField(`${device.id}.model`, String(await adb(serial, ["shell", "getprop", "ro.product.model"])).trim());
  const androidVersion = stringField(`${device.id}.androidVersion`, String(await adb(serial, ["shell", "getprop", "ro.build.version.release"])).trim());
  const hardwareSerial = String(await adb(serial, ["shell", "getprop", "ro.serialno"])).trim() || serial;
  const fingerprint = createHmac("sha256", fingerprintSalt).update(`${hardwareSerial}\n${model}\n${androidVersion}`).digest("hex");
  const source = String(await adb(serial, ["shell", "cmd", "package", "get-install-source", manifest.packageName]));
  if (!source.includes("com.android.vending")) fail(`${device.id} was not installed by Google Play`);
  const packagePathOutput = String(await adb(serial, ["shell", "pm", "path", manifest.packageName])).trim();
  const packagePaths = packagePathOutput.split("\n").filter((line) => line.startsWith("package:")).map((line) => line.slice(8));
  const packagePath = packagePaths.find((path) => path.endsWith("/base.apk")) || packagePaths[0];
  if (!packagePath) fail(`${device.id} package path was not found`);
  const apk = await adb(serial, ["exec-out", "cat", packagePath], { binary: true });
  const apkSha256 = createHash("sha256").update(apk).digest("hex");
  if (apkSha256 !== manifest.releaseApkSha256.toLowerCase()) fail(`${device.id} installed APK does not match releaseApkSha256`);
  return {
    id: device.id,
    model,
    androidVersion,
    network: device.network,
    ...(device.network === "wifi" ? { wifiNetworkId: device.wifiNetworkId } : { carrierId: device.carrierId }),
    physical: true,
    installationSource: "play-store",
    deviceFingerprintSha256: fingerprint,
    apkSha256
  };
}

async function broadcastSnapshot(serial, manifest, adb) {
  const output = await adb(serial, [
    "shell", "am", "broadcast",
    "-a", SNAPSHOT_ACTION,
    "-n", `${manifest.packageName}/.diagnostics.DeviceLabControlReceiver`
  ]);
  return parseDeviceLabSnapshot(output);
}

async function setP2p(serial, manifest, enabled, adb) {
  const output = await adb(serial, [
    "shell", "am", "broadcast",
    "-a", SET_P2P_ACTION,
    "-n", `${manifest.packageName}/.diagnostics.DeviceLabControlReceiver`,
    "--ez", "enabled", String(enabled)
  ]);
  const snapshot = parseDeviceLabSnapshot(output);
  if (snapshot.p2pEnabled !== enabled) fail(`device did not apply P2P policy ${enabled}`);
  return snapshot;
}

function validateSnapshotForDevice(snapshot, device, manifest) {
  if (snapshot.channelId !== manifest.channelId) fail(`${device.id} is not playing the required channel`);
  if (snapshot.networkClass !== device.network) fail(`${device.id} network class does not match the manifest`);
  if (snapshot.playbackStarted !== true) fail(`${device.id} playback has not started`);
  if (snapshot.charging) fail(`${device.id} must remain unplugged during measurement`);
}

function assertMeasuredResults(manifest, devices, baselines, endSamples, disabledSamples) {
  let direct = 0;
  let edge = 0;
  let origin = 0;
  let relay = 0;
  let maximumBatteryDrainPctPerHour = 0;
  for (const device of devices) {
    const baseline = baselines.get(device.id);
    const end = endSamples.get(device.id);
    const disabled = disabledSamples.get(device.id);
    const measured = delta(baseline, end);
    const fallback = delta(end, disabled);
    const drain = Math.max(0, baseline.batteryPercent - end.batteryPercent) * 3600 / manifest.durationSeconds;
    maximumBatteryDrainPctPerHour = Math.max(maximumBatteryDrainPctPerHour, drain);
    if (device.network === "wifi" && measured.uploadedToPeers <= 0) fail(`${device.id} did not provide useful WiFi upload`);
    if (device.network === "cellular" && measured.uploadedToPeers !== 0) fail(`${device.id} uploaded payload on cellular`);
    if (measured.iceAttempts <= 0 || measured.iceSuccesses <= 0) fail(`${device.id} has no measured ICE success`);
    if (measured.iceSuccesses + measured.iceFailures !== measured.iceAttempts) fail(`${device.id} ICE outcomes are incomplete`);
    if (measured.iceCandidateUnknown !== 0) fail(`${device.id} has unknown selected ICE candidates`);
    const classified = measured.iceCandidateHost + measured.iceCandidateSrflx + measured.iceCandidatePrflx + measured.iceCandidateRelay;
    if (classified !== measured.iceSuccesses) fail(`${device.id} ICE candidate counts do not reconcile`);
    if (measured.peerHashFailures !== 0) fail(`${device.id} observed a peer hash failure`);
    if (disabled.p2pEnabled || disabled.p2pDownloadAllowed || disabled.activePeerLinks !== 0) {
      fail(`${device.id} retained P2P state after disable`);
    }
    if (fallback.downloadedFromEdge <= 0) fail(`${device.id} did not prove edge fallback after P2P disable`);
    direct += measured.downloadedFromPeers;
    edge += measured.downloadedFromEdge;
    origin += measured.downloadedFromBootstrapOrigin;
    relay += measured.downloadedFromRelay;
  }
  const total = direct + edge + origin + relay;
  if (total <= 0) fail("device lab measured no delivery bytes");
  const offloadRatio = direct / total;
  if (offloadRatio < 0.90) fail(`measured direct offload ${offloadRatio.toFixed(6)} is below 0.90`);
  return { directP2pBytes: direct, edgeBytes: edge, bootstrapOriginBytes: origin, relayBytes: relay, offloadRatio, maximumBatteryDrainPctPerHour };
}

export async function runAndroidDeviceLab({
  manifest: input,
  env = process.env,
  allowSynthetic = false,
  adb,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => new Date()
}) {
  const manifest = validateDeviceLabManifest(input, { allowSynthetic });
  const fingerprintSalt = stringField("SWARMCAST_DEVICE_FINGERPRINT_SALT", env.SWARMCAST_DEVICE_FINGERPRINT_SALT, /^.{32,}$/);
  const runtimeDevices = manifest.devices.map((device) => {
    const serial = stringField(device.serialEnv, env[device.serialEnv]);
    return { ...device, serial };
  });
  if (new Set(runtimeDevices.map((device) => device.serial)).size !== runtimeDevices.length) {
    fail("each device must use a distinct ADB serial");
  }
  const startedAt = now().toISOString();
  const inspected = await Promise.all(runtimeDevices.map((device) => inspectDevice({
    device,
    manifest,
    serial: device.serial,
    fingerprintSalt,
    adb
  })));
  if (new Set(inspected.map((device) => device.deviceFingerprintSha256)).size !== inspected.length) {
    fail("each configured entry must resolve to a distinct physical device");
  }
  const original = new Map();
  for (const device of runtimeDevices) {
    const snapshot = await broadcastSnapshot(device.serial, manifest, adb);
    validateSnapshotForDevice(snapshot, device, manifest);
    original.set(device.id, snapshot.p2pEnabled);
  }
  const samples = new Map(runtimeDevices.map((device) => [device.id, []]));
  try {
    await Promise.all(runtimeDevices.map((device) => setP2p(device.serial, manifest, false, adb)));
    await sleep(manifest.policySettleSeconds * 1000);
    const baselines = new Map();
    for (const device of runtimeDevices) {
      const snapshot = await broadcastSnapshot(device.serial, manifest, adb);
      validateSnapshotForDevice(snapshot, device, manifest);
      if (snapshot.p2pEnabled || snapshot.activePeerLinks !== 0 || snapshot.p2pDownloadAllowed || snapshot.uploadAllowed) {
        fail(`${device.id} did not reach a clean P2P-off baseline`);
      }
      baselines.set(device.id, snapshot);
      samples.get(device.id).push(snapshot);
    }
    await Promise.all(runtimeDevices.map((device) => setP2p(device.serial, manifest, true, adb)));
    const sampleCount = Math.floor(manifest.durationSeconds / manifest.sampleIntervalSeconds);
    for (let index = 0; index < sampleCount; index += 1) {
      await sleep(manifest.sampleIntervalSeconds * 1000);
      for (const device of runtimeDevices) {
        const snapshot = await broadcastSnapshot(device.serial, manifest, adb);
        validateSnapshotForDevice(snapshot, device, manifest);
        if (!snapshot.p2pEnabled || !snapshot.p2pDownloadAllowed) fail(`${device.id} did not remain in P2P mode during measurement`);
        if (device.network === "cellular" && snapshot.uploadAllowed) fail(`${device.id} allowed upload on cellular`);
        samples.get(device.id).push(snapshot);
      }
    }
    const endSamples = new Map(runtimeDevices.map((device) => [device.id, samples.get(device.id).at(-1)]));
    await Promise.all(runtimeDevices.map((device) => setP2p(device.serial, manifest, false, adb)));
    await sleep(manifest.edgeFallbackSeconds * 1000);
    const disabledSamples = new Map();
    for (const device of runtimeDevices) {
      const snapshot = await broadcastSnapshot(device.serial, manifest, adb);
      validateSnapshotForDevice(snapshot, device, manifest);
      disabledSamples.set(device.id, snapshot);
      samples.get(device.id).push(snapshot);
    }
    const measured = assertMeasuredResults(manifest, runtimeDevices, baselines, endSamples, disabledSamples);
    return {
      schemaVersion: 1,
      runId: manifest.runId,
      environment: manifest.environment,
      commit: manifest.commit,
      appVersion: manifest.appVersion,
      releaseApkSha256: manifest.releaseApkSha256.toLowerCase(),
      channelId: manifest.channelId,
      synthetic: manifest.synthetic === true,
      startedAt,
      completedAt: now().toISOString(),
      durationSeconds: manifest.durationSeconds,
      sampleIntervalSeconds: manifest.sampleIntervalSeconds,
      devices: inspected.map((device) => ({ ...device, samples: samples.get(device.id) })),
      measured
    };
  } finally {
    await Promise.all(runtimeDevices.map((device) => setP2p(device.serial, manifest, original.get(device.id), adb).catch(() => null)));
  }
}
