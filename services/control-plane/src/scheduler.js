import { createHash } from "node:crypto";

export class IngestScheduler {
  constructor(nodes, perNodeCap = 140) {
    this.nodes = nodes.map((node) => ({ load: 0, ...node }));
    this.perNodeCap = perNodeCap;
    this.placement = new Map();
  }

  hashRank(channelId) {
    return this.nodes
      .map((node) => ({
        node,
        hash: createHash("sha1").update(`${channelId}:${node.id}`).digest().readUInt32BE(0)
      }))
      .sort((a, b) => a.hash - b.hash)
      .map((entry) => entry.node);
  }

  assign(channelId) {
    const existing = this.placement.get(channelId);
    if (existing) return this.nodes.find((node) => node.id === existing) || null;

    for (const node of this.hashRank(channelId)) {
      if (node.load < this.perNodeCap) {
        node.load += 1;
        this.placement.set(channelId, node.id);
        return node;
      }
    }

    return null;
  }

  release(channelId) {
    const nodeId = this.placement.get(channelId);
    if (!nodeId) return;
    const node = this.nodes.find((candidate) => candidate.id === nodeId);
    if (node) node.load = Math.max(0, node.load - 1);
    this.placement.delete(channelId);
  }

  originUrlFor(channelId) {
    const node = this.assign(channelId);
    return node ? `${node.baseUrl}/live/${channelId}` : null;
  }
}
