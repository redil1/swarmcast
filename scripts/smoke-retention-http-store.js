import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const NOW = "2026-07-05T00:00:00.000Z";
const TOKEN = "retention-store-smoke-token";
const SENSITIVE_SENTINELS = [
  "https://source.invalid/private/master.m3u8",
  "SYNTHETIC_JWT_SHOULD_NOT_APPEAR",
  "203.0.113.10",
  "viewer@example.invalid",
  "super-secret-api-key"
];

const records = readFileSync("test-fixtures/retention/sensitive-records.jsonl", "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const listCalls = [];
const applyCalls = [];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function assertNoSensitive(label, text) {
  for (const sentinel of SENSITIVE_SENTINELS) {
    assert.equal(text.includes(sentinel), false, `${label} leaked sensitive sentinel: ${sentinel}`);
  }
}

function assertMinimalApplyBody(body) {
  const allowedKeys = new Set(["recordId", "classId", "observedAt", "action", "dryRun", "now"]);
  for (const key of Object.keys(body)) {
    assert.equal(allowedKeys.has(key), true, `HTTP apply body emitted disallowed field: ${key}`);
  }
  const text = JSON.stringify(body);
  assertNoSensitive("HTTP apply body", text);
  assert.match(body.recordId, /^redaction-/);
  assert.equal(body.dryRun, false);
  assert.equal(body.now, NOW);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return sendJson(res, 401, { error: "unauthorized" });
    const body = JSON.parse(await readBody(req) || "{}");
    const url = new URL(req.url, "http://retention-store.local");

    if (url.pathname === "/retention/list") {
      listCalls.push(body);
      return sendJson(res, 200, {
        records: records.filter((record) => record.classId === body.classId)
      });
    }
    if (url.pathname === "/retention/apply") {
      applyCalls.push(body);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

function runRetention(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/retention-job.js", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RETENTION_NOW: NOW,
        RETENTION_STORE_MODULE: path.resolve("scripts/retention-http-store.js"),
        RETENTION_STORE_HTTP_BASE_URL: baseUrl,
        RETENTION_STORE_HTTP_TOKEN: TOKEN,
        RETENTION_STORE_HTTP_TIMEOUT_MS: "5000",
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

try {
  const dryRun = await runRetention([]);
  assert.equal(dryRun.status, 0, `HTTP retention dry run failed\nSTDOUT:\n${dryRun.stdout}\nSTDERR:\n${dryRun.stderr}`);
  assertNoSensitive("HTTP dry-run stdout", dryRun.stdout);
  assertNoSensitive("HTTP dry-run stderr", dryRun.stderr);
  const dryRunResult = JSON.parse(dryRun.stdout);
  assert.equal(dryRunResult.ok, true);
  assert.equal(dryRunResult.dryRun, true);
  assert.equal(dryRunResult.scannedRecords, 5);
  assert.equal(listCalls.length, 5);
  assert.equal(applyCalls.length, 0, "dry-run HTTP store must not call apply endpoint");

  listCalls.length = 0;
  applyCalls.length = 0;
  const executed = await runRetention(["--execute", "--prometheus"], { RETENTION_EXECUTE: "1" });
  assert.equal(executed.status, 0, `HTTP retention execute failed\nSTDOUT:\n${executed.stdout}\nSTDERR:\n${executed.stderr}`);
  assertNoSensitive("HTTP execute stdout", executed.stdout);
  assertNoSensitive("HTTP execute stderr", executed.stderr);
  assert.match(executed.stdout, /swarmcast_retention_records_total/);
  assert.match(executed.stdout, /swarmcast_retention_failures_total 0/);
  assert.equal(listCalls.length, 5);
  assert.equal(applyCalls.length, 5);
  for (const body of applyCalls) assertMinimalApplyBody(body);

  console.log("retention HTTP store smoke OK: dryRunApplyCalls=0 executeApplyCalls=5 actionPayloadMinimal=true");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
