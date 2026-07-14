import { readFileSync } from "node:fs";

const CACHE_STATUSES = new Set(["HIT", "MISS", "BYPASS", "EXPIRED", "STALE", "UPDATING", "REVALIDATED"]);

function numberValue(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusClass(status) {
  const numeric = Number.parseInt(status, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return "unknown";
  return `${Math.floor(numeric / 100)}xx`;
}

function parseUpstreamSeconds(value) {
  if (value === undefined || value === null || value === "" || value === "-") return 0;
  return String(value)
    .split(",")
    .map((part) => numberValue(part.trim(), 0))
    .reduce((sum, part) => sum + part, 0);
}

export function parseEdgeAccessLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed);
  const cache = String(parsed.cache || "NONE").toUpperCase();
  return {
    status: Number.parseInt(parsed.status, 10) || 0,
    statusClass: statusClass(parsed.status),
    bytes: Math.max(0, Number.parseInt(parsed.bytes, 10) || 0),
    cache,
    cacheable: CACHE_STATUSES.has(cache),
    requestTimeSeconds: numberValue(parsed.request_time, 0),
    upstreamResponseTimeSeconds: parseUpstreamSeconds(parsed.upstream_response_time),
    upstreamStatus: String(parsed.upstream_status || "")
  };
}

export function edgeMetricsFromLines(lines) {
  const metrics = {
    requests: 0,
    byCache: new Map(),
    byStatusClass: new Map(),
    hits: 0,
    cacheable: 0,
    egressBytes: 0,
    originFillBytes: 0,
    errors: 0,
    requestTimeSum: 0,
    upstreamResponseTimeSum: 0,
    upstreamResponseTimeCount: 0
  };

  for (const line of lines) {
    const entry = parseEdgeAccessLine(line);
    if (!entry) continue;

    metrics.requests += 1;
    metrics.byCache.set(entry.cache, (metrics.byCache.get(entry.cache) || 0) + 1);
    metrics.byStatusClass.set(entry.statusClass, (metrics.byStatusClass.get(entry.statusClass) || 0) + 1);
    metrics.egressBytes += entry.bytes;
    metrics.requestTimeSum += entry.requestTimeSeconds;

    if (entry.status >= 500) metrics.errors += 1;
    if (entry.cacheable) {
      metrics.cacheable += 1;
      if (entry.cache === "HIT") metrics.hits += 1;
      if (entry.cache !== "HIT") metrics.originFillBytes += entry.bytes;
    }
    if (entry.upstreamResponseTimeSeconds > 0) {
      metrics.upstreamResponseTimeSum += entry.upstreamResponseTimeSeconds;
      metrics.upstreamResponseTimeCount += 1;
    }
  }

  metrics.hitRatio = metrics.cacheable === 0 ? 0 : metrics.hits / metrics.cacheable;
  metrics.errorRate = metrics.requests === 0 ? 0 : metrics.errors / metrics.requests;
  return metrics;
}

function promLine(name, value, labels = {}) {
  const labelText = Object.entries(labels)
    .map(([key, labelValue]) => `${key}="${String(labelValue).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`)
    .join(",");
  return `${name}${labelText ? `{${labelText}}` : ""} ${value}`;
}

export function formatEdgeMetrics(metrics) {
  const lines = [
    promLine("swarmcast_edge_requests_total", metrics.requests),
    promLine("swarmcast_edge_cache_hit_ratio", metrics.hitRatio),
    promLine("swarmcast_edge_egress_bytes_total", metrics.egressBytes),
    promLine("swarmcast_edge_origin_fill_bytes_total", metrics.originFillBytes),
    promLine("swarmcast_edge_errors_total", metrics.errors),
    promLine("swarmcast_edge_error_rate", metrics.errorRate),
    promLine("swarmcast_edge_request_time_seconds_sum", metrics.requestTimeSum),
    promLine("swarmcast_edge_upstream_response_time_seconds_sum", metrics.upstreamResponseTimeSum),
    promLine("swarmcast_edge_upstream_response_time_seconds_count", metrics.upstreamResponseTimeCount)
  ];

  for (const [cache, count] of [...metrics.byCache.entries()].sort()) {
    lines.push(promLine("swarmcast_edge_requests_by_cache_total", count, { cache }));
  }
  for (const [status, count] of [...metrics.byStatusClass.entries()].sort()) {
    lines.push(promLine("swarmcast_edge_requests_by_status_class_total", count, { status_class: status }));
  }

  return `${lines.join("\n")}\n`;
}

export function edgeMetricsFromText(text) {
  return edgeMetricsFromLines(text.split(/\r?\n/));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const logPath = process.argv[2] || process.env.EDGE_ACCESS_LOG || "/var/log/nginx/edge-access.log";
  const metrics = edgeMetricsFromText(readFileSync(logPath, "utf8"));
  process.stdout.write(formatEdgeMetrics(metrics));
}
