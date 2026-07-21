import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseDeviceLabSnapshot,
  runAndroidDeviceLab,
  SET_P2P_ACTION,
  SNAPSHOT_ACTION,
  validateDeviceLabManifest
} from "./android-device-lab-runner.js";

const manifest = JSON.parse(readFileSync("test-fixtures/android/device-lab-manifest.complete.synthetic.json", "utf8"));
const serials = {
  SWARMCAST_DEVICE_WIFI_A_SERIAL: "adb-wifi-a",
  SWARMCAST_DEVICE_WIFI_B_SERIAL: "adb-wifi-b",
  SWARMCAST_DEVICE_CELL_A_SERIAL: "adb-cell-a",
  SWARMCAST_DEVICE_CELL_B_SERIAL: "adb-cell-b"
};
const deviceBySerial = new Map(manifest.devices.map((device) => [serials[device.serialEnv], device]));

function encodeSnapshot(snapshot) {
  const wire = Buffer.from(JSON.stringify(snapshot)).toString("base64url");
  return `Broadcast completed: result=0, data="scdl1:${wire}"\n`;
}

function baseSnapshot(device) {
  return {
    schemaVersion: 1,
    capturedAtElapsedRealtimeMs: 1,
    channelId: manifest.channelId,
    p2pEnabled: false,
    p2pDownloadAllowed: false,
    uploadAllowed: false,
    swarmMode: "edge-only",
    networkClass: device.network,
    metered: device.network === "cellular",
    batteryPercent: 90,
    charging: false,
    uplinkKbps: device.network === "wifi" ? 12000 : 0,
    activePeerLinks: 0,
    playbackStarted: true,
    rebufferCount: 0,
    bufferMs: 12000,
    downloadedFromPeers: 0,
    downloadedFromEdge: 100,
    downloadedFromBootstrapOrigin: 0,
    downloadedFromRelay: 0,
    uploadedToPeers: 0,
    peerTimeouts: 0,
    peerHashFailures: 0,
    peerDisconnects: 0,
    iceAttempts: 0,
    iceSuccesses: 0,
    iceFailures: 0,
    iceCandidateHost: 0,
    iceCandidateSrflx: 0,
    iceCandidatePrflx: 0,
    iceCandidateRelay: 0,
    iceCandidateUnknown: 0
  };
}

function fakeAdbFactory(overrides = {}) {
  const states = new Map([...deviceBySerial].map(([serial, device]) => [serial, baseSnapshot(device)]));
  return async function adb(serial, args) {
    const device = deviceBySerial.get(serial);
    if (!device) throw new Error(`unexpected test serial ${serial}`);
    const command = args.join(" ");
    if (command === "get-state") return "device\n";
    if (command === "shell getprop ro.kernel.qemu") return overrides.qemu === true ? "1\n" : "0\n";
    if (command === "shell getprop ro.boot.qemu") return "0\n";
    if (command === "shell getprop ro.product.model") return `Test ${device.id}\n`;
    if (command === "shell getprop ro.build.version.release") return "15\n";
    if (command === "shell getprop ro.serialno") return `hardware-${device.id}\n`;
    if (command.startsWith("shell cmd package get-install-source")) {
      return overrides.nonPlay === true ? "initiatingPackageName=com.example.sideload\n" : "initiatingPackageName=com.android.vending\n";
    }
    if (command.startsWith("shell pm path")) return "package:/data/app/tv.swarmcast/base.apk\n";
    if (command.startsWith("exec-out cat")) return Buffer.from(overrides.apkMismatch === true ? "wrong-apk" : "fake-apk");
    if (!command.startsWith("shell am broadcast")) throw new Error(`unexpected ADB command ${command}`);

    const state = states.get(serial);
    if (args.includes(SET_P2P_ACTION)) {
      const enabled = args.at(-1) === "true";
      state.p2pEnabled = enabled;
      state.p2pDownloadAllowed = enabled;
      state.uploadAllowed = enabled && device.network === "wifi";
      state.swarmMode = enabled ? "p2p" : "edge-only";
      state.activePeerLinks = enabled ? 2 : 0;
    } else if (!args.includes(SNAPSHOT_ACTION)) {
      throw new Error(`unexpected broadcast action ${command}`);
    }

    if (state.p2pEnabled) {
      state.downloadedFromPeers += overrides.lowOffload === true ? 50 : 900;
      state.downloadedFromEdge += overrides.lowOffload === true ? 950 : 25;
      state.uploadedToPeers += device.network === "wifi" ? 900 : (overrides.cellularUpload === true ? 1 : 0);
      state.iceAttempts += 1;
      const recordSuccess = overrides.incompleteIce !== true || state.iceAttempts === 1;
      if (recordSuccess) {
        state.iceSuccesses += 1;
        state.iceCandidateSrflx += 1;
      }
    } else {
      state.downloadedFromEdge += 100;
    }
    if (overrides.unsafeDisable === true && !state.p2pEnabled) state.activePeerLinks = 1;
    if (overrides.charging === true) state.charging = true;
    state.capturedAtElapsedRealtimeMs += 1000;
    return encodeSnapshot({ ...state, ...(overrides.sensitiveSnapshot === true ? { accessToken: "forbidden" } : {}) });
  };
}

function run(overrides = {}, input = manifest) {
  return runAndroidDeviceLab({
    manifest: input,
    env: {
      ...serials,
      SWARMCAST_DEVICE_FINGERPRINT_SALT: "synthetic-device-fingerprint-salt-32-bytes"
    },
    allowSynthetic: true,
    adb: fakeAdbFactory(overrides),
    sleep: async () => {},
    now: () => new Date("2026-07-21T12:00:00.000Z")
  });
}

await assert.rejects(() => runAndroidDeviceLab({ manifest, adb: fakeAdbFactory() }), /require --allow-synthetic/);
assert.throws(
  () => validateDeviceLabManifest({ ...manifest, devices: manifest.devices.map((device) => ({ ...device, serialEnv: "SWARMCAST_DEVICE_DUPLICATE_SERIAL" })) }, { allowSynthetic: true }),
  /duplicate device serial environment/
);
assert.throws(() => parseDeviceLabSnapshot(encodeSnapshot({ ...baseSnapshot(manifest.devices[0]), accessToken: "forbidden" })), /forbidden key accessToken/);
await assert.rejects(() => run({ qemu: true }), /is an emulator/);
await assert.rejects(() => run({ nonPlay: true }), /was not installed by Google Play/);
await assert.rejects(() => run({ apkMismatch: true }), /does not match releaseApkSha256/);
await assert.rejects(() => run({ cellularUpload: true }), /uploaded payload on cellular/);
await assert.rejects(() => run({ lowOffload: true }), /below 0.90/);
await assert.rejects(() => run({ incompleteIce: true }), /ICE outcomes are incomplete/);
await assert.rejects(() => run({ unsafeDisable: true }), /did not reach a clean P2P-off baseline|retained P2P state after disable/);
await assert.rejects(() => run({ sensitiveSnapshot: true }), /forbidden key accessToken/);
await assert.rejects(() => run({ charging: true }), /must remain unplugged during measurement/);

const result = await run();
assert.equal(result.synthetic, true);
assert.equal(result.devices.length, 4);
assert.ok(result.measured.offloadRatio >= 0.90);
assert.ok(result.devices.every((device) => device.physical === true && device.installationSource === "play-store"));
const serialized = JSON.stringify(result);
for (const serial of Object.values(serials)) assert.equal(serialized.includes(serial), false);
assert.equal(serialized.includes("hardware-pixel"), false);

console.log("Android device lab smoke OK: pass=1 failures=11 devices=4");
