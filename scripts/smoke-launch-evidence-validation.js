import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = "test-fixtures/launch/evidence-complete.synthetic.json";
const baseRecord = JSON.parse(readFileSync(fixture, "utf8"));
const tempRoot = mkdtempSync(path.join(tmpdir(), "swarmcast-launch-evidence-"));

function cloneRecord() {
  return JSON.parse(JSON.stringify(baseRecord));
}

function writeVariant(name, transform) {
  const record = transform(cloneRecord());
  const file = path.join(tempRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function gate(record, id) {
  const value = record.gates.find((candidate) => candidate.id === id);
  assert.ok(value, `fixture missing ${id}`);
  return value;
}

function validate(file, extraArgs = []) {
  return spawnSync(process.execPath, ["scripts/validate-launch-evidence.js", "--allow-synthetic", ...extraArgs, file], {
    encoding: "utf8"
  });
}

function expectPass(label, file) {
  const result = validate(file);
  assert.equal(result.status, 0, `${label} should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectFailure(label, file, pattern) {
  const result = validate(file);
  assert.notEqual(result.status, 0, `${label} should fail`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, pattern, `${label} failed with unexpected output:\n${output}`);
}

expectPass("complete synthetic launch evidence", fixture);
expectFailure(
  "non-synthetic staging launch evidence",
  writeVariant("non-synthetic-staging", (record) => {
    record.synthetic = false;
    record.environment = "staging";
    return record;
  }),
  /launch evidence environment must be production/
);
expectFailure(
  "waived launch gate",
  writeVariant("waived-dependency-review", (record) => {
    const dependencyReview = gate(record, "dependency-review");
    dependencyReview.status = "waived";
    dependencyReview.waiver = {
      reason: "synthetic rehearsal waiver",
      approvedBy: "release-lead",
      expiresAt: "2026-07-06T00:00:00.000Z"
    };
    return record;
  }),
  /dependency-review is waived; launch evidence is not complete/
);
expectFailure(
  "missing production release manifest smoke evidence",
  writeVariant("missing-release-manifest-smoke", (record) => {
    const releaseArtifacts = gate(record, "release-artifacts");
    releaseArtifacts.evidence = releaseArtifacts.evidence.filter((evidence) => !evidence.includes("smoke:release-manifest-production"));
    return record;
  }),
  /release-artifacts evidence must mention smoke:release-manifest-production/
);
expectFailure(
  "missing legal viewer retransmission launch evidence",
  writeVariant("missing-legal-viewer-retransmission", (record) => {
    const legalApproval = gate(record, "legal-approval");
    legalApproval.evidence = legalApproval.evidence.map((evidence) => evidence.replaceAll("viewer-device-retransmission", "viewer-device-scope-missing"));
    return record;
  }),
  /legal-approval evidence must mention viewer-device-retransmission/
);
expectFailure(
  "missing privacy store compliance launch evidence",
  writeVariant("missing-privacy-store-compliance", (record) => {
    const privacyStoreCompliance = gate(record, "privacy-store-compliance");
    privacyStoreCompliance.evidence = ["docs/privacy-store-compliance.md"];
    return record;
  }),
  /privacy-store-compliance evidence must mention privacy:store:validate/
);
expectFailure(
  "missing infrastructure image scan evidence",
  writeVariant("missing-node-exporter-scan", (record) => {
    const imageScans = gate(record, "image-scan-reports");
    imageScans.evidence = imageScans.evidence.filter((evidence) => !evidence.includes("var/scans/node-exporter.trivy.json"));
    return record;
  }),
  /image-scan-reports evidence must mention var\/scans\/node-exporter\.trivy\.json/
);
expectFailure(
  "missing Android release config smoke evidence",
  writeVariant("missing-android-release-config-smoke", (record) => {
    const androidReleaseConfig = gate(record, "android-release-config");
    androidReleaseConfig.evidence = androidReleaseConfig.evidence.filter((evidence) => !evidence.includes("smoke:android-release-config-validation"));
    return record;
  }),
  /android-release-config evidence must mention smoke:android-release-config-validation/
);
expectFailure(
  "missing Android CI launch evidence",
  writeVariant("missing-android-ci-evidence", (record) => {
    const androidCi = gate(record, "android-ci-build");
    androidCi.evidence = androidCi.evidence.filter((evidence) => !evidence.includes("android:ci:evidence:validate"));
    return record;
  }),
  /android-ci-build evidence must mention android:ci:evidence:validate/
);
expectFailure(
  "missing Android CI artifact launch evidence",
  writeVariant("missing-android-ci-artifact-evidence", (record) => {
    const androidCi = gate(record, "android-ci-build");
    androidCi.evidence = androidCi.evidence.filter((evidence) => !evidence.includes("swarmcast-android-debug-apk"));
    return record;
  }),
  /android-ci-build evidence must mention swarmcast-android-debug-apk/
);
expectFailure(
  "missing Android playback soak launch evidence",
  writeVariant("missing-android-playback-soak-evidence", (record) => {
    const androidPlayback = gate(record, "android-device-playback");
    androidPlayback.evidence = androidPlayback.evidence.map((evidence) => evidence.replaceAll("30m-soak", "short-soak"));
    return record;
  }),
  /android-device-playback evidence must mention 30m-soak/
);
expectFailure(
  "missing Android P2P cellular no-upload launch evidence",
  writeVariant("missing-android-p2p-cellular-no-upload-evidence", (record) => {
    const androidP2p = gate(record, "android-p2p-transfer");
    androidP2p.evidence = androidP2p.evidence.map((evidence) => evidence.replaceAll("cellular-no-upload", "cellular-upload-unknown"));
    return record;
  }),
  /android-p2p-transfer evidence must mention cellular-no-upload/
);
expectFailure(
  "missing threat model launch evidence",
  writeVariant("missing-threat-model-evidence", (record) => {
    const threatModel = gate(record, "threat-model-signoff");
    threatModel.evidence = threatModel.evidence.filter((evidence) => !evidence.includes("threat:model:validate"));
    return record;
  }),
  /threat-model-signoff evidence must mention threat:model:validate/
);
expectFailure(
  "missing security review launch evidence",
  writeVariant("missing-security-review-evidence", (record) => {
    const securityReview = gate(record, "security-review");
    securityReview.evidence = securityReview.evidence.filter((evidence) => !evidence.includes("security:review:validate"));
    return record;
  }),
  /security-review evidence must mention security:review:validate/
);
expectFailure(
  "missing dependency review SBOM launch evidence",
  writeVariant("missing-dependency-review-sbom-evidence", (record) => {
    const dependencyReview = gate(record, "dependency-review");
    dependencyReview.evidence = dependencyReview.evidence.map((evidence) => evidence.replaceAll("sbom", "software-bill"));
    return record;
  }),
  /dependency-review evidence must mention sbom/
);
expectFailure(
  "missing accessibility touch target launch evidence",
  writeVariant("missing-accessibility-touch-target-evidence", (record) => {
    const accessibility = gate(record, "accessibility-ux-baseline");
    accessibility.evidence = accessibility.evidence.map((evidence) => evidence.replaceAll("touch-targets", "target-size-missing"));
    return record;
  }),
  /accessibility-ux-baseline evidence must mention touch-targets/
);
expectFailure(
  "missing host monitoring launch evidence",
  writeVariant("missing-host-monitoring-evidence", (record) => {
    const hostProvisioning = gate(record, "host-provisioning");
    hostProvisioning.evidence = hostProvisioning.evidence.map((evidence) => evidence.replaceAll("monitoring", "observability-host-missing"));
    return record;
  }),
  /host-provisioning evidence must mention monitoring/
);
expectFailure(
  "missing deployment rollback-ready launch evidence",
  writeVariant("missing-deployment-rollback-ready-evidence", (record) => {
    const deploymentExecution = gate(record, "deployment-execution");
    deploymentExecution.evidence = deploymentExecution.evidence.map((evidence) => evidence.replaceAll("rollback-ready", "rollback-missing"));
    return record;
  }),
  /deployment-execution evidence must mention rollback-ready/
);
expectFailure(
  "missing nginx cross-token launch evidence",
  writeVariant("missing-nginx-cross-token-evidence", (record) => {
    const nginxTls = gate(record, "nginx-tls-smoke");
    nginxTls.evidence = nginxTls.evidence.map((evidence) => evidence.replaceAll("cross-token-hit", "cross-cache-missing"));
    return record;
  }),
  /nginx-tls-smoke evidence must mention cross-token-hit/
);
expectFailure(
  "missing production secrets redaction launch evidence",
  writeVariant("missing-production-secrets-redaction-evidence", (record) => {
    const productionSecrets = gate(record, "production-secrets");
    productionSecrets.evidence = productionSecrets.evidence.map((evidence) => evidence.replaceAll("redaction-proof", "redaction-review-missing"));
    return record;
  }),
  /production-secrets evidence must mention redaction-proof/
);
expectFailure(
  "missing self sustaining sweep launch evidence",
  writeVariant("missing-self-sustaining-sweep", (record) => {
    const capacityLoadLadder = gate(record, "capacity-load-ladder");
    capacityLoadLadder.evidence = capacityLoadLadder.evidence.filter((evidence) => evidence !== "selfSustainingSweep synthetic-pass");
    return record;
  }),
  /capacity-load-ladder evidence must mention selfSustainingSweep/
);
expectFailure(
  "missing WebRTC load ladder launch evidence",
  writeVariant("missing-webrtc-load-ladder", (record) => {
    const capacityLoadLadder = gate(record, "capacity-load-ladder");
    capacityLoadLadder.evidence = capacityLoadLadder.evidence.filter((evidence) => !evidence.includes("webrtc-datachannel"));
    return record;
  }),
  /capacity-load-ladder evidence must mention webrtc-datachannel/
);
expectFailure(
  "missing peer health staging chaos launch evidence",
  writeVariant("missing-peer-health-staging-chaos", (record) => {
    const stagingChaos = gate(record, "staging-chaos-drills");
    stagingChaos.evidence = stagingChaos.evidence.filter((evidence) => !evidence.includes("peer-health-incident"));
    return record;
  }),
  /staging-chaos-drills evidence must mention peer-health-incident/
);
expectFailure(
  "missing playback continuity staging chaos launch evidence",
  writeVariant("missing-playback-continuity-staging-chaos", (record) => {
    const stagingChaos = gate(record, "staging-chaos-drills");
    stagingChaos.evidence = stagingChaos.evidence.filter((evidence) => !evidence.includes("android-playback-continuity"));
    return record;
  }),
  /staging-chaos-drills evidence must mention android-playback-continuity/
);
expectFailure(
  "missing alertmanager fire drill launch evidence",
  writeVariant("missing-alertmanager-fire-drill", (record) => {
    const alertFireDrill = gate(record, "alert-receiver-fire-drill");
    alertFireDrill.evidence = alertFireDrill.evidence.filter((evidence) => !evidence.includes("alertmanager:fire-drill:validate"));
    return record;
  }),
  /alert-receiver-fire-drill evidence must mention alertmanager:fire-drill:validate/
);
expectFailure(
  "missing alertmanager resolved critical launch evidence",
  writeVariant("missing-alertmanager-resolved-critical", (record) => {
    const alertFireDrill = gate(record, "alert-receiver-fire-drill");
    alertFireDrill.evidence = alertFireDrill.evidence.map((evidence) => evidence.replaceAll("critical-resolved", "resolved-missing"));
    return record;
  }),
  /alert-receiver-fire-drill evidence must mention critical-resolved/
);
expectFailure(
  "missing prometheus alert launch evidence",
  writeVariant("missing-prometheus-alerts", (record) => {
    const prometheusAlerts = gate(record, "prometheus-alerts");
    prometheusAlerts.evidence = ["monitoring/prometheus-alerts-synthetic-report"];
    return record;
  }),
  /prometheus-alerts evidence must mention prometheus:alerts:validate/
);
expectFailure(
  "missing prometheus peer hash alert launch evidence",
  writeVariant("missing-prometheus-peer-hash-alert", (record) => {
    const prometheusAlerts = gate(record, "prometheus-alerts");
    prometheusAlerts.evidence = prometheusAlerts.evidence.map((evidence) => evidence.replaceAll("SwarmcastPeerHashFailures", "PeerHashAlertMissing"));
    return record;
  }),
  /prometheus-alerts evidence must mention SwarmcastPeerHashFailures/
);
expectFailure(
  "missing catalog import launch evidence",
  writeVariant("missing-catalog-import", (record) => {
    const catalogImport = gate(record, "catalog-import");
    catalogImport.evidence = ["catalog-import/signed-sanitized-snapshot-synthetic"];
    return record;
  }),
  /catalog-import evidence must mention catalog:import:validate/
);
expectFailure(
  "missing canary metrics launch evidence",
  writeVariant("missing-canary-metrics", (record) => {
    const canaryRollout = gate(record, "canary-rollout");
    canaryRollout.evidence = ["canary:rollout:evidence:validate synthetic-pass"];
    return record;
  }),
  /canary-rollout evidence must mention canary:metrics:validate/
);
expectFailure(
  "missing production environment launch evidence",
  writeVariant("missing-production-environment", (record) => {
    const productionEnvironment = gate(record, "production-environment");
    productionEnvironment.evidence = ["deployment/compose-production-render-synthetic-report"];
    return record;
  }),
  /production-environment evidence must mention env:production:validate/
);
expectFailure(
  "missing production smoke area launch evidence",
  writeVariant("missing-production-smoke-area", (record) => {
    const productionSmokes = gate(record, "production-smokes");
    productionSmokes.evidence = ["production:smoke:evidence:validate synthetic-pass"];
    return record;
  }),
  /production-smokes evidence must mention source-preflight/
);
expectFailure(
  "missing rollback drill launch evidence",
  writeVariant("missing-rollback-evidence", (record) => {
    const rollbackDrill = gate(record, "rollback-drill");
    rollbackDrill.evidence = rollbackDrill.evidence.filter((evidence) => !evidence.includes("rollback:evidence:validate"));
    return record;
  }),
  /rollback-drill evidence must mention rollback:evidence:validate/
);
expectFailure(
  "missing rollback incident-control launch evidence",
  writeVariant("missing-rollback-incident-control", (record) => {
    const rollbackDrill = gate(record, "rollback-drill");
    rollbackDrill.evidence = rollbackDrill.evidence.filter((evidence) => !evidence.includes("app-incident-delivery-fleet-only"));
    return record;
  }),
  /rollback-drill evidence must mention app-incident-delivery-fleet-only/
);
expectFailure(
  "missing restore drill launch evidence",
  writeVariant("missing-restore-evidence", (record) => {
    const restoreDrill = gate(record, "restore-drill");
    restoreDrill.evidence = ["docs/runbooks/restore-drill.md#synthetic-rehearsal"];
    return record;
  }),
  /restore-drill evidence must mention restore:evidence:validate/
);
expectFailure(
  "sensitive source URL in launch evidence",
  writeVariant("sensitive-source-url", (record) => {
    gate(record, "production-smokes").evidence.push("sourceUrl=https://source1.upstream.tv/live/private.m3u8");
    return record;
  }),
  /production-smokes evidence reference looks like it may contain sensitive stream or token material/
);

console.log("launch evidence validation smoke OK: pass=1 failures=35");
