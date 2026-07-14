import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { edgeMetricsFromText, formatEdgeMetrics } from "./edge-cache-log-metrics.js";

const DEFAULT_PORT = 9101;
const DEFAULT_LOG_PATH = "/var/log/nginx/edge-access.log";

export function createEdgeMetricsServer({
  logPath = process.env.EDGE_ACCESS_LOG || DEFAULT_LOG_PATH,
  now = () => Date.now()
} = {}) {
  let lastReadOk = false;
  let lastReadError = "";
  let lastScrapeMs = 0;

  function readMetrics() {
    lastScrapeMs = now();
    if (!existsSync(logPath)) {
      lastReadOk = false;
      lastReadError = "log_missing";
      return formatEdgeMetrics(edgeMetricsFromText(""));
    }

    try {
      const text = readFileSync(logPath, "utf8");
      lastReadOk = true;
      lastReadError = "";
      return formatEdgeMetrics(edgeMetricsFromText(text));
    } catch {
      lastReadOk = false;
      lastReadError = "log_read_failed";
      return formatEdgeMetrics(edgeMetricsFromText(""));
    }
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://edge-metrics.local");
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(lastReadOk || lastScrapeMs === 0 ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: lastReadOk || lastScrapeMs === 0,
        lastScrapeMs,
        error: lastReadError || null
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      const body = readMetrics();
      res.writeHead(lastReadOk ? 200 : 503, {
        "content-type": "text/plain; version=0.0.4; charset=utf-8"
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not_found"}');
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number.parseInt(process.env.EDGE_METRICS_PORT || String(DEFAULT_PORT), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("EDGE_METRICS_PORT must be a valid TCP port");
  }
  const server = createEdgeMetricsServer();
  server.listen(port, () => {
    console.log(`edge cache metrics exporter listening on ${port}`);
  });
}
