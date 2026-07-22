import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { IpRateLimiter } from "./rateLimit.js";

const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
});
const STATIC_ROOT = fileURLToPath(new URL("../dist/", import.meta.url));

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function requestIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

async function upstreamJson(url, options, timeoutMs = 8_000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `upstream returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function safeCatalogQuery(searchParams) {
  const allowed = new URLSearchParams();
  for (const key of ["page", "pageSize", "q", "group"]) {
    const value = searchParams.get(key);
    if (value !== null) allowed.set(key, value.slice(0, key === "q" || key === "group" ? 160 : 8));
  }
  return allowed;
}

export function createWebServer({
  authBase = process.env.WEB_AUTH_BASE || "http://auth:7003",
  catalogBase = process.env.WEB_CATALOG_BASE || "http://control-plane:7010",
  appApiKey = process.env.APP_API_KEY,
  trackerUrl = process.env.WEB_TRACKER_URL,
  staticRoot = STATIC_ROOT,
  sessionLimiter = new IpRateLimiter(),
  fetchJson = upstreamJson
} = {}) {
  if (!appApiKey) throw new Error("APP_API_KEY is required");
  if (!/^wss:\/\//.test(trackerUrl || "")) throw new Error("WEB_TRACKER_URL must use wss://");

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://web.local");
    try {
      if (url.pathname === "/health" || url.pathname === "/ready") return json(res, 200, { ok: true });

      if (url.pathname === "/web-api/session" && req.method === "POST") {
        if (!sessionLimiter.allow(requestIp(req))) return json(res, 429, { error: "rate_limited", message: "Try again shortly." });
        const session = await fetchJson(`${authBase}/token`, {
          method: "POST",
          headers: { "x-app-key": appApiKey, "content-type": "application/json" },
          body: "{}"
        });
        return json(res, 200, { ...session, trackerUrl });
      }

      if ((url.pathname === "/web-api/channels" || url.pathname === "/web-api/groups") && req.method === "GET") {
        const path = url.pathname.endsWith("channels")
          ? `/channels?${safeCatalogQuery(url.searchParams)}`
          : "/groups";
        return json(res, 200, await fetchJson(`${catalogBase}${path}`, { headers: { accept: "application/json" } }));
      }

      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method_not_allowed" });
      const requested = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^[/\\]+/, "");
      if (!/^(index\.html|app\.js|styles\.css)$/.test(requested)) return json(res, 404, { error: "not_found" });
      const data = await readFile(join(staticRoot, requested));
      res.writeHead(200, {
        "content-type": MIME[extname(requested)] || "application/octet-stream",
        "cache-control": requested === "index.html" ? "no-cache" : "public, max-age=3600",
        "x-content-type-options": "nosniff"
      });
      if (req.method === "HEAD") res.end();
      else res.end(data);
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 502;
      json(res, status, { error: "service_unavailable", message: "The service is temporarily unavailable." });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number.parseInt(process.env.WEB_PORT || "7030", 10);
  const server = createWebServer();
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  server.listen(port, "0.0.0.0");
}
