import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { runLoadLadderProbe } from "./load-ladder-probe-runner.js";

const args = process.argv.slice(2);
const allowed = new Set(["--acknowledge-staging-load", "--allow-synthetic", "--driver", "--manifest", "--output"]);

function fail(message) {
  throw new Error(message);
}

function parseOptions() {
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!allowed.has(key)) fail(`unknown option ${key}`);
    if (options.has(key)) fail(`duplicate option ${key}`);
    if (key === "--acknowledge-staging-load" || key === "--allow-synthetic") {
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

try {
  const options = parseOptions();
  if (options.get("--acknowledge-staging-load") !== true) {
    fail("--acknowledge-staging-load is required because this command creates sustained WebRTC traffic");
  }
  const manifestPath = options.get("--manifest");
  const driverPath = options.get("--driver");
  const outputPath = options.get("--output");
  if (!manifestPath || !driverPath || !outputPath) {
    fail("Usage: node scripts/run-load-ladder-probe.js --acknowledge-staging-load --manifest <probe.json> --driver <executable> --output <raw.json> [--allow-synthetic]");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bundle = await runLoadLadderProbe({
    manifest,
    driverPath,
    allowSynthetic: options.get("--allow-synthetic") === true
  });
  writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  chmodSync(outputPath, 0o600);
  const probe = bundle.probes[0];
  console.log(`Load ladder probe OK: stage=${probe.stageId} generator=${probe.generatorId} peers=${probe.joinedPeers} crossHost=${probe.crossGeneratorEndpoints} synthetic=${probe.synthetic}`);
} catch (error) {
  console.error(`Load ladder probe failed: ${error.message}`);
  process.exit(1);
}
