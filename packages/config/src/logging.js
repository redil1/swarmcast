export const LOG_LEVELS = Object.freeze(["debug", "info", "warn", "error"]);

export const LOG_SERVICES = Object.freeze([
  "auth",
  "ingest",
  "tracker",
  "control-plane",
  "retention-worker",
  "edge",
  "android"
]);

export const LOG_CONTEXT_FIELDS = Object.freeze([
  "request_id",
  "channel_id",
  "peer_id",
  "segment_seq",
  "node_id",
  "swarm_id",
  "error_class"
]);

const FIELD_ALIASES = Object.freeze({
  requestId: "request_id",
  channelId: "channel_id",
  peerId: "peer_id",
  segmentSeq: "segment_seq",
  nodeId: "node_id",
  swarmId: "swarm_id",
  errorClass: "error_class"
});

const SENSITIVE_FIELDS = new Set([
  "authorization",
  "cookie",
  "set_cookie",
  "jwt",
  "token",
  "app_api_key",
  "internal_token",
  "private_key",
  "signing_key",
  "source_url",
  "sourceurl",
  "upstream_source_url",
  "upstreamsourceurl",
  "password",
  "secret"
]);

function normalizeFieldName(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isSensitiveField(key) {
  const normalized = normalizeFieldName(key);
  return (
    SENSITIVE_FIELDS.has(normalized) ||
    normalized.endsWith("_token") ||
    normalized.endsWith("_secret") ||
    normalized.endsWith("_credential") ||
    normalized.endsWith("_credentials")
  );
}

export function sanitizeLogFields(value, key = "") {
  if (value === undefined) return undefined;
  if (isSensitiveField(key)) return "[redacted]";
  if (value instanceof Error) return { name: value.name };
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => sanitizeLogFields(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeLogFields(entryValue, entryKey)])
        .filter(([, entryValue]) => entryValue !== undefined)
    );
  }
  return value;
}

function normalizeFields(fields) {
  const normalized = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined) continue;
    normalized[FIELD_ALIASES[key] || key] = sanitizeLogFields(value, key);
  }
  return normalized;
}

export function createLogRecord({ service, level = "info", event, msg = "", ...fields }, { now = () => new Date() } = {}) {
  if (!LOG_SERVICES.includes(service)) throw new Error(`invalid log service: ${service}`);
  if (!LOG_LEVELS.includes(level)) throw new Error(`invalid log level: ${level}`);
  if (!event || typeof event !== "string") throw new Error("log event is required");

  const normalized = normalizeFields(fields);
  const record = {
    ts: now().toISOString(),
    level,
    service,
    event
  };

  for (const field of LOG_CONTEXT_FIELDS) {
    record[field] = normalized[field] ?? null;
    delete normalized[field];
  }

  for (const [key, value] of Object.entries(normalized)) {
    record[key] = value;
  }

  record.msg = String(msg || "");
  return record;
}

export function createLogger({ service, sink = process.stdout, now = () => new Date(), defaults = {} }) {
  const write = (record) => {
    const line = `${JSON.stringify(record)}\n`;
    if (typeof sink === "function") sink(line);
    else sink.write(line);
  };

  const emit = (level, event, fields = {}, msg = "") => {
    if (typeof fields === "string") {
      msg = fields;
      fields = {};
    }
    const record = createLogRecord({ service, level, event, ...defaults, ...fields, msg }, { now });
    write(record);
    return record;
  };

  return Object.freeze({
    debug: (event, fields, msg) => emit("debug", event, fields, msg),
    info: (event, fields, msg) => emit("info", event, fields, msg),
    warn: (event, fields, msg) => emit("warn", event, fields, msg),
    error: (event, fields, msg) => emit("error", event, fields, msg)
  });
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value ? String(value) : "";
}

function sanitizedPath(rawUrl) {
  try {
    return new URL(rawUrl || "/", "http://swarmcast.local").pathname || "/";
  } catch {
    return "/invalid";
  }
}

export function logHttpRequest(req, res, logger, { event = "http_request_completed" } = {}) {
  if (!logger) return;
  const startedAt = process.hrtime.bigint();
  const requestId = firstHeaderValue(req.headers?.["x-request-id"]) ||
    firstHeaderValue(req.headers?.["x-correlation-id"]) ||
    null;

  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const statusCode = Number(res.statusCode || 0);
    logger.info(event, {
      request_id: requestId,
      method: req.method || "",
      path: sanitizedPath(req.url),
      status_code: statusCode,
      duration_ms: Number(durationMs.toFixed(3)),
      error_class: statusCode >= 500 ? "server_error" : statusCode >= 400 ? "client_error" : null
    }, "http request completed");
  });
}
