import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseM3uText, publicChannel } from "../src/catalog.js";

function fixture(path) {
  return readFileSync(new URL(`../../../test-fixtures/${path}`, import.meta.url), "utf8");
}

test("sample m3u fixture parses into safe public channels", () => {
  const channels = [...parseM3uText(fixture("catalog/sample.m3u")).values()];

  assert.equal(channels.length, 2);
  assert.deepEqual(publicChannel(channels[0]), {
    id: channels[0].id,
    name: "Example News",
    logo: "https://img.example/news.png",
    group: "News",
    tvgId: "news.us"
  });
  assert.equal("sourceUrl" in publicChannel(channels[0]), false);
});

test("duplicates and malformed fixture ignores orphan URLs and overwrites duplicate source", () => {
  const channels = [...parseM3uText(fixture("catalog/duplicates-malformed.m3u")).values()];

  assert.equal(channels.length, 2);
  assert.equal(channels.some((channel) => channel.sourceUrl.includes("orphan")), false);
  assert.equal(channels.find((channel) => channel.sourceUrl.includes("duplicate")).name, "Duplicate Two Wins");
  assert.equal(channels.find((channel) => channel.group === "Kids").tvgId, "");
});
