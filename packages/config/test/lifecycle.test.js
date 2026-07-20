import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import http from "node:http";
import { closeHttpServer, createServiceLifecycle } from "../src/lifecycle.js";

test("service lifecycle becomes unready and shuts down exactly once", async () => {
  const processRef = new EventEmitter();
  const exitCodes = [];
  let shutdownCalls = 0;
  const lifecycle = createServiceLifecycle({
    service: "test-service",
    processRef,
    exit: (code) => exitCodes.push(code)
  });
  lifecycle.install(async () => { shutdownCalls += 1; });
  lifecycle.markReady();
  assert.equal(lifecycle.isReady(), true);

  processRef.emit("SIGTERM");
  processRef.emit("SIGINT");
  await lifecycle.shutdown("test");

  assert.equal(lifecycle.isReady(), false);
  assert.equal(lifecycle.state(), "stopped");
  assert.equal(shutdownCalls, 1);
  assert.deepEqual(exitCodes, [0]);
  assert.equal(processRef.listenerCount("SIGTERM"), 0);
  assert.equal(processRef.listenerCount("SIGINT"), 0);
});

test("service lifecycle exits non-zero when shutdown fails or times out", async () => {
  for (const shutdownFn of [
    async () => { throw new Error("close failed"); },
    () => new Promise(() => {})
  ]) {
    const exitCodes = [];
    const lifecycle = createServiceLifecycle({
      service: "test-service",
      processRef: new EventEmitter(),
      timeoutMs: 10,
      exit: (code) => exitCodes.push(code)
    });
    lifecycle.install(shutdownFn);
    lifecycle.markReady();
    await lifecycle.shutdown();
    assert.equal(lifecycle.state(), "failed");
    assert.deepEqual(exitCodes, [1]);
  }
});

test("closeHttpServer drains a listening HTTP server", async () => {
  const server = http.createServer((_req, res) => res.end("ok"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "ok");

  await closeHttpServer(server);
  assert.equal(server.listening, false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}`));
  await closeHttpServer(server);
});
