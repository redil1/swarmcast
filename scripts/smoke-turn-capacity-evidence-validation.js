import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixturePath = "test-fixtures/load/turn-capacity-complete.synthetic.json";
const validatorPath = "scripts/validate-turn-capacity-evidence.js";
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const directory = mkdtempSync(path.join(tmpdir(), "swarmcast-turn-capacity-validation-"));

function run(args) {
  return spawnSync(process.execPath, [validatorPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

function expectPass(args) {
  const result = run(args);
  if (result.status !== 0) throw new Error(`expected validation success: ${result.stderr || result.stdout}`);
}

function expectFailure(name, mutate, expected) {
  const record = structuredClone(fixture);
  mutate(record);
  const file = path.join(directory, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  const result = run(["--allow-synthetic", file]);
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== 1 || !expected.test(output)) {
    throw new Error(`${name} did not fail as expected: status=${result.status} output=${output}`);
  }
}

try {
  expectPass(["--allow-synthetic", fixturePath]);
  const syntheticRejection = run([fixturePath]);
  if (syntheticRejection.status !== 1 || !/requires --allow-synthetic/.test(syntheticRejection.stderr)) {
    throw new Error("synthetic fixture passed without explicit allowance");
  }
  const unknownOption = run(["--unknown", fixturePath]);
  if (unknownOption.status !== 2 || !/Unknown option/.test(unknownOption.stderr)) {
    throw new Error("unknown validator option was not rejected");
  }

  const cases = [
    ["missing-synthetic-declaration", (record) => delete record.synthetic, /synthetic must be explicitly true or false/],
    ["one-turn-host", (record) => record.turnFleet.serverHosts.pop(), /at least two hosts/],
    ["turn-failure-domain", (record) => {
      record.turnFleet.serverHosts[1].failureDomain = record.turnFleet.serverHosts[0].failureDomain;
    }, /TURN hosts must span at least two failure domains/],
    ["one-load-generator", (record) => record.loadGenerators.pop(), /at least two independent hosts/],
    ["load-failure-domain", (record) => {
      record.loadGenerators[1].failureDomain = record.loadGenerators[0].failureDomain;
    }, /loadGenerators must span at least two failure domains/],
    ["load-provider", (record) => {
      record.loadGenerators[1].provider = record.loadGenerators[0].provider;
    }, /loadGenerators must span at least two providers/],
    ["dependent-network-path", (record) => {
      record.loadGenerators[0].independentNetworkPath = false;
    }, /independentNetworkPath must be true/],
    ["missing-tls-profile", (record) => {
      record.profiles = record.profiles.filter((profile) => profile.id !== "turn-b-tls");
    }, /missing tls capacity profile for TURN host turn-b/],
    ["duplicate-host-transport", (record) => {
      const duplicate = structuredClone(record.profiles[0]);
      duplicate.id = "turn-a-udp-second";
      duplicate.rawProbes.forEach((probe) => { probe.runId = `${probe.runId}-second`; });
      record.profiles.push(duplicate);
    }, /duplicate udp capacity profile for TURN host turn-a/],
    ["short-warmup", (record) => record.profiles[0].warmupSeconds = 59, /warmupSeconds must be a finite number/],
    ["short-sustained-run", (record) => record.profiles[0].sustainedSeconds = 299, /sustainedSeconds must be a finite number/],
    ["short-wall-duration", (record) => {
      record.profiles[0].completedAt = "2026-07-21T00:05:59Z";
    }, /wall duration is shorter/],
    ["missing-raw-probe", (record) => record.profiles[0].rawProbes.pop(), /must include exactly one probe per load generator/],
    ["duplicate-raw-probe-generator", (record) => {
      record.profiles[0].rawProbes[1].loadGeneratorHostId = "load-a";
    }, /contains duplicate generator load-a/],
    ["raw-probe-start-skew", (record) => {
      record.profiles[0].rawProbes[1].startedAt = "2026-07-21T00:00:06Z";
      record.profiles[0].rawProbes[1].completedAt = "2026-07-21T00:06:06Z";
    }, /start more than five seconds apart/],
    ["raw-probe-envelope", (record) => {
      record.profiles[0].completedAt = "2026-07-21T00:07:00Z";
    }, /timestamps must match the synchronized raw probe envelope/],
    ["duplicate-raw-probe-run", (record) => {
      record.profiles[1].rawProbes[0].runId = record.profiles[0].rawProbes[0].runId;
    }, /duplicate raw probe runId/],
    ["failed-raw-probe", (record) => record.profiles[0].rawProbes[0].result = "fail", /rawProbes\[0\]\.result must pass/],
    ["short-raw-probe", (record) => {
      record.profiles[0].rawProbes[0].completedAt = "2026-07-21T00:05:59Z";
    }, /rawProbes\[0\] wall duration is shorter/],
    ["allocation-failures", (record) => record.profiles[0].allocationFailures = 20, /allocation failure ratio exceeds 1%/],
    ["allocation-headroom", (record) => {
      record.profiles[0].approvedConcurrentAllocations = 1001;
    }, /approvedConcurrentAllocations does not preserve required headroom/],
    ["relay-leg-undercount", (record) => {
      record.profiles[0].coturnIngressBytes = record.profiles[0].applicationPayloadBytes;
    }, /coturn traffic must cover both relay legs/],
    ["host-counter-mismatch", (record) => {
      record.profiles[0].hostNicEgressBytes = 10000000000;
    }, /coturn\/host egress does not reconcile/],
    ["provider-counter-mismatch", (record) => {
      record.profiles[0].providerIngressBytes = 10000000000;
    }, /coturn\/provider ingress does not reconcile/],
    ["fake-throughput", (record) => {
      record.profiles[0].measuredSustainedEgressMbps = 900;
    }, /measuredSustainedEgressMbps is inconsistent/],
    ["link-overclaim", (record) => {
      record.turnFleet.serverHosts[0].linkCapacityMbps = 700;
    }, /exceeds the declared host link capacity/],
    ["throughput-headroom", (record) => {
      record.profiles[0].approvedSustainedEgressMbps = 616;
    }, /approvedSustainedEgressMbps does not preserve required headroom/],
    ["packet-loss", (record) => record.profiles[0].packetLossRatio = 0.02, /packetLossRatio must be a finite number/],
    ["latency", (record) => record.profiles[0].p95RttMs = 251, /p95RttMs must be a finite number/],
    ["cpu", (record) => record.profiles[0].cpuP95Ratio = 0.71, /cpuP95Ratio must be a finite number/],
    ["memory", (record) => record.profiles[0].memoryP95Ratio = 0.81, /memoryP95Ratio must be a finite number/],
    ["restart", (record) => record.profiles[0].restarts = 1, /restarts must be a finite number/],
    ["allocation-leak", (record) => {
      record.profiles[0].allocationsReturnedToZero = false;
    }, /allocationsReturnedToZero must be true/],
    ["missing-metric-evidence", (record) => {
      record.profiles[0].evidence = record.profiles[0].evidence.filter((item) => !item.includes("coturn-prometheus"));
    }, /must include coturn-prometheus/],
    ["sensitive-evidence", (record) => {
      record.profiles[0].evidence.push("runs/shared_secret=do-not-store.txt");
    }, /sensitive material/],
    ["unapproved-provider-terms", (record) => {
      record.turnFleet.providerTrafficTermsApproved = false;
    }, /providerTrafficTermsApproved must be true/],
    ["missing-security-approval", (record) => {
      record.approvals = record.approvals.filter((approval) => approval.role !== "security");
    }, /approvals must include operations, performance, and security/],
    ["duplicate-approval-reviewer", (record) => {
      record.approvals[1].reviewer = record.approvals[0].reviewer;
    }, /approval reviewers must be distinct/]
  ];

  for (const [name, mutate, expected] of cases) expectFailure(name, mutate, expected);
  console.log(`TURN capacity evidence validation smoke OK: positive=1 negative=${cases.length + 2}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
