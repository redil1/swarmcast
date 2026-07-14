import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SQLiteCatalogStore } from "../services/control-plane/src/sqliteCatalogStore.js";
import { SQLitePlacementRegistry } from "../services/control-plane/src/sqlitePlacementRegistry.js";

const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="news-a" group-title="News",Alpha News
https://source.example/alpha.m3u8
#EXTINF:-1 tvg-id="sports-a" group-title="Sports",Beta Sports
https://source.example/beta.m3u8
#EXTINF:-1 tvg-id="news-b" group-title="News",Gamma News
https://source.example/gamma.m3u8
`;

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function backupAsset({ id, source, destination }) {
  copyFileSync(source, destination);
  return {
    id,
    kind: "sqlite",
    path: destination,
    bytes: statSync(destination).size,
    sha256: sha256File(destination)
  };
}

function verifyAsset(asset) {
  assert.equal(asset.sha256, sha256File(asset.path), `${asset.id} checksum mismatch`);
  assert.equal(asset.bytes, statSync(asset.path).size, `${asset.id} size mismatch`);
}

const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-sqlite-backup-"));
const sourceDir = path.join(dir, "source");
const backupDir = path.join(dir, "backup");
const restoreDir = path.join(dir, "restore");
mkdirSync(sourceDir);
mkdirSync(backupDir);
mkdirSync(restoreDir);

try {
  const catalogDb = path.join(sourceDir, "catalog.sqlite");
  const placementDb = path.join(sourceDir, "placements.sqlite");
  const catalog = await SQLiteCatalogStore.fromM3uText(catalogDb, m3u, {
    sourcePolicy: { allowedHosts: ["source.example"], allowPrivateNetworks: false }
  });
  catalog.close();

  const placements = await SQLitePlacementRegistry.open(placementDb);
  placements.set("alpha", "origin-a");
  placements.set("beta", "origin-b");
  placements.close();

  const manifest = {
    schemaVersion: 1,
    createdAt: "2026-07-05T00:00:00.000Z",
    assets: [
      backupAsset({
        id: "catalog-db",
        source: catalogDb,
        destination: path.join(backupDir, "catalog.sqlite")
      }),
      backupAsset({
        id: "placement-db",
        source: placementDb,
        destination: path.join(backupDir, "placements.sqlite")
      })
    ]
  };
  writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const asset of manifest.assets) verifyAsset(asset);

  const restoredCatalogDb = path.join(restoreDir, "catalog.sqlite");
  const restoredPlacementDb = path.join(restoreDir, "placements.sqlite");
  copyFileSync(path.join(backupDir, "catalog.sqlite"), restoredCatalogDb);
  copyFileSync(path.join(backupDir, "placements.sqlite"), restoredPlacementDb);

  const restoredCatalog = await SQLiteCatalogStore.fromDatabaseFile(restoredCatalogDb);
  assert.equal(restoredCatalog.list({ pageSize: 10 }).total, 3);
  assert.equal(restoredCatalog.channels.some((channel) => "sourceUrl" in channel), false);
  restoredCatalog.close();

  const restoredPlacements = await SQLitePlacementRegistry.open(restoredPlacementDb);
  assert.equal(restoredPlacements.get("alpha"), "origin-a");
  assert.equal(restoredPlacements.get("beta"), "origin-b");
  assert.equal(restoredPlacements.entries().length, 2);
  restoredPlacements.close();

  console.log("sqlite backup restore smoke OK: assets=2 catalogChannels=3 placements=2 checksums=valid");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
