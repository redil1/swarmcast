import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_VISIBLE_ERROR_CODES,
  ERROR_CODES,
  httpStatusForError,
  isClientVisibleError,
  publicError
} from "../src/errors.js";

test("error taxonomy includes required launch codes", () => {
  for (const code of [
    "capacity",
    "not_found",
    "unknown_channel",
    "unauthorized",
    "source_unavailable",
    "edge_unavailable",
    "tracker_unavailable"
  ]) {
    assert.equal(Object.values(ERROR_CODES).includes(code), true);
  }
});

test("client-visible allowlist hides internal messages", () => {
  assert.equal(isClientVisibleError(ERROR_CODES.CAPACITY), true);
  assert.equal(isClientVisibleError(ERROR_CODES.CONFIG_INVALID), false);
  assert.deepEqual(publicError(ERROR_CODES.CONFIG_INVALID, "secret path leaked"), {
    error: "config_invalid",
    message: ""
  });
  assert.deepEqual(publicError(ERROR_CODES.UNKNOWN_CHANNEL, "Channel is not available"), {
    error: "unknown_channel",
    message: "Channel is not available"
  });
});

test("HTTP status mapping covers public error codes", () => {
  for (const code of CLIENT_VISIBLE_ERROR_CODES) {
    assert.equal(Number.isInteger(httpStatusForError(code)), true);
    assert.equal(httpStatusForError(code) >= 400, true);
  }
  assert.equal(httpStatusForError(ERROR_CODES.UNAUTHORIZED), 401);
  assert.equal(httpStatusForError(ERROR_CODES.RATE_LIMITED), 429);
  assert.equal(httpStatusForError(ERROR_CODES.NOT_FOUND), 404);
  assert.equal(httpStatusForError("missing"), 500);
});
