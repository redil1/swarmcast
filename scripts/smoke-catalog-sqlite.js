import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SQLiteCatalogStore } from "../services/control-plane/src/sqliteCatalogStore.js";

const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="news-a" group-title="News",Alpha News
https://source.example/alpha.m3u8
#EXTINF:-1 tvg-id="sports-a" group-title="Sports",Beta Sports
https://source.example/beta.m3u8
#EXTINF:-1 tvg-id="news-b" group-title="News",Gamma News
https://source.example/gamma.m3u8
`;

const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-catalog-sqlite-"));
const filePath = path.join(dir, "catalog.sqlite");

try {
  const imported = await SQLiteCatalogStore.fromM3uText(filePath, m3u, {
    sourcePolicy: { allowedHosts: ["source.example"], allowPrivateNetworks: false }
  });
  assert.equal(imported.channels.length, 3);
  assert.equal(imported.channels.some((channel) => "sourceUrl" in channel), false);
  imported.close();

  const restored = await SQLiteCatalogStore.fromDatabaseFile(filePath);
  assert.equal(restored.list({ pageSize: 10 }).total, 3);
  assert.equal(restored.list({ group: "News", pageSize: 10 }).total, 2);
  assert.deepEqual(restored.listGroups().groups, ["News", "Sports"]);
  const columns = restored.database.prepare("PRAGMA table_info(catalog_channels)").all().map((column) => column.name);
  assert.equal(columns.includes("sourceUrl"), false);
  restored.close();
  console.log("Catalog SQLite smoke OK: channels=3, groups=2, sourceUrls=0");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
