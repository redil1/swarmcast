import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createEdgeMetricsServer } from "./edge-cache-metrics-server.js";

const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-edge-metrics-server-"));
const logPath = path.join(dir, "edge-access.log");
writeFileSync(logPath, [
  JSON.stringify({
    ts: "2026-07-05T00:00:00+00:00",
    host: "edge.example.tv",
    uri: "/live/news/seg_0001.m4s",
    status: 200,
    bytes: 2000,
    cache: "MISS",
    request_time: 0.040,
    upstream_response_time: "0.030",
    upstream_status: "200"
  }),
  JSON.stringify({
    ts: "2026-07-05T00:00:01+00:00",
    host: "edge.example.tv",
    uri: "/live/news/seg_0001.m4s",
    status: 200,
    bytes: 2000,
    cache: "HIT",
    request_time: 0.004,
    upstream_response_time: "-",
    upstream_status: "-"
  })
].join("\n"));

const server = createEdgeMetricsServer({ logPath, now: () => 1783209600000 });
server.listen(0, "127.0.0.1");
await once(server, "listening");

try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const firstHealth = await fetch(`${base}/health`);
  assert.equal(firstHealth.status, 200);

  const metrics = await fetch(`${base}/metrics`);
  assert.equal(metrics.status, 200);
  const text = await metrics.text();
  assert.match(text, /swarmcast_edge_cache_hit_ratio 0\.5/);
  assert.match(text, /swarmcast_edge_origin_fill_bytes_total 2000/);
  assert.doesNotMatch(text, /seg_0001|edge\.example\.tv/);

  const afterHealth = await fetch(`${base}/health`);
  assert.equal(afterHealth.status, 200);
  assert.equal((await afterHealth.json()).lastScrapeMs, 1783209600000);

  console.log("edge cache metrics server smoke OK: health=200 metrics=200 hitRatio=0.5");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
