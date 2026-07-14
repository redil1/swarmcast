import { performance } from "node:perf_hooks";
import { CatalogStore } from "../services/control-plane/src/catalogStore.js";

const CHANNELS = 20_000;
const groups = ["News", "Sports", "Movies", "Kids", "Documentary", "Music", "International", "Local"];

let m3u = "#EXTM3U\n";
for (let i = 0; i < CHANNELS; i += 1) {
  const group = groups[i % groups.length];
  const padded = String(i).padStart(5, "0");
  const name = i === 19_999 ? "Needle Sports Ultra" : `${group} Channel ${padded}`;
  m3u += `#EXTINF:-1 tvg-id="ch-${padded}" group-title="${group}" tvg-logo="https://logo.example/${padded}.png",${name}\n`;
  m3u += `https://source.example/${padded}/index.m3u8\n`;
}

const importStart = performance.now();
const store = CatalogStore.fromM3uText(m3u);
const importMs = performance.now() - importStart;

const pageStart = performance.now();
const firstPage = store.list({ page: 1, pageSize: 50 });
const pageMs = performance.now() - pageStart;

const searchStart = performance.now();
const search = store.list({ q: "Needle Sports Ultra", page: 1, pageSize: 10 });
const searchMs = performance.now() - searchStart;

const groupStart = performance.now();
const sports = store.list({ group: "Sports", page: 1, pageSize: 50 });
const groupMs = performance.now() - groupStart;

if (firstPage.items.length !== 50 || firstPage.total !== CHANNELS) {
  throw new Error("first page returned wrong size or total");
}
if (firstPage.items.some((item) => "sourceUrl" in item)) {
  throw new Error("public catalog leaked sourceUrl");
}
if (search.total !== 1 || search.items[0].name !== "Needle Sports Ultra") {
  throw new Error("search did not find expected channel");
}
if (sports.total !== CHANNELS / groups.length) {
  throw new Error(`group filter returned wrong total: ${sports.total}`);
}
if (searchMs > 100) {
  throw new Error(`20K search exceeded 100 ms budget: ${searchMs.toFixed(2)} ms`);
}

console.log([
  "catalog 20K smoke OK:",
  `import=${importMs.toFixed(2)}ms`,
  `page=${pageMs.toFixed(2)}ms`,
  `search=${searchMs.toFixed(2)}ms`,
  `group=${groupMs.toFixed(2)}ms`
].join(" "));
