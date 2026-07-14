const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LIST_PATH = "/retention/list";
const DEFAULT_APPLY_PATH = "/retention/apply";

function requiredEnv(env, key) {
  const value = env[key];
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${key} is required for the HTTP retention store`);
  }
  return String(value).trim();
}

function optionalEnv(env, key, fallback = "") {
  const value = env[key];
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return String(value).trim();
}

function timeoutMsFromEnv(env) {
  const raw = optionalEnv(env, "RETENTION_STORE_HTTP_TIMEOUT_MS", String(DEFAULT_TIMEOUT_MS));
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 100 || value > 120_000) {
    throw new Error("RETENTION_STORE_HTTP_TIMEOUT_MS must be an integer between 100 and 120000");
  }
  return value;
}

function endpoint(baseUrl, path) {
  return new URL(path, baseUrl);
}

async function postJson(url, body, { token, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      accept: "application/json",
      "content-type": "application/json"
    };
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`retention HTTP store ${url.pathname} returned ${response.status}`);
    }
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`retention HTTP store ${url.pathname} returned invalid JSON`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function isoDate(value, name) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a valid date`);
  return date.toISOString();
}

function minimalActionBody({ record, action, dryRun, now }) {
  if (!record.id) throw new Error("retention HTTP store records must include id");
  return {
    recordId: record.id,
    classId: record.classId,
    observedAt: record.observedAt,
    action,
    dryRun: Boolean(dryRun),
    now: isoDate(now, "now")
  };
}

export function createRetentionStore({ env = process.env, dryRun = true } = {}) {
  const baseUrl = requiredEnv(env, "RETENTION_STORE_HTTP_BASE_URL").replace(/\/+$/, "");
  const token = optionalEnv(env, "RETENTION_STORE_HTTP_TOKEN");
  const timeoutMs = timeoutMsFromEnv(env);
  const listUrl = endpoint(baseUrl, optionalEnv(env, "RETENTION_STORE_HTTP_LIST_PATH", DEFAULT_LIST_PATH));
  const applyUrl = endpoint(baseUrl, optionalEnv(env, "RETENTION_STORE_HTTP_APPLY_PATH", DEFAULT_APPLY_PATH));
  const options = { token, timeoutMs };

  return {
    async listRetentionRecords({ classId, rawCutoff, aggregateCutoff, now }) {
      const response = await postJson(listUrl, {
        classId,
        rawCutoff: isoDate(rawCutoff, "rawCutoff"),
        aggregateCutoff: isoDate(aggregateCutoff, "aggregateCutoff"),
        now: isoDate(now, "now"),
        dryRun: Boolean(dryRun)
      }, options);
      const records = Array.isArray(response) ? response : response?.records;
      if (!Array.isArray(records)) {
        throw new Error("retention HTTP store list response must be an array or { records }");
      }
      return records;
    },

    async applyRetentionAction({ record, action, now }) {
      if (dryRun) return;
      await postJson(applyUrl, minimalActionBody({
        record,
        action,
        dryRun,
        now
      }), options);
    }
  };
}
