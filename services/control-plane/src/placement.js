import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { IngestScheduler } from "./scheduler.js";

export class PlacementRegistry {
  constructor({ filePath = null, backend = filePath ? "file" : "memory" } = {}) {
    this.filePath = filePath;
    this.backend = backend;
    this.map = new Map();
    if (filePath && existsSync(filePath)) {
      const rows = JSON.parse(readFileSync(filePath, "utf8"));
      this.map = new Map(rows.map((row) => [row.channelId, row.nodeId]));
    }
  }

  get(channelId) {
    return this.map.get(channelId) || null;
  }

  set(channelId, nodeId) {
    this.map.set(channelId, nodeId);
    this.save();
  }

  delete(channelId) {
    const deleted = this.map.delete(channelId);
    this.save();
    return deleted;
  }

  entries() {
    return [...this.map.entries()].map(([channelId, nodeId]) => ({ channelId, nodeId }));
  }

  save() {
    if (!this.filePath) return;
    writeFileSync(this.filePath, JSON.stringify(this.entries(), null, 2));
  }
}

export class PlacementService {
  constructor({ nodes, perNodeCap = 140, registry = new PlacementRegistry() }) {
    this.nodes = nodes;
    this.registry = registry;
    this.scheduler = new IngestScheduler(nodes, perNodeCap);

    for (const { channelId, nodeId } of registry.entries()) {
      const node = this.scheduler.nodes.find((candidate) => candidate.id === nodeId);
      if (node) {
        node.load += 1;
        this.scheduler.placement.set(channelId, nodeId);
      }
    }
  }

  assign(channelId) {
    const existingNodeId = this.registry.get(channelId);
    if (existingNodeId) {
      const node = this.scheduler.nodes.find((candidate) => candidate.id === existingNodeId);
      if (node) return { channelId, node };
    }

    const node = this.scheduler.assign(channelId);
    if (!node) return null;
    this.registry.set(channelId, node.id);
    return { channelId, node };
  }

  get(channelId) {
    const nodeId = this.registry.get(channelId);
    if (!nodeId) return null;
    const node = this.scheduler.nodes.find((candidate) => candidate.id === nodeId);
    return node ? { channelId, node } : null;
  }

  release(channelId) {
    this.scheduler.release(channelId);
    return this.registry.delete(channelId);
  }
}

export function publicPlacement(placement) {
  if (!placement) return null;
  return {
    channelId: placement.channelId,
    node: {
      id: placement.node.id,
      baseUrl: placement.node.baseUrl,
      ...(placement.node.ingestUrl ? { ingestUrl: placement.node.ingestUrl } : {})
    }
  };
}
