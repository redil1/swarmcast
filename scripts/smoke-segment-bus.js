import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createSegmentPublisher,
  createSegmentSubscriber
} from "@swarmcast/segment-bus";

const IMAGE = process.env.SWARMCAST_NATS_SMOKE_IMAGE || "nats:2.12.1-alpine@sha256:b3f2bd84176ae7bd0afa9c48a00f06d7d0818ff4aaee898e4172e0b8340e5816";
const INGEST_PASSWORD = "ingest-segment-bus-smoke-password";
const TRACKER_PASSWORD = "tracker-segment-bus-smoke-password";

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `docker ${args.join(" ")} failed`);
  return result.stdout.trim();
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(fn, timeoutMs = 15_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error("timed out");
}

const tempDir = mkdtempSync(path.join(tmpdir(), "swarmcast-segment-bus-"));
const containerName = `swarmcast-segment-bus-smoke-${process.pid}`;
const clientPort = await freePort();
const monitorPort = await freePort();
const configPath = path.resolve("infra/nats/nats-server.conf");
const received = [];
let publisher;
let subscriber;

function startBroker() {
  docker([
    "run", "-d", "--rm", "--name", containerName,
    "-p", `127.0.0.1:${clientPort}:4222`,
    "-p", `127.0.0.1:${monitorPort}:8222`,
    "-e", "NATS_INGEST_USER=ingest",
    "-e", `NATS_INGEST_PASSWORD=${INGEST_PASSWORD}`,
    "-e", "NATS_TRACKER_USER=tracker",
    "-e", `NATS_TRACKER_PASSWORD=${TRACKER_PASSWORD}`,
    "-v", `${configPath}:/etc/nats/nats-server.conf:ro`,
    "-v", `${tempDir}:/data`,
    IMAGE,
    "-c", "/etc/nats/nats-server.conf"
  ]);
}

function stopBroker() {
  spawnSync("docker", ["rm", "-f", containerName], { encoding: "utf8" });
}

function busConfig(role) {
  return {
    servers: [`nats://127.0.0.1:${clientPort}`],
    user: role,
    password: role === "ingest" ? INGEST_PASSWORD : TRACKER_PASSWORD,
    tlsRequired: false,
    connectTimeoutMs: 3_000,
    publishTimeoutMs: 2_000,
    maxAgeMs: 600_000,
    maxMessagesPerSubject: 120,
    maxBytes: 100_000_000,
    replicas: 1,
    clientName: `segment-bus-smoke-${role}`
  };
}

const segment = (channelId, seq, digest = "a") => ({
  channelId,
  seq,
  sha256: digest.repeat(64),
  size: 4096,
  k: 24
});

try {
  startBroker();
  await waitFor(async () => (await fetch(`http://127.0.0.1:${monitorPort}/healthz?js-enabled-only=true`)).ok);
  publisher = await createSegmentPublisher(busConfig("ingest"));
  subscriber = await createSegmentSubscriber(busConfig("tracker"), {
    onSegment: async (value, metadata) => received.push({ ...value, replayed: metadata.replayed })
  });
  await subscriber.subscribeChannel("channel-a");

  await publisher.publish(segment("channel-a", 1, "a"));
  await publisher.publish(segment("channel-b", 1, "b"));
  await waitFor(() => received.some((value) => value.channelId === "channel-a" && value.seq === 1));
  if (received.some((value) => value.channelId === "channel-b")) throw new Error("subscriber received an inactive channel");

  subscriber.unsubscribeChannel("channel-a");
  await publisher.publish(segment("channel-a", 2, "c"));
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (received.some((value) => value.channelId === "channel-a" && value.seq === 2)) {
    throw new Error("unsubscribed channel received a live segment");
  }
  await subscriber.subscribeChannel("channel-a");
  await waitFor(() => received.some((value) => value.channelId === "channel-a" && value.seq === 2 && value.replayed));
  const duplicate = await publisher.publish(segment("channel-a", 2, "c"));
  if (!duplicate.duplicate) throw new Error("JetStream did not deduplicate the repeated segment publish");

  stopBroker();
  await waitFor(() => !publisher.isHealthy() && !subscriber.isHealthy());
  startBroker();
  await waitFor(async () => (await fetch(`http://127.0.0.1:${monitorPort}/healthz?js-enabled-only=true`)).ok);
  await waitFor(() => publisher.isHealthy() && subscriber.isHealthy());
  await publisher.publish(segment("channel-a", 3, "d"));
  await waitFor(() => received.some((value) => value.channelId === "channel-a" && value.seq === 3));

  await subscriber.close();
  subscriber = null;
  await publisher.close();
  publisher = null;
  stopBroker();
  startBroker();
  await waitFor(async () => (await fetch(`http://127.0.0.1:${monitorPort}/healthz?js-enabled-only=true`)).ok);

  subscriber = await createSegmentSubscriber(busConfig("tracker"), {
    onSegment: async (value, metadata) => received.push({ ...value, replayed: metadata.replayed, afterRestart: true })
  });
  await subscriber.subscribeChannel("channel-a");
  await waitFor(() => received.some((value) => value.afterRestart && value.seq === 3 && value.replayed));

  console.log("segment bus smoke OK: publishOnce=pass selectiveDelivery=pass duplicateSuppression=pass reconnectHealth=pass replay=pass durableRestart=pass");
} finally {
  await subscriber?.close().catch(() => {});
  await publisher?.close().catch(() => {});
  stopBroker();
  rmSync(tempDir, { recursive: true, force: true });
}
