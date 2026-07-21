import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isPrivateAddress,
  parseTurnutilsOutput,
  prometheusMetricSum,
  redactSensitive
} from "./run-turn-capacity-probe.js";

const directory = mkdtempSync(path.join(tmpdir(), "swarmcast-turn-capacity-probe-"));
const fakeClient = path.join(directory, "fake-turnutils-uclient.js");
const outputFile = path.join(directory, "raw-probe.json");
const sharedSecret = "probe-test-secret-0123456789abcdef0123456789abcdef";
const usernames = new Set();
const credentials = new Set();
let childInheritedSharedSecret = false;
const counters = {
  active: 0,
  peerRcvb: 0,
  peerSentb: 0,
  rcvb: 0,
  sentb: 0
};

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/metrics") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end([
      `turn_total_allocations ${counters.active}`,
      `turn_total_traffic_rcvb ${counters.rcvb}`,
      `turn_total_traffic_sentb ${counters.sentb}`,
      `turn_total_traffic_peer_rcvb ${counters.peerRcvb}`,
      `turn_total_traffic_peer_sentb ${counters.peerSentb}`,
      ""
    ].join("\n"));
    return;
  }
  if (req.method === "POST" && (req.url === "/start" || req.url === "/stop")) {
    const body = await readBody(req);
    if (req.url === "/start") {
      counters.active += 1;
      usernames.add(body.username);
      credentials.add(body.credential);
      childInheritedSharedSecret ||= body.inheritedSharedSecret;
    } else {
      counters.active -= 1;
      const bytes = body.messages * body.messageBytes;
      counters.rcvb += bytes;
      counters.sentb += bytes;
      counters.peerRcvb += bytes;
      counters.peerSentb += bytes;
    }
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(404);
  res.end();
});

writeFileSync(fakeClient, `#!/usr/bin/env node
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const messages = Number.parseInt(value("-n"), 10);
const messageBytes = Number.parseInt(value("-l"), 10);
const username = value("-u");
const credential = value("-w");
await fetch(process.env.FAKE_TURN_CONTROL_URL + "/start", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username, credential, inheritedSharedSecret: Boolean(process.env.TURN_SHARED_SECRET) })
});
await new Promise((resolve) => setTimeout(resolve, 1100));
await fetch(process.env.FAKE_TURN_CONTROL_URL + "/stop", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages, messageBytes })
});
console.log("udp: msz=" + messageBytes + ", tot_send_msgs=" + messages + ", tot_recv_msgs=" + messages +
  ", tot_send_bytes ~ " + (messages * messageBytes) + ", tot_recv_bytes ~ " + (messages * messageBytes));
console.log("Total lost packets 0 (0.000000%), total send dropped 0 (0.000000%)");
console.log("Average round trip delay 10.000000 ms; min = 9 ms, max = 11 ms");
`);
chmodSync(fakeClient, 0o755);

function runProbe(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/run-turn-capacity-probe.js", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

try {
  const parsed = parseTurnutilsOutput([
    "udp: msz=100, tot_send_msgs=10, tot_recv_msgs=9, tot_send_bytes ~ 1000, tot_recv_bytes ~ 900",
    "Total lost packets 1 (10.000000%), total send dropped 0 (0.000000%)",
    "Average round trip delay 12.500000 ms; min = 9 ms, max = 20 ms"
  ].join("\n"));
  if (parsed.sentMessages !== 10 || parsed.receivedMessages !== 9 || parsed.lostPackets !== 1 || parsed.averageRttMs !== 12.5) {
    throw new Error("turnutils statistics parser returned incorrect values");
  }
  const metricText = "turn_total_allocations{state=\"a\"} 2\nturn_total_allocations{state=\"b\"} 3\n";
  if (prometheusMetricSum(metricText, "turn_total_allocations") !== 5) {
    throw new Error("Prometheus metric summation returned an incorrect value");
  }
  if (!isPrivateAddress("127.0.0.1") || !isPrivateAddress("10.0.0.1") || isPrivateAddress("1.1.1.1")) {
    throw new Error("public endpoint guard returned an incorrect classification");
  }
  if (redactSensitive(`value=${sharedSecret}`, [sharedSecret]).includes(sharedSecret)) {
    throw new Error("secret redaction failed");
  }

  const missingAcknowledgement = spawnSync(process.execPath, ["scripts/run-turn-capacity-probe.js"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, TURN_SHARED_SECRET: sharedSecret }
  });
  if (missingAcknowledgement.status !== 1 || !missingAcknowledgement.stderr.includes("--acknowledge-staging-load")) {
    throw new Error("probe did not fail closed without load acknowledgement");
  }

  const port = await listen(server);
  const args = [
    "--acknowledge-staging-load",
    "--allocations", "2",
    "--commit", "a".repeat(40),
    "--interval-ms", "10",
    "--load-generator-failure-domain", "test-a",
    "--load-generator-host-id", "load-test-a",
    "--load-generator-provider", "local-test",
    "--load-generator-region", "local",
    "--message-bytes", "100",
    "--metrics-sample-ms", "250",
    "--metrics-url", `http://127.0.0.1:${port}/metrics`,
    "--output", outputFile,
    "--peer-address", "8.8.8.8",
    "--peer-port", "3480",
    "--port", "3478",
    "--release-version", "v0.1.0-test",
    "--run-id", "turn-probe-test",
    "--server", "1.1.1.1",
    "--sustained-seconds", "1",
    "--transport", "udp",
    "--uclient-bin", fakeClient,
    "--warmup-seconds", "1"
  ];
  const result = await runProbe(args, {
    FAKE_TURN_CONTROL_URL: `http://127.0.0.1:${port}`,
    NODE_ENV: "test",
    SWARMCAST_TURN_PROBE_TEST_MODE: "1",
    TURN_SHARED_SECRET: sharedSecret
  });
  if (result.status !== 0) throw new Error(`probe orchestration failed: ${result.stderr || result.stdout}`);
  const raw = readFileSync(outputFile, "utf8");
  const evidence = JSON.parse(raw);
  if (raw.includes(sharedSecret) || [...credentials].some((credential) => raw.includes(credential))) {
    throw new Error("raw probe evidence contains credentials");
  }
  if (evidence.synthetic !== true || evidence.environment !== "test" || evidence.result !== "pass") {
    throw new Error("test-mode probe was not marked synthetic");
  }
  if (evidence.metrics.peakAllocations !== 2 || evidence.metrics.afterDrain.turn_total_allocations !== 0) {
    throw new Error("probe did not record exact allocation peak and drain");
  }
  if (evidence.warmup.allocationsSucceeded !== 2 || evidence.sustained.allocationsSucceeded !== 2) {
    throw new Error("probe did not complete every allocation");
  }
  if (usernames.size !== 4 || credentials.size !== 4) {
    throw new Error(`expected four unique credentials, got usernames=${usernames.size} credentials=${credentials.size}`);
  }
  if (childInheritedSharedSecret) throw new Error("TURN client inherited the shared secret");
  if ((statSync(outputFile).mode & 0o777) !== 0o600) throw new Error("probe output permissions are not 0600");
  console.log("TURN capacity probe smoke OK: phases=2 allocations=2 exactPeak=2 uniqueCredentials=4 redaction=pass");
} finally {
  await close(server).catch(() => {});
  rmSync(directory, { recursive: true, force: true });
}
