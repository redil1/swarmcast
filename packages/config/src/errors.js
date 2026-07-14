export const ERROR_CODES = Object.freeze({
  CAPACITY: "capacity",
  NOT_FOUND: "not_found",
  UNKNOWN_CHANNEL: "unknown_channel",
  UNAUTHORIZED: "unauthorized",
  SOURCE_UNAVAILABLE: "source_unavailable",
  EDGE_UNAVAILABLE: "edge_unavailable",
  TRACKER_UNAVAILABLE: "tracker_unavailable",
  RATE_LIMITED: "rate_limited",
  BAD_MESSAGE: "bad_message",
  PLACEMENT_FAILED: "placement_failed",
  POISONED_SEGMENT: "poisoned_segment",
  CONFIG_INVALID: "config_invalid"
});

export const CLIENT_VISIBLE_ERROR_CODES = Object.freeze([
  ERROR_CODES.CAPACITY,
  ERROR_CODES.NOT_FOUND,
  ERROR_CODES.UNKNOWN_CHANNEL,
  ERROR_CODES.UNAUTHORIZED,
  ERROR_CODES.SOURCE_UNAVAILABLE,
  ERROR_CODES.EDGE_UNAVAILABLE,
  ERROR_CODES.TRACKER_UNAVAILABLE,
  ERROR_CODES.RATE_LIMITED
]);

export const HTTP_STATUS_BY_ERROR = Object.freeze({
  [ERROR_CODES.CAPACITY]: 503,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.UNKNOWN_CHANNEL]: 404,
  [ERROR_CODES.UNAUTHORIZED]: 401,
  [ERROR_CODES.SOURCE_UNAVAILABLE]: 502,
  [ERROR_CODES.EDGE_UNAVAILABLE]: 503,
  [ERROR_CODES.TRACKER_UNAVAILABLE]: 503,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.BAD_MESSAGE]: 400,
  [ERROR_CODES.PLACEMENT_FAILED]: 503,
  [ERROR_CODES.POISONED_SEGMENT]: 422,
  [ERROR_CODES.CONFIG_INVALID]: 500
});

export function isClientVisibleError(code) {
  return CLIENT_VISIBLE_ERROR_CODES.includes(code);
}

export function publicError(code, message = "") {
  const safeCode = Object.values(ERROR_CODES).includes(code) ? code : ERROR_CODES.CONFIG_INVALID;
  return {
    error: safeCode,
    message: isClientVisibleError(safeCode) ? message : ""
  };
}

export function httpStatusForError(code) {
  return HTTP_STATUS_BY_ERROR[code] || 500;
}
