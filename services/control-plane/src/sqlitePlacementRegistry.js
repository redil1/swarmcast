import { mkdirSync } from "node:fs";
import path from "node:path";
import { PlacementRegistry } from "./placement.js";

const schemaSql = `
CREATE TABLE IF NOT EXISTS channel_placements (
  channel_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS channel_placements_node_idx ON channel_placements(node_id);
`;

async function openDatabase(filePath) {
  const { DatabaseSync } = await import("node:sqlite");
  if (filePath !== ":memory:") {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }
  return new DatabaseSync(filePath);
}

export class SQLitePlacementRegistry extends PlacementRegistry {
  constructor(database, filePath) {
    super({ backend: "sqlite" });
    this.database = database;
    this.filePath = filePath;
    this.database.exec(schemaSql);
    this.upsertStatement = this.database.prepare(`
      INSERT INTO channel_placements (channel_id, node_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET node_id = excluded.node_id, updated_at = excluded.updated_at
    `);
    this.deleteStatement = this.database.prepare("DELETE FROM channel_placements WHERE channel_id = ?");
    this.loadFromDatabase();
  }

  static async open(filePath) {
    return new SQLitePlacementRegistry(await openDatabase(filePath), filePath);
  }

  loadFromDatabase() {
    const rows = this.database
      .prepare("SELECT channel_id, node_id FROM channel_placements ORDER BY channel_id")
      .all();
    this.map = new Map(rows.map((row) => [row.channel_id, row.node_id]));
  }

  set(channelId, nodeId) {
    this.map.set(channelId, nodeId);
    this.upsertStatement.run(channelId, nodeId, new Date().toISOString());
  }

  delete(channelId) {
    const deleted = this.map.delete(channelId);
    if (deleted) this.deleteStatement.run(channelId);
    return deleted;
  }

  save() {
    // SQLite writes are committed in set/delete.
  }

  close() {
    this.database.close();
  }
}
