import http from "node:http";
import { ERROR_CODES, httpStatusForError, publicError } from "@swarmcast/config/errors";
import { createLogger, logHttpRequest } from "@swarmcast/config/logging";
import { parseM3u, publicChannel } from "./catalog.js";
import { ChannelManager } from "./channelManager.js";
import { config, loadConfig } from "./config.js";
import { formatIngestMetrics, ingestStats } from "./metrics.js";
import { watchSegments } from "./segmentWatcher.js";

function sendJson(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function sendError(res, code, message = "") {
  return sendJson(res, httpStatusForError(code), publicError(code, message));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

export function createIngestServer({ cfg = config, catalog = parseM3u(cfg.m3uPath, { sourcePolicy: cfg.sourcePolicy }), manager, logger = null } = {}) {
  const channelManager = manager || new ChannelManager({ catalog, config: cfg, logger });

  const server = http.createServer(async (req, res) => {
    logHttpRequest(req, res, logger);
    const url = new URL(req.url, "http://ingest.local");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(formatIngestMetrics(ingestStats(channelManager)));
      return;
    }

    if (req.headers["x-internal-token"] !== cfg.internalToken) {
      return sendError(res, ERROR_CODES.UNAUTHORIZED, "unauthorized");
    }

    if (req.method === "GET" && url.pathname === "/channels") {
      return sendJson(res, 200, [...catalog.values()].map(publicChannel));
    }

    if (req.method === "POST" && parts[0] === "channels" && parts[2] === "demand") {
      const body = await readJsonBody(req);
      const demand = channelManager.demand(parts[1], {
        swarmSize: Number.parseInt(body.swarmSize || "0", 10) || 0
      });
      logger?.info("channel_demand_started", {
        channel_id: parts[1],
        swarm_size: Number.parseInt(body.swarmSize || "0", 10) || 0,
        error_class: demand.ok ? null : demand.error
      }, "channel demand handled");
      if (!demand.ok) return sendError(res, demand.error, demand.error);
      return sendJson(res, 200, demand);
    }

    if (req.method === "GET" && parts[0] === "channels" && parts[2] === "status") {
      return sendJson(res, 200, channelManager.status(parts[1]));
    }

    return sendError(res, ERROR_CODES.NOT_FOUND, "not found");
  });

  return { server, catalog, manager: channelManager };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtimeConfig = loadConfig(process.env, { requireSecrets: true });
  const logger = createLogger({ service: "ingest" });
  const { server, catalog, manager } = createIngestServer({ cfg: runtimeConfig, logger });
  const watcher = watchSegments({
    hlsRoot: runtimeConfig.hlsRoot,
    trackerInternalUrl: runtimeConfig.trackerInternalUrl,
    trackerInternalUrls: runtimeConfig.trackerInternalUrls,
    internalToken: runtimeConfig.internalToken,
    rlncK: runtimeConfig.rlncK,
    logger,
    onSegment: (segment) => manager.recordSegment(segment.channelId)
  });

  const reapTimer = setInterval(() => manager.reapIdle(), 15_000);
  const shutdown = () => {
    clearInterval(reapTimer);
    watcher.close();
    manager.stopAll();
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(runtimeConfig.restApiPort, () => {
    logger.info("service_started", {
      node_id: "ingest",
      port: runtimeConfig.restApiPort,
      catalog_channels: catalog.size
    }, "ingest listening");
  });
}
