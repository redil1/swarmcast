import { mkdirSync } from "node:fs";
import path from "node:path";
import { parseM3uText, publicChannel } from "../../ingest/src/catalog.js";
import { CatalogStore } from "./catalogStore.js";

const schemaSql = `
CREATE TABLE IF NOT EXISTS catalog_channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  logo TEXT NOT NULL DEFAULT '',
  tvg_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS catalog_channels_group_idx ON catalog_channels(group_name);
CREATE INDEX IF NOT EXISTS catalog_channels_name_idx ON catalog_channels(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS catalog_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

async function openDatabase(filePath) {
  const { DatabaseSync } = await import("node:sqlite");
  if (filePath !== ":memory:") {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }
  return new DatabaseSync(filePath);
}

function rowToChannel(row) {
  return {
    id: row.id,
    name: row.name,
    group: row.group_name,
    logo: row.logo,
    tvgId: row.tvg_id
  };
}

export class SQLiteCatalogStore extends CatalogStore {
  constructor(database, filePath) {
    super([], { backend: "sqlite" });
    this.database = database;
    this.filePath = filePath;
    this.database.exec(schemaSql);
    this.loadFromDatabase();
  }

  static async fromDatabaseFile(filePath) {
    return new SQLiteCatalogStore(await openDatabase(filePath), filePath);
  }

  static async fromM3uText(filePath, text, options = {}) {
    const store = await SQLiteCatalogStore.fromDatabaseFile(filePath);
    store.replace([...parseM3uText(text, options).values()]);
    return store;
  }

  loadFromDatabase() {
    const rows = this.database
      .prepare("SELECT id, name, group_name, logo, tvg_id FROM catalog_channels ORDER BY name, id")
      .all();
    super.replace(rows.map(rowToChannel));
  }

  replace(channels) {
    const safeChannels = channels.map(publicChannel);
    super.replace(safeChannels);
    if (this.database) this.persist();
  }

  persist() {
    const insertChannel = this.database.prepare(`
      INSERT INTO catalog_channels (id, name, group_name, logo, tvg_id)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertMetadata = this.database.prepare(`
      INSERT INTO catalog_metadata (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM catalog_channels").run();
      for (const channel of this.channels) {
        insertChannel.run(channel.id, channel.name, channel.group || "", channel.logo || "", channel.tvgId || "");
      }
      insertMetadata.run("schemaVersion", "1");
      insertMetadata.run("etag", this.etag);
      insertMetadata.run("channelCount", String(this.channels.length));
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}
