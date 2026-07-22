import http from "node:http";
import { ERROR_CODES, httpStatusForError, publicError } from "@swarmcast/config/errors";
import { closeHttpServer, createServiceLifecycle } from "@swarmcast/config/lifecycle";
import { createLogger, logHttpRequest } from "@swarmcast/config/logging";
import { createSegmentPublisher } from "@swarmcast/segment-bus";
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

export function createIngestServer({
  cfg = config,
  catalog = parseM3u(cfg.m3uPath, { sourcePolicy: cfg.sourcePolicy }),
  manager,
  segmentPublisher = null,
  logger = null,
  isReady = () => true
} = {}) {
  const channelManager = manager || new ChannelManager({ catalog, config: cfg, logger });

  const server = http.createServer(async (req, res) => {
    logHttpRequest(req, res, logger);
    const url = new URL(req.url, "http://ingest.local");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/ready") {
      const ready = isReady();
      return sendJson(res, ready ? 200 : 503, { ok: ready });
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(formatIngestMetrics({
        ...ingestStats(channelManager),
        segmentBusPublished: segmentPublisher?.stats.published || 0,
        segmentBusDuplicates: segmentPublisher?.stats.duplicates || 0,
        segmentBusFailures: segmentPublisher?.stats.failures || 0,
        segmentBusHealthy: segmentPublisher ? segmentPublisher.isHealthy() : false
      }));
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
  const lifecycle = createServiceLifecycle({ service: "ingest", logger });
  const segmentPublisher = runtimeConfig.segmentBus.enabled
    ? await createSegmentPublisher({
      ...runtimeConfig.segmentBus,
      clientName: `swarmcast-ingest-${process.env.HOSTNAME || "local"}`
    })
    : null;
  const { server, catalog, manager } = createIngestServer({
    cfg: runtimeConfig,
    logger,
    segmentPublisher,
    isReady: () => lifecycle.isReady() && (!segmentPublisher || segmentPublisher.isHealthy())
  });
  const watcher = watchSegments({
    hlsRoot: runtimeConfig.hlsRoot,
    trackerInternalUrl: runtimeConfig.trackerInternalUrl,
    trackerInternalUrls: runtimeConfig.trackerInternalUrls,
    internalToken: runtimeConfig.internalToken,
    rlncK: runtimeConfig.rlncK,
    logger,
    publishSegment: segmentPublisher ? (segment) => segmentPublisher.publish(segment) : null,
    onSegment: (segment) => manager.recordSegment(segment.channelId, Date.now(), segment.seq)
  });

  const reapTimer = setInterval(() => manager.reapIdle(), 15_000);
  lifecycle.install(async () => {
    clearInterval(reapTimer);
    watcher.close();
    manager.stopAll();
    await segmentPublisher?.close();
    await closeHttpServer(server);
  });

  server.listen(runtimeConfig.restApiPort, () => {
    lifecycle.markReady();
    logger.info("service_started", {
      node_id: "ingest",
      port: runtimeConfig.restApiPort,
      catalog_channels: catalog.size
    }, "ingest listening");
  });
}
