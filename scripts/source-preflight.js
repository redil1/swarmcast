import { readFileSync } from "node:fs";
import { ENV_DEFAULTS, intEnv, sourcePolicyFromEnv, stringEnv } from "../packages/config/src/env.js";
import { parseM3u } from "../services/ingest/src/catalog.js";

const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_MAX_CONCURRENCY = 8;

function timeoutSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

function publicErrorName(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "timeout";
  return error?.name || "fetch_error";
}

async function closeBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Best effort: preflight only needs status and headers.
  }
}

async function probeSource(sourceUrl, { fetchImpl, timeoutMs }) {
  let response = await fetchImpl(sourceUrl, {
    method: "HEAD",
    signal: timeoutSignal(timeoutMs)
  });
  await closeBody(response);

  if (response.status === 405) {
    response = await fetchImpl(sourceUrl, {
      method: "GET",
      headers: { range: "bytes=0-0" },
      signal: timeoutSignal(timeoutMs)
    });
    await closeBody(response);
    return { method: "GET", status: response.status, ok: response.status >= 200 && response.status < 400 };
  }

  return { method: "HEAD", status: response.status, ok: response.status >= 200 && response.status < 400 };
}

export async function preflightChannelSource(channel, {
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  try {
    const result = await probeSource(channel.sourceUrl, { fetchImpl, timeoutMs });
    return {
      channelId: channel.id,
      name: channel.name,
      group: channel.group,
      ...result
    };
  } catch (error) {
    return {
      channelId: channel.id,
      name: channel.name,
      group: channel.group,
      method: "HEAD",
      status: 0,
      ok: false,
      error: publicErrorName(error)
    };
  }
}

export async function preflightCatalogSources(channels, {
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxConcurrency = DEFAULT_MAX_CONCURRENCY
} = {}) {
  const entries = [...channels.values()];
  const results = new Array(entries.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(maxConcurrency, entries.length || 1));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < entries.length) {
      const index = next;
      next += 1;
      results[index] = await preflightChannelSource(entries[index], { fetchImpl, timeoutMs });
    }
  }));

  const failed = results.filter((result) => !result.ok);
  return {
    total: results.length,
    healthy: results.length - failed.length,
    failed: failed.length,
    results
  };
}

export async function preflightM3uFile(m3uPath, options = {}) {
  const channels = parseM3u(m3uPath, { sourcePolicy: options.sourcePolicy });
  return preflightCatalogSources(channels, options);
}

export function formatSourcePreflightSummary(summary) {
  const lines = [
    `source preflight summary: total=${summary.total} healthy=${summary.healthy} failed=${summary.failed}`
  ];
  for (const result of summary.results.filter((item) => !item.ok).slice(0, 20)) {
    const reason = result.error || `status_${result.status}`;
    lines.push(`source preflight failed: channel=${result.channelId} name=${result.name} method=${result.method} reason=${reason}`);
  }
  return lines.join("\n");
}

async function main() {
  const m3uPath = stringEnv(process.env, "M3U_PATH", ENV_DEFAULTS.M3U_PATH);
  const sourcePolicy = sourcePolicyFromEnv(process.env, { requireAllowedHosts: true });
  const timeoutMs = intEnv(process.env, "SOURCE_PREFLIGHT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, { min: 100, max: 60_000 });
  const maxConcurrency = intEnv(process.env, "SOURCE_PREFLIGHT_MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY, { min: 1, max: 256 });

  readFileSync(m3uPath, "utf8");
  const summary = await preflightM3uFile(m3uPath, { sourcePolicy, timeoutMs, maxConcurrency });
  const output = formatSourcePreflightSummary(summary);
  if (summary.failed > 0) {
    console.error(output);
    process.exit(1);
  }
  console.log(output);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`source preflight failed: ${error.message}`);
    process.exit(1);
  });
}
