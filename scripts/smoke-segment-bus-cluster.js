import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { jetstreamManager } from "@nats-io/jetstream";
import { connect } from "@nats-io/transport-node";
import {
  SEGMENT_STREAM_NAME,
  createSegmentPublisher,
  createSegmentSubscriber,
  provisionSegmentStream
} from "@swarmcast/segment-bus";

const IMAGE = process.env.SWARMCAST_NATS_SMOKE_IMAGE || "nats:2.12.1-alpine@sha256:b3f2bd84176ae7bd0afa9c48a00f06d7d0818ff4aaee898e4172e0b8340e5816";
const NATS_BOX_IMAGE = process.env.SWARMCAST_NATS_BOX_SMOKE_IMAGE || "natsio/nats-box:0.19.7@sha256:ffce8bd103383f179f8c7f11cf645726acf5d17280706c530c3b342dbe16334c";
const NODE_COUNT = 3;
const oldCredentials = Object.freeze({
  admin: "segment-cluster-admin-password-old-0001",
  ingest: "segment-cluster-ingest-password-old-0001",
  tracker: "segment-cluster-tracker-password-old-0001"
});
const newCredentials = Object.freeze({
  admin: "segment-cluster-admin-password-new-0002",
  ingest: "segment-cluster-ingest-password-new-0002",
  tracker: "segment-cluster-tracker-password-new-0002"
});
const users = Object.freeze({ admin: "segment-admin", ingest: "ingest", tracker: "tracker" });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function docker(args, options = {}) {
  return run("docker", args, options);
}

const passwordHashCache = new Map();

function passwordHash(password) {
  if (!passwordHashCache.has(password)) {
    const output = docker(["run", "--rm", NATS_BOX_IMAGE, "nats", "server", "passwd", "--pass", password, "--cost", "11"]);
    assert.match(output, /^\$2a\$11\$[./A-Za-z0-9]{53}$/, "NATS CLI returned an invalid bcrypt hash");
    passwordHashCache.set(password, output);
  }
  return passwordHashCache.get(password);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(fn, timeoutMs = 30_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error("timed out");
}

async function waitForPort(port) {
  return waitFor(() => new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  }));
}

function createCertificates(root, nodeNames, includeLocalhost = true) {
  const caConfig = path.join(root, "ca.cnf");
  const serverConfig = path.join(root, "server.cnf");
  const dnsNames = includeLocalhost ? ["localhost", ...nodeNames] : nodeNames;
  const altNames = dnsNames.map((name, index) => `DNS.${index + 1} = ${name}`).join("\n");
  writeFileSync(caConfig, `[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = v3_ca\n[dn]\nCN = SwarmCast Segment Bus Smoke CA\n[v3_ca]\nbasicConstraints = critical, CA:true\nkeyUsage = critical, keyCertSign, cRLSign\nsubjectKeyIdentifier = hash\n`);
  writeFileSync(serverConfig, `[req]\nprompt = no\ndistinguished_name = dn\nreq_extensions = v3_req\n[dn]\nCN = localhost\n[v3_req]\nsubjectAltName = @alt_names\nextendedKeyUsage = serverAuth, clientAuth\nkeyUsage = critical, digitalSignature, keyEncipherment\n[alt_names]\n${altNames}\n`);
  rmSync(path.join(root, "ca.srl"), { force: true });
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "2", "-config", caConfig, "-keyout", path.join(root, "ca.key"), "-out", path.join(root, "ca.crt")]);
  run("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256", "-config", serverConfig, "-keyout", path.join(root, "server.key"), "-out", path.join(root, "server.csr")]);
  run("openssl", ["x509", "-req", "-sha256", "-days", "2", "-in", path.join(root, "server.csr"), "-CA", path.join(root, "ca.crt"), "-CAkey", path.join(root, "ca.key"), "-CAcreateserial", "-extfile", serverConfig, "-extensions", "v3_req", "-out", path.join(root, "server.crt")]);
  chmodSync(path.join(root, "ca.crt"), 0o644);
  chmodSync(path.join(root, "server.crt"), 0o644);
  chmodSync(path.join(root, "server.key"), 0o644);
}

const prefix = `swarmcast-segment-cluster-smoke-${process.pid}`;
const networkName = `${prefix}-network`;
const nodeNames = Array.from({ length: NODE_COUNT }, (_, index) => `${prefix}-n${index + 1}`);
const volumeNames = nodeNames.map((name) => `${name}-data`);
const clientPorts = await Promise.all(nodeNames.map(() => freePort()));
const serverUrls = clientPorts.map((port) => `tls://127.0.0.1:${port}`);
const root = mkdtempSync(path.join(tmpdir(), "swarmcast-segment-cluster-"));
const caFile = path.join(root, "ca.crt");
const configPath = path.resolve("infra/nats/nats-server.production.conf");
const running = new Set();

function nodeIndex(serverName) {
  const index = nodeNames.indexOf(serverName);
  if (index < 0) throw new Error(`unknown cluster node ${serverName}`);
  return index;
}

function startNode(index, credentials) {
  const name = nodeNames[index];
  const routes = nodeNames
    .filter((candidate) => candidate !== name)
    .map((candidate) => `nats-route://${candidate}:6222`);
  docker([
    "run", "-d", "--name", name,
    "--network", networkName,
    "-p", `127.0.0.1:${clientPorts[index]}:4222`,
    "-e", `NATS_SERVER_NAME=${name}`,
    "-e", `NATS_CLIENT_ADVERTISE=127.0.0.1:${clientPorts[index]}`,
    "-e", `NATS_CLUSTER_ADVERTISE=${name}:6222`,
    "-e", `NATS_CLUSTER_ROUTES=${JSON.stringify(routes)}`,
    "-e", "NATS_MAX_MEMORY_STORE=64MB",
    "-e", "NATS_MAX_FILE_STORE=256MB",
    "-e", `NATS_ADMIN_USER=${users.admin}`,
    "-e", `NATS_ADMIN_PASSWORD_HASH=${JSON.stringify(passwordHash(credentials.admin))}`,
    "-e", `NATS_INGEST_USER=${users.ingest}`,
    "-e", `NATS_INGEST_PASSWORD_HASH=${JSON.stringify(passwordHash(credentials.ingest))}`,
    "-e", `NATS_TRACKER_USER=${users.tracker}`,
    "-e", `NATS_TRACKER_PASSWORD_HASH=${JSON.stringify(passwordHash(credentials.tracker))}`,
    "-v", `${configPath}:/etc/nats/nats-server.conf:ro`,
    "-v", `${root}:/run/secrets/nats:ro`,
    "-v", `${volumeNames[index]}:/data`,
    IMAGE,
    "-c", "/etc/nats/nats-server.conf"
  ]);
  running.add(index);
}

function stopNode(index) {
  spawnSync("docker", ["rm", "-f", nodeNames[index]], { encoding: "utf8" });
  running.delete(index);
}

function nodeLogs(index, tail) {
  const args = ["logs"];
  if (tail) args.push("--tail", String(tail));
  args.push(nodeNames[index]);
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return `${result.stdout || ""}${result.stderr || ""}`;
}

async function restartNode(index, credentials) {
  stopNode(index);
  startNode(index, credentials);
  await waitForPort(clientPorts[index]);
}

function roleConfig(role, credentials, servers = serverUrls) {
  return {
    servers,
    user: users[role],
    password: credentials[role],
    tlsRequired: true,
    tlsCaFile: caFile,
    tlsServerName: "localhost",
    manageStream: false,
    connectTimeoutMs: 4_000,
    publishTimeoutMs: 4_000,
    maxAgeMs: 600_000,
    maxMessagesPerSubject: 200,
    maxBytes: 100_000_000,
    replicas: 3,
    clientName: `segment-cluster-smoke-${role}`
  };
}

async function adminConnection(credentials, servers = serverUrls) {
  return connect({
    servers,
    user: users.admin,
    pass: credentials.admin,
    tls: { caFile, servername: "localhost" },
    timeout: 4_000,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 250
  });
}

async function clusterInfo(manager, expectedCurrent = 3) {
  return waitFor(async () => {
    const info = await manager.streams.info(SEGMENT_STREAM_NAME);
    if (!info.cluster?.leader || info.config.num_replicas !== 3 || info.cluster.replicas?.length !== 2) return false;
    const current = 1 + info.cluster.replicas.filter((replica) => replica.current).length;
    return current >= expectedCurrent ? info : false;
  }, 45_000);
}

async function expectPublishDenied(role, credentials, subject, server = serverUrls[0]) {
  const nc = await connect({
    servers: [server],
    user: users[role],
    pass: credentials[role],
    tls: { caFile, servername: "localhost" },
    timeout: 3_000
  });
  let denied = false;
  const statusTask = (async () => {
    for await (const status of nc.status()) {
      if (status.type === "error" && /permissions violation/i.test(String(status.error))) denied = true;
    }
  })();
  nc.publish(subject, new Uint8Array([1]));
  await nc.flush().catch((error) => {
    if (/permissions violation/i.test(String(error))) denied = true;
  });
  await waitFor(() => denied, 5_000);
  await nc.close();
  await statusTask;
}

async function closeClient(client, { ignoreErrors = false } = {}) {
  if (!client) return;
  if (ignoreErrors) {
    await client.close().catch(() => {});
    return;
  }
  await client.close();
}

const segment = (seq, digest = "a") => ({
  channelId: "cluster-final",
  seq,
  sha256: digest.repeat(64),
  size: 4096,
  k: 24
});

let admin;
let manager;
let publisher;
let subscriber;
let received = [];

try {
  createCertificates(root, nodeNames, false);
  docker(["network", "create", networkName]);
  for (const volume of volumeNames) docker(["volume", "create", volume]);
  for (let index = 0; index < NODE_COUNT; index += 1) startNode(index, oldCredentials);
  await Promise.all(clientPorts.map(waitForPort));

  await assert.rejects(
    connect({
      servers: [`tls://127.0.0.1:${clientPorts[0]}`],
      user: users.admin,
      pass: oldCredentials.admin,
      tls: { caFile, servername: "localhost" },
      timeout: 2_000
    }),
    /(?:hostname|IP address|certificate)/i
  );
  for (let index = 0; index < NODE_COUNT; index += 1) stopNode(index);
  createCertificates(root, nodeNames);
  for (let index = 0; index < NODE_COUNT; index += 1) startNode(index, oldCredentials);
  await Promise.all(clientPorts.map(waitForPort));

  await waitFor(() => provisionSegmentStream({ ...roleConfig("admin", oldCredentials), manageStream: true }), 45_000);
  admin = await adminConnection(oldCredentials);
  manager = await jetstreamManager(admin);
  let info = await clusterInfo(manager);
  assert.equal(new Set([info.cluster.leader, ...info.cluster.replicas.map((replica) => replica.name)]).size, 3);

  await expectPublishDenied("ingest", oldCredentials, `$JS.API.STREAM.DELETE.${SEGMENT_STREAM_NAME}`);
  await expectPublishDenied("tracker", oldCredentials, "swarmcast.segment.forbidden");

  publisher = await createSegmentPublisher(roleConfig("ingest", oldCredentials));
  subscriber = await createSegmentSubscriber(roleConfig("tracker", oldCredentials), {
    onSegment: async (value, metadata) => received.push({ ...value, replayed: metadata.replayed })
  });
  await subscriber.subscribeChannel("cluster-final");
  await publisher.publish(segment(1, "a"));
  await waitFor(() => received.some((value) => value.seq === 1));

  const failedLeader = info.cluster.leader;
  const failedLeaderIndex = nodeIndex(failedLeader);
  stopNode(failedLeaderIndex);
  info = await clusterInfo(manager, 2);
  assert.notEqual(info.cluster.leader, failedLeader);
  await publisher.publish(segment(2, "b"));
  await waitFor(() => received.some((value) => value.seq === 2));
  startNode(failedLeaderIndex, oldCredentials);
  await waitForPort(clientPorts[failedLeaderIndex]);
  info = await clusterInfo(manager);

  const rotationOrder = nodeNames
    .filter((name) => name !== info.cluster.leader)
    .map(nodeIndex);
  for (const index of rotationOrder) {
    await restartNode(index, newCredentials);
    await clusterInfo(manager);
  }

  await closeClient(subscriber);
  subscriber = null;
  await closeClient(publisher);
  publisher = null;
  await admin.close();
  admin = null;
  manager = null;

  const rotatedUrls = rotationOrder.map((index) => serverUrls[index]);
  admin = await adminConnection(newCredentials, rotatedUrls);
  manager = await waitFor(() => jetstreamManager(admin), 45_000);
  await clusterInfo(manager, 2);
  publisher = await createSegmentPublisher(roleConfig("ingest", newCredentials, rotatedUrls));
  received = [];
  subscriber = await createSegmentSubscriber(roleConfig("tracker", newCredentials, rotatedUrls), {
    onSegment: async (value, metadata) => received.push({ ...value, replayed: metadata.replayed })
  });
  await subscriber.subscribeChannel("cluster-final");
  await waitFor(() => received.some((value) => value.seq === 2 && value.replayed));

  const finalOldIndex = nodeIndex(info.cluster.leader);
  await restartNode(finalOldIndex, newCredentials);
  await clusterInfo(manager);
  await assert.rejects(
    connect({
      servers: [`tls://127.0.0.1:${clientPorts[finalOldIndex]}`],
      user: users.ingest,
      pass: oldCredentials.ingest,
      tls: { caFile, servername: "localhost" },
      timeout: 2_000
    }),
    /authorization/i
  );

  const publishLatencyMs = [];
  for (let seq = 3; seq <= 102; seq += 1) {
    const started = performance.now();
    await publisher.publish(segment(seq, (seq % 10).toString(16)));
    publishLatencyMs.push(performance.now() - started);
  }
  await waitFor(() => received.some((value) => value.seq === 102));
  publishLatencyMs.sort((left, right) => left - right);
  const p99PublishMs = publishLatencyMs[Math.ceil(publishLatencyMs.length * 0.99) - 1];
  assert.ok(p99PublishMs < 1_000, `local replicated publish p99 ${p99PublishMs.toFixed(1)}ms exceeded 1000ms`);

  await closeClient(subscriber);
  subscriber = null;
  await closeClient(publisher);
  publisher = null;
  await admin.close();
  admin = null;
  manager = null;
  for (let index = 0; index < NODE_COUNT; index += 1) stopNode(index);
  for (let index = 0; index < NODE_COUNT; index += 1) startNode(index, newCredentials);
  await Promise.all(clientPorts.map(waitForPort));

  admin = await adminConnection(newCredentials);
  manager = await waitFor(() => jetstreamManager(admin), 45_000);
  await clusterInfo(manager);
  received = [];
  subscriber = await createSegmentSubscriber(roleConfig("tracker", newCredentials), {
    onSegment: async (value, metadata) => received.push({ ...value, replayed: metadata.replayed })
  });
  await subscriber.subscribeChannel("cluster-final");
  await waitFor(() => received.some((value) => value.seq === 102 && value.replayed));

  for (let index = 0; index < NODE_COUNT; index += 1) {
    assert.doesNotMatch(nodeLogs(index), /Plaintext passwords detected/i, `${nodeNames[index]} did not load bcrypt credentials`);
  }

  console.log(`segment bus cluster smoke OK: tlsHostname=pass nodes=3 replicas=3 leaderLoss=pass quorumPublish=pass bcryptCredentials=pass credentialScope=pass credentialRotation=pass persistentRecovery=pass publishP99Ms=${p99PublishMs.toFixed(1)}`);
} catch (error) {
  for (const index of running) {
    console.error(`\n--- ${nodeNames[index]} logs ---\n${nodeLogs(index, 120)}`);
  }
  throw error;
} finally {
  await closeClient(subscriber, { ignoreErrors: true });
  await closeClient(publisher, { ignoreErrors: true });
  await admin?.close().catch(() => {});
  for (const index of [...running]) stopNode(index);
  for (const volume of volumeNames) spawnSync("docker", ["volume", "rm", "-f", volume], { encoding: "utf8" });
  spawnSync("docker", ["network", "rm", networkName], { encoding: "utf8" });
  rmSync(root, { recursive: true, force: true });
}
