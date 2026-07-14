import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SQLiteCatalogStore } from "../src/sqliteCatalogStore.js";

const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="news-a" group-title="News" tvg-logo="https://logo/news.png",Alpha News
https://source.example/alpha.m3u8
#EXTINF:-1 tvg-id="sports-a" group-title="Sports",Beta Sports
https://source.example/beta.m3u8
#EXTINF:-1 tvg-id="news-b" group-title="News",Gamma News
https://source.example/gamma.m3u8
`;

test("SQLiteCatalogStore persists sanitized catalog data", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-catalog-db-"));
  const filePath = path.join(dir, "catalog.sqlite");
  try {
    const imported = await SQLiteCatalogStore.fromM3uText(filePath, m3u, {
      sourcePolicy: { allowedHosts: ["source.example"], allowPrivateNetworks: false }
    });
    const importPage = imported.list({ pageSize: 10 });
    assert.equal(importPage.total, 3);
    assert.equal("sourceUrl" in imported.channels[0], false);
    imported.close();

    const restored = await SQLiteCatalogStore.fromDatabaseFile(filePath);
    const page = restored.list({ q: "news", pageSize: 10 });
    assert.equal(page.total, 2);
    assert.deepEqual(restored.listGroups().groups, ["News", "Sports"]);
    assert.equal(page.etag, importPage.etag);

    const columns = restored.database.prepare("PRAGMA table_info(catalog_channels)").all().map((column) => column.name);
    assert.deepEqual(columns, ["id", "name", "group_name", "logo", "tvg_id"]);
    assert.equal(restored.database.prepare("SELECT value FROM catalog_metadata WHERE key = ?").get("channelCount").value, "3");
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
