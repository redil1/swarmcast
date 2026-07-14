import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CatalogStore } from "../src/catalogStore.js";

const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="news-a" group-title="News" tvg-logo="https://logo/news.png",Alpha News
https://source.example/alpha.m3u8
#EXTINF:-1 tvg-id="sports-a" group-title="Sports",Beta Sports
https://source.example/beta.m3u8
#EXTINF:-1 tvg-id="news-b" group-title="News",Gamma News
https://source.example/gamma.m3u8
`;

test("CatalogStore lists paginated public channels without source URLs", () => {
  const store = CatalogStore.fromM3uText(m3u);
  const page = store.list({ page: 1, pageSize: 2 });

  assert.equal(page.items.length, 2);
  assert.equal(page.total, 3);
  assert.equal(page.hasMore, true);
  assert.equal("sourceUrl" in page.items[0], false);
  assert.equal(typeof page.etag, "string");
});

test("CatalogStore filters by query and group", () => {
  const store = CatalogStore.fromM3uText(m3u);

  assert.equal(store.list({ q: "sports" }).items[0].name, "Beta Sports");
  const news = store.list({ group: "News", pageSize: 10 });
  assert.equal(news.total, 2);
  assert.deepEqual(news.items.map((item) => item.name), ["Alpha News", "Gamma News"]);
});

test("CatalogStore lists groups", () => {
  const store = CatalogStore.fromM3uText(m3u);
  assert.deepEqual(store.listGroups().groups, ["News", "Sports"]);
});

test("CatalogStore fromM3uText enforces source URL policy", () => {
  assert.equal(CatalogStore.fromM3uText(m3u, {
    sourcePolicy: { allowedHosts: ["source.example"], allowPrivateNetworks: false }
  }).list({ pageSize: 10 }).total, 3);

  assert.throws(() => CatalogStore.fromM3uText(m3u, {
    sourcePolicy: { allowedHosts: ["other.example"], allowPrivateNetworks: false }
  }), /SOURCE_ALLOWED_HOSTS/);
});

test("CatalogStore snapshot persists sanitized catalog", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-catalog-snapshot-"));
  const filePath = path.join(dir, "catalog.json");
  try {
    const store = CatalogStore.fromM3uText(m3u);
    store.saveSnapshot(filePath);
    const restored = CatalogStore.fromSnapshotFile(filePath);
    const page = restored.list({ pageSize: 10 });

    assert.equal(page.total, 3);
    assert.equal("sourceUrl" in page.items[0], false);
    assert.deepEqual(restored.listGroups().groups, ["News", "Sports"]);
    assert.equal(restored.etag, store.etag);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
