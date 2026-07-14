import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createCatalogServer } from "../services/control-plane/src/catalogServer.js";
import { SQLiteCatalogStore } from "../services/control-plane/src/sqliteCatalogStore.js";

const CHANNELS = 20_000;
const SEARCH_BUDGET_MS = 100;
const HTTP_BUDGET_MS = 100;
const IMPORT_BUDGET_MS = 5_000;
const groups = ["News", "Sports", "Movies", "Kids", "Documentary", "Music", "International", "Local"];

function generateM3u() {
  const lines = ["#EXTM3U"];
  for (let index = 0; index < CHANNELS; index += 1) {
    const group = groups[index % groups.length];
    const padded = String(index).padStart(5, "0");
    const name = index === CHANNELS - 1 ? "Needle Sports Ultra" : `${group} Channel ${padded}`;
    lines.push(`#EXTINF:-1 tvg-id="ch-${padded}" group-title="${group}" tvg-logo="https://logo.example/${padded}.png",${name}`);
    lines.push(`https://source.example/${padded}/index.m3u8`);
  }
  return `${lines.join("\n")}\n`;
}

async function jsonTimed(url) {
  const start = performance.now();
  const response = await fetch(url);
  const elapsedMs = performance.now() - start;
  if (response.status !== 200) throw new Error(`${url} returned ${response.status}`);
  return { body: await response.json(), elapsedMs };
}

function assertUnder(name, elapsedMs, budgetMs) {
  if (elapsedMs > budgetMs) {
    throw new Error(`${name} exceeded ${budgetMs} ms budget: ${elapsedMs.toFixed(2)} ms`);
  }
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-catalog-sqlite-20k-"));
const dbPath = path.join(dir, "catalog.sqlite");
let restored = null;
let server = null;

try {
  const importStart = performance.now();
  const imported = await SQLiteCatalogStore.fromM3uText(dbPath, generateM3u(), {
    sourcePolicy: { allowedHosts: ["source.example"], allowPrivateNetworks: false }
  });
  const importMs = performance.now() - importStart;
  if (imported.channels.some((channel) => "sourceUrl" in channel)) {
    throw new Error("SQLite catalog persisted sourceUrl in memory");
  }
  imported.close();
  assertUnder("sqlite 20K import", importMs, IMPORT_BUDGET_MS);

  const reloadStart = performance.now();
  restored = await SQLiteCatalogStore.fromDatabaseFile(dbPath);
  const reloadMs = performance.now() - reloadStart;
  if (restored.channels.length !== CHANNELS) throw new Error(`restored ${restored.channels.length} channels`);

  server = createCatalogServer({ store: restored });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  const firstPage = await jsonTimed(`${base}/channels?page=1&pageSize=50`);
  const search = await jsonTimed(`${base}/channels?q=${encodeURIComponent("Needle Sports Ultra")}&pageSize=10`);
  const sports = await jsonTimed(`${base}/channels?group=${encodeURIComponent("Sports")}&pageSize=50`);

  if (firstPage.body.items.length !== 50 || firstPage.body.total !== CHANNELS) {
    throw new Error("first page returned wrong size or total");
  }
  if (firstPage.body.items.some((item) => "sourceUrl" in item)) {
    throw new Error("public catalog leaked sourceUrl");
  }
  if (search.body.total !== 1 || search.body.items[0].name !== "Needle Sports Ultra") {
    throw new Error("search did not find expected channel");
  }
  if (sports.body.total !== CHANNELS / groups.length) {
    throw new Error(`group filter returned wrong total: ${sports.body.total}`);
  }

  assertUnder("sqlite HTTP first page", firstPage.elapsedMs, HTTP_BUDGET_MS);
  assertUnder("sqlite HTTP search", search.elapsedMs, SEARCH_BUDGET_MS);
  assertUnder("sqlite HTTP group filter", sports.elapsedMs, HTTP_BUDGET_MS);

  console.log([
    "catalog SQLite 20K HTTP smoke OK:",
    `import=${importMs.toFixed(2)}ms`,
    `reload=${reloadMs.toFixed(2)}ms`,
    `page=${firstPage.elapsedMs.toFixed(2)}ms`,
    `search=${search.elapsedMs.toFixed(2)}ms`,
    `group=${sports.elapsedMs.toFixed(2)}ms`
  ].join(" "));
} finally {
  if (server) await closeServer(server);
  if (restored) restored.close();
  rmSync(dir, { recursive: true, force: true });
}
