import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runAndroidDeviceLab } from "./android-device-lab-runner.js";

const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith("--")) return null;
  return args[index + 1];
}

function has(name) {
  return args.includes(name);
}

const manifestPath = option("--manifest");
const outputPath = option("--output");
const adbCommand = option("--adb") || "adb";
const allowSynthetic = has("--allow-synthetic");

if (!manifestPath || !outputPath || !has("--acknowledge-physical-device-test")) {
  console.error("Usage: node scripts/run-android-device-lab.js --acknowledge-physical-device-test --manifest <manifest.json> --output <raw-evidence.json> [--adb adb] [--allow-synthetic]");
  process.exit(2);
}

function adb(serial, commandArgs, { binary = false } = {}) {
  const result = spawnSync(adbCommand, ["-s", serial, ...commandArgs], {
    encoding: binary ? null : "utf8",
    maxBuffer: 512 * 1024 * 1024,
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
    throw new Error(`ADB command failed for configured device: ${stderr || `exit ${result.status}`}`);
  }
  return result.stdout;
}

try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const record = await runAndroidDeviceLab({ manifest, allowSynthetic, adb });
  writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(outputPath, 0o600);
  console.log(`Android device lab OK: devices=${record.devices.length} samples=${record.devices.reduce((sum, device) => sum + device.samples.length, 0)} rho=${record.measured.offloadRatio.toFixed(6)} synthetic=${record.synthetic}`);
} catch (error) {
  console.error(`Android device lab failed: ${error.message}`);
  process.exit(1);
}
