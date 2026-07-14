import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createLogger, createLogRecord, logHttpRequest, sanitizeLogFields } from "../src/logging.js";

test("createLogRecord emits required structured fields", () => {
  const record = createLogRecord({
    service: "tracker",
    level: "info",
    event: "tracker_joined",
    requestId: "req-1",
    channelId: "news",
    peerId: "peer-1",
    msg: "peer joined"
  }, {
    now: () => new Date("2026-07-05T00:00:00.000Z")
  });

  assert.deepEqual(record, {
    ts: "2026-07-05T00:00:00.000Z",
    level: "info",
    service: "tracker",
    event: "tracker_joined",
    request_id: "req-1",
    channel_id: "news",
    peer_id: "peer-1",
    segment_seq: null,
    node_id: null,
    swarm_id: null,
    error_class: null,
    msg: "peer joined"
  });
});

test("sanitizeLogFields redacts tokens, keys, and source URLs", () => {
  assert.deepEqual(sanitizeLogFields({
    token: "secret-token",
    appApiKey: "app-secret",
    sourceUrl: "https://source.example/live.m3u8",
    nested: { internalToken: "internal-secret", safe: "ok" }
  }), {
    token: "[redacted]",
    appApiKey: "[redacted]",
    sourceUrl: "[redacted]",
    nested: { internalToken: "[redacted]", safe: "ok" }
  });
});

test("createLogger writes newline-delimited JSON", () => {
  const lines = [];
  const logger = createLogger({
    service: "auth",
    sink: { write: (line) => lines.push(line) },
    now: () => new Date("2026-07-05T00:00:00.000Z")
  });

  const record = logger.warn("auth_verify_failed", { errorClass: "unauthorized" }, "verify failed");

  assert.equal(lines.length, 1);
  assert.equal(lines[0].endsWith("\n"), true);
  assert.deepEqual(JSON.parse(lines[0]), record);
  assert.equal(record.error_class, "unauthorized");
});

test("logHttpRequest emits sanitized completion records", () => {
  const lines = [];
  const logger = createLogger({
    service: "retention-worker",
    sink: { write: (line) => lines.push(line) },
    now: () => new Date("2026-07-05T00:00:00.000Z")
  });
  const res = new EventEmitter();
  res.statusCode = 204;

  logHttpRequest({
    method: "GET",
    url: "/verify?token=secret-token&sourceUrl=https://source.example/live.m3u8",
    headers: { "x-request-id": "req-1" }
  }, res, logger);
  res.emit("finish");

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.event, "http_request_completed");
  assert.equal(record.request_id, "req-1");
  assert.equal(record.path, "/verify");
  assert.equal(record.status_code, 204);
  assert.equal(record.error_class, null);
  assert.equal(JSON.stringify(record).includes("secret-token"), false);
  assert.equal(JSON.stringify(record).includes("source.example"), false);
});
