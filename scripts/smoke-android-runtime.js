import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const valueArg = (name, fallback = undefined) => {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const apkPath = resolve(valueArg("apk", "android/app/build/outputs/apk/debug/app-debug.apk"));
const outputPath = valueArg("output") ? resolve(valueArg("output")) : null;
const screenshotPath = valueArg("screenshot") ? resolve(valueArg("screenshot")) : null;
const allowEmulator = args.includes("--allow-emulator");
const expectedRlnc = valueArg("expect-rlnc");
const sdkRoot = process.env.ANDROID_SDK_ROOT
  ?? process.env.ANDROID_HOME
  ?? join(homedir(), "Library", "Android", "sdk");
const adb = join(sdkRoot, "platform-tools", "adb");
const apkanalyzer = join(sdkRoot, "cmdline-tools", "latest", "bin", "apkanalyzer");
const maxBuffer = 64 * 1024 * 1024;

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: options.binary ? null : "utf8",
    maxBuffer,
    env: process.env
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
    throw new Error(`${command} ${commandArgs.join(" ")} failed: ${(stderr || "unknown error").trim()}`);
  }
  return result.stdout;
}

function adbRun(serial, commandArgs, options = {}) {
  return run(adb, ["-s", serial, ...commandArgs], options);
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

if (!existsSync(apkPath)) throw new Error(`APK not found: ${apkPath}`);
if (!existsSync(adb)) throw new Error(`adb not found: ${adb}`);
if (!existsSync(apkanalyzer)) throw new Error(`apkanalyzer not found: ${apkanalyzer}`);

const attached = run(adb, ["devices"])
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter((parts) => parts.length >= 2 && parts[1] === "device")
  .map(([serial]) => serial);
const requestedSerial = process.env.ANDROID_SERIAL;
const serial = requestedSerial ?? (attached.length === 1 ? attached[0] : null);
if (!serial || !attached.includes(serial)) {
  throw new Error(`Expected one ready Android device or ANDROID_SERIAL; found ${attached.length}`);
}

const isEmulator = adbRun(serial, ["shell", "getprop", "ro.kernel.qemu"]).trim() === "1";
if (isEmulator && !allowEmulator) {
  throw new Error("Emulator detected; pass --allow-emulator for local regression evidence");
}

const manifest = run(apkanalyzer, ["manifest", "print", apkPath]);
const rlncMatch = manifest.match(/android:name="tv\.swarmcast\.RLNC_ENABLED"[\s\S]{0,200}?android:value="(true|false)"/);
if (!rlncMatch) throw new Error("APK manifest is missing RLNC_ENABLED metadata");
const rlncEnabled = rlncMatch[1] === "true";
if (expectedRlnc !== undefined && rlncEnabled !== (expectedRlnc === "true")) {
  throw new Error(`Expected RLNC_ENABLED=${expectedRlnc}, got ${rlncEnabled}`);
}

run(adb, ["-s", serial, "install", "-r", apkPath]);
adbRun(serial, ["shell", "am", "force-stop", "tv.swarmcast"]);
adbRun(serial, ["logcat", "-c"]);
const launch = adbRun(serial, ["shell", "am", "start", "-W", "-n", "tv.swarmcast/.ui.MainActivity"]);
sleep(5_000);

const pid = adbRun(serial, ["shell", "pidof", "tv.swarmcast"]).trim();
const activities = adbRun(serial, ["shell", "dumpsys", "activity", "activities"]);
const logs = adbRun(serial, ["logcat", "-d", "-v", "brief"]);
const packageDump = adbRun(serial, ["shell", "dumpsys", "package", "tv.swarmcast"]);
const fatal = /FATAL EXCEPTION[\s\S]{0,1200}?Process: tv\.swarmcast/.test(logs)
  || /ANR in tv\.swarmcast/.test(logs);
const foreground = activities.includes("tv.swarmcast/.ui.MainActivity");
const launchOk = launch.includes("Status: ok") && launch.includes("LaunchState: COLD");
if (!pid || !foreground || fatal || !launchOk) {
  throw new Error(`Runtime smoke failed: pid=${Boolean(pid)} foreground=${foreground} fatal=${fatal} launch=${launchOk}`);
}

let screenshotSha256 = null;
if (screenshotPath) {
  const screenshot = adbRun(serial, ["exec-out", "screencap", "-p"], { binary: true });
  mkdirSync(dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, screenshot);
  screenshotSha256 = sha256(screenshot);
}

const release = adbRun(serial, ["shell", "getprop", "ro.build.version.release"]).trim();
const apiLevel = Number(adbRun(serial, ["shell", "getprop", "ro.build.version.sdk"]).trim());
const model = adbRun(serial, ["shell", "getprop", "ro.product.model"]).trim();
const coldLaunchMs = Number(launch.match(/TotalTime:\s*(\d+)/)?.[1] ?? -1);
const versionName = packageDump.match(/versionName=([^\s]+)/)?.[1] ?? "unknown";
const apkBytes = readFileSync(apkPath);
const evidence = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  scope: "install-and-cold-launch",
  launchGateEligible: false,
  device: {
    kind: isEmulator ? "emulator" : "physical",
    model,
    androidRelease: release,
    apiLevel
  },
  app: {
    applicationId: "tv.swarmcast",
    versionName,
    rlncEnabled,
    apkSha256: sha256(apkBytes)
  },
  checks: {
    install: "passed",
    coldLaunch: "passed",
    processAlive: "passed",
    foregroundActivity: "passed",
    fatalExceptionOrAnr: "none",
    coldLaunchMs
  },
  artifacts: screenshotPath ? {
    screenshot: screenshotPath.replace(`${process.cwd()}/`, ""),
    screenshotSha256
  } : {},
  limitations: [
    "This smoke does not prove backend connectivity, playback, WebRTC transfer, battery use, accessibility, or store readiness.",
    ...(isEmulator ? ["Emulator results do not satisfy physical-device launch gates."] : [])
  ]
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
}
process.stdout.write(serialized);
