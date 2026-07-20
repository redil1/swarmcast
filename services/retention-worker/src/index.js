import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadRetentionWorkerConfig } from "@swarmcast/config/env";
import { ERROR_CODES, httpStatusForError, publicError } from "@swarmcast/config/errors";
import { closeHttpServer, createServiceLifecycle } from "@swarmcast/config/lifecycle";
import { createLogger, logHttpRequest } from "@swarmcast/config/logging";
import {
  formatRetentionMetrics,
  runRetentionJob,
  validateRetentionPolicy
} from "@swarmcast/config/retention";
import { createJsonlRetentionStore } from "@swarmcast/config/retention-stores";

function sendJson(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendError(res, code, message = "") {
  return sendJson(res, httpStatusForError(code), publicError(code, message));
}

export async function createRetentionStoreFromConfig(config, env = process.env) {
  if (config.storeModule) {
    const module = await import(pathToFileURL(resolve(config.storeModule)).href);
    if (typeof module.createRetentionStore !== "function") {
      throw new Error("RETENTION_STORE_MODULE must export createRetentionStore");
    }
    return module.createRetentionStore({
      env,
      dryRun: config.dryRun
    });
  }

  return createJsonlRetentionStore({
    recordsFile: config.recordsFile,
    actionLogFile: config.actionLogFile,
    initializeIfMissing: true
  });
}

export function createRetentionWorker({
  policy,
  store,
  config = loadRetentionWorkerConfig({}),
  logger = null,
  isReady = () => true,
  nowProvider = () => new Date()
} = {}) {
  if (!policy) throw new Error("policy is required");
  if (!store) throw new Error("store is required");

  const state = {
    running: false,
    failuresTotal: 0,
    lastSuccessTimestampSeconds: 0,
    lastResult: null,
    metrics: formatRetentionMetrics({}, {
      failuresTotal: 0,
      lastSuccessTimestampSeconds: 0
    })
  };
  let currentRun = null;

  async function executeRun() {
    state.running = true;
    const now = nowProvider();
    try {
      const result = await runRetentionJob({
        policy,
        store,
        now,
        dryRun: config.dryRun
      });
      state.lastResult = result;
      if (result.ok) {
        state.lastSuccessTimestampSeconds = Math.floor(new Date(result.now).getTime() / 1000);
      } else {
        state.failuresTotal += Math.max(1, result.failures.length);
      }
      state.metrics = formatRetentionMetrics(result.summary, {
        failuresTotal: state.failuresTotal,
        lastSuccessTimestampSeconds: state.lastSuccessTimestampSeconds
      });
      logger?.info("retention_job_completed", {
        records_scanned: result.scannedRecords,
        records_applied: result.appliedRecords,
        dry_run: result.dryRun,
        error_class: result.ok ? null : "retention_job_failed"
      }, "retention job completed");
      return result;
    } catch (error) {
      state.failuresTotal += 1;
      state.lastResult = {
        ok: false,
        dryRun: config.dryRun,
        now: now.toISOString(),
        scannedRecords: 0,
        appliedRecords: 0,
        summary: {},
        failures: [{
          stage: "run",
          error: error instanceof Error ? error.message : String(error)
        }]
      };
      state.metrics = formatRetentionMetrics({}, {
        failuresTotal: state.failuresTotal,
        lastSuccessTimestampSeconds: state.lastSuccessTimestampSeconds
      });
      logger?.error("retention_job_failed", {
        error_class: "retention_job_failed",
        error_message: state.lastResult.failures[0].error
      }, "retention job failed");
      return state.lastResult;
    } finally {
      state.running = false;
    }
  }

  function runOnce() {
    if (currentRun) return currentRun;
    currentRun = executeRun().finally(() => { currentRun = null; });
    return currentRun;
  }

  async function waitForIdle() {
    if (currentRun) await currentRun;
  }

  const server = http.createServer((req, res) => {
    logHttpRequest(req, res, logger);
    const url = new URL(req.url, "http://retention-worker.local");
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        dryRun: config.dryRun,
        running: state.running,
        failuresTotal: state.failuresTotal,
        lastSuccessTimestampSeconds: state.lastSuccessTimestampSeconds
      });
    }
    if (req.method === "GET" && url.pathname === "/ready") {
      const ready = isReady();
      return sendJson(res, ready ? 200 : 503, { ok: ready });
    }
    if (req.method === "GET" && url.pathname === "/metrics") {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(state.metrics);
      return;
    }
    return sendError(res, ERROR_CODES.NOT_FOUND, "not found");
  });

  return { server, runOnce, state, waitForIdle };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadRetentionWorkerConfig(process.env);
  const logger = createLogger({ service: "retention-worker" });
  const lifecycle = createServiceLifecycle({ service: "retention-worker", logger });
  const policy = validateRetentionPolicy(JSON.parse(readFileSync(config.policyFile, "utf8")));
  const store = await createRetentionStoreFromConfig(config, process.env);
  const worker = createRetentionWorker({ policy, store, config, logger, isReady: lifecycle.isReady });
  let timer = null;

  if (config.runOnStart) worker.runOnce();
  timer = setInterval(() => worker.runOnce(), config.intervalMs);

  lifecycle.install(async () => {
    if (timer) clearInterval(timer);
    await closeHttpServer(worker.server);
    await worker.waitForIdle();
  });

  worker.server.listen(config.port, () => {
    lifecycle.markReady();
    logger.info("service_started", {
      node_id: "retention-worker",
      port: config.port,
      dry_run: config.dryRun
    }, "retention worker listening");
  });
}
