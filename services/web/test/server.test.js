import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebServer } from "../src/server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("session endpoint hides app key and returns public tracker config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swarmcast-web-"));
  await writeFile(join(root, "index.html"), "ok");
  const calls = [];
  const server = createWebServer({
    appApiKey: "private-key",
    trackerUrl: "wss://tracker.example/ws",
    staticRoot: root,
    fetchJson: async (url, options) => {
      calls.push({ url, options });
      return { token: "short-lived", expiresIn: 60, iceServers: [{ urls: ["stun:turn.example"] }] };
    }
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/web-api/session`, { method: "POST" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.trackerUrl, "wss://tracker.example/ws");
  assert.equal(JSON.stringify(body).includes("private-key"), false);
  assert.equal(calls[0].options.headers["x-app-key"], "private-key");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("catalog proxy only forwards allowlisted query parameters", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swarmcast-web-"));
  await writeFile(join(root, "index.html"), "ok");
  let upstreamUrl;
  const server = createWebServer({
    appApiKey: "private-key",
    trackerUrl: "wss://tracker.example/ws",
    staticRoot: root,
    fetchJson: async (url) => { upstreamUrl = url; return { items: [] }; }
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/web-api/channels?page=2&q=news&evil=secret`);
  assert.equal(response.status, 200);
  assert.match(upstreamUrl, /page=2/);
  assert.match(upstreamUrl, /q=news/);
  assert.doesNotMatch(upstreamUrl, /evil/);
});

test("static service denies arbitrary paths and methods", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swarmcast-web-"));
  await writeFile(join(root, "index.html"), "ok");
  const server = createWebServer({ appApiKey: "key", trackerUrl: "wss://tracker.example/ws", staticRoot: root });
  t.after(() => server.close());
  const base = await listen(server);
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/../../etc/passwd`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: "PUT" })).status, 405);
});
