import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const roots = ["scripts", "services", "packages"];
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (full.endsWith(".js")) files.push(full);
  }
}

for (const root of roots) walk(root);

let failed = false;
for (const file of files.sort()) {
  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (res.status !== 0) {
    failed = true;
    process.stderr.write(`${file}\n${res.stderr || res.stdout}\n`);
  }
}

if (failed) process.exit(1);
console.log(`Syntax OK: ${files.length} JavaScript files`);
