import http from "node:http";
import { gzipSync } from "node:zlib";
import { ERROR_CODES, httpStatusForError, publicError } from "@swarmcast/config/errors";
import { logHttpRequest } from "@swarmcast/config/logging";
import { controlPlaneStats, formatControlPlaneMetrics } from "./metrics.js";

function acceptsGzip(req) {
  return String(req.headers["accept-encoding"] || "")
    .split(",")
    .map((part) => part.trim().toLowerCase().split(";")[0])
    .includes("gzip");
}

function json(req, res, code, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  const shouldGzip = acceptsGzip(req) && payload.length > 0;
  const responseBody = shouldGzip ? gzipSync(payload) : payload;
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "private, max-age=30",
    "content-length": responseBody.length,
    vary: "Accept-Encoding",
    ...(shouldGzip ? { "content-encoding": "gzip" } : {}),
    ...headers
  });
  res.end(responseBody);
}

function errorJson(req, res, code, message = "", headers = {}) {
  return json(req, res, httpStatusForError(code), publicError(code, message), headers);
}

export function createCatalogServer({ store, logger = null, isReady = () => true }) {
  if (!store) throw new Error("store is required");

  return http.createServer((req, res) => {
    logHttpRequest(req, res, logger);
    const url = new URL(req.url, "http://catalog.local");

    if (url.pathname === "/health") {
      return json(req, res, 200, { ok: true });
    }

    if (url.pathname === "/ready") {
      const ready = isReady();
      return json(req, res, ready ? 200 : 503, { ok: ready }, { "cache-control": "no-store" });
    }

    if (url.pathname === "/channels" && req.method === "GET") {
      const result = store.list({
        q: url.searchParams.get("q") || "",
        group: url.searchParams.get("group") || "",
        page: url.searchParams.get("page") || "1",
        pageSize: url.searchParams.get("pageSize") || "50"
      });

      if (req.headers["if-none-match"] === result.etag) {
        res.writeHead(304, { etag: result.etag });
        res.end();
        return;
      }

      return json(req, res, 200, {
        items: result.items,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        hasMore: result.hasMore
      }, { etag: result.etag });
    }

    if (url.pathname === "/groups" && req.method === "GET") {
      const result = store.listGroups();
      if (req.headers["if-none-match"] === result.etag) {
        res.writeHead(304, { etag: result.etag });
        res.end();
        return;
      }
      return json(req, res, 200, { groups: result.groups }, { etag: result.etag });
    }

    return errorJson(req, res, ERROR_CODES.NOT_FOUND, "not found", { "cache-control": "no-store" });
  });
}

export function createControlPlaneServer({
  store,
  placementService = null,
  internalToken = "",
  logger = null,
  isReady = () => true
}) {
  const catalogServer = createCatalogServer({ store, isReady });

  return http.createServer((req, res) => {
    logHttpRequest(req, res, logger);
    const url = new URL(req.url, "http://control-plane.local");
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] === "internal") {
      if (!internalToken || req.headers["x-internal-token"] !== internalToken) {
        return errorJson(req, res, ERROR_CODES.UNAUTHORIZED, "unauthorized", { "cache-control": "no-store" });
      }
      if (!placementService) {
        return errorJson(req, res, ERROR_CODES.TRACKER_UNAVAILABLE, "placement unavailable", { "cache-control": "no-store" });
      }

      const channelId = parts[2];
      if (parts[1] === "channels" && channelId && parts[3] === "assign" && req.method === "POST") {
        const placement = placementService.assign(channelId);
        if (!placement) return errorJson(req, res, ERROR_CODES.CAPACITY, "capacity", { "cache-control": "no-store" });
        return json(req, res, 200, publicPlacement(placement), { "cache-control": "no-store" });
      }

      if (parts[1] === "channels" && channelId && parts[3] === "placement" && req.method === "GET") {
        const placement = placementService.get(channelId);
        if (!placement) return errorJson(req, res, ERROR_CODES.NOT_FOUND, "not found", { "cache-control": "no-store" });
        return json(req, res, 200, publicPlacement(placement), { "cache-control": "no-store" });
      }

      if (parts[1] === "channels" && channelId && parts[3] === "placement" && req.method === "DELETE") {
        placementService.release(channelId);
        return json(req, res, 200, { ok: true }, { "cache-control": "no-store" });
      }
    }

    if (url.pathname === "/metrics" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(formatControlPlaneMetrics(controlPlaneStats({ store, placementService })));
      return;
    }

    catalogServer.emit("request", req, res);
  });
}

function publicPlacement(placement) {
  return {
    channelId: placement.channelId,
    node: {
      id: placement.node.id,
      baseUrl: placement.node.baseUrl,
      ...(placement.node.ingestUrl ? { ingestUrl: placement.node.ingestUrl } : {})
    }
  };
}
