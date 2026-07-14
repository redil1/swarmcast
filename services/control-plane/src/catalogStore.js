import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseM3uText, publicChannel } from "../../ingest/src/catalog.js";

function normalizePage(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function byName(a, b) {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export class CatalogStore {
  constructor(channels = [], { backend = "memory" } = {}) {
    this.backend = backend;
    this.replace(channels);
  }

  static fromM3uText(text, options = {}) {
    return new CatalogStore([...parseM3uText(text, options).values()], { backend: "m3u" });
  }

  static fromSnapshotFile(filePath) {
    const snapshot = JSON.parse(readFileSync(filePath, "utf8"));
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.channels)) {
      throw new Error("catalog snapshot has unsupported schema");
    }
    for (const channel of snapshot.channels) {
      if (channel.sourceUrl) throw new Error("catalog snapshot must not contain sourceUrl");
    }
    return new CatalogStore(snapshot.channels, { backend: "snapshot" });
  }

  replace(channels) {
    this.channels = channels.map((channel) => ({ ...channel })).sort(byName);
    this.groups = [...new Set(this.channels.map((channel) => channel.group).filter(Boolean))].sort();
    this.etag = createHash("sha256")
      .update(JSON.stringify(this.channels.map(({ id, name, group, logo, tvgId }) => ({ id, name, group, logo, tvgId }))))
      .digest("hex");
  }

  list({ q = "", group = "", page = 1, pageSize = 50 } = {}) {
    const currentPage = normalizePage(page, 1);
    const size = Math.min(normalizePage(pageSize, 50), 200);
    const query = String(q).trim().toLowerCase();
    const wantedGroup = String(group).trim();

    let rows = this.channels;
    if (wantedGroup) rows = rows.filter((channel) => channel.group === wantedGroup);
    if (query) {
      rows = rows.filter((channel) =>
        channel.name.toLowerCase().includes(query) ||
        channel.group.toLowerCase().includes(query) ||
        channel.tvgId.toLowerCase().includes(query)
      );
    }

    const total = rows.length;
    const start = (currentPage - 1) * size;
    const items = rows.slice(start, start + size).map(publicChannel);

    return {
      items,
      page: currentPage,
      pageSize: size,
      total,
      hasMore: start + size < total,
      etag: this.etag
    };
  }

  listGroups() {
    return {
      groups: this.groups,
      etag: this.etag
    };
  }

  toSnapshot() {
    return {
      schemaVersion: 1,
      etag: this.etag,
      channels: this.channels.map(publicChannel)
    };
  }

  saveSnapshot(filePath) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(this.toSnapshot(), null, 2)}\n`);
    renameSync(tempPath, filePath);
  }
}
