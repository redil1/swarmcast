import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { edgeMetricsFromText, formatEdgeMetrics } from "./edge-cache-log-metrics.js";

const sample = [
  {
    ts: "2026-07-05T00:00:00+00:00",
    host: "edge.example.tv",
    uri: "/live/news/seg_0001.m4s",
    status: 200,
    bytes: 1000,
    cache: "MISS",
    request_time: 0.050,
    upstream_response_time: "0.040",
    upstream_status: "200"
  },
  {
    ts: "2026-07-05T00:00:01+00:00",
    host: "edge.example.tv",
    uri: "/live/news/seg_0001.m4s",
    status: 200,
    bytes: 1000,
    cache: "HIT",
    request_time: 0.005,
    upstream_response_time: "-",
    upstream_status: "-"
  },
  {
    ts: "2026-07-05T00:00:02+00:00",
    host: "edge.example.tv",
    uri: "/live/news/seg_0002.m4s",
    status: 502,
    bytes: 120,
    cache: "MISS",
    request_time: 0.090,
    upstream_response_time: "0.080",
    upstream_status: "502"
  }
].map((entry) => JSON.stringify(entry)).join("\n");

const metrics = edgeMetricsFromText(sample);
assert.equal(metrics.requests, 3);
assert.equal(metrics.hits, 1);
assert.equal(metrics.cacheable, 3);
assert.equal(metrics.hitRatio, 1 / 3);
assert.equal(metrics.egressBytes, 2120);
assert.equal(metrics.originFillBytes, 1120);
assert.equal(metrics.errors, 1);
assert.equal(metrics.upstreamResponseTimeCount, 2);

const output = formatEdgeMetrics(metrics);
assert.match(output, /swarmcast_edge_cache_hit_ratio 0\.3333333333333333/);
assert.match(output, /swarmcast_edge_requests_by_cache_total\{cache="HIT"\} 1/);
assert.match(output, /swarmcast_edge_requests_by_cache_total\{cache="MISS"\} 2/);
assert.match(output, /swarmcast_edge_errors_total 1/);
assert.doesNotMatch(output, /seg_0001|edge\.example\.tv/);

const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-edge-metrics-"));
writeFileSync(path.join(dir, "edge-access.log"), `${sample}\n`);

console.log(`edge cache metrics smoke OK: requests=${metrics.requests} hitRatio=${metrics.hitRatio.toFixed(3)} originFillBytes=${metrics.originFillBytes}`);
