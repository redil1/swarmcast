import { readFileSync } from "node:fs";
import { missingRequiredEnvExampleKeys } from "../packages/config/src/env.js";
import { validatePerformanceBudgets } from "../packages/config/src/performanceBudgets.js";

const checks = [
  {
    file: "infra/nginx/swarmcast.conf",
    required: [
      "listen 80",
      "server_name origin.example.tv api.example.tv tracker.example.tv",
      "location ^~ /.well-known/acme-challenge/",
      "root /var/www/certbot",
      "auth_request /_auth",
      "limit_req zone=seg",
      "proxy_pass http://tracker_ws",
      "proxy_pass http://control_plane",
      "Cache-Control \"public, max-age=300, immutable\""
    ],
    forbidden: ["cloudfront", "akamai", "fastly", "cdn"]
  },
  {
    file: "infra/edge/nginx-edge.conf",
    required: [
      "listen 80",
      "server_name edge.example.tv",
      "location ^~ /.well-known/acme-challenge/",
      "root /var/www/certbot",
      "proxy_cache_lock on",
      "proxy_cache_key \"$scheme$proxy_host$uri\"",
      "add_header X-Cache $upstream_cache_status",
      "log_format swarmcast_edge escape=json",
      "access_log /var/log/nginx/edge-access.log swarmcast_edge",
      "$body_bytes_sent",
      "$request_time",
      "$upstream_response_time",
      "proxy_cache_valid 200 60s",
      "auth_request /_auth",
      "proxy_set_header X-Original-URI $request_uri"
    ],
    forbidden: ["cloudfront", "akamai", "fastly"]
  },
  {
    file: "infra/docker-compose.yml",
    required: [
      "TRACKER_INTERNAL_URL: http://tracker:7002",
      "AUTH_JWKS_URL: http://auth:7003/jwks",
      "AUTH_JWT_AUDIENCE",
      "AUTH_JWT_ISSUER",
      "AUTH_TOKEN_TTL_SECONDS",
      "AUTH_PLAY_INTEGRITY_ENABLED",
      "AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH",
      "AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS",
      "AUTH_ATTESTATION_CHALLENGE_SECRET",
      "AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET",
      "M3U_PATH: ${M3U_PATH:-/config/source.m3u}",
      "SOURCE_ALLOWED_HOSTS",
      "SOURCE_ALLOW_PRIVATE_NETWORKS",
      "TAIL_ADMISSION_MAX_CHANNELS",
      "TAIL_DOWNSCALE_ENABLED",
      "TAIL_DOWNSCALE_VIDEO_KBPS",
      "TAIL_DOWNSCALE_AUDIO_KBPS",
      "EDGE_BASE",
      "TRACKER_MAX_CONNECTIONS",
      "TRACKER_MAX_PAYLOAD_BYTES",
      "TRACKER_IDLE_TIMEOUT_SECONDS",
      "TRACKER_DEMAND_HEARTBEAT_SECONDS",
      "TRACKER_SHARD_ID",
      "TRACKER_SHARDS",
      "context: ..",
      "dockerfile: services/ingest/Dockerfile",
      "dockerfile: services/tracker/Dockerfile",
      "dockerfile: services/auth/Dockerfile",
      "dockerfile: services/control-plane/Dockerfile",
      "dockerfile: services/web/Dockerfile",
      "dockerfile: services/retention-worker/Dockerfile",
      "AUTH_KEY_PATH: ${AUTH_KEY_PATH:-/data/es256.pem}",
      "INGEST_NODES: ${INGEST_NODES:-",
      "RETENTION_POLICY_FILE: /config/data-retention.json",
      "RETENTION_EXECUTE",
      "RETENTION_STORE_MODULE",
      "RETENTION_STORE_HTTP_BASE_URL",
      "RETENTION_STORE_HTTP_TIMEOUT_MS",
      "RETENTION_RECORDS_FILE: ${RETENTION_RECORDS_FILE:-/data/retention-records.jsonl}",
      "CATALOG_DB_PATH: ${CATALOG_DB_PATH:-/data/catalog.sqlite}",
      "CATALOG_SNAPSHOT_PATH: ${CATALOG_SNAPSHOT_PATH:-/data/catalog-snapshot.json}",
      "PLACEMENT_DB_PATH: ${PLACEMENT_DB_PATH:-/data/placements.sqlite}",
      "PLACEMENT_PATH: ${PLACEMENT_PATH:-/data/placements.json}",
      "${SWARMCAST_NGINX_IMAGE:-swarmcast-nginx:local}",
      "${SWARMCAST_PROMETHEUS_IMAGE:-prom/prometheus:v3.13.1-distroless}",
      "${SWARMCAST_ALERTMANAGER_IMAGE:-swarmcast-alertmanager:local}",
      "${SWARMCAST_GRAFANA_IMAGE:-swarmcast-grafana:local}",
      "${ALERTMANAGER_CONFIG_PATH:-./monitoring/alertmanager.yml}:/etc/alertmanager/alertmanager.yml:ro",
      "/var/www/certbot:/var/www/certbot:ro"
    ],
    forbidden: ["cloudfront", "akamai", "fastly"]
  },
  {
    file: "infra/docker-compose.release.yml",
    required: [
      "SWARMCAST_AUTH_IMAGE",
      "SWARMCAST_INGEST_IMAGE",
      "SWARMCAST_TRACKER_IMAGE",
      "SWARMCAST_CONTROL_PLANE_IMAGE",
      "SWARMCAST_WEB_IMAGE",
      "SWARMCAST_RETENTION_WORKER_IMAGE",
      "auth:",
      "ingest:",
      "tracker:",
      "control-plane:",
      "web:",
      "retention-worker:"
    ],
    forbidden: ["cloudfront", "akamai", "fastly"]
  },
  {
    file: "infra/edge/docker-compose.yml",
    required: [
      "edge-metrics:",
      "${SWARMCAST_EDGE_NGINX_IMAGE:-swarmcast-edge-nginx:local}",
      "${SWARMCAST_EDGE_METRICS_IMAGE:-swarmcast-edge-metrics:local}",
      "dockerfile: infra/edge/Dockerfile.nginx",
      "dockerfile: infra/edge/Dockerfile.metrics",
      "${SWARMCAST_NODE_EXPORTER_IMAGE:-prom/node-exporter:v1.12.0-distroless}",
      "EDGE_ACCESS_LOG: /var/log/nginx/edge-access.log",
      "EDGE_METRICS_PORT: \"9101\"",
      "edge_logs:/var/log/nginx",
      "edge_logs:/var/log/nginx:ro",
      "\"80:80\"",
      "/var/www/certbot:/var/www/certbot:ro",
      "\"9101:9101\""
    ],
    forbidden: ["cloudfront", "akamai", "fastly"]
  },
  {
    file: "infra/edge/Dockerfile.metrics",
    required: [
      "packages/config/src/lifecycle.js",
      "HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3",
      "http://127.0.0.1:9101/ready"
    ],
    forbidden: []
  },
  {
    file: "infra/host/sysctl.d/99-swarmcast.conf",
    required: [
      "fs.file-max = 2097152",
      "net.core.somaxconn = 65535",
      "net.core.netdev_max_backlog = 250000",
      "net.ipv4.ip_local_port_range = 1024 65535",
      "net.ipv4.tcp_max_syn_backlog = 65535",
      "vm.swappiness = 10"
    ],
    forbidden: []
  },
  {
    file: "infra/host/security-limits.d/99-swarmcast.conf",
    required: [
      "* soft nofile 1048576",
      "* hard nofile 1048576",
      "root soft nofile 1048576",
      "root hard nofile 1048576"
    ],
    forbidden: []
  },
  {
    file: "infra/host/firewall/ufw-swarmcast.sh",
    required: [
      "APPLY=\"${APPLY:-0}\"",
      "DRY RUN:",
      "ufw default deny incoming",
      "ufw default allow outgoing",
      "ALLOW_SSH_FROM",
      "ufw allow 80/tcp",
      "ufw allow 443/tcp",
      "7000 7001 7002 7003 7010 7020 9101",
      "ufw deny",
      "ufw --force enable"
    ],
    forbidden: []
  },
  {
    file: "infra/host/tls/certbot-swarmcast.sh",
    required: [
      "APPLY=\"${APPLY:-0}\"",
      "CERTBOT_MODE=\"${CERTBOT_MODE:-webroot}\"",
      "DOMAINS_RAW=\"${DOMAINS:-origin.example.tv,api.example.tv,tracker.example.tv}\"",
      "WEBROOT=\"${WEBROOT:-/var/www/certbot}\"",
      "certbot certonly",
      "--cert-name",
      "--webroot-path",
      "--standalone",
      "--deploy-hook",
      "ALLOW_PLACEHOLDER_DOMAINS",
      "DRY RUN:"
    ],
    forbidden: []
  },
  {
    file: "infra/turn/docker-compose.yml",
    required: [
      "swarmcast-turn:local",
      "network_mode: host",
      "TURN_SHARED_SECRET",
      "TURN_PREVIOUS_SHARED_SECRET",
      "TURN_BPS_CAPACITY",
      "TURN_MIN_PORT",
      "TURN_MAX_PORT",
      "read_only: true",
      "cap_drop: [\"ALL\"]",
      "NET_BIND_SERVICE",
      "turnutils_stunclient"
    ],
    forbidden: ["cloudfront", "akamai", "fastly"]
  },
  {
    file: "infra/turn/Dockerfile",
    required: [
      "alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40",
      "PROMETHEUS_CLIENT_COMMIT=23b260f0916ef9ea03cac91d3d64a93cd33ea563",
      "COTURN_COMMIT=678996a52954ddc7a44afd9f72f5b5c647e41083",
      "TURN_NO_SQLITE=1",
      "apk upgrade --no-cache",
      "USER nobody:nogroup"
    ],
    forbidden: []
  },
  {
    file: "infra/turn/render-config.sh",
    required: [
      "use-auth-secret",
      "static-auth-secret=$TURN_SHARED_SECRET",
      "TURN_PREVIOUS_SHARED_SECRET",
      "cert=/certs/fullchain.pem",
      "pkey=/certs/privkey.pem",
      "denied-peer-ip=10.0.0.0-10.255.255.255",
      "TURN_ALLOW_PRIVATE_PEERS",
      "prometheus",
      "no-cli",
      "no-rfc5780"
    ],
    forbidden: []
  },
  {
    file: "infra/host/firewall/ufw-turn.sh",
    required: [
      "APPLY=\"${APPLY:-0}\"",
      "ALLOW_METRICS_FROM",
      "TURN_LISTENING_PORT",
      "TURN_TLS_LISTENING_PORT",
      "TURN_MIN_PORT}:${TURN_MAX_PORT}/udp",
      "TURN_MIN_PORT}:${TURN_MAX_PORT}/tcp",
      "restricted turn metrics",
      "deny public turn metrics",
      "DRY RUN:"
    ],
    forbidden: []
  },
  {
    file: "services/auth/src/turnCredentials.js",
    required: ["createHmac", "sha1", "expiresAt", "username", "credential"],
    forbidden: []
  },
  {
    file: "docs/runbooks/turn-relay.md",
    required: [
      "TURN Relay Operations",
      "TURN_SHARED_SECRET",
      "TURN_PREVIOUS_SHARED_SECRET",
      "turn_total_allocations",
      "turn_total_traffic_sentb",
      "SwarmcastTurnTargetDown",
      "npm run smoke:turn",
      "turn:capacity:evidence:validate",
      "synchronized external capacity procedure",
      "two relay failure domains",
      "Delivery Fleet"
    ],
    forbidden: []
  },
  {
    file: "docs/runbooks/app-attestation.md",
    required: [
      "Play Integrity",
      "AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH",
      "AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET",
      "AUTH_ATTESTATION_CHALLENGE_TTL_SECONDS",
      "SwarmcastAppAttestationFailures",
      "android:attestation:evidence:validate"
    ],
    forbidden: []
  },
  {
    file: ".github/CODEOWNERS",
    required: ["* @redil1", "/.github/ @redil1", "/infra/ @redil1", "/services/auth/ @redil1"],
    forbidden: []
  },
  {
    file: ".github/dependabot.yml",
    required: [
      "package-ecosystem: npm",
      "package-ecosystem: gradle",
      "package-ecosystem: github-actions",
      "package-ecosystem: docker",
      "directory: /android",
      "interval: weekly"
    ],
    forbidden: []
  },
  {
    file: "scripts/validate-android-attestation-evidence.js",
    required: [
      "packageName",
      "cloudProjectNumber",
      "certificateSha256Digest",
      "requestHashMatched",
      "replayRejected",
      "rawIntegrityTokenStored"
    ],
    forbidden: []
  }
];

let failed = false;

function serviceBlock(text, service) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${service}:`);
  if (start === -1) return "";
  const endOffset = lines.slice(start + 1).findIndex((line) => /^  [A-Za-z0-9_-]+:\s*$/.test(line));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start, end).join("\n");
}

for (const check of checks) {
  const text = readFileSync(check.file, "utf8").toLowerCase();

  for (const required of check.required) {
    if (!text.includes(required.toLowerCase())) {
      console.error(`${check.file}: missing required text: ${required}`);
      failed = true;
    }
  }

  for (const forbidden of check.forbidden) {
    if (text.includes(forbidden.toLowerCase())) {
      console.error(`${check.file}: contains forbidden CDN/provider text: ${forbidden}`);
      failed = true;
    }
  }
}

const coreComposeText = readFileSync("infra/docker-compose.yml", "utf8");
for (const service of ["ingest", "tracker", "auth", "control-plane", "retention-worker"]) {
  const block = serviceBlock(coreComposeText, service);
  for (const required of [
    "init: true",
    "stop_grace_period: 15s",
    "read_only: true",
    "cap_drop: [\"ALL\"]",
    "security_opt: [\"no-new-privileges:true\"]",
    "healthcheck:",
    "/ready"
  ]) {
    if (!block.includes(required)) {
      console.error(`infra/docker-compose.yml: ${service} missing lifecycle control: ${required}`);
      failed = true;
    }
  }
}

const edgeMetricsBlock = serviceBlock(readFileSync("infra/edge/docker-compose.yml", "utf8"), "edge-metrics");
for (const required of [
  "init: true",
  "stop_grace_period: 15s",
  "read_only: true",
  "cap_drop: [\"ALL\"]",
  "security_opt: [\"no-new-privileges:true\"]",
  "healthcheck:",
  "/ready"
]) {
  if (!edgeMetricsBlock.includes(required)) {
    console.error(`infra/edge/docker-compose.yml: edge-metrics missing lifecycle control: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);

const hostBootstrapText = readFileSync("docs/runbooks/host-bootstrap.md", "utf8");
for (const required of [
  "Ubuntu 24.04 LTS",
  "infra/host/sysctl.d/99-swarmcast.conf",
  "infra/host/security-limits.d/99-swarmcast.conf",
  "infra/host/firewall/ufw-swarmcast.sh",
  "infra/host/tls/certbot-swarmcast.sh",
  "install -m 0644 infra/host/sysctl.d/99-swarmcast.conf",
  "install -m 0644 infra/host/security-limits.d/99-swarmcast.conf",
  "DRY_RUN=1 infra/host/firewall/ufw-swarmcast.sh",
  "ALLOW_SSH_FROM=203.0.113.10/32 APPLY=1 infra/host/firewall/ufw-swarmcast.sh",
  "CERTBOT_MODE=standalone",
  "CERTBOT_MODE=webroot",
  "certbot renew --dry-run",
  "npm run host:provisioning:evidence:validate -- path/to/host-provisioning-evidence.json",
  "test-fixtures/infra/host-provisioning-complete.synthetic.json",
  "one certificate directory for each public hostname",
  "sysctl --system",
  "net.core.somaxconn",
  "ulimit -n",
  "1048576",
  "origin, edge, API, tracker, control-plane, retention-worker, TURN, and monitoring",
  "infra/host/firewall/ufw-turn.sh",
  "Evidence references for bootstrap checks must explicitly include the check IDs"
]) {
  if (!hostBootstrapText.includes(required)) {
    console.error(`docs/runbooks/host-bootstrap.md: missing host bootstrap text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);

const jsonFiles = [
  "infra/monitoring/grafana/dashboards/swarmcast-overview.json",
  "config/performance-budgets.json",
  "config/dependency-inventory.json",
  "config/data-retention.json",
  "config/capacity-plan.json"
];

for (const file of jsonFiles) {
  try {
    JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`${file}: invalid JSON: ${error.message}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const packageText = readFileSync("package.json", "utf8");
for (const required of [
  "\"check\": \"node scripts/check-syntax.js && node scripts/validate-fmp4-fixtures.js && node scripts/smoke-fmp4-fixture-validation.js && node scripts/validate-prometheus-alerts.js && node scripts/smoke-prometheus-alerts-validation.js && node scripts/validate-grafana-dashboard.js && node scripts/smoke-grafana-dashboard-validation.js && node scripts/smoke-production-env-validation.js && node scripts/smoke-compose-production-env.js && node scripts/smoke-release-images-validation.js && node scripts/smoke-release-manifest-production.js && node scripts/smoke-image-scan-bundle-validation.js && node scripts/smoke-image-scan-report-validation.js && node scripts/smoke-deployment-evidence-validation.js && node scripts/smoke-rollback-evidence-validation.js && node scripts/smoke-secrets-evidence-validation.js && node scripts/smoke-repository-governance-evidence-validation.js && node scripts/smoke-host-provisioning-evidence-validation.js && node scripts/smoke-source-allowlist-evidence-validation.js && node scripts/smoke-production-smoke-evidence-validation.js && node scripts/smoke-privacy-store-compliance-validation.js && node scripts/smoke-legal-approval-validation.js && node scripts/smoke-android-ci-evidence-validation.js && node scripts/smoke-android-release-config-validation.js && node scripts/smoke-android-attestation-evidence-validation.js && node scripts/smoke-android-playback-evidence-validation.js && node scripts/smoke-android-p2p-evidence-validation.js && node scripts/smoke-android-device-lab.js && node scripts/smoke-android-rlnc-decision-validation.js && node scripts/smoke-android-accessibility-evidence-validation.js && node scripts/smoke-catalog-import-validation.js && node scripts/smoke-nginx-tls-evidence-validation.js && node scripts/smoke-alertmanager-receivers-validation.js && node scripts/smoke-alertmanager-fire-drill-validation.js && node scripts/smoke-canary-metrics-validation.js && node scripts/smoke-canary-rollout-evidence-validation.js && node scripts/smoke-capacity-plan-validation.js && node scripts/smoke-segment-bus-capacity-probe.js && node scripts/smoke-segment-bus-capacity-evidence-validation.js && node scripts/smoke-load-ladder-probe.js && node scripts/smoke-load-ladder-evidence-validation.js && node scripts/smoke-turn-capacity-evidence-validation.js && node scripts/smoke-turn-capacity-probe.js && node scripts/smoke-staging-chaos-evidence-validation.js && node scripts/smoke-restore-evidence-validation.js && node scripts/smoke-security-review-validation.js && node scripts/smoke-dependency-review-validation.js && node scripts/smoke-threat-model-review-validation.js && node scripts/smoke-retention-approval-validation.js && node scripts/smoke-retention-execution-evidence-validation.js && node scripts/smoke-launch-artifact-bundle-validation.js && node scripts/smoke-launch-evidence-validation.js && npm run evidence:committed:validate && node scripts/validate-configs.js\"",
  "\"smoke:compose-production-env\": \"node scripts/smoke-compose-production-env.js\"",
  "\"smoke:production-env-validation\": \"node scripts/smoke-production-env-validation.js\"",
  "\"smoke:release-images-validation\": \"node scripts/smoke-release-images-validation.js\"",
  "\"smoke:launch-evidence-validation\": \"node scripts/smoke-launch-evidence-validation.js\"",
  "\"smoke:launch-artifact-bundle-validation\": \"node scripts/smoke-launch-artifact-bundle-validation.js\"",
  "\"media:fixtures:validate\": \"node scripts/validate-fmp4-fixtures.js\"",
  "\"smoke:fmp4-fixture-validation\": \"node scripts/smoke-fmp4-fixture-validation.js\"",
  "\"smoke:image-scan-bundle-validation\": \"node scripts/smoke-image-scan-bundle-validation.js\"",
  "\"smoke:image-scan-report-validation\": \"node scripts/smoke-image-scan-report-validation.js\"",
  "\"smoke:deployment-evidence-validation\": \"node scripts/smoke-deployment-evidence-validation.js\"",
  "\"smoke:rollback-evidence-validation\": \"node scripts/smoke-rollback-evidence-validation.js\"",
  "\"smoke:secrets-evidence-validation\": \"node scripts/smoke-secrets-evidence-validation.js\"",
  "\"smoke:repository-governance-evidence-validation\": \"node scripts/smoke-repository-governance-evidence-validation.js\"",
  "\"smoke:host-provisioning-evidence-validation\": \"node scripts/smoke-host-provisioning-evidence-validation.js\"",
  "\"smoke:source-allowlist-evidence-validation\": \"node scripts/smoke-source-allowlist-evidence-validation.js\"",
  "\"smoke:production-smoke-evidence-validation\": \"node scripts/smoke-production-smoke-evidence-validation.js\"",
  "\"smoke:privacy-store-compliance-validation\": \"node scripts/smoke-privacy-store-compliance-validation.js\"",
  "\"smoke:legal-approval-validation\": \"node scripts/smoke-legal-approval-validation.js\"",
  "\"smoke:catalog-import-validation\": \"node scripts/smoke-catalog-import-validation.js\"",
  "\"smoke:android-ci-evidence-validation\": \"node scripts/smoke-android-ci-evidence-validation.js\"",
  "\"smoke:android-release-config-validation\": \"node scripts/smoke-android-release-config-validation.js\"",
  "\"smoke:android-attestation-evidence-validation\": \"node scripts/smoke-android-attestation-evidence-validation.js\"",
  "\"smoke:android-playback-evidence-validation\": \"node scripts/smoke-android-playback-evidence-validation.js\"",
  "\"smoke:android-p2p-evidence-validation\": \"node scripts/smoke-android-p2p-evidence-validation.js\"",
  "\"smoke:android-device-lab\": \"node scripts/smoke-android-device-lab.js\"",
  "\"smoke:android-rlnc-decision-validation\": \"node scripts/smoke-android-rlnc-decision-validation.js\"",
  "\"smoke:android-accessibility-evidence-validation\": \"node scripts/smoke-android-accessibility-evidence-validation.js\"",
  "\"smoke:nginx-tls-evidence-validation\": \"node scripts/smoke-nginx-tls-evidence-validation.js\"",
  "\"smoke:alertmanager-receivers-validation\": \"node scripts/smoke-alertmanager-receivers-validation.js\"",
  "\"smoke:alertmanager-fire-drill-validation\": \"node scripts/smoke-alertmanager-fire-drill-validation.js\"",
  "\"smoke:prometheus-alerts-validation\": \"node scripts/smoke-prometheus-alerts-validation.js\"",
  "\"smoke:grafana-dashboard-validation\": \"node scripts/smoke-grafana-dashboard-validation.js\"",
  "\"smoke:canary-metrics-validation\": \"node scripts/smoke-canary-metrics-validation.js\"",
  "\"smoke:canary-rollout-evidence-validation\": \"node scripts/smoke-canary-rollout-evidence-validation.js\"",
  "\"smoke:capacity-plan-validation\": \"node scripts/smoke-capacity-plan-validation.js\"",
  "\"smoke:segment-bus-capacity-probe\": \"node scripts/smoke-segment-bus-capacity-probe.js\"",
  "\"smoke:segment-bus-capacity-evidence-validation\": \"node scripts/smoke-segment-bus-capacity-evidence-validation.js\"",
  "\"smoke:load-ladder-probe\": \"node scripts/smoke-load-ladder-probe.js\"",
  "\"smoke:load-ladder-evidence-validation\": \"node scripts/smoke-load-ladder-evidence-validation.js\"",
  "\"smoke:turn-capacity-evidence-validation\": \"node scripts/smoke-turn-capacity-evidence-validation.js\"",
  "\"smoke:turn-capacity-probe\": \"node scripts/smoke-turn-capacity-probe.js\"",
  "\"smoke:staging-chaos-evidence-validation\": \"node scripts/smoke-staging-chaos-evidence-validation.js\"",
  "\"smoke:restore-evidence-validation\": \"node scripts/smoke-restore-evidence-validation.js\"",
  "\"smoke:security-review-validation\": \"node scripts/smoke-security-review-validation.js\"",
  "\"smoke:dependency-review-validation\": \"node scripts/smoke-dependency-review-validation.js\"",
  "\"smoke:threat-model-review-validation\": \"node scripts/smoke-threat-model-review-validation.js\"",
  "\"smoke:retention-approval-validation\": \"node scripts/smoke-retention-approval-validation.js\"",
  "\"smoke:retention-execution-evidence-validation\": \"node scripts/smoke-retention-execution-evidence-validation.js\"",
  "\"prometheus:alerts:validate\": \"node scripts/validate-prometheus-alerts.js\"",
  "\"grafana:dashboard:validate\": \"node scripts/validate-grafana-dashboard.js\"",
  "\"sbom:generate\": \"node scripts/generate-sbom.js\"",
  "\"launch:evidence:validate\": \"node scripts/validate-launch-evidence.js\"",
  "\"launch:artifacts:generate\": \"node scripts/generate-launch-artifact-bundle.js\"",
  "\"legal:approval:validate\": \"node scripts/validate-legal-approval.js\"",
  "\"privacy:store:validate\": \"node scripts/validate-privacy-store-compliance.js\"",
  "\"production:smoke:evidence:validate\": \"node scripts/validate-production-smoke-evidence.js\"",
  "\"env:production:validate\": \"node scripts/validate-production-env.js\"",
  "\"alertmanager:receivers:validate\": \"node scripts/validate-alertmanager-receivers.js\"",
  "\"alertmanager:fire-drill:validate\": \"node scripts/validate-alertmanager-fire-drill.js\"",
  "\"smoke:control-plane-placement-sqlite\": \"node scripts/smoke-control-plane-placement-sqlite.js\"",
  "\"smoke:sqlite-backup-restore\": \"node scripts/smoke-sqlite-backup-restore.js\"",
  "\"smoke:catalog-sqlite\": \"node scripts/smoke-catalog-sqlite.js\"",
  "\"smoke:catalog-sqlite-20k\": \"node scripts/smoke-catalog-sqlite-20k.js\"",
  "\"source:allowlist:evidence:validate\": \"node scripts/validate-source-allowlist-evidence.js\"",
  "\"catalog:import:validate\": \"node scripts/validate-catalog-import.js\"",
  "\"host:provisioning:evidence:validate\": \"node scripts/validate-host-provisioning-evidence.js\"",
  "\"secrets:evidence:validate\": \"node scripts/validate-secrets-evidence.js\"",
  "\"repository:governance:evidence:validate\": \"node scripts/validate-repository-governance-evidence.js\"",
  "\"evidence:committed:validate\": \"node scripts/validate-android-ci-evidence.js evidence/android/ci-build-29785361703.json && node scripts/validate-repository-governance-evidence.js evidence/security/repository-governance-main-20260720.json\"",
  "\"deployment:evidence:validate\": \"node scripts/validate-deployment-evidence.js\"",
  "\"smoke:alertmanager-routing\": \"node scripts/smoke-alertmanager-routing.js\"",
  "\"canary:metrics:validate\": \"node scripts/validate-canary-metrics.js\"",
  "\"canary:rollout:evidence:validate\": \"node scripts/validate-canary-rollout-evidence.js\"",
  "\"capacity:plan:validate\": \"node scripts/validate-capacity-plan.js\"",
  "\"segment-bus:capacity:probe\": \"node scripts/run-segment-bus-capacity-probe.js\"",
  "\"segment-bus:capacity:evidence:validate\": \"node scripts/validate-segment-bus-capacity-evidence.js\"",
  "\"android:release-config:validate\": \"node scripts/validate-android-release-config.js\"",
  "\"android:attestation:evidence:validate\": \"node scripts/validate-android-attestation-evidence.js\"",
  "\"android:ci:evidence:validate\": \"node scripts/validate-android-ci-evidence.js\"",
  "\"android:accessibility:validate\": \"node scripts/validate-android-accessibility-evidence.js\"",
  "\"android:playback:evidence:validate\": \"node scripts/validate-android-playback-evidence.js\"",
  "\"android:p2p:evidence:validate\": \"node scripts/validate-android-p2p-evidence.js\"",
  "\"android:device-lab\": \"node scripts/run-android-device-lab.js\"",
  "\"android:rlnc:decision:validate\": \"node scripts/validate-android-rlnc-decision.js\"",
  "\"load:ladder:validate\": \"node scripts/validate-load-ladder-evidence.js\"",
  "\"load:ladder:probe\": \"node scripts/run-load-ladder-probe.js\"",
  "\"turn:capacity:probe\": \"node scripts/run-turn-capacity-probe.js\"",
  "\"turn:capacity:evidence:validate\": \"node scripts/validate-turn-capacity-evidence.js\"",
  "\"chaos:staging:validate\": \"node scripts/validate-staging-chaos-evidence.js\"",
  "\"nginx:tls:evidence:validate\": \"node scripts/validate-nginx-tls-evidence.js\"",
  "\"release:manifest\": \"node scripts/generate-release-manifest.js\"",
  "\"release:images:check\": \"node scripts/validate-release-images.js\"",
  "\"image:scan:validate\": \"node scripts/validate-image-scan-report.js\"",
  "\"image:scan:bundle:validate\": \"node scripts/validate-image-scan-bundle.js\"",
  "\"dependency:review:validate\": \"node scripts/validate-dependency-review.js\"",
  "\"threat:model:validate\": \"node scripts/validate-threat-model-review.js\"",
  "\"retention:approval:validate\": \"node scripts/validate-retention-approval.js\"",
  "\"retention:execution:evidence:validate\": \"node scripts/validate-retention-execution-evidence.js\"",
  "\"restore:evidence:validate\": \"node scripts/validate-restore-evidence.js\"",
  "\"rollback:evidence:validate\": \"node scripts/validate-rollback-evidence.js\"",
  "\"security:review:validate\": \"node scripts/validate-security-review.js\"",
  "\"smoke:tracker-ws\"",
  "\"smoke:tracker-ws-cells-1k\"",
  "\"smoke:tracker-ws-cells-10k\"",
  "\"smoke:webrtc-200\"",
  "\"smoke:webrtc-hash-rejection\"",
  "\"smoke:webrtc-turn-relay\"",
  "\"smoke:webrtc-turn-relay-20\"",
  "\"smoke:webrtc-turn-auth-rejection\"",
  "\"verify\""
]) {
  if (!packageText.includes(required)) {
    console.error(`package.json: missing script text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
try {
  validatePerformanceBudgets(JSON.parse(readFileSync("config/performance-budgets.json", "utf8")));
} catch (error) {
  console.error(`config/performance-budgets.json: ${error.message}`);
  failed = true;
}

const performanceBudgetsText = readFileSync("docs/performance-budgets.md", "utf8");
for (const required of [
  "Tracker CPU per message p95",
  "Tracker memory per peer",
  "Segment hash latency p95",
  "Android decode CPU per segment p95",
  "Android battery drain",
  "Android startup latency p95",
  "Android stall rate maximum",
  "Android buffer minimum",
  "Edge cache hit ratio minimum",
  "Segment bus publish acknowledgement p99",
  "Segment bus end-to-end delivery p99",
  "Segment bus leader election maximum",
  "Segment bus publish recovery maximum",
  "Segment bus disk write p95",
  "Segment bus CPU p95 maximum",
  "Segment bus memory p95 maximum",
  "Segment bus storage maximum",
  "docs/segment-bus-capacity.md",
  "npm run canary:metrics:validate -- path/to/canary-metrics.json",
  "npm run smoke:canary-metrics-validation"
]) {
  if (!performanceBudgetsText.includes(required)) {
    console.error(`docs/performance-budgets.md: missing performance budget text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const loadTestingText = readFileSync("docs/load-testing.md", "utf8");
for (const required of [
  "`npm run smoke:ingest-demand-playlist`",
  "`npm run smoke:ingest-ffmpeg-chaos`",
  "`npm run smoke:ingest-tail-admission`",
  "`npm run smoke:ingest-tail-downscale`",
  "`npm run smoke:multi-ingest-routing`",
  "`npm run smoke:edge-cache-metrics`",
  "`npm run smoke:edge-cache-metrics-server`",
  "`npm run smoke:catalog-sqlite-20k`",
  "`npm run smoke:placement-movement`",
  "`npm run smoke:headless-super-peer-sweep`",
  "`npm run smoke:tracker-load`",
  "`npm run smoke:tracker-sharding`",
  "`npm run smoke:tracker-ws`",
  "`npm run smoke:tracker-ws-load`",
  "`npm run smoke:tracker-ws-multichannel`",
  "`npm run smoke:tracker-ws-restart`",
  "`npm run smoke:tracker-ws-cells`",
  "`npm run smoke:tracker-ws-cells-1k`",
  "`npm run smoke:tracker-ws-cells-10k`",
  "`npm run smoke:webrtc-200`",
  "`npm run smoke:webrtc-hash-rejection`",
  "`npm run smoke:webrtc-turn-relay`",
  "`npm run smoke:webrtc-turn-relay-20`",
  "`npm run smoke:webrtc-turn-auth-rejection`",
  "`uWebSockets.js` v20.51.0",
  "Node 18, 20, 22, or 23",
  "`TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws`",
  "Use the same `TRACKER_WS_DOCKER_IMAGE=swarmcast-tracker:local` prefix for `npm run smoke:tracker-ws-load`, `npm run smoke:tracker-ws-multichannel`, and `npm run smoke:tracker-ws-restart`",
  "`TRACKER_CELL_LOAD_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws-cells-1k`",
  "`TRACKER_CELL_LOAD_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:tracker-ws-cells-10k`",
  "`TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-200`",
  "`TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-turn-relay`",
  "`TRACKER_WEBRTC_DOCKER_IMAGE=swarmcast-tracker:local npm run smoke:webrtc-turn-relay-20`",
  "The 1K and 10K cell preflights are control-plane evidence only",
  "The 200-peer browser preflight is real same-host WebRTC transport evidence",
  "The forced-relay preflights additionally prove browser-to-owned-coturn transport",
  "rejects an invalid JWT",
  "two-client WebRTC signaling relay",
  "connection-limit rejection",
  "rate-limit disconnect",
  "oversized-frame disconnect",
  "idle-timeout closure",
  "playback-quality metrics",
  "recurring demand heartbeat",
  "rejects new cold-tail channels",
  "lower-bitrate ffmpeg arguments",
  "wrong-shard `redirect` responses",
  "segment announcement delivery",
  "buffer health",
  "500-peer deterministic headless sweep",
  "charges every preloaded helper segment as bootstrap delivery",
  "self-sustaining sweep command, tested super-peer fractions, flatten fraction, helper upload budget, every preloaded helper charged as bootstrap packets",
  "reconciled within 5% of edge, origin, and relay access-log egress",
  "WebRTC DataChannel transport, tracker-signaling relay path, and successful DataChannel transfer",
  "rho >= 0.90",
  "config/performance-budgets.json",
  "100 ms budget",
  "`npm run smoke:load-ladder-evidence-validation`",
  "`npm run smoke:load-ladder-probe`",
  "`npm run smoke:turn-capacity-probe`",
  "`npm run smoke:turn-capacity-evidence-validation`",
  "## TURN Capacity Ladder",
  "--expected-host-allocations 1300",
  "npm run turn:capacity:evidence:validate -- path/to/turn-capacity-evidence.json",
  "test-fixtures/load/turn-capacity-complete.synthetic.json",
  "## Segment Metadata Bus Capacity",
  "docs/segment-bus-capacity.md",
  "npm run segment-bus:capacity:probe",
  "--acknowledge-staging-disruption",
  "npm run segment-bus:capacity:evidence:validate -- path/to/segment-bus-capacity-evidence.json",
  "npm run smoke:segment-bus-capacity-probe",
  "npm run smoke:segment-bus-capacity-evidence-validation",
  "npm run load:ladder:validate -- path/to/load-ladder-evidence.json",
  "Distributed VM stages are collected through `docs/distributed-load-ladder.md` and `npm run load:ladder:probe`",
  "hash-bound raw probe bundles from independent providers/failure domains",
  "at least 10% cross-generator endpoints",
  "test-fixtures/load/load-ladder-complete.synthetic.json",
  "1 channel / 200 mixed headless peers through real tracker WebSockets and WebRTC DataChannels",
  "50 channels / 2000 peers",
  "1 channel / 1000 peers partitioned across at least 2 tracker cells",
  "1 channel / 10000 peers partitioned across at least 2 tracker cells",
  "1 channel / 100000 peers partitioned across at least 5 tracker cells",
  "exact per-cell peer counts",
  "The committed synthetic fixture proves only",
  "VM/WebRTC ladder"
]) {
  if (!loadTestingText.includes(required)) {
    console.error(`docs/load-testing.md: missing load-testing text: ${required}`);
    failed = true;
  }
}

const distributedLoadLadderText = readFileSync("docs/distributed-load-ladder.md", "utf8");
for (const required of [
  "# Distributed WebRTC Load Ladder",
  "exact-hash WebRTC driver",
  "mode `0600` raw probe bundle",
  "at least five generators",
  "At least 10% of stage endpoints",
  "starts differ by no more than five seconds",
  "the 100K stage runs for at least 900 seconds",
  "SWARMCAST_LOAD_DRIVER_",
  "per simulated viewer",
  "--acknowledge-staging-load",
  "npm run load:ladder:probe",
  "probeArtifacts",
  "generatorProbeIds",
  "npm run load:ladder:validate",
  "npm run smoke:load-ladder-probe",
  "without `--allow-synthetic`"
]) {
  if (!distributedLoadLadderText.includes(required)) {
    console.error(`docs/distributed-load-ladder.md: missing distributed load ladder text: ${required}`);
    failed = true;
  }
}

const loadLadderScriptText = readFileSync("scripts/validate-load-ladder-evidence.js", "utf8");
for (const required of [
  "stageExpectations",
  "validateSelfSustainingSweep",
  "selfSustainingSweep.flattenSuperPeerFraction",
  "selfSustainingSweep.bootstrapAccounting",
  "clientBootstrapOriginBytes",
  "edgeAccessEgressBytes",
  "assertReconciled",
  "smoke:headless-super-peer-sweep",
  "configuredCellMaxPeers",
  "cellPeerCounts",
  "segmentFanoutCells",
  "cellFailureEdgeFallback",
  "cellFailureRejoin",
  "sameCellSignalViolations",
  "originBootstrapCellCount",
  "originSeedAssignments",
  "edgeBootstrapCellCount",
  "edgeSeedAssignments",
  "androidStallRateMax",
  "trackerCpuMsPerMessageP95",
  "webrtc-datachannel",
  "tracker-signaling-relay",
  "dataChannelTransfer",
  "probeArtifacts",
  "validateLoadProbeBundle",
  "generatorProbeIds",
  "distinct network egress fingerprints",
  "generator starts differ by more than five seconds",
  "generator peer ranges have a gap or overlap",
  "cross-generator endpoints must be at least",
  "raw generator probe total",
  "raw probes observed",
  "budgetArgIndex !== -1",
  "synthetic load ladder evidence requires --allow-synthetic",
  "Load ladder evidence OK"
]) {
  if (!loadLadderScriptText.includes(required)) {
    console.error(`scripts/validate-load-ladder-evidence.js: missing load ladder validator text: ${required}`);
    failed = true;
  }
}

const loadLadderFixtureText = readFileSync("test-fixtures/load/load-ladder-complete.synthetic.json", "utf8");
for (const required of [
  "\"ladderId\": \"load-ladder-20260705\"",
  "\"selfSustainingSweep\"",
  "\"flattenSuperPeerFraction\": 0.15",
  "\"bootstrapAccounting\": \"all-preloaded-helpers\"",
  "\"bestOffloadRatio\": 0.85",
  "\"edgeFallbackPackets\": 5750",
  "\"edgeBootstrapPackets\": 1500",
  "\"clientBootstrapOriginBytes\"",
  "\"edgeAccessEgressBytes\"",
  "\"id\": \"1-channel-3-devices\"",
  "\"id\": \"1-channel-200-peers\"",
  "\"id\": \"50-channels-2000-peers\"",
  "\"id\": \"zipf-catalog\"",
  "\"id\": \"1-channel-1000-cell-peers\"",
  "\"id\": \"1-channel-10000-cell-peers\"",
  "\"id\": \"1-channel-100000-cell-peers\"",
  "\"configuredCellMaxPeers\": 20000",
  "\"cellPeerCounts\"",
  "\"segmentFanoutCells\"",
  "\"originBootstrapCellCount\": 1",
  "\"originSeedAssignments\"",
  "\"edgeBootstrapCellCount\"",
  "\"edgeSeedAssignments\"",
  "\"cellFailureEdgeFallback\": true",
  "\"cellFailureRejoin\": true",
  "\"peerCount\": 2000",
  "\"transport\": \"webrtc-datachannel\"",
  "\"signalingPath\": \"tracker-signaling-relay\"",
  "\"dataChannelTransfer\": true",
  "\"probeArtifacts\"",
  "\"generatorProbeIds\"",
  "\"clientUploadBytes\"",
  "\"offloadRatio\": 0.9",
  "\"alertState\": \"clear\"",
  "\"synthetic\": true"
]) {
  if (!loadLadderFixtureText.includes(required)) {
    console.error(`test-fixtures/load/load-ladder-complete.synthetic.json: missing load ladder fixture text: ${required}`);
    failed = true;
  }
}

const rawLoadProbeFixtureText = readFileSync("test-fixtures/load/load-ladder-raw-probes.complete.synthetic.json", "utf8");
for (const required of [
  "\"probeId\":\"p200-a\"",
  "\"probeId\":\"p2k-a\"",
  "\"probeId\":\"pzipf-a\"",
  "\"probeId\":\"p1k-a\"",
  "\"probeId\":\"p10k-a\"",
  "\"probeId\":\"p100k-e\"",
  "\"authMode\":\"per-viewer-short-lived\"",
  "\"crossGeneratorEndpoints\"",
  "\"networkEgressFingerprintSha256\"",
  "\"candidateSelections\"",
  "\"unknown\":0",
  "\"synthetic\": true"
]) {
  if (!rawLoadProbeFixtureText.includes(required)) {
    console.error(`test-fixtures/load/load-ladder-raw-probes.complete.synthetic.json: missing raw probe fixture text: ${required}`);
    failed = true;
  }
}

const loadLadderSmokeText = readFileSync("scripts/smoke-load-ladder-evidence-validation.js", "utf8");
for (const required of [
  "scripts/validate-load-ladder-evidence.js",
  "synthetic load ladder evidence requires --allow-synthetic",
  "missing self sustaining sweep",
  "missing 100K single-channel cell stage",
  "cell exceeds configured ceiling",
  "cell peer totals do not reconcile",
  "segment fanout misses a cell",
  "cell failure does not retain edge fallback",
  "cell backpressure drops present",
  "multiple origin bootstrap cells",
  "origin seed assignments exceed the per-channel bound",
  "secondary cell lacks edge bootstrap",
  "bootstrap evidence marker missing",
  "edge fallback after flatten",
  "missing helper bootstrap accounting",
  "edge access reconciliation drift",
  "zipf-catalog",
  "offloadRatio = 0.89",
  "stallRate = 0.02",
  "trackerCpuMsP95 = 3",
  "dataChannelTransfer = false",
  "alertState = \"firing\"",
  "token=synthetic-secret",
  "missing raw probe artifacts",
  "raw probe artifact hash mismatch",
  "raw probe artifact has an unsupported field",
  "generator peer range overlap",
  "generator providers are not independent",
  "generator starts are not synchronized",
  "probe totals do not reconcile to stage bytes",
  "raw probes miss a tracker cell",
  "unknown selected ICE candidate in raw probe",
  "selected ICE object has an unsupported field",
  "cross-generator transfer graph is disconnected",
  "stage stall rate is not derived from raw probes",
  "stage startup p95 is not the conservative raw maximum",
  "stage buffer minimum is not derived from raw probes",
  "load ladder evidence validation smoke OK: pass=1 failures=43"
]) {
  if (!loadLadderSmokeText.includes(required)) {
    console.error(`scripts/smoke-load-ladder-evidence-validation.js: missing load ladder smoke text: ${required}`);
    failed = true;
  }
}

for (const check of [
  {
    file: "scripts/smoke-tracker-load.js",
    required: ["createTrackerState", "handlePeerMessage", "metricsForState", "trackerCpuMsPerMessageP95", "androidStallRateMax", "androidBufferMsMin", "swarmcast_tracker_offload_ratio_5m", "swarmcast_tracker_stall_rate_5m", "startup_ms", "buffer_ms", "PEERS = 200"]
  },
  {
    file: "scripts/smoke-tracker-sharding.js",
    required: ["loadTrackerConfig", "selectTrackerCell", "assignmentKey", "trackerShardConfig", "tracker shard redirect", "wrong shard must redirect before demand", "tracker sharding smoke OK"]
  },
  {
    file: "services/tracker/src/sharding.js",
    required: ["rankTrackerShards", "selectTrackerShard", "selectOriginBootstrapCell", "rankTrackerCells", "selectTrackerCell", "selectTrackerSpillover", "createTrackerCellRouteToken", "verifyTrackerCellRouteToken", "assignmentKey", "region", "routeTrackerJoin", "createHash", "createHmac", "timingSafeEqual", "localeCompare"]
  },
  {
    file: "services/tracker/src/peerIndex.js",
    required: ["class PeerPool", "positions", "SCORE_BUCKETS", "takeSuper", "takeNormal", "membership"]
  },
  {
    file: "services/tracker/src/stats.js",
    required: ["createTrackerStats", "recordTrackerStats", "snapshotTrackerStats", "snapshotRollingTrackerStats", "MAX_ROLLING_BUCKETS", "class MinHeap"]
  },
  {
    file: "services/tracker/src/metrics.js",
    required: ["swarmcast_tracker_cells", "swarmcast_tracker_segment_payload_encodes_total", "swarmcast_tracker_origin_seed_assignments_total", "swarmcast_tracker_edge_seed_assignments_total", "swarmcast_tracker_backpressure_drops_total", "swarmcast_tracker_cell_capacity_spillovers_total", "swarmcast_tracker_cell_capacity_rejections_total"]
  },
  {
    file: "scripts/smoke-tracker-ws-cells.js",
    required: ["spawnTracker", "selectOriginBootstrapCell", "selectTrackerCell", "announceSegment", "TRACKER_CELL_MAX_PEERS", "assignmentKey", "cellRouteToken", "swarmcast_tracker_origin_seed_assignments_total", "swarmcast_tracker_edge_seed_assignments_total", "originBootstrap=1", "edgeBootstrap=1", "swarmcast_tracker_cell_capacity_spillovers_total 1", "capacitySpillover=pass", "edgeUrlTemplate", "tracker cell WebSocket smoke OK"]
  },
  {
    file: "scripts/smoke-tracker-ws-cells-1k.js",
    required: ["positiveOption(\"peers\", 1000", "positiveOption(\"cells\", 4", "PEER_COUNT === 1000 && CELL_COUNT === 4 ? 300", "positiveOption(\"join-batch-size\", 25", "JOIN_ACK_TIMEOUT_MS", "MAX_JOIN_ATTEMPTS", "MAX_TOTAL_JOIN_RETRIES", "TRACKER_CELL_LOAD_DOCKER_IMAGE", "reservePorts", "assignmentsByCell", "selectTrackerCell", "closeWebSocket", "connection attempts", "announceAndMeasure", "proveSignalingIsolation", "swarmcast_tracker_backpressure_drops_total", "swarmcast_tracker_cell_capacity_rejections_total", "RECOVERY_P95_BUDGET_MS", "joinRetries=", "closeCode=1012", "crossCellSignal=blocked", "tracker cell ${LOAD_LABEL} WebSocket load OK"]
  },
  {
    file: "scripts/smoke-webrtc-tracker-200.js",
    required: ["--force-turn-relay", "--force-turn-relay-20", "--expect-turn-auth-rejection", "TURN_RELAY_20 ? 20", "authSessionCount = USE_TURN ? PEER_COUNT : 1", "distinct viewer auth artifacts", "JOIN_BATCH_SIZE = 25", "MAX_JOIN_ATTEMPTS = 3", "MAX_TOTAL_JOIN_RETRIES = 20", "join acknowledgement timeout", "tracker joins exceeded retry ceiling", "playwright-core", "new RTCPeerConnection", "iceTransportPolicy", "createDataChannel(\"swarmcast-segment\"", "kind: \"offer\"", "kind: \"answer\"", "kind: \"ice\"", "crypto.subtle.digest", "SHA-256 mismatch", "TURN authentication rejected (401)", "swarmcast_tracker_download_p2p_bytes_total", "swarmcast_tracker_upload_bytes_total", "swarmcast_tracker_download_relay_bytes_total", "turn_total_allocations", "turn_total_traffic_peer_sentb", "relay/relay", "verifiedTransfers=", "coturnPeakAllocations=", "joinRetries=", "trackerSignaling=pass", "hashVerification=pass", "accounting=pass"]
  },
  {
    file: "scripts/smoke-tracker-ws.js",
    required: ["createAuthServer", "new WebSocket", "AUTH_JWKS_URL", "TRACKER_INTERNAL_PORT", "swarmcast_tracker_offload_ratio", "swarmcast_tracker_startup_latency_ms_avg_5m", "swarmcast_tracker_buffer_ms_min_5m", "startup_ms", "buffer_ms", "/internal/segment", "segmentAnnounced=true", "signalingRelayed=true", "type: \"offer\"", "type: \"answer\"", "type: \"ice\"", "demandCalls.length >= 2", "TRACKER_WS_DOCKER_IMAGE", "host.docker.internal", "TRACKER_MAX_CONNECTIONS", "TRACKER_IDLE_TIMEOUT_SECONDS", "TRACKER_DEMAND_HEARTBEAT_SECONDS", "TRACKER_RATE_LIMIT_CAPACITY", "TRACKER_RATE_LIMIT_REFILL_PER_SECOND", "rateLimitClosed=true", "expectRejectedWebSocket", "connectionLimitRejected=true", "oversizedClosed=true", "idleClosed=true"]
  },
  {
    file: "scripts/smoke-tracker-ws-load.js",
    required: ["PEERS = intArg", "CHANNELS = intArg", "TRACKER_WS_DOCKER_IMAGE", "createAuthServer", "new WebSocket", "TRACKER_MAX_CONNECTIONS", "swarmcast_tracker_offload_ratio_5m", "finalDemandByChannel", "p2pPeerLists"]
  },
  {
    file: "scripts/smoke-tracker-ws-restart.js",
    required: ["createAuthServer", "new WebSocket", "TRACKER_WS_DOCKER_IMAGE", "spawnTracker", "stopTracker", "waitForRemoteClose", "closedByRestart", "rejoined", "Delivery Fleet playlist URL", "swarmcast_tracker_offload_ratio_5m"]
  },
  {
    file: "scripts/smoke-ingest-ffmpeg-chaos.js",
    required: ["ChannelManager", "MAX_FFMPEG_FAILURES", "ffmpeg_worker_failed", "CHANNEL_STATE.DEGRADED", "swarmSize", "restartBackoffMs"]
  },
  {
    file: "scripts/smoke-ingest-tail-admission.js",
    required: ["ChannelManager", "tailAdmissionMaxChannels", "activeTailCount", "rejectedTail=1", "ingest tail admission smoke OK"]
  },
  {
    file: "scripts/smoke-ingest-tail-downscale.js",
    required: ["ChannelManager", "tailDownscaleEnabled", "tail_downscale", "source_copy", "libx264", "ingest tail downscale smoke OK"]
  },
  {
    file: "scripts/smoke-ingest-demand-playlist.js",
    required: ["createIngestServer", "ChannelManager", "watchSegments", "syntheticHlsSpawn", "playlist.m3u8", "seg_00000000.m4s", "segment announce", "latestSegmentAt"]
  },
  {
    file: "scripts/smoke-nginx-origin-playback.js",
    required: ["nginx origin playback smoke OK", "createAuthServer", "swarmcast.conf", "host.docker.internal", "httpsGet", "unauthorized=401", "cache-control", "immutable", "ffmpeg"]
  },
  {
    file: "scripts/smoke-control-plane-placement-restart.js",
    required: ["createControlPlaneServer", "PlacementRegistry", "PlacementService", "swarmcast_control_channel_placements", "releasePersisted=true", "restoredNode"]
  },
  {
    file: "scripts/smoke-control-plane-placement-sqlite.js",
    required: ["createControlPlaneServer", "SQLitePlacementRegistry", "PlacementService", "swarmcast_control_channel_placements", "releasePersisted=true", "restoredNode", "control-plane SQLite placement restart smoke OK"]
  },
  {
    file: "scripts/smoke-sqlite-backup-restore.js",
    required: ["SQLiteCatalogStore", "SQLitePlacementRegistry", "sha256File", "manifest", "sqlite backup restore smoke OK", "sourceUrl"]
  },
  {
    file: "scripts/smoke-placement-movement.js",
    required: ["IngestScheduler", "CHANNELS = 20_000", "MOVEMENT_MAX", "LOAD_SKEW_MAX", "hashRank", "placement movement smoke OK"]
  },
  {
    file: "scripts/smoke-multi-ingest-routing.js",
    required: ["createControlPlaneServer", "PlacementService", "handlePeerMessage", "perNodeCap: 1", "edgeUrlTemplate", "originUrlTemplate", "demandCalls", "multi-ingest routing smoke OK"]
  },
  {
    file: "scripts/smoke-retention-execute.js",
    required: ["RETENTION_EXECUTE", "Refusing destructive retention execution", "RETENTION_ACTION_LOG", "guardRefused=true", "aggregate_then_delete_raw", "delete_aggregate"]
  },
  {
    file: "scripts/retention-http-store.js",
    required: ["createRetentionStore", "RETENTION_STORE_HTTP_BASE_URL", "RETENTION_STORE_HTTP_TOKEN", "RETENTION_STORE_HTTP_TIMEOUT_MS", "listRetentionRecords", "applyRetentionAction", "dryRun) return", "minimalActionBody"]
  },
  {
    file: "scripts/smoke-retention-http-store.js",
    required: ["RETENTION_STORE_MODULE", "RETENTION_STORE_HTTP_BASE_URL", "dryRunApplyCalls=0", "executeApplyCalls=5", "actionPayloadMinimal=true", "assertMinimalApplyBody"]
  },
  {
    file: "scripts/smoke-retention-redaction.js",
    required: ["SENSITIVE_SENTINELS", "sensitive-records.jsonl", "assertNoSensitive", "dryRunClean=true", "prometheusClean=true", "actionLogClean=true", "allowedKeys"]
  },
  {
    file: "scripts/smoke-source-policy.js",
    required: ["parseM3uText", "sourcePolicy", "privateRejected=true", "allowlistRejected=true"]
  },
  {
    file: "scripts/smoke-service-lifecycle-containers.js",
    required: ["waitHealthy", "ReadonlyRootfs", "CapDrop", "no-new-privileges", "service_shutdown_completed", "docker", "stop", "service lifecycle container smoke OK"]
  },
  {
    file: "scripts/smoke-production-env-validation.js",
    required: ["missing auth key path", "temporary catalog database path", "missing retention HTTP token", "relative retention store module", "tag-only infrastructure image", "missing Alertmanager config path", "production env validation smoke OK"]
  },
  {
    file: "scripts/smoke-compose-production-env.js",
    required: ["Docker Compose not available", "test-fixtures/config/production.env", "infra/docker-compose.release.yml", "infra/edge/docker-compose.yml", "origin-a", "RETENTION_STORE_MODULE: /app/scripts/retention-http-store.js", "RETENTION_RECORDS_FILE: /data/retention-records.jsonl", "source: /etc/swarmcast/alertmanager.yml", "ghcr.io/aziz/ads/auth@sha256", "prom/prometheus:v2.53.0@sha256", "node:22-slim@sha256", "edge=pass", "production compose env smoke OK"]
  },
  {
    file: "scripts/smoke-release-manifest-production.js",
    required: ["validate-release-images.js", "--require-digests", "test-fixtures/config/production.env", "node-exporter", "production release manifest smoke OK"]
  },
  {
    file: "scripts/validate-prometheus-alerts.js",
    required: ["parseAlerts", "balancedExpression", "runbook_url", "requiredLaunchAlerts", "SwarmcastPeerHashFailures", "--require-launch-coverage", "launch alerts must include critical severity", "Prometheus alert validation OK"]
  },
  {
    file: "scripts/smoke-prometheus-alerts-validation.js",
    required: ["scripts/validate-prometheus-alerts.js", "--require-launch-coverage", "missing required launch alert SwarmcastLowOffloadRatio", "duplicate alert name", "expr has unbalanced delimiters or quotes", "for duration must use a single Prometheus duration", "severity must be warning or critical", "runbook_url must not traverse directories", "prometheus alert validation smoke OK: pass=1 failures=8"]
  },
  {
    file: "scripts/validate-grafana-dashboard.js",
    required: ["balancedExpression", "rectanglesOverlap", "Grafana dashboard validation OK", "legendFormat"]
  },
  {
    file: "scripts/smoke-grafana-dashboard-validation.js",
    required: ["scripts/validate-grafana-dashboard.js", "missing production tag", "duplicate panel id 1", "panel 2 overlaps panel 1", "uses unsupported type heatmap", "target 0 expr is unbalanced", "grafana dashboard validation smoke OK: pass=1 failures=7"]
  },
  {
    file: "scripts/source-preflight.js",
    required: ["preflightM3uFile", "sourcePolicyFromEnv", "requireAllowedHosts: true", "formatSourcePreflightSummary", "source preflight summary", "source preflight failed"]
  },
  {
    file: "scripts/smoke-catalog-source-preflight.js",
    required: ["preflightM3uFile", "spawn", "scripts/source-preflight.js", "failedDetected", "sourceUrl", "GET fallback"]
  },
  {
    file: "scripts/edge-cache-log-metrics.js",
    required: ["parseEdgeAccessLine", "edgeMetricsFromText", "formatEdgeMetrics", "swarmcast_edge_cache_hit_ratio", "swarmcast_edge_origin_fill_bytes_total"]
  },
  {
    file: "scripts/edge-cache-metrics-server.js",
    required: ["createEdgeMetricsServer", "/health", "/metrics", "EDGE_ACCESS_LOG", "EDGE_METRICS_PORT"]
  },
  {
    file: "scripts/smoke-edge-cache-metrics.js",
    required: ["edgeMetricsFromText", "swarmcast_edge_cache_hit_ratio", "assert.doesNotMatch", "originFillBytes"]
  },
  {
    file: "scripts/smoke-edge-cache-metrics-server.js",
    required: ["createEdgeMetricsServer", "health=200", "metrics=200", "assert.doesNotMatch"]
  },
  {
    file: "scripts/smoke-nginx-edge-cache.js",
    required: ["nginx edge cache smoke OK", "createAuthServer", "nginx-edge.conf", "host.docker.internal", "x-cache", "MISS", "crossTokenHIT", "secondToken", "originFills=1", "unauthorized=401"]
  },
  {
    file: "services/tracker/src/stats.js",
    required: ["startup_ms", "buffer_ms", "startupLatencyMsAvg", "bufferMsMin", "stallRate", "peer_timeouts", "hash_failures", "peer_disconnects", "peerHashFailures"]
  },
  {
    file: "services/tracker/src/metrics.js",
    required: ["swarmcast_tracker_stall_rate_5m", "swarmcast_tracker_startup_latency_ms_avg_5m", "swarmcast_tracker_buffer_ms_min_5m", "swarmcast_tracker_playback_stalls_total", "swarmcast_tracker_peer_timeouts_total", "swarmcast_tracker_peer_hash_failures_total", "swarmcast_tracker_peer_disconnects_total", "swarmcast_tracker_join_timeouts_total", "swarmcast_tracker_join_timeouts_5m"]
  },
  {
    file: "services/tracker/src/segments.js",
    required: ["validateSegmentEnvelope", "validateSegmentAnnounce", "announceSegmentToState", "originBootstrapCellId", "originSeedAssignments", "edgeSeedAssignments", "recipients"]
  },
  {
    file: "packages/segment-bus/src/index.js",
    required: ["validateSegmentEnvelope", "sha256", "1_073_741_824", "max: 255"]
  },
  {
    file: "services/tracker/test/segments.test.js",
    required: ["broadcasts ordered segment announcements", "rejects malformed segment announcements", "accepts valid segment when swarm is empty"]
  },
  {
    file: "services/ingest/src/channelManager.js",
    required: ["MAX_FFMPEG_FAILURES", "failures = 0", "latestSegmentAt", "recordSegment", "isTailDemand", "activeTailCount", "canAdmitTail", "shouldDownscale", "restartForPackaging", "tail_downscale", "source_copy", "libx264"]
  },
  {
    file: "services/ingest/src/metrics.js",
    required: ["swarmcast_ingest_segment_age_seconds", "segmentAgeSeconds"]
  },
  {
    file: "services/control-plane/src/metrics.js",
    required: ["swarmcast_control_catalog_backend_info", "swarmcast_control_placement_backend_info", "catalogBackend", "placementBackend"]
  },
  {
    file: "services/control-plane/test/metrics.test.js",
    required: ["catalogBackend", "placementBackend", "swarmcast_control_catalog_backend_info", "swarmcast_control_placement_backend_info"]
  },
  {
    file: "services/ingest/src/index.js",
    required: ["onSegment: (segment) => manager.recordSegment(segment.channelId, Date.now(), segment.seq)"]
  },
  {
    file: "scripts/smoke-headless-super-peer-sweep.js",
    required: ["PEERS = 500", "SUPER_PEER_FRACTIONS", "UPLOAD_PACKETS_PER_SUPER_PEER", "edgeFallbackPackets", "flatten"]
  },
  {
    file: "scripts/load-ladder-contract.js",
    required: [
      "LOAD_STAGE_EXPECTATIONS",
      "1-channel-3-devices",
      "1-channel-200-peers",
      "50-channels-2000-peers",
      "zipf-catalog",
      "1-channel-1000-cell-peers",
      "1-channel-10000-cell-peers",
      "1-channel-100000-cell-peers",
      "minDurationSeconds: 900",
      "validateLoadProbe",
      "validateLoadProbeBundle",
      "PROBE_KEYS",
      "networkEgressFingerprintSha256",
      "per-viewer-short-lived",
      "cross-generator-transfer",
      "candidateSelections",
      "unknown must equal 0",
      "synthetic evidence requires --allow-synthetic"
    ]
  },
  {
    file: "scripts/load-ladder-probe-runner.js",
    required: [
      "--allow-synthetic",
      "target.trackerUrl must use wss",
      "target.trackerUrl must resolve only to public addresses",
      "load driver SHA-256 does not match manifest",
      "SWARMCAST_LOAD_DRIVER_",
      "MAX_DRIVER_OUTPUT_BYTES",
      "load driver start differs from synchronized startAt",
      "per-viewer-short-lived",
      "validateLoadProbe"
    ]
  },
  {
    file: "scripts/run-load-ladder-probe.js",
    required: [
      "--acknowledge-staging-load",
      "--manifest",
      "--driver",
      "--output",
      "runLoadLadderProbe",
      "mode: 0o600",
      "chmodSync(outputPath, 0o600)",
      "Load ladder probe OK"
    ]
  },
  {
    file: "scripts/smoke-load-ladder-probe.js",
    required: [
      "probe output permissions are not 0600",
      "--acknowledge-staging-load is required",
      "private production target",
      "driver hash mismatch",
      "unknown ICE candidate",
      "sensitive driver output key",
      "load ladder probe smoke OK"
    ]
  },
  {
    file: "scripts/run-turn-capacity-probe.js",
    required: [
      "--acknowledge-staging-load",
      "--expected-host-allocations",
      "--phase-gap-seconds",
      "--start-at",
      "requirePublicHost",
      "unique-short-lived-turn-rest-per-allocation",
      "issueTurnCredentials",
      "TURN_SHARED_SECRET",
      "delete env.TURN_SHARED_SECRET",
      "delete env.TURN_PREVIOUS_SHARED_SECRET",
      "turn_total_allocations",
      "peakAllocations !== config.expectedHostAllocations",
      "scheduledSustainedStartAt",
      "TURN host is not idle before the sustained phase",
      "waitForAllocationDrain",
      "sharedSecretRecorded: false",
      "chmodSync(config.output, 0o600)",
      "Final evidence requires two independent load generators"
    ]
  },
  {
    file: "scripts/validate-turn-capacity-evidence.js",
    required: [
      "at least two independent hosts",
      "loadGenerators must span at least two providers",
      "TURN hosts must span at least two failure domains",
      "rawProbes must include exactly one probe per load generator",
      "rawProbes start more than five seconds apart",
      "timestamps must match the synchronized raw probe envelope",
      "duplicate raw probe runId",
      "requiredTransports",
      "coturn traffic must cover both relay legs",
      "sustained provider egress",
      "declared host link capacity",
      "does not preserve required headroom",
      "provider-egress-export",
      "operations|performance|security",
      "approval reviewers must be distinct",
      "synthetic TURN capacity evidence requires --allow-synthetic"
    ]
  },
  {
    file: "scripts/smoke-turn-capacity-evidence-validation.js",
    required: [
      "test-fixtures/load/turn-capacity-complete.synthetic.json",
      "duplicate-host-transport",
      "raw-probe-start-skew",
      "raw-probe-envelope",
      "duplicate-raw-probe-run",
      "load-provider",
      "allocation-headroom",
      "provider-counter-mismatch",
      "fake-throughput",
      "link-overclaim",
      "allocation-leak",
      "sensitive-evidence",
      "duplicate-approval-reviewer",
      "TURN capacity evidence validation smoke OK"
    ]
  },
  {
    file: "scripts/smoke-turn-capacity-probe.js",
    required: [
      "SWARMCAST_TURN_PROBE_TEST_MODE",
      "expected four unique credentials",
      "probe output permissions are not 0600",
      "probe did not record exact allocation peak and drain",
      "raw probe evidence contains credentials",
      "TURN client inherited the shared secret",
      "TURN capacity probe smoke OK"
    ]
  },
  {
    file: "package.json",
    required: ["alertmanager:fire-drill:validate", "alertmanager:receivers:validate", "android:accessibility:validate", "android:attestation:evidence:validate", "android:ci:evidence:validate", "android:p2p:evidence:validate", "android:playback:evidence:validate", "android:rlnc:decision:validate", "canary:metrics:validate", "canary:rollout:evidence:validate", "capacity:plan:validate", "catalog:import:validate", "chaos:staging:validate", "dependency:review:validate", "deployment:evidence:validate", "edge:metrics", "env:production:validate", "evidence:committed:validate", "grafana:dashboard:validate", "host:provisioning:evidence:validate", "image:scan:bundle:validate", "launch:artifacts:generate", "launch:evidence:validate", "media:fixtures:validate", "legal:approval:validate", "load:ladder:validate", "nginx:tls:evidence:validate", "privacy:store:validate", "production:smoke:evidence:validate", "prometheus:alerts:validate", "restore:evidence:validate", "rollback:evidence:validate", "retention:approval:validate", "retention:execution:evidence:validate", "secrets:evidence:validate", "security:review:validate", "smoke:alertmanager-fire-drill-validation", "smoke:alertmanager-receivers-validation", "smoke:alertmanager-routing", "smoke:android-accessibility-evidence-validation", "smoke:android-attestation-evidence-validation", "smoke:android-ci-evidence-validation", "smoke:android-p2p-evidence-validation", "smoke:android-playback-evidence-validation", "smoke:android-rlnc-decision-validation", "smoke:canary-metrics-validation", "smoke:canary-rollout-evidence-validation", "smoke:capacity-plan-validation", "smoke:catalog-import-validation", "smoke:catalog-source-preflight", "smoke:catalog-sqlite", "smoke:catalog-sqlite-20k", "smoke:compose-production-env", "smoke:control-plane-placement-restart", "smoke:control-plane-placement-sqlite", "smoke:dependency-review-validation", "smoke:deployment-evidence-validation", "smoke:edge-cache-metrics", "smoke:edge-cache-metrics-server", "smoke:headless-super-peer-sweep", "smoke:host-provisioning-evidence-validation", "smoke:image-scan-bundle-validation", "smoke:image-scan-report-validation", "smoke:ingest-demand-playlist", "smoke:ingest-ffmpeg-chaos", "smoke:ingest-tail-admission", "smoke:ingest-tail-downscale", "smoke:launch-artifact-bundle-validation", "smoke:launch-evidence-validation", "smoke:legal-approval-validation", "smoke:load-ladder-evidence-validation", "smoke:multi-ingest-routing", "smoke:nginx-edge-cache", "smoke:nginx-origin-playback", "smoke:nginx-tls-evidence-validation", "smoke:placement-movement", "smoke:privacy-store-compliance-validation", "smoke:production-env-validation", "smoke:production-smoke-evidence-validation", "smoke:prometheus-alerts-validation", "smoke:fmp4-fixture-validation", "smoke:grafana-dashboard-validation", "smoke:release-images-validation", "smoke:release-manifest-production", "smoke:restore-evidence-validation", "smoke:retention-approval-validation", "smoke:retention-execute", "smoke:retention-execution-evidence-validation", "smoke:retention-http-store", "smoke:retention-redaction", "smoke:rollback-evidence-validation", "smoke:secrets-evidence-validation", "smoke:security-review-validation", "smoke:service-lifecycle-containers", "smoke:source-allowlist-evidence-validation", "smoke:source-policy", "smoke:sqlite-backup-restore", "smoke:staging-chaos-evidence-validation", "smoke:threat-model-review-validation", "smoke:tracker-load", "smoke:tracker-sharding", "smoke:tracker-ws", "smoke:tracker-ws-cells-1k", "smoke:tracker-ws-load", "smoke:tracker-ws-multichannel", "smoke:tracker-ws-restart", "source:allowlist:evidence:validate", "source:preflight", "threat:model:validate"]
  },
  {
    file: "package.json",
    required: ["android:release-config:validate", "smoke:android-release-config-validation"]
  },
  {
    file: "package.json",
    required: ["android:device-lab", "smoke:android-device-lab"]
  },
  {
    file: "package.json",
    required: ["smoke:tracker-ws-cells-10k"]
  },
  {
    file: "package.json",
    required: ["playwright-core", "smoke:webrtc-200", "smoke:webrtc-hash-rejection", "smoke:webrtc-turn-relay", "smoke:webrtc-turn-relay-20", "smoke:webrtc-turn-auth-rejection"]
  },
  {
    file: "package.json",
    required: ["turn:capacity:probe", "turn:capacity:evidence:validate", "smoke:turn-capacity-probe", "smoke:turn-capacity-evidence-validation"]
  },
  {
    file: "package.json",
    required: ["segment-bus:capacity:probe", "segment-bus:capacity:evidence:validate", "smoke:segment-bus-capacity-probe", "smoke:segment-bus-capacity-evidence-validation"]
  },
  {
    file: "package.json",
    required: ["load:ladder:probe", "load:ladder:validate", "smoke:load-ladder-probe", "smoke:load-ladder-evidence-validation"]
  },
  {
    file: "scripts/segment-bus-capacity-probe-runner.js",
    required: ["startAt must be between 15 seconds and 30 minutes", "must resolve only to public addresses", "SWARMCAST_SEGMENT_BUS_DRIVER_", "exceeded", "driver output contains a configured secret"]
  },
  {
    file: "scripts/validate-segment-bus-capacity-evidence.js",
    required: ["regular non-symlink file", "mode 0600", "SHA-256 mismatch", "segmentBusCapacityMeasurementStatus", "independent-reviewers"]
  },
  {
    file: "scripts/smoke-segment-bus-capacity-probe.js",
    required: ["failures=", "missing disruption acknowledgement", "secret output", "replay corruption"]
  },
  {
    file: "scripts/smoke-segment-bus-capacity-evidence-validation.js",
    required: ["failures=", "raw symlink", "provider collapse", "unmeasured capacity plan"]
  }
]) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing tracker load smoke text: ${required}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
const releaseManifestScriptText = readFileSync("scripts/generate-release-manifest.js", "utf8");
for (const required of [
  "swarmcast-release-manifest",
  "swarmcast-sbom",
  "expectedImageScans",
  "SWARMCAST_PROMETHEUS_IMAGE",
  "node-exporter",
  "npm run image:scan:validate -- var/scans/*.json",
  "npm run image:scan:bundle:validate -- --manifest var/release/swarmcast-release-manifest.json var/scans/*.trivy.json",
  "--require-digests",
  "Release manifest OK"
]) {
  if (!releaseManifestScriptText.includes(required)) {
    console.error(`scripts/generate-release-manifest.js: missing release manifest text: ${required}`);
    failed = true;
  }
}

const releaseManifestWorkflowText = readFileSync(".github/workflows/release.yml", "utf8");
for (const required of [
  "npm run release:manifest --",
  "--output var/release/swarmcast-release-manifest.json",
  "--input var/release/swarmcast-release-manifest.json --check",
  "name: swarmcast-release-manifest",
  "path: var/release/swarmcast-release-manifest.json",
  "Release manifest artifact: swarmcast-release-manifest",
  "SBOM artifact: swarmcast-sbom"
]) {
  if (!releaseManifestWorkflowText.includes(required)) {
    console.error(`.github/workflows/release.yml: missing release manifest workflow text: ${required}`);
    failed = true;
  }
}

const deploymentPipelineManifestText = readFileSync("docs/deployment-pipeline.md", "utf8");
for (const required of [
  "generates `var/release/swarmcast-release-manifest.json`",
  "uploads it as the `swarmcast-release-manifest` artifact",
  "target environment, service and infrastructure image refs, expected SBOM artifact, expected image scan report paths",
  "npm run smoke:release-manifest-production",
  "npm run image:scan:bundle:validate -- --manifest var/release/swarmcast-release-manifest.json var/scans/*.trivy.json",
  "npm run deployment:evidence:validate -- path/to/deployment-evidence.json",
  "test-fixtures/deployment/deployment-complete.synthetic.json",
  "`swarmcast-release-manifest` artifact link",
  "`swarmcast-sbom` artifact link"
]) {
  if (!deploymentPipelineManifestText.includes(required)) {
    console.error(`docs/deployment-pipeline.md: missing release manifest text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const chaosDrillsText = readFileSync("docs/chaos-drills.md", "utf8");
for (const required of [
  "`npm run smoke:tracker-ws-restart`",
  "`npm run smoke:ingest-ffmpeg-chaos`",
  "`npm run smoke:control-plane-placement-restart`",
  "`npm run smoke:staging-chaos-evidence-validation`",
  "Delivery Fleet playlist URLs",
  "MAX_FFMPEG_FAILURES",
  "same ingest node",
  "Required Staging Drills",
  "missing peer-health runbook evidence",
  "npm run chaos:staging:validate -- path/to/staging-chaos-evidence.json",
  "test-fixtures/chaos/staging-chaos-complete.synthetic.json",
  "Kill tracker during real Android playback",
  "Kill ffmpeg for a demanded live channel",
  "Restart control plane during active tracker joins",
  "android-playback-continuity",
  "owned-edge-failover",
  "placement-failover",
  "durable-placement-restore",
  "Inject a peer-health incident",
  "Production launch remains blocked"
]) {
  if (!chaosDrillsText.includes(required)) {
    console.error(`docs/chaos-drills.md: missing chaos-drill text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const stagingChaosScriptText = readFileSync("scripts/validate-staging-chaos-evidence.js", "utf8");
for (const required of [
  "requiredDrills",
  "tracker-restart-android-playback",
  "ffmpeg-worker-crash",
  "edge-node-failover",
  "ingest-node-failover",
  "control-plane-restart",
  "multi-service-recovery",
  "peer-health-incident",
  "android-playback-continuity",
  "owned-edge-failover",
  "placement-failover",
  "durable-placement-restore",
  "docs/runbooks/peer-health.md",
  "SwarmcastPeerHashFailures",
  "synthetic staging chaos evidence requires --allow-synthetic",
  "Staging chaos evidence OK"
]) {
  if (!stagingChaosScriptText.includes(required)) {
    console.error(`scripts/validate-staging-chaos-evidence.js: missing staging chaos validator text: ${required}`);
    failed = true;
  }
}

const stagingChaosFixtureText = readFileSync("test-fixtures/chaos/staging-chaos-complete.synthetic.json", "utf8");
for (const required of [
  "\"drillId\": \"staging-chaos-20260705\"",
  "\"id\": \"tracker-restart-android-playback\"",
  "\"id\": \"ffmpeg-worker-crash\"",
  "\"id\": \"edge-node-failover\"",
  "\"id\": \"ingest-node-failover\"",
  "\"id\": \"control-plane-restart\"",
  "\"id\": \"multi-service-recovery\"",
  "\"id\": \"peer-health-incident\"",
  "android-playback-continuity",
  "owned-edge-failover",
  "placement-failover",
  "durable-placement-restore",
  "docs/runbooks/peer-health.md",
  "SwarmcastPeerHashFailures",
  "\"thirdPartyCdnUsed\": false",
  "\"noCascade\": true",
  "\"synthetic\": true"
]) {
  if (!stagingChaosFixtureText.includes(required)) {
    console.error(`test-fixtures/chaos/staging-chaos-complete.synthetic.json: missing staging chaos fixture text: ${required}`);
    failed = true;
  }
}

const stagingChaosSmokeText = readFileSync("scripts/smoke-staging-chaos-evidence-validation.js", "utf8");
for (const required of [
  "scripts/validate-staging-chaos-evidence.js",
  "synthetic staging chaos evidence requires --allow-synthetic",
  "edge-node-failover",
  "alertObserved = false",
  "recovered = false",
  "noCascade = false",
  "thirdPartyCdnUsed = true",
  "missing Android playback continuity",
  "dataLoss = true",
  "missing peer health runbook evidence",
  "docs/runbooks/peer-health.md",
  "jwt=synthetic-secret",
  "staging chaos evidence validation smoke OK: pass=1 failures=10"
]) {
  if (!stagingChaosSmokeText.includes(required)) {
    console.error(`scripts/smoke-staging-chaos-evidence-validation.js: missing staging chaos smoke text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
for (const check of [
  {
    file: "services/auth/Dockerfile",
    required: [
      "COPY package.json package-lock.json",
      "COPY packages/config/package.json",
      "COPY services/retention-worker/package.json",
      "npm ci --omit=dev --ignore-scripts --workspace @swarmcast/auth --workspace @swarmcast/config",
      "COPY packages/config/src",
      "ARG NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian13:nonroot@sha256:",
      "COPY --from=build --chown=65532:65532 /app /app",
      "HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3",
      "http://127.0.0.1:7003/ready",
      'CMD ["services/auth/src/index.js"]'
    ]
  },
  {
    file: "services/control-plane/Dockerfile",
    required: [
      "COPY package.json package-lock.json",
      "COPY packages/config/package.json",
      "COPY services/retention-worker/package.json",
      "npm ci --omit=dev --ignore-scripts --workspace @swarmcast/control-plane --workspace @swarmcast/config",
      "COPY services/ingest/src/catalog.js",
      "ARG NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian13:nonroot@sha256:",
      "COPY --from=build --chown=65532:65532 /app /app",
      "HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3",
      "http://127.0.0.1:7010/ready",
      'CMD ["services/control-plane/src/index.js"]'
    ]
  },
  {
    file: "services/ingest/Dockerfile",
    required: [
      "COPY package.json package-lock.json",
      "COPY packages/config/package.json",
      "COPY services/retention-worker/package.json",
      "npm ci --omit=dev --ignore-scripts --workspace @swarmcast/ingest --workspace @swarmcast/config",
      "COPY packages/config/src",
      "chown -R node:node /var/hls",
      "WORKDIR /app/services/ingest",
      "HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3",
      "http://127.0.0.1:7001/ready"
    ]
  },
  {
    file: "services/tracker/Dockerfile",
    required: [
      "COPY package.json package-lock.json",
      "COPY packages/config/package.json",
      "COPY services/retention-worker/package.json",
      "npm ci --omit=dev --ignore-scripts --workspace @swarmcast/tracker --workspace @swarmcast/config",
      "COPY packages/config/src",
      "ARG NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian13:nonroot@sha256:",
      "COPY --from=build --chown=65532:65532 /app /app",
      "HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3",
      "http://127.0.0.1:7002/ready",
      'CMD ["services/tracker/src/index.js"]'
    ]
  },
  {
    file: "services/web/Dockerfile",
    required: [
      "COPY package.json package-lock.json",
      "COPY services/web/package.json",
      "npm ci --ignore-scripts --workspace @swarmcast/web",
      "COPY services/web/client services/web/client",
      "npm run build --workspace @swarmcast/web",
      "ARG NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian13:nonroot@sha256:",
      "COPY --from=build --chown=65532:65532 /app/services/web/dist services/web/dist",
      "HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3",
      "http://127.0.0.1:7030/ready",
      'CMD ["services/web/src/server.js"]'
    ]
  },
  {
    file: "services/retention-worker/Dockerfile",
    required: [
      "COPY package.json package-lock.json",
      "COPY packages/config/package.json",
      "npm ci --omit=dev --ignore-scripts --workspace @swarmcast/retention-worker --workspace @swarmcast/config",
      "COPY packages/config/src",
      "COPY services/retention-worker/src",
      "ARG NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian13:nonroot@sha256:",
      "COPY --from=build --chown=65532:65532 /app /app",
      "HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3",
      "http://127.0.0.1:7020/ready",
      'CMD ["services/retention-worker/src/index.js"]'
    ]
  }
]) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing Docker workspace build text: ${required}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
const alertText = readFileSync("infra/monitoring/alerts.yml", "utf8");
for (const alertName of [
  "SwarmcastLowOffloadRatio",
  "SwarmcastLowSuperPeerFraction",
  "SwarmcastTrackerPeerDrops",
  "SwarmcastPeerHashFailures",
  "SwarmcastPeerDisconnectSpike",
  "SwarmcastPeerTimeoutSpike",
  "SwarmcastTrackerJoinTimeoutSpike",
  "SwarmcastHighPlaybackStallRate",
  "SwarmcastHighStartupLatency",
  "SwarmcastLowPlaybackBuffer",
  "SwarmcastLowEdgeCacheHitRatio",
  "SwarmcastHighEdgeEgressRate",
  "SwarmcastHighEdgeOriginFillRate",
  "SwarmcastHighEdgeErrorRate",
  "SwarmcastIngestDegradedChannels",
  "SwarmcastIngestStaleSegments",
  "SwarmcastFfmpegFailureSpike",
  "SwarmcastAuthVerifyFailures",
  "SwarmcastControlPlaneCatalogNotDurable",
  "SwarmcastControlPlanePlacementNotDurable",
  "SwarmcastRetentionJobFailures",
  "SwarmcastRetentionJobStale"
]) {
  if (!alertText.includes(`alert: ${alertName}`)) {
    console.error(`infra/monitoring/alerts.yml: missing alert ${alertName}`);
    failed = true;
  }
}
if (!alertText.includes("swarmcast_tracker_offload_ratio_5m < 0.90")) {
  console.error("infra/monitoring/alerts.yml: low offload alert must use rolling 5 minute offload gauge");
  failed = true;
}
if (!alertText.includes("swarmcast_edge_cache_hit_ratio < 0.80")) {
  console.error("infra/monitoring/alerts.yml: low edge cache alert must use edge cache hit ratio metric");
  failed = true;
}
for (const required of [
  "swarmcast_tracker_stall_rate_5m > 0.01",
  "swarmcast_tracker_startup_latency_ms_avg_5m > 5000",
  "(swarmcast_tracker_buffer_ms_min_5m > 0) and (swarmcast_tracker_buffer_ms_min_5m < 10000)",
  "increase(swarmcast_tracker_peer_hash_failures_total[5m]) > 0",
  "increase(swarmcast_tracker_peer_disconnects_total[10m]) > 5",
  "increase(swarmcast_tracker_peer_timeouts_total[5m]) > 50",
  "increase(swarmcast_tracker_join_timeouts_total[5m]) / clamp_min(swarmcast_tracker_peers, 1) > 0.01",
  "swarmcast_ingest_segment_age_seconds > 30",
  "rate(swarmcast_edge_egress_bytes_total[5m]) > 200000000",
  "rate(swarmcast_edge_origin_fill_bytes_total[5m]) > 50000000",
  "rate(swarmcast_edge_errors_total[5m]) / clamp_min(rate(swarmcast_edge_requests_total[5m]), 1) > 0.02",
  "sum by (job, instance) (swarmcast_control_catalog_backend_info{backend!=\"sqlite\"}) > 0",
  "sum by (job, instance) (swarmcast_control_placement_backend_info{backend!=\"sqlite\"}) > 0"
]) {
  if (!alertText.includes(required)) {
    console.error(`infra/monitoring/alerts.yml: missing edge alert expression: ${required}`);
    failed = true;
  }
}
for (const runbook of [
  "docs/runbooks/low-offload-ratio.md",
  "docs/runbooks/low-super-peer-fraction.md",
  "docs/runbooks/tracker-peer-drops.md",
  "docs/runbooks/peer-health.md",
  "docs/runbooks/app-incident.md",
  "docs/runbooks/edge-cache-hit-ratio.md",
  "docs/runbooks/ingest-degraded.md",
  "docs/runbooks/auth-verify-failures.md",
  "docs/runbooks/control-plane-storage-backend.md",
  "docs/runbooks/retention-job-failures.md"
]) {
  if (!alertText.includes(runbook)) {
    console.error(`infra/monitoring/alerts.yml: missing runbook link ${runbook}`);
    failed = true;
  }
}

const controlPlaneStorageRunbookText = readFileSync("docs/runbooks/control-plane-storage-backend.md", "utf8");
for (const required of [
  "SwarmcastControlPlaneCatalogNotDurable",
  "SwarmcastControlPlanePlacementNotDurable",
  "Control Plane Storage Backends",
  "CATALOG_DB_PATH",
  "PLACEMENT_DB_PATH",
  "npm run smoke:catalog-sqlite",
  "npm run smoke:control-plane-placement-sqlite",
  "npm run smoke:sqlite-backup-restore",
  "backend=\"sqlite\""
]) {
  if (!controlPlaneStorageRunbookText.includes(required)) {
    console.error(`docs/runbooks/control-plane-storage-backend.md: missing control-plane storage runbook text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const edgeCacheRunbookText = readFileSync("docs/runbooks/edge-cache-hit-ratio.md", "utf8");
for (const required of [
  "swarmcast_edge_requests_by_cache_total",
  "swarmcast_edge_egress_bytes_total",
  "SwarmcastHighEdgeEgressRate",
  "swarmcast_edge_origin_fill_bytes_total",
  "SwarmcastHighEdgeOriginFillRate",
  "SwarmcastHighEdgeErrorRate",
  "`npm run smoke:edge-cache-metrics`",
  "`npm run smoke:edge-cache-metrics-server`",
  "port `9101`",
  "Keep raw edge access logs out of broad incident channels"
]) {
  if (!edgeCacheRunbookText.includes(required)) {
    console.error(`docs/runbooks/edge-cache-hit-ratio.md: missing edge cache runbook text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const authKeyRotationText = readFileSync("docs/runbooks/auth-key-rotation.md", "utf8");
for (const required of [
  "Rotate the ES256 JWT signing key",
  "AUTH_PREVIOUS_JWKS_PATH",
  "AUTH_KEY_ID",
  "AUTH_JWT_AUDIENCE",
  "AUTH_JWT_ISSUER",
  "AUTH_TOKEN_TTL_SECONDS",
  "Confirm `/jwks` publishes both",
  "expected issuer, audience, and TTL claims",
  "Verify an old token still passes `/verify`",
  "Wait longer than the maximum token lifetime",
  "New-token `iss`, `aud`, and `exp - iat` values",
  "Auth metrics showing no spike"
]) {
  if (!authKeyRotationText.includes(required)) {
    console.error(`docs/runbooks/auth-key-rotation.md: missing key rotation text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const authOutageText = readFileSync("docs/runbooks/auth-outage.md", "utf8");
for (const required of [
  "Auth Outage",
  "`/health`",
  "`/jwks`",
  "`/token`",
  "`/verify`",
  "AUTH_KEY_PATH",
  "AUTH_JWT_AUDIENCE",
  "Delivery Fleet fallback does not bypass auth",
  "Do not rotate signing keys during an availability outage",
  "Tracker WebSocket smoke"
]) {
  if (!authOutageText.includes(required)) {
    console.error(`docs/runbooks/auth-outage.md: missing auth outage text: ${required}`);
    failed = true;
  }
}
if (!readFileSync("docs/runbooks/auth-verify-failures.md", "utf8").includes("docs/runbooks/auth-outage.md")) {
  console.error("docs/runbooks/auth-verify-failures.md: missing auth outage handoff");
  failed = true;
}

if (failed) process.exit(1);
const appIncidentText = readFileSync("docs/runbooks/app-incident.md", "utf8");
for (const required of [
  "App Incident",
  "EDGE_ONLY_MODE=1",
  "P2P_ENABLED=0",
  "RLNC_ENABLED=0",
  "Delivery-Fleet-only playback",
  "Android crash-free sessions",
  "P2P toggle behavior",
  "Do not paste JWTs",
  "Record every flag change"
]) {
  if (!appIncidentText.includes(required)) {
    console.error(`docs/runbooks/app-incident.md: missing app incident text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const prometheusText = readFileSync("infra/monitoring/prometheus.yml", "utf8");
for (const required of [
  "alertmanagers:",
  "alertmanager:9093",
  "edge-cache-metrics",
  "edge.example.tv:9101",
  "swarmcast-retention-worker",
  "retention-worker:7020"
]) {
  if (!prometheusText.includes(required)) {
    console.error(`infra/monitoring/prometheus.yml: missing required alertmanager text: ${required}`);
    failed = true;
  }
}

const alertmanagerText = readFileSync("infra/monitoring/alertmanager.yml", "utf8");
for (const required of [
  "receiver: oncall-default",
  "receiver: oncall-critical",
  "repeat_interval: 30m",
  "send_resolved: true"
]) {
  if (!alertmanagerText.includes(required)) {
    console.error(`infra/monitoring/alertmanager.yml: missing required routing text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const dashboardText = readFileSync("infra/monitoring/grafana/dashboards/swarmcast-overview.json", "utf8");
for (const metric of [
  "swarmcast_tracker_offload_ratio_5m",
  "swarmcast_tracker_download_p2p_bytes_5m",
  "swarmcast_tracker_download_edge_bytes_5m",
  "swarmcast_tracker_download_bootstrap_origin_bytes_5m",
  "swarmcast_tracker_download_relay_bytes_5m",
  "swarmcast_tracker_stall_rate_5m",
  "swarmcast_tracker_startup_latency_ms_avg_5m",
  "swarmcast_tracker_buffer_ms_min_5m",
  "Peer Health",
  "ICE Success By Network",
  "Selected ICE Candidate Types",
  "swarmcast_tracker_ice_attempts_total",
  "swarmcast_tracker_ice_selected_candidate_total",
  "swarmcast_tracker_peer_timeouts_5m",
  "swarmcast_tracker_peer_hash_failures_5m",
  "swarmcast_tracker_peer_disconnects_5m",
  "swarmcast_tracker_join_timeouts_5m",
  "swarmcast_ingest_segment_age_seconds",
  "swarmcast_edge_cache_hit_ratio",
  "swarmcast_edge_egress_bytes_total",
  "swarmcast_edge_origin_fill_bytes_total",
  "swarmcast_control_catalog_backend_info",
  "swarmcast_control_placement_backend_info",
  "Control Plane Storage Backends",
  "Core Service Availability",
  "up{job=~\\\"(swarmcast-(auth|ingest|tracker|control-plane|retention-worker|segment-bus)|edge-cache-metrics)\\\"}",
  "Active Alerts",
  "ALERTS{alertstate=\\\"firing\\\",alertname=~\\\"Swarmcast.*\\\"}"
]) {
  if (!dashboardText.includes(metric)) {
    console.error(`infra/monitoring/grafana/dashboards/swarmcast-overview.json: missing metric ${metric}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const serviceLifecycleRunbookText = readFileSync("docs/runbooks/service-lifecycle.md", "utf8");
for (const required of [
  "Service Lifecycle Incident",
  "SwarmcastServiceTargetDown",
  "`/health`",
  "`/ready`",
  "service_shutdown_completed",
  "WebSocket restart code `1012`",
  "docker inspect",
  "docker stop --time 15",
  "Do not restore traffic"
]) {
  if (!serviceLifecycleRunbookText.includes(required)) {
    console.error(`docs/runbooks/service-lifecycle.md: missing service lifecycle text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const androidRlncAdr = readFileSync("docs/adr/0008-android-rlnc-library-boundary.md", "utf8");
for (const required of [
  "must not ship hand-rolled finite-field math",
  "Required Android Decoder Contract",
  "benchmark decode CPU",
  "bad decodes never enter `SegmentStore`",
  "npm run android:rlnc:decision:validate -- path/to/android-rlnc-decision.json",
  "npm run smoke:android-rlnc-decision-validation",
  "test-fixtures/android/rlnc-decision-complete.synthetic.json",
  "Backblaze JavaReedSolomon",
  "d3c481dc69471e0c47ff6f67f33d53bde941675e",
  "license: MIT"
]) {
  if (!androidRlncAdr.includes(required)) {
    console.error(`docs/adr/0008-android-rlnc-library-boundary.md: missing required text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const androidRlncDecisionScriptText = readFileSync("scripts/validate-android-rlnc-decision.js", "utf8");
for (const required of [
  "requiredChecks",
  "budgetArgIndex !== -1",
  "requiredReviewerRoles",
  "license-review",
  "fuzz-malformed-packets",
  "device-swarm-decode",
  "androidDecodeCpuMsPerSegmentP95",
  "synthetic Android RLNC decision requires --allow-synthetic",
  "Android RLNC decision OK"
]) {
  if (!androidRlncDecisionScriptText.includes(required)) {
    console.error(`scripts/validate-android-rlnc-decision.js: missing Android RLNC decision validator text: ${required}`);
    failed = true;
  }
}

const androidRlncDecisionSmokeText = readFileSync("scripts/smoke-android-rlnc-decision-validation.js", "utf8");
for (const required of [
  "scripts/validate-android-rlnc-decision.js",
  "test-fixtures/android/rlnc-decision-complete.synthetic.json",
  "synthetic Android RLNC decision requires --allow-synthetic",
  "implementation\\.abiRisk must not be high for launch",
  "missing required reviewer role legal",
  "duplicate reviewer role android",
  "performance\\.reviewedAt must be ISO-8601 parseable",
  "missing required Android RLNC check fuzz-malformed-packets",
  "decode-benchmark\\.status must pass before Android RLNC approval",
  "duplicate RLNC decision check license-review",
  "license-review\\.evidence evidence reference looks like it may contain sensitive material",
  "benchmarks\\.decodeCpuMsP95 must be between 0 and 100",
  "benchmarks\\.batteryDrainPctPerHour must be between 0 and 8",
  "benchmarks\\.k must be between 1 and 255",
  "fuzz\\.cases must be between 1000 and Infinity",
  "fuzz\\.crashes must be between 0 and 0",
  "deviceDecode\\.devices must be between 2 and Infinity",
  "deviceDecode\\.verifiedSegments must be between 1 and Infinity",
  "deviceDecode\\.hashFailures must be between 0 and 0",
  "deviceDecode\\.segmentStoreVerified must be true",
  "deviceDecode\\.evidence evidence reference looks like it may contain sensitive material",
  "implementation\\.version must match selected Android RLNC implementation",
  "Android RLNC decision validation smoke OK: pass=1 failures=20"
]) {
  if (!androidRlncDecisionSmokeText.includes(required)) {
    console.error(`scripts/smoke-android-rlnc-decision-validation.js: missing Android RLNC smoke text: ${required}`);
    failed = true;
  }
}

const androidRlncDecisionFixtureText = readFileSync("test-fixtures/android/rlnc-decision-complete.synthetic.json", "utf8");
for (const required of [
  "\"decisionId\": \"android-rlnc-20260705\"",
  "\"name\": \"backblaze-javareedsolomon-gf256\"",
  "\"license\": \"MIT\"",
  "\"id\": \"license-review\"",
  "\"id\": \"fuzz-malformed-packets\"",
  "\"id\": \"device-swarm-decode\"",
  "\"decodeCpuMsP95\": 64",
  "\"cases\": 5000",
  "\"verifiedSegments\": 32",
  "\"synthetic\": true"
]) {
  if (!androidRlncDecisionFixtureText.includes(required)) {
    console.error(`test-fixtures/android/rlnc-decision-complete.synthetic.json: missing Android RLNC fixture text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const readinessText = readFileSync("docs/launch-readiness.md", "utf8");
for (const required of [
  "Legal redistribution, rebroadcast, peer-relay, viewer-device retransmission, privacy disclosure, territory/platform, app store, and metrics-logging approval evidence passes `npm run legal:approval:validate -- path/to/legal-approval.json`; local guard coverage remains `npm run smoke:legal-approval-validation`",
  "Privacy and store compliance evidence passes `npm run privacy:store:validate -- path/to/privacy-store-compliance.json`; local guard coverage remains `npm run smoke:privacy-store-compliance-validation`",
  "Android release Gradle properties pass `npm run android:release-config:validate -- path/to/release.properties`; an RLNC-enabled release must also pass a real decision through `--rlnc-decision path/to/android-rlnc-decision.json`; local guard coverage remains `npm run smoke:android-release-config-validation`",
  "Android debug and release build evidence passes `npm run android:ci:evidence:validate -- path/to/android-ci-evidence.json`, including `swarmcast-android-debug-apk`, `swarmcast-android-release-unsigned-apk`, and checksum sidecar evidence; local guard coverage remains `npm run smoke:android-ci-evidence-validation`",
  "Android Delivery-Fleet-only playback evidence passes `npm run android:playback:evidence:validate -- path/to/android-playback-evidence.json` with 30-minute WiFi and cellular soaks, edge cache hit evidence, and crash-free playback; local guard coverage remains `npm run smoke:android-playback-evidence-validation`",
  "Android P2P transfer evidence follows `docs/android-device-lab.md` and passes `npm run android:p2p:evidence:validate -- path/to/android-p2p-evidence.json`",
  "at least four distinct Play-installed physical devices across two WiFi failure domains and two cellular carriers",
  "direct `rho >= 0.90`",
  "Raw device-lab output is not launch evidence until those server/provider records and independent reviews are joined",
  "local guard coverage remains `npm run smoke:android-device-lab` and `npm run smoke:android-p2p-evidence-validation`",
  "Android RLNC decoder decision evidence passes `npm run android:rlnc:decision:validate -- path/to/android-rlnc-decision.json`; local guard coverage remains `npm run smoke:android-rlnc-decision-validation`",
  "Threat model sign-off evidence passes `npm run threat:model:validate -- path/to/threat-model-review.json` for auth, tracker, control plane, ingest, segment metadata bus, retention worker, edge, Android P2P, RLNC, release, and dependency supply chain; local guard coverage remains `npm run smoke:threat-model-review-validation`",
  "retention worker",
  "Dependency review evidence passes `npm run dependency:review:validate -- path/to/dependency-review.json`; evidence must cover npm audit, SBOM, release image refs, image scans, Android debug/release builds, inventory decisions, reviewer roles, and waiver expiry; local guard coverage remains `npm run smoke:dependency-review-validation`",
  "Release artifact evidence includes the `swarmcast-release-manifest` and `swarmcast-sbom` artifacts, plus `npm run smoke:release-manifest-production` output",
  "Runtime image vulnerability scan reports pass `npm run image:scan:validate`, local report-level guard coverage remains `npm run smoke:image-scan-report-validation`, the release bundle passes `npm run image:scan:bundle:validate -- --manifest var/release/swarmcast-release-manifest.json var/scans/*.trivy.json`, and launch evidence references all 16 expected service and infrastructure scan report paths",
  "Capacity/load ladder evidence follows `docs/distributed-load-ladder.md`, uses `npm run load:ladder:probe` on independent generator hosts",
  "It requires hash-bound mode-`0600` raw probes, exact peer-range coverage, synchronized cross-provider starts",
  "local guard coverage remains `npm run smoke:capacity-plan-validation`, `npm run smoke:load-ladder-probe`, and `npm run smoke:load-ladder-evidence-validation`",
  "Segment metadata bus evidence follows `docs/segment-bus-capacity.md` and passes `npm run segment-bus:capacity:evidence:validate -- path/to/segment-bus-capacity-evidence.json`",
  "Local guard coverage remains `npm run smoke:segment-bus-capacity-probe`, `npm run smoke:segment-bus-capacity-evidence-validation`, and `npm run smoke:segment-bus-cluster`",
  "Owned TURN packaging passes `npm run smoke:turn`; production evidence must additionally pass `npm run turn:capacity:evidence:validate -- path/to/turn-capacity-evidence.json`",
  "Data retention approval evidence passes `npm run retention:approval:validate -- path/to/retention-approval.json`, retention execution evidence passes `npm run retention:execution:evidence:validate -- path/to/retention-execution-evidence.json`, and local guard coverage remains `npm run smoke:retention-approval-validation` plus `npm run smoke:retention-execution-evidence-validation`",
  "Accessibility and UX evidence passes `npm run android:accessibility:validate -- path/to/android-accessibility-evidence.json` for TalkBack, 200% fonts, small screens, player controls, P2P/privacy controls, touch targets, error states, and localization readiness; local guard coverage remains `npm run smoke:android-accessibility-evidence-validation`",
  "Host provisioning evidence passes `npm run host:provisioning:evidence:validate -- path/to/host-provisioning-evidence.json` with origin, edge, API, tracker, control-plane, retention-worker, TURN, and monitoring host coverage plus DNS, TLS, TURN port/range, internal-port deny, and compose-render evidence before production smoke evidence",
  "Production secrets evidence passes `npm run secrets:evidence:validate -- path/to/secrets-evidence.json`",
  "secret purpose, production scope, storage, rotation policy, runtime injection, access-review, backup/restore, redaction, and no-raw-secret evidence shape",
  "Production environment config passes `npm run env:production:validate -- path/to/production.env`, `npm run smoke:production-env-validation`, and `npm run smoke:compose-production-env` before deployment",
  "Final non-synthetic launch evidence must set `environment` to `production`; synthetic staging fixtures are shape-only and require `--allow-synthetic`",
  "Deployment execution evidence passes `npm run deployment:evidence:validate -- path/to/deployment-evidence.json`, proving each required service image was pulled, deployed with `up --no-build`, checked healthy, post-deploy smoked, and rollback-ready with exact service and control evidence markers",
  "Real nginx/TLS edge and origin playback evidence passes `npm run nginx:tls:evidence:validate -- path/to/nginx-tls-evidence.json`; evidence must name valid certificate, hostname verification, origin auth, authorized segment fetch, edge MISS/HIT, cross-token cache reuse, source URL redaction, cache-key redaction, and no third-party CDN fallback; local regression coverage remains `npm run smoke:nginx-origin-playback`, `npm run smoke:nginx-edge-cache`, and `npm run smoke:nginx-tls-evidence-validation`",
  "npm run nginx:tls:evidence:validate -- path/to/nginx-tls-evidence.json",
  "npm run smoke:nginx-edge-cache",
  "npm run smoke:nginx-origin-playback",
  "Source allowlist evidence passes `npm run source:allowlist:evidence:validate -- path/to/source-allowlist-evidence.json`",
  "production catalog preflight",
  "Signed catalog import evidence passes `npm run catalog:import:validate -- path/to/catalog-import-evidence.json`; local guard coverage remains `npm run smoke:catalog-import-validation`",
  "Production smoke evidence passes `npm run production:smoke:evidence:validate -- path/to/production-smoke-evidence.json`",
  "Prometheus alert rules pass `npm run prometheus:alerts:validate`, including the launch alert inventory, warning and critical severity coverage, and runbook links; local guard coverage remains `npm run smoke:prometheus-alerts-validation`",
  "Grafana dashboard JSON passes `npm run grafana:dashboard:validate`; local guard coverage remains `npm run smoke:grafana-dashboard-validation`",
  "App incident runbook can force Delivery-Fleet-only playback",
  "npm run canary:metrics:validate -- path/to/canary-metrics.json",
  "npm run smoke:canary-metrics-validation",
  "npm run canary:rollout:evidence:validate -- path/to/canary-rollout-evidence.json",
  "npm run capacity:plan:validate -- config/capacity-plan.json",
  "npm run smoke:capacity-plan-validation",
  "Rollback drill evidence passes `npm run rollback:evidence:validate -- path/to/rollback-evidence.json`",
  "Staging restore evidence passes `npm run restore:evidence:validate -- path/to/restore-evidence.json`; local guard coverage remains `npm run smoke:restore-evidence-validation`",
  "Security review evidence passes `npm run security:review:validate -- path/to/security-review.json`; local guard coverage remains `npm run smoke:security-review-validation`",
  "Alertmanager fire-drill evidence passes `npm run alertmanager:fire-drill:validate -- path/to/alertmanager-fire-drill.json`; evidence must name receiver validation, routing smoke, warning firing, critical firing, critical resolved, expected receivers, and acknowledgment markers",
  "npm run alertmanager:receivers:validate -- path/to/alertmanager.yml",
  "Staging chaos drill evidence passes `npm run chaos:staging:validate -- path/to/staging-chaos-evidence.json`, including a peer-health incident drill",
  "Chaos drills",
  "Go/No-Go Record",
  "Machine-Readable Launch Evidence",
  "docs/launch-artifact-bundle.md",
  "exact 53-artifact inventory",
  "distinct release, operations, and security approvals",
  "npm run launch:evidence:validate -- path/to/launch-evidence.json",
  "The validator requires every hard blocker to be present, owned, complete, and backed by evidence. It fails by default when any gate is `blocked`, `partial`, or `waived`; use `--allow-incomplete` only for rehearsal or shape checks before the final go/no-go review",
  "`release-artifacts`",
  "`privacy-store-compliance` with `privacy:store:validate`, `docs/privacy-store-compliance.md`, `support-faq-reviewed`, and `app-store-notes-reviewed`",
  "`android-release-config`",
  "`dependency-review` with `dependency:review:validate`, `npm-audit`, `sbom`, `release-image-refs`, `image-scans`, `android-debug-build`, `android-release-build`, `inventory-decisions`, and `waiver-expiry`",
  "`image-scan-reports`",
  "`host-provisioning`",
  "`production-secrets`",
  "Production environment config",
  "`catalog-import`",
  "`deployment-execution` with `deployment:evidence:validate`, `release-manifest-validated`, `image-digests-pinned`, `compose-rendered`, `images-pulled`, `deployed-up-no-build`, `service-health`, `post-deploy-smokes`, and `rollback-ready`",
  "`nginx-tls-smoke` with `nginx:tls:evidence:validate`, `smoke:nginx-origin-playback`, `smoke:nginx-edge-cache`, `valid-certificate`, `hostname-verified`, `origin-auth-401`, `origin-segment-200`, `edge-cache-miss`, `edge-cache-hit`, `cross-token-hit`, `no-third-party-cdn`, `source-url-redaction`, and `cache-key-redaction`",
  "`canary-rollout` with `canary:rollout:evidence:validate`, `canary:metrics:validate`, `peerTimeouts5m`, `peerHashFailures5m=0`, and `peerDisconnects5m=0`",
  "`capacity-load-ladder` with `capacity:plan:validate`, `load:ladder:validate`, `direct-p2p-offload-measured`, `edge-tls-throughput-measured`, `provider-traffic-terms-approved`, `relay-egress-included`, `selfSustainingSweep`, `webrtc-datachannel`, `tracker-signaling-relay`, `raw-probe-artifacts-sha256`, `independent-generator-providers`, `exact-peer-range-coverage`, `cross-generator-webrtc`, and the `single-channel-cell-ladder-1k`, `single-channel-cell-ladder-10k`, and `single-channel-cell-ladder-100k` markers",
  "`segment-metadata-bus` with `segment-bus:capacity:evidence:validate`, `three-failure-domain-cluster`, `projected-peak-sustained`, `publish-delivery-reconciled`, `leader-loss-quorum`, `persistent-latest-replay`, `credential-rotation`, `subject-permission-denial`, `hostname-verified-tls`, `mutual-route-tls`, `storage-recovery`, `monitoring-reconciled`, `raw-probe-artifact-sha256`, and `independent-reviewers`",
  "`turn-relay` with `smoke:turn`, `turn:capacity:evidence:validate`, `turn-rest-credentials`, `turn-udp-relay`, `turn-tls-relay`, `turn-prometheus`, `turn-private-peer-deny`, `android-relay-candidate-selected`, `direct-relay-payload-attribution`, `relay-egress-reconciled`, `relay-egress-included`, `turn-capacity-sustained`, `independent-load-generators`, `udp-tls-capacity`, and `provider-egress-reconciled`",
  "`staging-chaos-drills` with `chaos:staging:validate`, `android-playback-continuity`, `owned-edge-failover`, `placement-failover`, `durable-placement-restore`, `peer-health-incident`, `SwarmcastPeerHashFailures`, and `docs/runbooks/peer-health.md`",
  "`production-smokes` with `production:smoke:evidence:validate`, `source-preflight`, `catalog-search-pagination`, `ingest-demand-segments`, `edge-cache-miss-hit`, `tracker-join-peer-list-signal-stats-metrics`, `retention-health-metrics`, and `offload-dashboard-alert-query`",
  "`rollback-drill` with `rollback:evidence:validate`, `docs/runbooks/rollback-drill.md`, `android-release-halt-ready`, `app-incident-delivery-fleet-only`, and `tail-edge-only-mode`",
  "Synthetic evidence fixtures must be validated with `--allow-synthetic`"
]) {
  if (!readinessText.includes(required)) {
    console.error(`docs/launch-readiness.md: missing launch readiness gate: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const launchArtifactBundleDocText = readFileSync("docs/launch-artifact-bundle.md", "utf8");
for (const required of [
  "all 34 launch gates with exactly 53 artifacts",
  "38 fixed validation groups",
  "one unique repository-relative path per artifact ID",
  "no `test-fixtures/` paths in a production bundle",
  "npm run launch:artifacts:generate",
  "mode `0600` and exclusive-create semantics",
  "Three distinct people must approve",
  "npm run launch:evidence:validate",
  "prohibited for production approval"
]) {
  if (!launchArtifactBundleDocText.includes(required)) {
    console.error(`docs/launch-artifact-bundle.md: missing launch artifact bundle text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const legalGateText = readFileSync("docs/legal-gate.md", "utf8");
for (const required of [
  "Redistribution or rebroadcast",
  "Peer relay from viewer devices",
  "viewer-device-retransmission",
  "operational-metrics-logging",
  "privacy-disclosure",
  "npm run legal:approval:validate -- path/to/legal-approval.json",
  "npm run smoke:legal-approval-validation",
  "test-fixtures/legal/legal-approval-complete.synthetic.json"
]) {
  if (!legalGateText.includes(required)) {
    console.error(`docs/legal-gate.md: missing legal gate text: ${required}`);
    failed = true;
  }
}

const legalApprovalScriptText = readFileSync("scripts/validate-legal-approval.js", "utf8");
for (const required of [
  "requiredApproverRoles",
  "content-licensing",
  "redistribution",
  "peerRelay",
  "viewerDeviceRetransmission",
  "requiredRightEvidence",
  "redistribution-rights",
  "rebroadcast-rights",
  "peer-relay-rights",
  "viewer-device-retransmission",
  "territory-platform-scope",
  "app-store-distribution",
  "operational-metrics-logging",
  "privacy-disclosure",
  "appStoreDistribution",
  "operationalMetricsLogging",
  "privacyDisclosure",
  "synthetic legal approval requires --allow-synthetic",
  "Legal approval OK"
]) {
  if (!legalApprovalScriptText.includes(required)) {
    console.error(`scripts/validate-legal-approval.js: missing legal approval validator text: ${required}`);
    failed = true;
  }
}

const legalApprovalSmokeText = readFileSync("scripts/smoke-legal-approval-validation.js", "utf8");
for (const required of [
  "scripts/validate-legal-approval.js",
  "test-fixtures/legal/legal-approval-complete.synthetic.json",
  "synthetic legal approval requires --allow-synthetic",
  "rights\\.peerRelay must be true",
  "evidence must mention viewer-device-retransmission",
  "missing required approval role privacy",
  "duplicate approval role legal",
  "content-licensing\\.approvedAt must be ISO-8601 parseable",
  "territories contains duplicate US",
  "privacy\\.evidence evidence reference looks like it may contain sensitive source, token, or personal material",
  "legal approval validation smoke OK: pass=1 failures=9"
]) {
  if (!legalApprovalSmokeText.includes(required)) {
    console.error(`scripts/smoke-legal-approval-validation.js: missing legal approval smoke text: ${required}`);
    failed = true;
  }
}

const legalApprovalFixtureText = readFileSync("test-fixtures/legal/legal-approval-complete.synthetic.json", "utf8");
for (const required of [
  "\"approvalId\": \"legal-approval-20260705\"",
  "\"redistribution\": true",
  "\"peerRelay\": true",
  "\"viewerDeviceRetransmission\": true",
  "\"appStoreDistribution\": true",
  "redistribution-rights",
  "rebroadcast-rights",
  "peer-relay-rights",
  "viewer-device-retransmission",
  "territory-platform-scope",
  "app-store-distribution",
  "operational-metrics-logging",
  "privacy-disclosure",
  "\"role\": \"legal\"",
  "\"role\": \"content-licensing\"",
  "\"role\": \"privacy\"",
  "\"synthetic\": true"
]) {
  if (!legalApprovalFixtureText.includes(required)) {
    console.error(`test-fixtures/legal/legal-approval-complete.synthetic.json: missing legal approval fixture text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const capacityPlanScriptText = readFileSync("scripts/validate-capacity-plan.js", "utf8");
for (const required of [
  "offloadMeasurementStatus must be measured before launch",
  "directP2pOffloadRatio must be at least 0.90 before launch",
  "segmentBusCapacityMeasurementStatus must be measured before launch",
  "segmentBusTargetMessagesPerSecond",
  "requiredSegmentBusMessagesPerSecond",
  "edgeNodeCapacityMeasurementStatus must be measured before launch",
  "providerTrafficTermsApproved must be true before launch",
  "relayEgressIncluded must be true",
  "edgeNodeCapacityMbps exceeds the sustained link utilization budget",
  "validateSensitivity",
  "--allow-draft",
  "edgeCacheHitRatio must be at least 0.80 before launch",
  "plannedEdgeNodes",
  "plannedOriginNodes",
  "Capacity plan OK"
]) {
  if (!capacityPlanScriptText.includes(required)) {
    console.error(`scripts/validate-capacity-plan.js: missing capacity plan validation text: ${required}`);
    failed = true;
  }
}

const capacityPlanText = readFileSync("docs/capacity-plan.md", "utf8");
for (const required of [
  "npm run capacity:plan:validate -- config/capacity-plan.json",
  "npm run capacity:plan:validate -- --allow-draft config/capacity-plan.json",
  "npm run smoke:capacity-plan-validation",
  "`directP2pOffloadRatio`",
  "`offloadMeasurementStatus`",
  "`edgeNodeCapacityMeasurementStatus`",
  "`providerTrafficTermsApproved`",
  "`relayEgressIncluded`",
  "`selfSustainingSuperPeerFraction`",
  "`helperUploadPacketsPerSegment`",
  "`superPeerSweepEvidence`",
  "`edgeCacheHitRatio`",
  "`segmentDurationSeconds`",
  "`segmentBusTargetMessagesPerSecond`",
  "`segmentBusCapacityMeasurementStatus`",
  "`segmentBusCapacityEvidence`",
  "docs/segment-bus-capacity.md",
  "`plannedEdgeNodes`",
  "`plannedOriginNodes`",
  "directP2pOffloadRatio >= 0.90",
  "82 nodes at `rho=0.99`",
  "813 at `rho=0.90`",
  "2,438 at `rho=0.70`",
  "4,063 at `rho=0.50`",
  "selfSustainingSuperPeerFraction <= 0.25"
]) {
  if (!capacityPlanText.includes(required)) {
    console.error(`docs/capacity-plan.md: missing capacity plan text: ${required}`);
    failed = true;
  }
}

const capacityPlanSmokeText = readFileSync("scripts/smoke-capacity-plan-validation.js", "utf8");
for (const required of [
  "scripts/validate-capacity-plan.js",
  "reviewDate = \"07/05/2026\"",
  "directP2pOffloadRatio = 0.89",
  "edgeNodeCapacityMbps = 801",
  "edgeNodeCapacityMeasurementStatus = \"conservative-assumption\"",
  "offloadMeasurementEvidence = \"load-ladder/physical-device.synthetic.json\"",
  "edgeNodeCapacityEvidence = \"capacity/edge-node-throughput.pending.json\"",
  "providerTrafficTermsApproved = false",
  "providerTrafficTermsEvidence = \"capacity/provider-traffic-terms.pending.md\"",
  "relayEgressIncluded = false",
  "selfSustainingSuperPeerFraction = 0.3",
  "superPeerSweepEvidence = \"token=synthetic-secret\"",
  "edgeCacheHitRatio = 0.79",
  "plannedEdgeNodes = 24",
  "plannedOriginNodes = 4",
  "capacity plan validation smoke OK: pass=2 failures=18"
]) {
  if (!capacityPlanSmokeText.includes(required)) {
    console.error(`scripts/smoke-capacity-plan-validation.js: missing capacity plan smoke text: ${required}`);
    failed = true;
  }
}

const capacityPlanJsonText = readFileSync("config/capacity-plan.json", "utf8");
for (const required of [
  "\"offloadMeasurementStatus\": \"modeled\"",
  "\"directP2pOffloadRatio\": 0.85",
  "\"selfSustainingSuperPeerFraction\": 0.15",
  "\"helperUploadPacketsPerSegment\": 150",
  "\"superPeerSweepEvidence\": \"load-ladder/headless-super-peer-sweep.synthetic.json\"",
  "\"edgeCacheHitRatio\": 0.85",
  "\"segmentDurationSeconds\": 2",
  "\"segmentBusCapacityMeasurementStatus\": \"pending\"",
  "\"segmentBusTargetMessagesPerSecond\": 325",
  "\"segmentBusCapacityEvidence\": \"capacity/segment-bus-capacity.pending.json\"",
  "\"edgeNodeCapacityMeasurementStatus\": \"conservative-assumption\"",
  "\"edgeNodeCapacityMbps\": 800",
  "\"providerTrafficTermsApproved\": false",
  "\"relayEgressIncluded\": true",
  "\"headroomRatio\": 0.3",
  "\"plannedEdgeNodes\": 25",
  "\"plannedOriginNodes\": 5",
  "\"sensitivityPeakConcurrentViewers\": 1000000",
  "\"requiredEdgeNodes\": 4063"
]) {
  if (!capacityPlanJsonText.includes(required)) {
    console.error(`config/capacity-plan.json: missing capacity plan value: ${required}`);
    failed = true;
  }
}

const assumptionsText = readFileSync("docs/assumptions.md", "utf8");
for (const required of [
  "config/capacity-plan.json",
  "npm run capacity:plan:validate -- --allow-draft config/capacity-plan.json",
  "Self-sustaining super-peer threshold",
  "current deterministic sweep flattens at 15%",
  "corrected deterministic model currently reports 0.85",
  "800 Mbps sustained on a 1 Gbps link",
  "min(80% of reported uplink, 1.5 MB/s)",
  "unknown uplink and disallowed policy produce zero upload"
]) {
  if (!assumptionsText.includes(required)) {
    console.error(`docs/assumptions.md: missing capacity plan assumption text: ${required}`);
    failed = true;
  }
}

const architectureRemediationText = readFileSync("docs/architecture-remediation-plan.md", "utf8");
for (const required of [
  "one shared monotonic token bucket across all peer links",
  "capped at 80% of the current reported uplink and 1.5 MB/s of payload",
  "WiFi-to-cellular transition fails closed",
  "concurrent reservations",
  "docs/segment-bus-capacity.md",
  "projected active-channel publication rate plus 30% headroom",
  "Segment metadata bus projected-peak soak across three real failure domains"
]) {
  if (!architectureRemediationText.includes(required)) {
    console.error(`docs/architecture-remediation-plan.md: missing upload budget text: ${required}`);
    failed = true;
  }
}

const segmentBusCapacityText = readFileSync("docs/segment-bus-capacity.md", "utf8");
for (const required of [
  "Exactly three NATS JetStream brokers in three failure domains and at least two infrastructure providers",
  "325 acknowledged publications per second",
  "--acknowledge-staging-disruption",
  "mode `0600`",
  "Stop the current stream leader",
  "Restart the full cluster",
  "distinct `platform`, `performance`, and `security` reviewers",
  "npm run segment-bus:capacity:evidence:validate -- path/to/segment-bus-capacity-evidence.json",
  "cannot satisfy the launch gate"
]) {
  if (!segmentBusCapacityText.includes(required)) {
    console.error(`docs/segment-bus-capacity.md: missing capacity proof text: ${required}`);
    failed = true;
  }
}

const lowSuperPeerRunbookText = readFileSync("docs/runbooks/low-super-peer-fraction.md", "utf8");
for (const required of [
  "at most 80% of reported uplink",
  "does not include WebRTC/IP transport overhead",
  "Do not raise the client payload cap"
]) {
  if (!lowSuperPeerRunbookText.includes(required)) {
    console.error(`docs/runbooks/low-super-peer-fraction.md: missing upload budget guidance: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const canaryMetricsScriptText = readFileSync("scripts/validate-canary-metrics.js", "utf8");
for (const required of [
  "validatePerformanceBudgets",
  "androidCrashFreeSessions",
  "androidStartupLatencyMsP95",
  "androidStallRate",
  "offloadRatio5m",
  "peerTimeouts5m",
  "peerHashFailures5m",
  "peerDisconnects5m",
  "edgeEgressBytesPerSecond",
  "Canary metrics OK"
]) {
  if (!canaryMetricsScriptText.includes(required)) {
    console.error(`scripts/validate-canary-metrics.js: missing canary metrics validation text: ${required}`);
    failed = true;
  }
}

const canaryMetricsFixtureText = readFileSync("test-fixtures/launch/canary-metrics-pass.json", "utf8");
for (const required of [
  "\"androidCrashFreeSessions\": 0.995",
  "\"androidStartupLatencyMsP95\": 3200",
  "\"androidStallRate\": 0.003",
  "\"offloadRatio5m\": 0.92",
  "\"peerTimeouts5m\": 4",
  "\"peerHashFailures5m\": 0",
  "\"peerDisconnects5m\": 0",
  "\"edgeEgressBytesPerSecondMax\": 200000000"
]) {
  if (!canaryMetricsFixtureText.includes(required)) {
    console.error(`test-fixtures/launch/canary-metrics-pass.json: missing canary metrics fixture text: ${required}`);
    failed = true;
  }
}

const canaryMetricsSmokeText = readFileSync("scripts/smoke-canary-metrics-validation.js", "utf8");
for (const required of [
  "scripts/validate-canary-metrics.js",
  "androidCrashFreeSessions = 0.98",
  "androidStartupLatencyMsP95 = 5100",
  "androidStallRate = 0.02",
  "androidBufferMsMin = 9000",
  "offloadRatio5m = 0.85",
  "edgeCacheHitRatio = 0.75",
  "peerTimeouts5m = 51",
  "peerHashFailures5m = 1",
  "peerDisconnects5m = 1",
  "canary metrics validation smoke OK: pass=1 failures=9"
]) {
  if (!canaryMetricsSmokeText.includes(required)) {
    console.error(`scripts/smoke-canary-metrics-validation.js: missing canary metrics smoke text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const alertmanagerReceiverScriptText = readFileSync("scripts/validate-alertmanager-receivers.js", "utf8");
for (const required of [
  "oncall-default",
  "oncall-critical",
  "send_resolved: true",
  "query-string secrets",
  "Alertmanager receivers OK"
]) {
  if (!alertmanagerReceiverScriptText.includes(required)) {
    console.error(`scripts/validate-alertmanager-receivers.js: missing alertmanager receiver validation text: ${required}`);
    failed = true;
  }
}

const alertmanagerRoutingSmokeText = readFileSync("scripts/smoke-alertmanager-routing.js", "utf8");
for (const required of [
  "parseRoute",
  "routeAlert",
  "sendResolved",
  "resolvedCritical=true",
  "alertmanager routing smoke OK"
]) {
  if (!alertmanagerRoutingSmokeText.includes(required)) {
    console.error(`scripts/smoke-alertmanager-routing.js: missing alertmanager routing smoke text: ${required}`);
    failed = true;
  }
}

const alertmanagerReceiverFixtureText = readFileSync("test-fixtures/monitoring/alertmanager-production.yml", "utf8");
for (const required of [
  "receiver: oncall-default",
  "receiver: oncall-critical",
  "https://alerts.swarmcast.tv/webhooks/default",
  "https://alerts.swarmcast.tv/webhooks/critical",
  "send_resolved: true"
]) {
  if (!alertmanagerReceiverFixtureText.includes(required)) {
    console.error(`test-fixtures/monitoring/alertmanager-production.yml: missing alertmanager receiver fixture text: ${required}`);
    failed = true;
  }
}

const alertmanagerFireDrillScriptText = readFileSync("scripts/validate-alertmanager-fire-drill.js", "utf8");
for (const required of [
  "requiredNotifications",
  "warning-firing",
  "critical-firing",
  "critical-resolved",
  "alertmanager:receivers:validate",
  "smoke:alertmanager-routing",
  "requireEvidenceMarker",
  "evidence must mention",
  "acknowledged",
  "synthetic Alertmanager fire-drill evidence requires --allow-synthetic",
  "Alertmanager fire-drill evidence OK"
]) {
  if (!alertmanagerFireDrillScriptText.includes(required)) {
    console.error(`scripts/validate-alertmanager-fire-drill.js: missing Alertmanager fire-drill validator text: ${required}`);
    failed = true;
  }
}

const alertmanagerFireDrillFixtureText = readFileSync("test-fixtures/monitoring/alertmanager-fire-drill-complete.synthetic.json", "utf8");
for (const required of [
  "\"drillId\": \"alertmanager-fire-drill-20260705\"",
  "\"id\": \"warning-firing\"",
  "\"id\": \"critical-firing\"",
  "\"id\": \"critical-resolved\"",
  "\"expectedReceiver\": \"oncall-default\"",
  "\"expectedReceiver\": \"oncall-critical\"",
  "\"notificationObserved\": true",
  "\"acknowledged\": true",
  "warning-firing oncall-default acknowledged",
  "critical-firing oncall-critical acknowledged",
  "critical-resolved oncall-critical acknowledged",
  "\"synthetic\": true"
]) {
  if (!alertmanagerFireDrillFixtureText.includes(required)) {
    console.error(`test-fixtures/monitoring/alertmanager-fire-drill-complete.synthetic.json: missing Alertmanager fire-drill fixture text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const productionEnvConfigurationText = readFileSync("docs/configuration.md", "utf8");
for (const required of [
  "npm run env:production:validate -- path/to/production.env",
  "rejects placeholders, non-HTTPS public bases, unsafe source allowlists, missing persistent auth key paths, missing durable control-plane SQLite paths, tag-only service or infrastructure images, missing retention HTTP store credentials/timeouts, missing retention execution settings, missing production Alertmanager config paths",
  "Production Environment File Gate",
  "Absolute persistent `CATALOG_DB_PATH` and `PLACEMENT_DB_PATH` values",
  "Production Alertmanager deployments must set `ALERTMANAGER_CONFIG_PATH`",
  "release compose overlay",
  "Digest-pinned `SWARMCAST_*_IMAGE` values for every service and production infrastructure container",
  "npm run secrets:evidence:validate -- path/to/secrets-evidence.json",
  "test-fixtures/config/production.env"
]) {
  if (!productionEnvConfigurationText.includes(required)) {
    console.error(`docs/configuration.md: missing production env validation text: ${required}`);
    failed = true;
  }
}

const productionEnvScriptText = readFileSync("scripts/validate-production-env.js", "utf8");
for (const required of [
  "requiredProductionKeys",
  "placeholderPattern",
  "SOURCE_ALLOW_PRIVATE_NETWORKS must be 0 for production",
  "AUTH_KEY_PATH",
  "AUTH_PREVIOUS_JWKS_PATH",
  "requirePersistentFilePath",
  "requireSqlitePath",
  "CATALOG_DB_PATH",
  "PLACEMENT_DB_PATH",
  "RETENTION_STORE_HTTP_TOKEN",
  "RETENTION_STORE_HTTP_TIMEOUT_MS",
  "must be an absolute path",
  "ALERTMANAGER_CONFIG_PATH",
  "SWARMCAST_PROMETHEUS_IMAGE",
  "infrastructureImageKeys",
  "RETENTION_EXECUTE must be 1 for production after approval",
  "digest-pinned with @sha256",
  "Production env OK"
]) {
  if (!productionEnvScriptText.includes(required)) {
    console.error(`scripts/validate-production-env.js: missing production env validation text: ${required}`);
    failed = true;
  }
}

const productionEnvFixtureText = readFileSync("test-fixtures/config/production.env", "utf8");
for (const required of [
  "SOURCE_ALLOWED_HOSTS=source1.upstream.tv,source2.upstream.tv",
  "SOURCE_ALLOW_PRIVATE_NETWORKS=0",
  "AUTH_KEY_PATH=/data/es256.pem",
  "CATALOG_DB_PATH=/data/catalog.sqlite",
  "PLACEMENT_DB_PATH=/data/placements.sqlite",
  "RETENTION_EXECUTE=1",
  "RETENTION_STORE_MODULE=/app/scripts/retention-http-store.js",
  "RETENTION_STORE_HTTP_TOKEN=89abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
  "RETENTION_STORE_HTTP_TIMEOUT_MS=10000",
  "RETENTION_RECORDS_FILE=/data/retention-records.jsonl",
  "ALERTMANAGER_CONFIG_PATH=/etc/swarmcast/alertmanager.yml",
  "SWARMCAST_AUTH_IMAGE=ghcr.io/aziz/ads/auth@sha256:",
  "SWARMCAST_RETENTION_WORKER_IMAGE=ghcr.io/aziz/ads/retention-worker@sha256:",
  "SWARMCAST_PROMETHEUS_IMAGE=prom/prometheus:v2.53.0@sha256:",
  "SWARMCAST_NODE_EXPORTER_IMAGE=prom/node-exporter:v1.8.0@sha256:"
]) {
  if (!productionEnvFixtureText.includes(required)) {
    console.error(`test-fixtures/config/production.env: missing production env fixture text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const launchEvidenceScriptText = readFileSync("scripts/validate-launch-evidence.js", "utf8");
for (const required of [
  "legal-approval",
  "legal:approval:validate",
  "redistribution-rights",
  "peer-relay-rights",
  "viewer-device-retransmission",
  "privacy-disclosure",
  "privacy-store-compliance",
  "privacy:store:validate",
  "docs/privacy-store-compliance.md",
  "support-faq-reviewed",
  "app-store-notes-reviewed",
  "retention:execution:evidence:validate",
  "release-artifacts",
  "smoke:release-manifest-production",
  "android-release-config",
  "android:release-config:validate",
  "smoke:android-release-config-validation",
  "android-ci-build",
  "android:ci:evidence:validate",
  "swarmcast-android-debug-apk",
  "swarmcast-android-release-unsigned-apk",
  "android-device-playback",
  "android:playback:evidence:validate",
  "delivery-fleet-only",
  "30m-soak",
  "wifi",
  "cellular",
  "android-p2p-transfer",
  "android:p2p:evidence:validate",
  "webrtc-datachannel",
  "tracker-signaling-relay",
  "verified-segment-hash",
  "cellular-no-upload",
  "ice-network-class",
  "ice-selected-candidate-type",
  "direct-relay-payload-attribution",
  "relay-egress-reconciled",
  "turn-relay",
  "turn:capacity:evidence:validate",
  "turn-capacity-sustained",
  "independent-load-generators",
  "udp-tls-capacity",
  "provider-egress-reconciled",
  "android-relay-candidate-selected",
  "android-rlnc-decision",
  "android:rlnc:decision:validate",
  "threat-model-signoff",
  "threat:model:validate",
  "security-review",
  "security:review:validate",
  "dependency-review",
  "dependency:review:validate",
  "npm-audit",
  "sbom",
  "release-image-refs",
  "image-scans",
  "android-debug-build",
  "android-release-build",
  "inventory-decisions",
  "waiver-expiry",
  "expectedImageScanEvidence",
  "image-scan-reports",
  "var/scans/node-exporter.trivy.json",
  "image:scan:bundle:validate",
  "accessibility-ux-baseline",
  "android:accessibility:validate",
  "talkback-focus-order",
  "large-font-200",
  "small-screen-layout",
  "touch-targets",
  "host-provisioning",
  "host:provisioning:evidence:validate",
  "public-dns-configured",
  "internal-ports-denied",
  "tls-certificates-issued",
  "monitoring",
  "production-secrets",
  "secrets:evidence:validate",
  "secret-storage",
  "rotation-policy",
  "runtime-injection",
  "access-review",
  "redaction-proof",
  "backup-restore",
  "no-raw-secret",
  "production-environment",
  "env:production:validate",
  "smoke:production-env-validation",
  "smoke:compose-production-env",
  "deployment-execution",
  "deployment:evidence:validate",
  "release-manifest-validated",
  "image-digests-pinned",
  "compose-rendered",
  "images-pulled",
  "deployed-up-no-build",
  "service-health",
  "post-deploy-smokes",
  "rollback-ready",
  "nginx-tls-smoke",
  "nginx:tls:evidence:validate",
  "valid-certificate",
  "hostname-verified",
  "origin-auth-401",
  "origin-segment-200",
  "edge-cache-miss",
  "edge-cache-hit",
  "cross-token-hit",
  "no-third-party-cdn",
  "source-url-redaction",
  "cache-key-redaction",
  "source:allowlist:evidence:validate",
  "catalog-import",
  "catalog:import:validate",
  "smoke:catalog-import-validation",
  "production-smokes",
  "production:smoke:evidence:validate",
  "source-preflight",
  "catalog-search-pagination",
  "ingest-demand-segments",
  "edge-cache-miss-hit",
  "tracker-join-peer-list-signal-stats-metrics",
  "retention-health-metrics",
  "offload-dashboard-alert-query",
  "canary-rollout",
  "canary:rollout:evidence:validate",
  "canary:metrics:validate",
  "peerTimeouts5m",
  "peerHashFailures5m=0",
  "peerDisconnects5m=0",
  "prometheus-alerts",
  "prometheus:alerts:validate",
  "SwarmcastLowOffloadRatio",
  "SwarmcastPeerHashFailures",
  "SwarmcastHighPlaybackStallRate",
  "SwarmcastLowEdgeCacheHitRatio",
  "SwarmcastIngestDegradedChannels",
  "SwarmcastAuthVerifyFailures",
  "SwarmcastRetentionJobFailures",
  "warning",
  "critical",
  "runbook-links",
  "grafana-dashboard",
  "grafana:dashboard:validate",
  "alert-receiver-fire-drill",
  "alertmanager:receivers:validate",
  "alertmanager:fire-drill:validate",
  "smoke:alertmanager-routing",
  "warning-firing",
  "critical-firing",
  "critical-resolved",
  "oncall-default",
  "oncall-critical",
  "acknowledged",
  "segment-metadata-bus",
  "segment-bus:capacity:evidence:validate",
  "three-failure-domain-cluster",
  "projected-peak-sustained",
  "publish-delivery-reconciled",
  "leader-loss-quorum",
  "persistent-latest-replay",
  "credential-rotation",
  "subject-permission-denial",
  "hostname-verified-tls",
  "mutual-route-tls",
  "storage-recovery",
  "monitoring-reconciled",
  "raw-probe-artifact-sha256",
  "independent-reviewers",
  "capacity-load-ladder",
  "capacity:plan:validate",
  "load:ladder:validate",
  "direct-p2p-offload-measured",
  "edge-tls-throughput-measured",
  "provider-traffic-terms-approved",
  "relay-egress-included",
  "selfSustainingSweep",
  "webrtc-datachannel",
  "tracker-signaling-relay",
  "raw-probe-artifacts-sha256",
  "independent-generator-providers",
  "exact-peer-range-coverage",
  "cross-generator-webrtc",
  "single-channel-cell-ladder-1k",
  "single-channel-cell-ladder-10k",
  "single-channel-cell-ladder-100k",
  "staging-chaos-drills",
  "chaos:staging:validate",
  "android-playback-continuity",
  "owned-edge-failover",
  "placement-failover",
  "durable-placement-restore",
  "peer-health-incident",
  "SwarmcastPeerHashFailures",
  "docs/runbooks/peer-health.md",
  "restore-drill",
  "restore:evidence:validate",
  "docs/runbooks/restore-drill.md",
  "rollback-drill",
  "rollback:evidence:validate",
  "android-release-halt-ready",
  "app-incident-delivery-fleet-only",
  "tail-edge-only-mode",
  "launch evidence environment must be production",
  "synthetic-shape-ready",
  "is waived; launch evidence is not complete",
  "--allow-incomplete",
  "--allow-synthetic",
  "sensitiveEvidencePatterns",
  "schemaVersion must equal 2",
  "synthetic must be a boolean",
  "artifact bundle SHA-256 mismatch",
  "non-synthetic artifact bundle must use mode 0600",
  "validateLaunchArtifactBundle",
  "reviewers must include release, operations, and security",
  "reviewer roles and identities must be distinct",
  "Launch evidence OK"
]) {
  if (!launchEvidenceScriptText.includes(required)) {
    console.error(`scripts/validate-launch-evidence.js: missing launch evidence text: ${required}`);
    failed = true;
  }
}

const launchArtifactContractText = readFileSync("scripts/launch-evidence-artifact-contract.js", "utf8");
for (const required of [
  "GATE_ARTIFACT_REQUIREMENTS",
  "artifact bundle synthetic must be a boolean",
  "VALIDATIONS",
  "fixedEnvironment",
  "regular non-symlink file",
  "assigned to more than one artifact",
  "artifact SHA-256 mismatch",
  "artifact changed during validation",
  "must not traverse symlinks or escape the repository root",
  "cannot come from test-fixtures",
  "fixed validator inventory",
  "spawnSync(process.execPath",
  "HOME\", \"PATH\", \"TMPDIR",
  "executeValidators"
]) {
  if (!launchArtifactContractText.includes(required)) {
    console.error(`scripts/launch-evidence-artifact-contract.js: missing launch artifact contract text: ${required}`);
    failed = true;
  }
}

const launchArtifactGeneratorText = readFileSync("scripts/generate-launch-artifact-bundle.js", "utf8");
for (const required of [
  "--inventory",
  "inventory synthetic must be a boolean",
  "--output",
  "exact ${expectedArtifactIds.size}-artifact set",
  "validateLaunchArtifactBundle",
  "flag: \"wx\"",
  "mode: 0o600"
]) {
  if (!launchArtifactGeneratorText.includes(required)) {
    console.error(`scripts/generate-launch-artifact-bundle.js: missing launch artifact generator text: ${required}`);
    failed = true;
  }
}

const launchArtifactSmokeText = readFileSync("scripts/smoke-launch-artifact-bundle-validation.js", "utf8");
for (const required of [
  "artifact hash mismatch",
  "artifact path traversal",
  "artifact command injection",
  "non-boolean bundle synthetic mode",
  "aliased artifact path",
  "symlink artifact",
  "symlinked artifact parent",
  "--definitely-invalid-node-option",
  "bundle generator must not overwrite",
  "bundle generator must reject a symlinked output parent",
  "launch artifact bundle validation smoke OK"
]) {
  if (!launchArtifactSmokeText.includes(required)) {
    console.error(`scripts/smoke-launch-artifact-bundle-validation.js: missing launch artifact smoke text: ${required}`);
    failed = true;
  }
}

const launchEvidenceFixtureText = readFileSync("test-fixtures/launch/evidence-complete.synthetic.json", "utf8");
for (const required of [
  "\"schemaVersion\": 2",
  "\"synthetic\": true",
  "\"environment\": \"staging\"",
  "\"artifactBundle\"",
  "evidence-artifacts.complete.synthetic.json",
  "\"role\": \"release\"",
  "\"role\": \"operations\"",
  "\"role\": \"security\"",
  "\"legal-approval\"",
  "legal:approval:validate",
  "redistribution-rights",
  "peer-relay-rights",
  "viewer-device-retransmission",
  "privacy-disclosure",
  "\"privacy-store-compliance\"",
  "privacy:store:validate",
  "docs/privacy-store-compliance.md",
  "support-faq-reviewed",
  "app-store-notes-reviewed",
  "retention:execution:evidence:validate",
  "\"release-artifacts\"",
  "swarmcast-release-manifest",
  "swarmcast-sbom",
  "smoke:release-manifest-production",
  "\"android-release-config\"",
  "android:release-config:validate",
  "smoke:android-release-config-validation",
  "\"android-ci-build\"",
  "android:ci:evidence:validate",
  "swarmcast-android-debug-apk",
  "swarmcast-android-release-unsigned-apk",
  "\"android-device-playback\"",
  "android:playback:evidence:validate",
  "delivery-fleet-only",
  "30m-soak",
  "wifi",
  "cellular",
  "\"android-p2p-transfer\"",
  "android:p2p:evidence:validate",
  "webrtc-datachannel",
  "tracker-signaling-relay",
  "verified-segment-hash",
  "cellular-no-upload",
  "ice-network-class",
  "ice-selected-candidate-type",
  "direct-relay-payload-attribution",
  "relay-egress-reconciled",
  "\"turn-relay\"",
  "turn:capacity:evidence:validate",
  "turn-capacity-sustained",
  "independent-load-generators",
  "udp-tls-capacity",
  "provider-egress-reconciled",
  "android-relay-candidate-selected",
  "\"android-rlnc-decision\"",
  "android:rlnc:decision:validate",
  "\"threat-model-signoff\"",
  "threat:model:validate",
  "\"security-review\"",
  "security:review:validate",
  "\"dependency-review\"",
  "dependency:review:validate",
  "npm-audit",
  "sbom",
  "release-image-refs",
  "image-scans",
  "android-debug-build",
  "android-release-build",
  "inventory-decisions",
  "waiver-expiry",
  "var/scans/nginx.trivy.json",
  "var/scans/prometheus.trivy.json",
  "var/scans/alertmanager.trivy.json",
  "var/scans/grafana.trivy.json",
  "var/scans/edge-nginx.trivy.json",
  "var/scans/edge-metrics.trivy.json",
  "var/scans/node-exporter.trivy.json",
  "image:scan:bundle:validate",
  "\"accessibility-ux-baseline\"",
  "android:accessibility:validate",
  "talkback-focus-order",
  "large-font-200",
  "small-screen-layout",
  "touch-targets",
  "\"host-provisioning\"",
  "host:provisioning:evidence:validate",
  "public-dns-configured",
  "internal-ports-denied",
  "tls-certificates-issued",
  "monitoring",
  "\"production-secrets\"",
  "secrets:evidence:validate",
  "secret-storage",
  "rotation-policy",
  "runtime-injection",
  "access-review",
  "redaction-proof",
  "backup-restore",
  "no-raw-secret",
  "\"production-environment\"",
  "env:production:validate",
  "smoke:production-env-validation",
  "smoke:compose-production-env",
  "\"deployment-execution\"",
  "deployment:evidence:validate",
  "release-manifest-validated",
  "image-digests-pinned",
  "compose-rendered",
  "images-pulled",
  "deployed-up-no-build",
  "service-health",
  "post-deploy-smokes",
  "rollback-ready",
  "nginx:tls:evidence:validate",
  "valid-certificate",
  "hostname-verified",
  "origin-auth-401",
  "origin-segment-200",
  "edge-cache-miss",
  "edge-cache-hit",
  "cross-token-hit",
  "no-third-party-cdn",
  "source-url-redaction",
  "cache-key-redaction",
  "source:allowlist:evidence:validate",
  "SOURCE_ALLOWED_HOSTS",
  "\"catalog-import\"",
  "catalog:import:validate",
  "smoke:catalog-import-validation",
  "\"production-smokes\"",
  "production:smoke:evidence:validate",
  "source-preflight",
  "catalog-search-pagination",
  "ingest-demand-segments",
  "edge-cache-miss-hit",
  "tracker-join-peer-list-signal-stats-metrics",
  "retention-health-metrics",
  "offload-dashboard-alert-query",
  "\"canary-rollout\"",
  "canary:rollout:evidence:validate",
  "canary:metrics:validate",
  "peerTimeouts5m",
  "peerHashFailures5m=0",
  "peerDisconnects5m=0",
  "\"prometheus-alerts\"",
  "prometheus:alerts:validate",
  "SwarmcastLowOffloadRatio",
  "SwarmcastPeerHashFailures",
  "SwarmcastHighPlaybackStallRate",
  "SwarmcastLowEdgeCacheHitRatio",
  "SwarmcastIngestDegradedChannels",
  "SwarmcastAuthVerifyFailures",
  "SwarmcastRetentionJobFailures",
  "warning",
  "critical",
  "runbook-links",
  "\"grafana-dashboard\"",
  "grafana:dashboard:validate",
  "\"alert-receiver-fire-drill\"",
  "alertmanager:receivers:validate",
  "alertmanager:fire-drill:validate",
  "smoke:alertmanager-routing",
  "warning-firing",
  "critical-firing",
  "critical-resolved",
  "oncall-default",
  "oncall-critical",
  "acknowledged",
  "\"capacity-load-ladder\"",
  "capacity:plan:validate",
  "load:ladder:validate",
  "direct-p2p-offload-measured",
  "edge-tls-throughput-measured",
  "provider-traffic-terms-approved",
  "relay-egress-included",
  "selfSustainingSweep",
  "webrtc-datachannel",
  "tracker-signaling-relay",
  "raw-probe-artifacts-sha256",
  "independent-generator-providers",
  "exact-peer-range-coverage",
  "cross-generator-webrtc",
  "single-channel-cell-ladder-1k",
  "single-channel-cell-ladder-10k",
  "single-channel-cell-ladder-100k",
  "\"staging-chaos-drills\"",
  "chaos:staging:validate",
  "android-playback-continuity",
  "owned-edge-failover",
  "placement-failover",
  "durable-placement-restore",
  "peer-health-incident",
  "SwarmcastPeerHashFailures",
  "docs/runbooks/peer-health.md",
  "\"restore-drill\"",
  "restore:evidence:validate",
  "docs/runbooks/restore-drill.md",
  "\"rollback-drill\"",
  "rollback:evidence:validate",
  "docs/runbooks/rollback-drill.md",
  "android-release-halt-ready",
  "app-incident-delivery-fleet-only",
  "tail-edge-only-mode"
]) {
  if (!launchEvidenceFixtureText.includes(required)) {
    console.error(`test-fixtures/launch/evidence-complete.synthetic.json: missing launch evidence fixture text: ${required}`);
    failed = true;
  }
}

const hostProvisioningEvidenceScriptText = readFileSync("scripts/validate-host-provisioning-evidence.js", "utf8");
for (const required of [
  "requiredChecks",
  "requiredHostRoles",
  "requiredCheckEvidence",
  "ubuntu-2404-lts",
  "docker-compose-installed",
  "sysctl-applied",
  "file-limits-applied",
  "tmpfs-var-hls-mounted",
  "internal-ports-denied",
  "tls-certificates-issued",
  "certbot-renew-dry-run",
  "hosts must include ${role}",
  "duplicate host",
  ".evidence must mention",
  "publicTcpPorts must be exactly [80,443]",
  "turnPublicUdpPorts must be exactly [3478]",
  "turnPublicTcpPorts must be exactly [3478,5349]",
  "turnRelayPortRange must be exactly [49152,65535]",
  "turnMetricsRestrictedToMonitoring must be true",
  "synthetic host provisioning evidence requires --allow-synthetic",
  "Host provisioning evidence OK"
]) {
  if (!hostProvisioningEvidenceScriptText.includes(required)) {
    console.error(`scripts/validate-host-provisioning-evidence.js: missing host provisioning validator text: ${required}`);
    failed = true;
  }
}

const hostProvisioningEvidenceFixtureText = readFileSync("test-fixtures/infra/host-provisioning-complete.synthetic.json", "utf8");
for (const required of [
  "\"evidenceId\": \"host-provisioning-20260705\"",
  "\"publicTcpPorts\": [80, 443]",
  "\"deniedInternalTcpPorts\": [7000, 7001, 7002, 7003, 7010, 7020, 9101]",
  "\"role\": \"origin\"",
  "\"role\": \"edge\"",
  "\"role\": \"api\"",
  "\"role\": \"tracker\"",
  "\"role\": \"control-plane\"",
  "\"role\": \"retention-worker\"",
  "\"role\": \"monitoring\"",
  "\"id\": \"sysctl-applied\"",
  "sysctl-applied-synthetic",
  "\"id\": \"internal-ports-denied\"",
  "internal-ports-denied-synthetic",
  "\"id\": \"tls-certificates-issued\"",
  "tls-certificates-issued",
  "\"id\": \"certbot-renew-dry-run\"",
  "\"synthetic\": true"
]) {
  if (!hostProvisioningEvidenceFixtureText.includes(required)) {
    console.error(`test-fixtures/infra/host-provisioning-complete.synthetic.json: missing host provisioning fixture text: ${required}`);
    failed = true;
  }
}

const nginxTlsEvidenceScriptText = readFileSync("scripts/validate-nginx-tls-evidence.js", "utf8");
for (const required of [
  "validateOrigin",
  "validateEdge",
  "localOriginSmokePassed",
  "localEdgeSmokePassed",
  "unauthorizedPlaylistStatus",
  "authorizedSegmentStatus",
  "firstCacheStatus",
  "secondCacheStatus",
  "crossTokenHit",
  "thirdPartyCdnUsed",
  "requireEvidenceMarker",
  "valid-certificate",
  "hostname-verified",
  "origin-auth-401",
  "source-url-redaction",
  "cache-key-redaction",
  "synthetic nginx/TLS evidence requires --allow-synthetic",
  "nginx/TLS evidence OK"
]) {
  if (!nginxTlsEvidenceScriptText.includes(required)) {
    console.error(`scripts/validate-nginx-tls-evidence.js: missing nginx/TLS validator text: ${required}`);
    failed = true;
  }
}

const nginxTlsEvidenceSmokeText = readFileSync("scripts/smoke-nginx-tls-evidence-validation.js", "utf8");
for (const required of [
  "scripts/validate-nginx-tls-evidence.js",
  "test-fixtures/launch/nginx-tls-smoke-complete.synthetic.json",
  "synthetic nginx\\/TLS evidence requires --allow-synthetic",
  "nginx\\/TLS evidence is incomplete for launch: environment",
  "origin\\.host has invalid format",
  "localOriginSmokePassed must be true",
  "origin\\.tls\\.validCertificate must be true",
  "origin\\.tls\\.evidence evidence must mention hostname-verified",
  "origin\\.unauthorizedPlaylistStatus must be 401",
  "origin\\.evidence evidence must mention source-url-redaction",
  "edge\\.firstCacheStatus has invalid format",
  "edge\\.crossTokenHit must be true",
  "edge\\.evidence evidence must mention cross-token-hit",
  "edge\\.originFills must be 1",
  "edge\\.thirdPartyCdnUsed must be false",
  "edge\\.tokenLeakedInCacheKey must be false",
  "nginx/TLS evidence validation smoke OK: pass=2 failures=16"
]) {
  if (!nginxTlsEvidenceSmokeText.includes(required)) {
    console.error(`scripts/smoke-nginx-tls-evidence-validation.js: missing nginx/TLS smoke text: ${required}`);
    failed = true;
  }
}

const nginxTlsEvidenceFixtureText = readFileSync("test-fixtures/launch/nginx-tls-smoke-complete.synthetic.json", "utf8");
for (const required of [
  "\"evidenceId\": \"nginx-tls-smoke-20260705\"",
  "\"host\": \"origin.staging.swarmcast.tv\"",
  "\"host\": \"edge.staging.swarmcast.tv\"",
  "\"unauthorizedPlaylistStatus\": 401",
  "\"authorizedSegmentStatus\": 200",
  "\"firstCacheStatus\": \"MISS\"",
  "\"secondCacheStatus\": \"HIT\"",
  "\"crossTokenHit\": true",
  "\"thirdPartyCdnUsed\": false",
  "valid-certificate hostname-verified",
  "origin-auth-401 origin-playlist-200 origin-segment-200",
  "edge-auth-401 edge-cache-miss edge-cache-hit",
  "cross-token-hit origin-fills=1 no-third-party-cdn cache-key-redaction",
  "\"synthetic\": true"
]) {
  if (!nginxTlsEvidenceFixtureText.includes(required)) {
    console.error(`test-fixtures/launch/nginx-tls-smoke-complete.synthetic.json: missing nginx/TLS fixture text: ${required}`);
    failed = true;
  }
}

const sourceAllowlistEvidenceScriptText = readFileSync("scripts/validate-source-allowlist-evidence.js", "utf8");
for (const required of [
  "validateHosts",
  "sourcePreflight",
  "productionEnvValidation",
  "approvedHosts",
  "privateNetworksAllowed",
  "catchAllWildcardAllowed",
  "rawSourceUrlsExposed",
  "privateNetworkSourcesRejected",
  "credentialedSourcesRejected",
  "synthetic source allowlist evidence requires --allow-synthetic",
  "Source allowlist evidence OK"
]) {
  if (!sourceAllowlistEvidenceScriptText.includes(required)) {
    console.error(`scripts/validate-source-allowlist-evidence.js: missing source allowlist validator text: ${required}`);
    failed = true;
  }
}

const sourceAllowlistEvidenceFixtureText = readFileSync("test-fixtures/launch/source-allowlist-complete.synthetic.json", "utf8");
for (const required of [
  "\"evidenceId\": \"source-allowlist-20260705\"",
  "\"approvedHosts\": [\"source1.upstream.tv\", \"source2.upstream.tv\"]",
  "\"privateNetworksAllowed\": false",
  "\"catchAllWildcardAllowed\": false",
  "\"rawSourceUrlsExposed\": false",
  "\"privateNetworkSourcesRejected\": true",
  "\"credentialedSourcesRejected\": true",
  "\"publicCatalogStripsSourceUrls\": true",
  "\"channelCount\": 20000",
  "\"synthetic\": true"
]) {
  if (!sourceAllowlistEvidenceFixtureText.includes(required)) {
    console.error(`test-fixtures/launch/source-allowlist-complete.synthetic.json: missing source allowlist fixture text: ${required}`);
    failed = true;
  }
}

const productionSmokeEvidenceScriptText = readFileSync("scripts/validate-production-smoke-evidence.js", "utf8");
for (const required of [
  "requiredChecks",
  "auth-token-issuance",
  "auth-token-verify",
  "source-preflight",
  "catalog-search-pagination",
  "ingest-demand-segments",
  "edge-cache-miss-hit",
  "tracker-join-peer-list-signal-stats-metrics",
  "retention-health-metrics",
  "offload-dashboard-alert-query",
  "synthetic production smoke evidence requires --allow-synthetic",
  "Production smoke evidence OK"
]) {
  if (!productionSmokeEvidenceScriptText.includes(required)) {
    console.error(`scripts/validate-production-smoke-evidence.js: missing production smoke validator text: ${required}`);
    failed = true;
  }
}

const productionSmokeEvidenceFixtureText = readFileSync("test-fixtures/launch/production-smokes-complete.synthetic.json", "utf8");
for (const required of [
  "\"evidenceId\": \"production-smokes-20260705\"",
  "\"id\": \"auth-token-issuance\"",
  "\"id\": \"auth-token-verify\"",
  "\"id\": \"source-preflight\"",
  "\"id\": \"catalog-search-pagination\"",
  "\"id\": \"ingest-demand-segments\"",
  "\"id\": \"edge-cache-miss-hit\"",
  "\"id\": \"tracker-join-peer-list-signal-stats-metrics\"",
  "\"id\": \"retention-health-metrics\"",
  "\"id\": \"offload-dashboard-alert-query\"",
  "\"thirdPartyCdnUsed\": false",
  "\"synthetic\": true"
]) {
  if (!productionSmokeEvidenceFixtureText.includes(required)) {
    console.error(`test-fixtures/launch/production-smokes-complete.synthetic.json: missing production smoke fixture text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const ciWorkflowText = readFileSync(".github/workflows/ci.yml", "utf8");
for (const required of [
  "node-version: 22",
  "npm ci --ignore-scripts",
  "npm run verify",
  "npm run smoke:webrtc-hash-rejection",
  "npm run smoke:webrtc-200",
  "npm run smoke:webrtc-turn-auth-rejection",
  "npm run smoke:webrtc-turn-relay",
  "npm run smoke:webrtc-turn-relay-20",
  "npm audit --audit-level=moderate",
  "android:",
  "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
  "actions/setup-java@0f481fcb613427c0f801b606911222b5b6f3083a # v5.5.0",
  "android-actions/setup-android@40fd30fb8d7440372e1316f5d1809ec01dcd3699 # v4.0.1",
  "gradle/actions/setup-gradle@3f131e8634966bd73d06cc69884922b02e6faf92 # v6.2.0",
  "./gradlew --no-daemon testDebugUnitTest assembleDebug assembleRelease",
  "working-directory: android",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
  "sha256sum app-debug.apk > app-debug.apk.sha256",
  "sha256sum app-release-unsigned.apk > app-release-unsigned.apk.sha256",
  "swarmcast-android-debug-apk",
  "android/app/build/outputs/apk/debug/app-debug.apk",
  "android/app/build/outputs/apk/debug/app-debug.apk.sha256",
  "swarmcast-android-release-unsigned-apk",
  "android/app/build/outputs/apk/release/app-release-unsigned.apk",
  "android/app/build/outputs/apk/release/app-release-unsigned.apk.sha256",
  "if-no-files-found: error",
  "deployment-shape:",
  "sudo apt-get update && sudo apt-get install -y ffmpeg",
  "docker compose -f infra/docker-compose.yml config",
  "docker compose -f infra/edge/docker-compose.yml config",
  "docker compose -f infra/docker-compose.yml build auth control-plane ingest retention-worker tracker web",
  "docker compose -f infra/edge/docker-compose.yml build edge-metrics",
  "npm run smoke:service-lifecycle-containers",
  "docker pull nginx:1.29.8-alpine3.23-slim@sha256:c9366b8c560169b101ca0e5422ed063b20779e6454c2326b9c9704225c9b0c08",
  "npm run smoke:nginx-config",
  "npm run smoke:nginx-origin-playback",
  "npm run smoke:nginx-edge-cache",
  "npm run smoke:turn",
  "npm run smoke:webrtc-turn-auth-rejection",
  "npm run smoke:webrtc-turn-relay",
  "npm run smoke:webrtc-turn-relay-20"
]) {
  if (!ciWorkflowText.includes(required)) {
    console.error(`.github/workflows/ci.yml: missing CI gate text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const releaseWorkflowText = readFileSync(".github/workflows/release.yml", "utf8");
for (const required of [
  "workflow_dispatch:",
  "strategy:",
  "service: auth",
  "service: node-exporter",
  "mode: build",
  "mode: mirror",
  "docker build --pull -f \"$DOCKERFILE\"",
  "docker image inspect --format '{{ json .RepoDigests }}'",
  "node scripts/select-owned-image-ref.js \"$IMAGE\"",
  "npm run sbom:generate -- --output var/sbom/swarmcast-sbom.json",
  "npm run sbom:generate -- --check",
  "npm run release:images:check",
  "npm run image:scan:bundle:validate",
  "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
  "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1",
  "docker/login-action@af1e73f918a031802d376d3c8bbc3fe56130a9b0 # v4.4.0",
  "aquasecurity/setup-trivy@81e514348e19b6112ce2a7e3ecbafe19c1e1f567 # v0.3.1",
  "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6 # v4.1.2",
  "cosign sign --yes",
  "swarmcast-image-scans",
  "swarmcast-image-sboms-signatures",
  "swarmcast-sbom",
  "docker push",
  "15 digest-pinned GHCR images",
  "15 real Trivy JSON reports with no blocked findings",
  "source SBOM plus 15 CycloneDX image SBOMs"
]) {
  if (!releaseWorkflowText.includes(required)) {
    console.error(`.github/workflows/release.yml: missing release workflow text: ${required}`);
    failed = true;
  }
}
if (releaseWorkflowText.includes("\"services/${{ matrix.service }}\"")) {
  console.error(".github/workflows/release.yml: Docker builds must use the repo root context");
  failed = true;
}

const deploymentText = readFileSync("docs/deployment-pipeline.md", "utf8");
for (const required of [
  "immutable container images",
  "uploads it as the `swarmcast-sbom` artifact",
  "CI must pass `npm run verify`, `npm audit --audit-level=moderate`, Android debug/release Gradle assembly, origin and edge compose rendering, `npm run smoke:nginx-config`, `npm run smoke:nginx-origin-playback`, and `npm run smoke:nginx-edge-cache`",
  "infra/docker-compose.release.yml",
  "SWARMCAST_AUTH_IMAGE",
  "SWARMCAST_INGEST_IMAGE",
  "SWARMCAST_TRACKER_IMAGE",
  "SWARMCAST_CONTROL_PLANE_IMAGE",
  "SWARMCAST_RETENTION_WORKER_IMAGE",
  "SWARMCAST_PROMETHEUS_IMAGE",
  "SWARMCAST_NODE_EXPORTER_IMAGE",
  "npm run release:images:check",
  "@sha256:",
  "up --no-build",
  "npm run rollback:evidence:validate -- path/to/rollback-evidence.json",
  "docs/runbooks/rollback-drill.md",
  "`retention-worker`",
  "Promote the same immutable tags to production",
  "Rollback uses the previous stable immutable tag",
  "launch-readiness evidence link"
]) {
  if (!deploymentText.includes(required)) {
    console.error(`docs/deployment-pipeline.md: missing deployment pipeline text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const rollbackDrillText = readFileSync("docs/runbooks/rollback-drill.md", "utf8");
for (const required of [
  "Rollback Drill Runbook",
  "Do not rebuild an old commit during an incident",
  "SWARMCAST_AUTH_IMAGE",
  "SWARMCAST_INGEST_IMAGE",
  "SWARMCAST_TRACKER_IMAGE",
  "SWARMCAST_CONTROL_PLANE_IMAGE",
  "SWARMCAST_RETENTION_WORKER_IMAGE",
  "SWARMCAST_PROMETHEUS_IMAGE",
  "SWARMCAST_NODE_EXPORTER_IMAGE",
  "npm run release:images:check",
  "@sha256:",
  "infra/docker-compose.release.yml",
  "pull auth ingest tracker control-plane web retention-worker",
  "up -d --no-build auth ingest tracker control-plane web retention-worker",
  "npm run rollback:evidence:validate -- path/to/rollback-evidence.json",
  "test-fixtures/rollback/rollback-drill-complete.synthetic.json",
  "Tracker WebSocket join, signal relay, stats intake, and `/metrics` respond",
  "Edge cache still returns authenticated `MISS` then `HIT`",
  "launch-readiness record"
]) {
  if (!rollbackDrillText.includes(required)) {
    console.error(`docs/runbooks/rollback-drill.md: missing rollback drill text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const rollbackEvidenceScriptText = readFileSync("scripts/validate-rollback-evidence.js", "utf8");
for (const required of [
  "requiredServices",
  "requiredPreflightChecks",
  "requiredPostChecks",
  "auth-token-verify",
  "source-preflight",
  "tracker-join-signal-stats-metrics",
  "edge-cache-miss-hit",
  "retention-health-metrics",
  "android-release-halt-ready",
  "app-incident-delivery-fleet-only",
  "tail-edge-only-mode",
  "synthetic rollback evidence requires --allow-synthetic",
  "Rollback evidence OK"
]) {
  if (!rollbackEvidenceScriptText.includes(required)) {
    console.error(`scripts/validate-rollback-evidence.js: missing rollback validator text: ${required}`);
    failed = true;
  }
}

const rollbackEvidenceFixtureText = readFileSync("test-fixtures/rollback/rollback-drill-complete.synthetic.json", "utf8");
for (const required of [
  "\"drillId\": \"rollback-drill-20260705\"",
  "\"rollbackVersion\": \"v0.1.0-previous\"",
  "\"id\": \"release-images-check\"",
  "\"id\": \"up-no-build\"",
  "\"id\": \"auth-token-verify\"",
  "\"id\": \"tracker-join-signal-stats-metrics\"",
  "\"id\": \"edge-cache-miss-hit\"",
  "\"id\": \"retention-health-metrics\"",
  "\"id\": \"android-release-halt-ready\"",
  "\"id\": \"app-incident-delivery-fleet-only\"",
  "\"id\": \"tail-edge-only-mode\"",
  "\"noThirdPartyCdnFallback\": true",
  "\"synthetic\": true"
]) {
  if (!rollbackEvidenceFixtureText.includes(required)) {
    console.error(`test-fixtures/rollback/rollback-drill-complete.synthetic.json: missing rollback fixture text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const productionEnvText = readFileSync("docs/production-environment.md", "utf8");
for (const required of [
  "Core Services",
  "retention-worker",
  "edge-metrics",
  "Image Ref/Digest",
  "`/health` is the process liveness endpoint",
  "`/ready` is the traffic admission endpoint",
  "retention worker `/metrics` scrape evidence",
  "Edge Nodes",
  "Durable Control-Plane State",
  "CATALOG_DB_PATH",
  "PLACEMENT_DB_PATH",
  "Required Secrets",
  "persistent `AUTH_KEY_PATH`",
  "Launch Evidence",
  "npm run production:smoke:evidence:validate -- path/to/production-smoke-evidence.json",
  "npm run host:provisioning:evidence:validate -- path/to/host-provisioning-evidence.json",
  "npm run secrets:evidence:validate -- path/to/secrets-evidence.json",
  "npm run deployment:evidence:validate -- path/to/deployment-evidence.json",
  "docs/segment-bus-capacity.md",
  "npm run segment-bus:capacity:evidence:validate -- path/to/segment-bus-capacity-evidence.json",
  "npm run nginx:tls:evidence:validate -- path/to/nginx-tls-evidence.json",
  "npm run smoke:nginx-tls-evidence-validation",
  "npm run source:allowlist:evidence:validate -- path/to/source-allowlist-evidence.json",
  "Alertmanager Receiver Gate",
  "npm run alertmanager:receivers:validate -- path/to/alertmanager.yml",
  "npm run smoke:alertmanager-routing -- path/to/alertmanager.yml",
  "npm run alertmanager:fire-drill:validate -- path/to/alertmanager-fire-drill.json",
  "resolved critical alerts are delivered",
  "test-fixtures/monitoring/alertmanager-production.yml",
  "test-fixtures/monitoring/alertmanager-fire-drill-complete.synthetic.json"
]) {
  if (!productionEnvText.includes(required)) {
    console.error(`docs/production-environment.md: missing production inventory text: ${required}`);
    failed = true;
  }
}

const backupRestoreText = readFileSync("docs/backup-restore.md", "utf8");
for (const required of [
  "Backup Scope",
  "Restore Drill",
  "docs/runbooks/restore-drill.md",
  "npm run smoke:sqlite-backup-restore",
  "npm run restore:evidence:validate -- path/to/restore-evidence.json",
  "npm run smoke:restore-evidence-validation",
  "test-fixtures/restore/evidence-complete.synthetic.json",
  "Production launch is blocked until a staging restore drill succeeds"
]) {
  if (!backupRestoreText.includes(required)) {
    console.error(`docs/backup-restore.md: missing backup/restore text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const restoreDrillText = readFileSync("docs/runbooks/restore-drill.md", "utf8");
for (const required of [
  "Restore Drill",
  "auth signing keys and JWKS state",
  "control-plane SQLite placement registry",
  "`npm run source:preflight`",
  "`npm run smoke:sqlite-backup-restore`",
  "`npm run smoke:control-plane-placement-sqlite`",
  "`npm run retention:job -- --prometheus`",
  "`npm run restore:evidence:validate -- path/to/restore-evidence.json`",
  "`npm run smoke:restore-evidence-validation`",
  "Do not paste private keys",
  "Source preflight summary with no raw source URLs",
  "Production launch remains blocked"
]) {
  if (!restoreDrillText.includes(required)) {
    console.error(`docs/runbooks/restore-drill.md: missing restore drill text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const restoreEvidenceScriptText = readFileSync("scripts/validate-restore-evidence.js", "utf8");
for (const required of [
  "requiredAssets",
  "requiredChecks",
  "auth-keys",
  "alertmanager-routing",
  "post-restore-smokes",
  "synthetic restore evidence requires --allow-synthetic",
  "Restore evidence OK"
]) {
  if (!restoreEvidenceScriptText.includes(required)) {
    console.error(`scripts/validate-restore-evidence.js: missing restore evidence validation text: ${required}`);
    failed = true;
  }
}

const restoreEvidenceFixtureText = readFileSync("test-fixtures/restore/evidence-complete.synthetic.json", "utf8");
for (const required of [
  "\"drillId\": \"restore-drill-20260705\"",
  "\"environment\": \"staging\"",
  "\"auth-keys\"",
  "\"control-plane-placement\"",
  "\"alertmanager-routing\"",
  "\"post-restore-smokes\"",
  "\"synthetic\": true"
]) {
  if (!restoreEvidenceFixtureText.includes(required)) {
    console.error(`test-fixtures/restore/evidence-complete.synthetic.json: missing restore evidence fixture text: ${required}`);
    failed = true;
  }
}

const restoreEvidenceSmokeText = readFileSync("scripts/smoke-restore-evidence-validation.js", "utf8");
for (const required of [
  "scripts/validate-restore-evidence.js",
  "synthetic restore evidence requires --allow-synthetic",
  "release-images",
  "restored = false",
  "sha256:not-a-valid-checksum",
  "post-restore-smokes",
  "retention-dry-run",
  "allowIncomplete: true",
  "completedAt = record.startedAt",
  "token=synthetic-secret",
  "restore evidence validation smoke OK"
]) {
  if (!restoreEvidenceSmokeText.includes(required)) {
    console.error(`scripts/smoke-restore-evidence-validation.js: missing restore evidence smoke text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const privacyText = readFileSync("docs/privacy-store-compliance.md", "utf8");
for (const required of [
  "Peers watching the same channel may see each other's IP addresses",
  "P2P upload can be turned off",
  "Cellular connections never upload",
  "docs/data-retention-policy.md",
  "disabling P2P immediately closes peer links",
  "Production launch is blocked until privacy policy text",
  "npm run privacy:store:validate -- path/to/privacy-store-compliance.json",
  "test-fixtures/privacy/privacy-store-compliance-complete.synthetic.json",
  "npm run smoke:privacy-store-compliance-validation"
]) {
  if (!privacyText.includes(required)) {
    console.error(`docs/privacy-store-compliance.md: missing privacy compliance text: ${required}`);
    failed = true;
  }
}

const privacyStoreValidatorText = readFileSync("scripts/validate-privacy-store-compliance.js", "utf8");
for (const required of [
  "requiredApproverRoles",
  "privacy-policy-text-reviewed",
  "app-store-notes-reviewed",
  "support-faq-reviewed",
  "peer-ip-disclosure-present",
  "p2p-disable-closes-links",
  "telemetry-source-url-redaction",
  "retention-policy-linked",
  "synthetic privacy/store compliance evidence requires --allow-synthetic",
  "Privacy/store compliance OK"
]) {
  if (!privacyStoreValidatorText.includes(required)) {
    console.error(`scripts/validate-privacy-store-compliance.js: missing privacy/store validator text: ${required}`);
    failed = true;
  }
}

const privacyStoreFixtureText = readFileSync("test-fixtures/privacy/privacy-store-compliance-complete.synthetic.json", "utf8");
for (const required of [
  "\"reviewId\": \"privacy-store-compliance-20260705\"",
  "\"role\": \"privacy\"",
  "\"role\": \"legal\"",
  "\"role\": \"support\"",
  "\"id\": \"privacy-policy-text-reviewed\"",
  "\"id\": \"support-faq-reviewed\"",
  "\"id\": \"p2p-disable-closes-links\"",
  "\"id\": \"telemetry-source-url-redaction\"",
  "\"synthetic\": true"
]) {
  if (!privacyStoreFixtureText.includes(required)) {
    console.error(`test-fixtures/privacy/privacy-store-compliance-complete.synthetic.json: missing privacy/store fixture text: ${required}`);
    failed = true;
  }
}

const privacyStoreSmokeText = readFileSync("scripts/smoke-privacy-store-compliance-validation.js", "utf8");
for (const required of [
  "scripts/validate-privacy-store-compliance.js",
  "synthetic privacy\\/store compliance evidence requires --allow-synthetic",
  "missing required approval role legal",
  "missing required privacy\\/store compliance check support-faq-reviewed",
  "p2p-disable-closes-links\\.status must pass",
  "sourceUrl=https://source.example/live/private.m3u8",
  "privacy/store compliance validation smoke OK: pass=1 failures=5"
]) {
  if (!privacyStoreSmokeText.includes(required)) {
    console.error(`scripts/smoke-privacy-store-compliance-validation.js: missing privacy/store smoke text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const dataRetention = JSON.parse(readFileSync("config/data-retention.json", "utf8"));
const dataRetentionText = readFileSync("docs/data-retention-policy.md", "utf8");
for (const required of [
  "Review date: 2026-07-05",
  "Peer stats",
  "IP-related logs",
  "Auth logs",
  "Playback errors",
  "Metrics",
  "Never log JWTs",
  "upstream source URLs",
  "Data deletion or aggregation jobs",
  "`@swarmcast/config/retention`",
  "`npm run retention:dry-run`",
  "`npm run retention:job`",
  "`npm run smoke:retention-execute`",
  "`npm run smoke:retention-http-store`",
  "`npm run smoke:retention-redaction`",
  "`retention-worker`",
  "`RETENTION_STORE_MODULE`",
  "`RETENTION_STORE_HTTP_BASE_URL`",
  "`RETENTION_STORE_HTTP_TOKEN`",
  "`RETENTION_STORE_HTTP_TIMEOUT_MS`",
  "`RETENTION_EXECUTE=1`",
  "`swarmcast_retention_failures_total`",
  "`aggregate_then_delete_raw`",
  "dry-run JSON, Prometheus metrics, and execute-mode action logs",
  "skip apply calls in dry-run mode",
  "JWTs, source URLs, IP addresses, contact data, and secrets",
  "owner and expiry"
  ,
  "npm run retention:approval:validate -- path/to/retention-approval.json",
  "npm run retention:execution:evidence:validate -- path/to/retention-execution-evidence.json",
  "npm run smoke:retention-approval-validation",
  "npm run smoke:retention-execution-evidence-validation",
  "test-fixtures/retention/retention-approval-complete.synthetic.json",
  "test-fixtures/retention/retention-execution-complete.synthetic.json"
]) {
  if (!dataRetentionText.includes(required)) {
    console.error(`docs/data-retention-policy.md: missing retention policy text: ${required}`);
    failed = true;
  }
}

for (const id of ["peer_stats", "ip_related_logs", "auth_logs", "playback_errors", "metrics"]) {
  const item = dataRetention.classes?.find((entry) => entry.id === id);
  if (!item) {
    console.error(`config/data-retention.json: missing retention class ${id}`);
    failed = true;
    continue;
  }
  for (const key of ["name", "allowedPurpose", "deletionRule"]) {
    if (typeof item[key] !== "string" || item[key].length === 0) {
      console.error(`config/data-retention.json: ${id} missing ${key}`);
      failed = true;
    }
  }
  for (const key of ["rawRetentionDays", "aggregateRetentionDays"]) {
    if (typeof item[key] !== "number" || !Number.isFinite(item[key]) || item[key] <= 0) {
      console.error(`config/data-retention.json: ${id} invalid ${key}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
for (const check of [
  {
    file: "packages/config/src/retention.js",
    required: ["validateRetentionPolicy", "retentionDecision", "retentionPlan", "runRetentionJob", "formatRetentionMetrics", "aggregate_then_delete_raw"]
  },
  {
    file: "scripts/retention-dry-run.js",
    required: ["config/data-retention.json", "retentionPlan", "formatRetentionMetrics", "policyReviewDate"]
  },
  {
    file: "scripts/retention-job.js",
    required: ["RETENTION_STORE_MODULE", "RETENTION_EXECUTE", "runRetentionJob", "formatRetentionMetrics", "policyReviewDate"]
  },
  {
    file: "scripts/retention-http-store.js",
    required: ["RETENTION_STORE_HTTP_BASE_URL", "minimalActionBody", "records must include id", "retention HTTP store list response must be an array"]
  },
  {
    file: "scripts/retention-jsonl-store.js",
    required: ["createJsonlRetentionStore"]
  },
  {
    file: "packages/config/src/retentionStores.js",
    required: ["createJsonlRetentionStore", "listRetentionRecords", "applyRetentionAction", "RETENTION_ACTION_LOG"]
  },
  {
    file: "services/retention-worker/src/index.js",
    required: ["createRetentionWorker", "loadRetentionWorkerConfig", "runRetentionJob", "formatRetentionMetrics", "/metrics"]
  },
  {
    file: "services/retention-worker/Dockerfile",
    required: ["COPY scripts/retention-http-store.js scripts/retention-http-store.js"]
  },
  {
    file: "docs/runbooks/retention-job-failures.md",
    required: ["SwarmcastRetentionJobFailures", "swarmcast_retention_last_success_timestamp_seconds", "incident hold", "npm run retention:job", "RETENTION_STORE_HTTP_BASE_URL"]
  },
  {
    file: "package.json",
    required: ["retention:dry-run", "retention:job", "retention:approval:validate", "retention:execution:evidence:validate", "smoke:retention-approval-validation", "smoke:retention-execution-evidence-validation", "smoke:retention-http-store", "smoke:retention-redaction"]
  },
  {
    file: "scripts/validate-retention-approval.js",
    required: [
      "requiredApproverRoles",
      "requiredControls",
      "policyClassMap",
      "missing retention approval",
      "policyArgIndex !== -1",
      "synthetic retention approval requires --allow-synthetic",
      "Retention approval OK"
    ]
  },
  {
    file: "scripts/smoke-retention-approval-validation.js",
    required: [
      "scripts/validate-retention-approval.js",
      "synthetic retention approval requires --allow-synthetic",
      "legal",
      "peer_stats",
      "auth_logs",
      "rawRetentionDays = 31",
      "metrics",
      "incident-hold-process",
      "retention-job",
      "email=person@example.com",
      "retention approval validation smoke OK"
    ]
  },
  {
    file: "test-fixtures/retention/retention-approval-complete.synthetic.json",
    required: [
      "\"approvalId\": \"retention-approval-20260705\"",
      "\"policyRevision\": \"config/data-retention.json#review-date-2026-07-05\"",
      "\"role\": \"privacy\"",
      "\"role\": \"legal\"",
      "\"id\": \"peer_stats\"",
      "\"id\": \"metrics\"",
      "\"id\": \"staging-execution\"",
      "\"synthetic\": true"
    ]
  },
  {
    file: "scripts/validate-retention-execution-evidence.js",
    required: [
      "requiredClasses",
      "approvalValidation",
      "dryRun",
      "executeRun",
      "scopedCredentials",
      "destructiveGuardVerified",
      "noSensitiveMaterialLeaked",
      "synthetic retention execution evidence requires --allow-synthetic",
      "Retention execution evidence OK"
    ]
  },
  {
    file: "scripts/smoke-retention-execution-evidence-validation.js",
    required: [
      "scripts/validate-retention-execution-evidence.js",
      "synthetic retention execution evidence requires --allow-synthetic",
      "policyReviewDate = \"2026-07-04\"",
      "scopedCredentials = false",
      "destructiveGuardVerified = false",
      "noSensitiveMaterialLeaked = false",
      "dryRun.scannedRecords = 0",
      "executeRun.command",
      "failedRecords = 1",
      "metrics",
      "192.168.0.1",
      "retention execution evidence validation smoke OK"
    ]
  },
  {
    file: "test-fixtures/retention/retention-execution-complete.synthetic.json",
    required: [
      "\"evidenceId\": \"retention-execution-20260705\"",
      "\"policyReviewDate\": \"2026-07-05\"",
      "\"scopedCredentials\": true",
      "\"destructiveGuardVerified\": true",
      "\"noSensitiveMaterialLeaked\": true",
      "\"id\": \"peer_stats\"",
      "\"id\": \"ip_related_logs\"",
      "\"id\": \"auth_logs\"",
      "\"id\": \"playback_errors\"",
      "\"id\": \"metrics\"",
      "\"synthetic\": true"
    ]
  },
  {
    file: "docs/test-fixtures.md",
    required: ["test-fixtures/retention/records.jsonl", "test-fixtures/retention/sensitive-records.jsonl"]
  },
  {
    file: "test-fixtures/retention/sensitive-records.jsonl",
    required: ["SYNTHETIC_JWT_SHOULD_NOT_APPEAR", "https://source.invalid/private/master.m3u8", "203.0.113.10", "viewer@example.invalid", "super-secret-api-key"]
  }
]) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing retention scaffold text: ${required}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
const loggingText = readFileSync("docs/logging-standard.md", "utf8");
for (const required of [
  "newline-delimited JSON logs",
  "`request_id`",
  "`channel_id`",
  "`peer_id`",
  "`segment_seq`",
  "`@swarmcast/config/logging`",
  "`auth_token_issued`",
  "`ffmpeg_worker_failed`",
  "`tracker_joined`",
  "`tracker_idle_peers_closed`",
  "`retention_job_completed`",
  "`retention_job_failed`",
  "`http_request_completed`",
  "Query strings are not logged",
  "Never log JWTs",
  "launch waiver"
]) {
  if (!loggingText.includes(required)) {
    console.error(`docs/logging-standard.md: missing logging standard text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
for (const check of [
  {
    file: "packages/config/src/logging.js",
    required: ["createLogger", "sanitizeLogFields", "LOG_CONTEXT_FIELDS", "logHttpRequest", "http_request_completed", "sanitizedPath", "[redacted]"]
  },
  {
    file: "packages/config/test/logging.test.js",
    required: ["logHttpRequest emits sanitized completion records", "secret-token", "source.example", "retention-worker", "http_request_completed"]
  },
  {
    file: "services/auth/src/index.js",
    required: ["createLogger", "logHttpRequest", "auth_token_issued", "auth_verify_failed", "x-original-uri", "verifyTokenFromRequest"]
  },
  {
    file: "services/ingest/src/index.js",
    required: ["createLogger", "logHttpRequest", "channel_demand_started", "service_started"]
  },
  {
    file: "services/control-plane/src/catalogServer.js",
    required: ["logHttpRequest", "createCatalogServer", "createControlPlaneServer"]
  },
  {
    file: "services/ingest/src/channelManager.js",
    required: ["ffmpeg_worker_failed", "entry.swarmSize"]
  },
  {
    file: "services/ingest/src/segmentWatcher.js",
    required: ["segment_announce_failed", "createLogger", "trackerInternalUrls", "AbortSignal.timeout", "Promise.all"]
  },
  {
    file: "services/tracker/src/index.js",
    required: ["tracker_joined", "tracker_signal_relayed", "tracker_peer_dropped", "tracker_idle_peers_closed", "segment_announced", "announceSegmentToState", "cell_id", "cellMaxPeers", "createTrackerSender"]
  },
  {
    file: "services/retention-worker/src/index.js",
    required: ["retention_job_completed", "retention_job_failed", "createLogger", "logHttpRequest"]
  }
]) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing structured logging text: ${required}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
const securityText = readFileSync("docs/security-review.md", "utf8");
for (const required of [
  "JWT audience, issuer, expiry, and key rotation",
  "Internal routes require `x-internal-token`",
  "Public catalog responses never include upstream source URLs",
  "Catalog source URL imports reject private-network targets",
  "refuse an empty `SOURCE_ALLOWED_HOSTS` allowlist",
  "Per-peer token bucket rate limiting",
  "Decoded RLNC output must be verified before storage",
  "P0/P1 findings are fixed or explicitly waived",
  "npm run security:review:validate -- path/to/security-review.json",
  "npm run smoke:security-review-validation",
  "test-fixtures/security/security-review-complete.synthetic.json"
]) {
  if (!securityText.includes(required)) {
    console.error(`docs/security-review.md: missing security checklist text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const securityReviewScriptText = readFileSync("scripts/validate-security-review.js", "utf8");
for (const required of [
  "requiredScopes",
  "blockingSeverities",
  "authentication-and-tokens",
  "p2p-poisoning",
  "synthetic security review requires --allow-synthetic",
  "Security review OK"
]) {
  if (!securityReviewScriptText.includes(required)) {
    console.error(`scripts/validate-security-review.js: missing security review validation text: ${required}`);
    failed = true;
  }
}

const securityReviewFixtureText = readFileSync("test-fixtures/security/security-review-complete.synthetic.json", "utf8");
for (const required of [
  "\"reviewId\": \"security-review-20260705\"",
  "\"authentication-and-tokens\"",
  "\"source-url-protection\"",
  "\"tracker-abuse\"",
  "\"SEC-002\"",
  "\"severity\": \"P1\"",
  "\"status\": \"fixed\"",
  "\"synthetic\": true"
]) {
  if (!securityReviewFixtureText.includes(required)) {
    console.error(`test-fixtures/security/security-review-complete.synthetic.json: missing security review fixture text: ${required}`);
    failed = true;
  }
}

const securityReviewSmokeText = readFileSync("scripts/smoke-security-review-validation.js", "utf8");
for (const required of [
  "scripts/validate-security-review.js",
  "synthetic security review requires --allow-synthetic",
  "tracker-abuse",
  "source-url-protection",
  "SEC-002",
  "status = \"open\"",
  "status = \"waived\"",
  "expiresAt: \"not-a-date\"",
  "jwt=synthetic-secret",
  "security review validation smoke OK"
]) {
  if (!securityReviewSmokeText.includes(required)) {
    console.error(`scripts/smoke-security-review-validation.js: missing security review smoke text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const threatModelText = readFileSync("docs/threat-model.md", "utf8");
for (const required of [
  "Review date: 2026-07-05",
  "Trust Boundaries",
  "Android app to auth/catalog/tracker/edge",
  "Retention worker to operational stores",
  "RLNC decoder boundary",
  "Release pipeline to production",
  "T-001",
  "T-004",
  "T-010",
  "T-015",
  "T-018",
  "Launch evidence to approval board",
  "P2P toggle is switched off mid-session",
  "npm run threat:model:validate -- path/to/threat-model-review.json",
  "npm run smoke:threat-model-review-validation",
  "test-fixtures/security/threat-model-review-complete.synthetic.json",
  "Data-retention policy is approved"
]) {
  if (!threatModelText.includes(required)) {
    console.error(`docs/threat-model.md: missing threat model text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const threatModelReviewScriptText = readFileSync("scripts/validate-threat-model-review.js", "utf8");
for (const required of [
  "requiredAreas",
  "requiredThreats",
  "T-018",
  "requiredOpenGates",
  "requiredSignoffRoles",
  "missing required threat",
  "synthetic threat model review requires --allow-synthetic",
  "Threat model review OK"
]) {
  if (!threatModelReviewScriptText.includes(required)) {
    console.error(`scripts/validate-threat-model-review.js: missing threat model validator text: ${required}`);
    failed = true;
  }
}

const threatModelReviewFixtureText = readFileSync("test-fixtures/security/threat-model-review-complete.synthetic.json", "utf8");
for (const required of [
  "\"reviewId\": \"threat-model-review-20260705\"",
  "\"modelRevision\": \"docs/threat-model.md#review-date-2026-07-05\"",
  "\"id\": \"T-001\"",
  "\"id\": \"T-015\"",
  "\"id\": \"T-018\"",
  "\"id\": \"android-rlnc-library\"",
  "\"role\": \"security\"",
  "\"role\": \"operations\"",
  "\"synthetic\": true"
]) {
  if (!threatModelReviewFixtureText.includes(required)) {
    console.error(`test-fixtures/security/threat-model-review-complete.synthetic.json: missing threat model fixture text: ${required}`);
    failed = true;
  }
}

const threatModelReviewSmokeText = readFileSync("scripts/smoke-threat-model-review-validation.js", "utf8");
for (const required of [
  "scripts/validate-threat-model-review.js",
  "synthetic threat model review requires --allow-synthetic",
  "rlnc",
  "T-014",
  "T-010",
  "status = \"open\"",
  "status = \"waived\"",
  "load-ladder",
  "operations",
  "bearer synthetic-secret",
  "threat model review validation smoke OK"
]) {
  if (!threatModelReviewSmokeText.includes(required)) {
    console.error(`scripts/smoke-threat-model-review-validation.js: missing threat model smoke text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const catalogImportText = readFileSync("docs/catalog-import.md", "utf8");
for (const required of [
  "Catalog Import Runbook",
  "npm run catalog:import:validate -- path/to/catalog-import-evidence.json",
  "test-fixtures/catalog/catalog-import-complete.synthetic.json",
  "npm run smoke:catalog-import-validation",
  "Do not include upstream playlist URLs"
]) {
  if (!catalogImportText.includes(required)) {
    console.error(`docs/catalog-import.md: missing catalog import text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const sourcePolicyText = readFileSync("docs/source-url-policy.md", "utf8");
for (const required of [
  "SOURCE_ALLOWED_HOSTS",
  "SOURCE_ALLOW_PRIVATE_NETWORKS",
  "use `http` or `https`",
  "omit URL credentials",
  "avoid loopback, link-local, carrier-grade NAT, and RFC1918 private networks",
  "`SOURCE_ALLOWED_HOSTS` is required when production validation is enabled",
  "Both ingest and control-plane startup use the same policy",
  "`npm run source:preflight`",
  "npm run source:allowlist:evidence:validate -- path/to/source-allowlist-evidence.json",
  "test-fixtures/launch/source-allowlist-complete.synthetic.json",
  "npm run catalog:import:validate -- path/to/catalog-import-evidence.json",
  "npm run smoke:catalog-import-validation",
  "test-fixtures/catalog/catalog-import-complete.synthetic.json",
  "`npm run smoke:catalog-source-preflight`",
  "`npm run smoke:source-policy`"
]) {
  if (!sourcePolicyText.includes(required)) {
    console.error(`docs/source-url-policy.md: missing source policy text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const sourceFailureRunbookText = readFileSync("docs/runbooks/source-failure.md", "utf8");
for (const required of [
  "Source Failure",
  "`npm run source:preflight`",
  "`npm run smoke:catalog-source-preflight`",
  "SOURCE_ALLOWED_HOSTS",
  "Do not paste upstream source URLs",
  "Quarantine failed channels"
]) {
  if (!sourceFailureRunbookText.includes(required)) {
    console.error(`docs/runbooks/source-failure.md: missing source failure runbook text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const missingEnvKeys = missingRequiredEnvExampleKeys(readFileSync(".env.example", "utf8"));
if (missingEnvKeys.length > 0) {
  console.error(`.env.example: missing required config keys: ${missingEnvKeys.join(", ")}`);
  failed = true;
}
const envExampleText = readFileSync(".env.example", "utf8");
for (const required of [
  "SWARMCAST_AUTH_IMAGE=ghcr.io/org/repo/auth@sha256:replace-with-image-digest",
  "SWARMCAST_RETENTION_WORKER_IMAGE=ghcr.io/org/repo/retention-worker@sha256:replace-with-image-digest",
  "SWARMCAST_PROMETHEUS_IMAGE=ghcr.io/org/repo/prometheus@sha256:replace-with-image-digest",
  "SWARMCAST_NODE_EXPORTER_IMAGE=ghcr.io/org/repo/node-exporter@sha256:replace-with-image-digest"
]) {
  if (!envExampleText.includes(required)) {
    console.error(`.env.example: missing production image example text: ${required}`);
    failed = true;
  }
}

const configurationText = readFileSync("docs/configuration.md", "utf8");
for (const required of [
  "Required Launch Values",
  "`INTERNAL_TOKEN`",
  "`APP_API_KEY`",
  "Service Defaults",
  "`AUTH_KEY_ID`",
  "`AUTH_PREVIOUS_JWKS_PATH`",
  "`AUTH_JWT_AUDIENCE`",
  "`AUTH_JWT_ISSUER`",
  "`AUTH_TOKEN_TTL_SECONDS`",
  "`IDLE_TEARDOWN_MS`",
  "`CATALOG_DB_PATH`",
  "`CATALOG_SNAPSHOT_PATH`",
  "`PLACEMENT_DB_PATH`",
  "`PLACEMENT_PATH`",
  "`SOURCE_ALLOWED_HOSTS`",
  "`SOURCE_ALLOW_PRIVATE_NETWORKS`",
  "`TAIL_ADMISSION_MAX_CHANNELS`",
  "`TAIL_DOWNSCALE_ENABLED`",
  "`TAIL_DOWNSCALE_VIDEO_KBPS`",
  "`TAIL_DOWNSCALE_AUDIO_KBPS`",
  "`RLNC_K`",
  "`TRACKER_MAX_PAYLOAD_BYTES`",
  "`TRACKER_MAX_CONNECTIONS`",
  "`TRACKER_IDLE_TIMEOUT_SECONDS`",
  "`TRACKER_DEMAND_HEARTBEAT_SECONDS`",
  "`TRACKER_SHARD_ID`",
  "`TRACKER_SHARDS`",
  "must be `0` or greater than `8`",
  "must match one declared shard",
  "rejected before ffmpeg starts",
  "restarted back to source-copy",
  "Runtime media base URLs reject known third-party CDN provider hostnames",
  "Android release Gradle properties must pass `npm run android:release-config:validate -- path/to/release.properties`",
  "Android Release Properties",
  "`SWARMCAST_API_BASE`",
  "`SWARMCAST_TRACKER_WS_URL`",
  "`SWARMCAST_APP_API_KEY`",
  "`SWARMCAST_RLNC_ENABLED=0`",
  "npm run smoke:android-release-config-validation",
  "safe JWT `kid`",
  "must share `AUTH_JWT_AUDIENCE` and `AUTH_JWT_ISSUER`",
  "between 300 and 86400 seconds",
  "production startup requires `SOURCE_ALLOWED_HOSTS`",
  "`TRACKER_RATE_LIMIT_CAPACITY`",
  "`RETENTION_WORKER_PORT`",
  "`RETENTION_INTERVAL_MS`",
  "`RETENTION_EXECUTE`",
  "`RETENTION_STORE_MODULE`",
  "`RETENTION_STORE_HTTP_BASE_URL`",
  "`RETENTION_STORE_HTTP_TIMEOUT_MS`",
  "built-in HTTP adapter",
  "`INGEST_NODES`",
  "non-empty JSON array",
  "unique safe `id` values",
  "docs/source-url-policy.md",
  "SQLite-backed catalog database",
  "SQLite-backed placement registry",
  "sanitized catalog snapshot",
  "npm run catalog:import:validate -- path/to/catalog-import-evidence.json",
  "npm run smoke:catalog-import-validation",
  "`SOURCE_ALLOWED_HOSTS` restricts production upstream hosts",
  "Android release property shape is now validated separately",
  "Runtime Node services now consume the shared loaders",
  "@swarmcast/config/media-urls",
  "docs/media-url-contract.md",
  "npm run secrets:evidence:validate -- path/to/secrets-evidence.json",
  "The shared config package is the canonical contract"
]) {
  if (!configurationText.includes(required)) {
    console.error(`docs/configuration.md: missing configuration standard text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const mediaUrlContractText = readFileSync("docs/media-url-contract.md", "utf8");
for (const required of [
  "@swarmcast/config/media-urls",
  "playlistUrl",
  "edgeUrlTemplate",
  "originUrlTemplate",
  "demandUrl",
  "https://edge.example.tv/edge/{nodeId}/live/{channelId}/playlist.m3u8"
]) {
  if (!mediaUrlContractText.includes(required)) {
    console.error(`docs/media-url-contract.md: missing media URL contract text: ${required}`);
    failed = true;
  }
}

for (const check of [
  {
    file: "packages/config/package.json",
    required: ["\"./media-urls\": \"./src/mediaUrls.js\""]
  },
  {
    file: "packages/config/src/mediaUrls.js",
    required: ["buildMediaUrlContract", "validateMediaUrlContract", "safe path identifier", "third-party CDN", "playlist.m3u8", "{file}"]
  },
  {
    file: "packages/config/test/mediaUrls.test.js",
    required: ["single-node fallback URLs", "placement-aware URLs", "rejects unsafe IDs", "rejects malformed templates"]
  },
  {
    file: "services/tracker/src/placementClient.js",
    required: ["@swarmcast/config/media-urls", "buildMediaUrlContract"]
  }
]) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing media URL contract text: ${required}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
for (const check of [
  {
    file: "services/auth/src/index.js",
    required: ["loadAuthConfig", "requireSecrets: true", "createLocalJWKSet", "previousJwksPath", "AUTH_PREVIOUS_JWKS_PATH", "jwtAudience", "jwtIssuer", "tokenTtlSeconds", "setIssuer"]
  },
  {
    file: "services/ingest/src/config.js",
    required: ["loadIngestConfig", "options"]
  },
  {
    file: "services/ingest/src/index.js",
    required: ["loadConfig", "requireSecrets: true", "runtimeConfig", "sourcePolicy"]
  },
  {
    file: "services/ingest/src/catalog.js",
    required: ["validateSourceUrl", "sourcePolicy", "M3U_SOURCE_URL"]
  },
  {
    file: "services/control-plane/src/index.js",
    required: ["loadControlPlaneConfig", "requireSecrets: true", "sourcePolicy", "catalogDbPath", "catalogSnapshotPath", "placementDbPath", "placement_database_loaded", "fromSnapshotFile", "saveSnapshot"]
  },
  {
    file: "services/control-plane/src/catalogStore.js",
    required: ["fromSnapshotFile", "toSnapshot", "saveSnapshot", "schemaVersion", "sourceUrl"]
  },
  {
    file: "services/control-plane/src/sqliteCatalogStore.js",
    required: ["SQLiteCatalogStore", "node:sqlite", "catalog_channels", "catalog_channels_group_idx", "catalog_channels_name_idx", "publicChannel", "schemaVersion", "channelCount"]
  },
  {
    file: "services/control-plane/src/sqlitePlacementRegistry.js",
    required: ["SQLitePlacementRegistry", "node:sqlite", "channel_placements", "channel_placements_node_idx", "updated_at", "ON CONFLICT(channel_id)"]
  },
  {
    file: "services/control-plane/test/catalogStore.test.js",
    required: ["snapshot persists sanitized catalog", "saveSnapshot", "fromSnapshotFile", "sourceUrl"]
  },
  {
    file: "services/control-plane/test/sqliteCatalogStore.test.js",
    required: ["SQLiteCatalogStore persists sanitized catalog data", "fromM3uText", "fromDatabaseFile", "sourceUrl", "PRAGMA table_info"]
  },
  {
    file: "scripts/smoke-catalog-sqlite.js",
    required: ["SQLiteCatalogStore", "Catalog SQLite smoke OK", "sourceUrl", "PRAGMA table_info"]
  },
  {
    file: "scripts/smoke-catalog-sqlite-20k.js",
    required: ["SQLiteCatalogStore", "createCatalogServer", "CHANNELS = 20_000", "SEARCH_BUDGET_MS = 100", "catalog SQLite 20K HTTP smoke OK", "sourceUrl"]
  },
  {
    file: "scripts/validate-catalog-import.js",
    required: ["requiredChecks", "source-preflight-passed", "operator-signature-verified", "rawSourceUrlsPresent must be false", "snapshot.sourceUrlsStripped must be true", "synthetic catalog import evidence requires --allow-synthetic", "Catalog import evidence OK"]
  },
  {
    file: "scripts/smoke-catalog-import-validation.js",
    required: ["scripts/validate-catalog-import.js", "test-fixtures/catalog/catalog-import-complete.synthetic.json", "synthetic catalog import evidence requires --allow-synthetic", "catalog import evidence is incomplete for launch: environment", "rawSourceUrlsPresent must be false", "sourcePreflightEvidence\\.command must include source:preflight", "sourcePreflightEvidence healthy \\+ failed must equal total", "snapshot\\.sourceUrlsStripped must be true", "snapshot\\.channelCount must equal sourcePreflightEvidence\\.total", "signature\\.algorithm must be minisign, cosign, or gpg", "missing required catalog import check snapshot-sanitized", "duplicate catalog import check public-catalog-smoke", "catalog import validation smoke OK: pass=2 failures=14"]
  },
  {
    file: "test-fixtures/catalog/catalog-import-complete.synthetic.json",
    required: ["\"importId\": \"catalog-import-20260705\"", "\"channelCount\": 20000", "\"sourceUrlsStripped\": true", "\"id\": \"operator-signature-verified\"", "\"synthetic\": true"]
  },
  {
    file: "packages/config/src/env.js",
    required: ["CATALOG_DB_PATH", "catalogDbPath", "CATALOG_SNAPSHOT_PATH", "catalogSnapshotPath", "PLACEMENT_DB_PATH", "placementDbPath", "PLACEMENT_PATH", "placementPath"]
  },
  {
    file: "services/tracker/src/index.js",
    required: ["loadTrackerConfig", "requireSecrets: true", "authJwtAudience", "authJwtIssuer", "routeTrackerJoin", "tracker_shard_redirect", "assignmentKey", "cellId", "t: \"redirect\""]
  },
  {
    file: "services/retention-worker/src/index.js",
    required: ["loadRetentionWorkerConfig"]
  },
  {
    file: "packages/config/src/env.js",
    required: ["loadFeatureFlags", "loadRetentionWorkerConfig", "validateIngestNodes", "validateTrackerShards", "validateTrackerShardId", "validateSourceUrl", "sourcePolicyFromEnv", "requireAllowedHosts", "SOURCE_ALLOWED_HOSTS is required when production validation is enabled", "SOURCE_ALLOWED_HOSTS", "SOURCE_ALLOW_PRIVATE_NETWORKS", "ownedUrlEnv", "keyIdEnv", "jwtClaimEnv", "AUTH_KEY_ID", "AUTH_PREVIOUS_JWKS_PATH", "AUTH_JWT_AUDIENCE", "AUTH_JWT_ISSUER", "AUTH_TOKEN_TTL_SECONDS", "third-party CDN provider", "RETENTION_WORKER_PORT", "RETENTION_INTERVAL_MS", "RETENTION_EXECUTE", "TAIL_ADMISSION_MAX_CHANNELS", "TAIL_DOWNSCALE_VIDEO_KBPS", "TAIL_DOWNSCALE_AUDIO_KBPS", "TRACKER_MAX_PAYLOAD_BYTES", "TRACKER_MAX_CONNECTIONS", "TRACKER_CELL_MAX_PEERS", "TRACKER_INTERNAL_URLS", "TRACKER_IDLE_TIMEOUT_SECONDS", "TRACKER_DEMAND_HEARTBEAT_SECONDS", "TRACKER_SHARD_ID", "TRACKER_SHARDS"]
  }
]) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing shared config loader text: ${required}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
const errorTaxonomyText = readFileSync("docs/error-taxonomy.md", "utf8");
for (const required of [
  "`capacity`",
  "`not_found`",
  "`unknown_channel`",
  "`unauthorized`",
  "`source_unavailable`",
  "`edge_unavailable`",
  "`tracker_unavailable`",
  "explicit waiver"
]) {
  if (!errorTaxonomyText.includes(required)) {
    console.error(`docs/error-taxonomy.md: missing error taxonomy text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
for (const check of [
  {
    file: "packages/config/src/errors.js",
    required: ["NOT_FOUND: \"not_found\"", "HTTP_STATUS_BY_ERROR", "publicError", "httpStatusForError"]
  },
  {
    file: "services/auth/src/index.js",
    required: ["@swarmcast/config/errors", "publicError", "httpStatusForError", "ERROR_CODES.UNAUTHORIZED", "ERROR_CODES.RATE_LIMITED", "ERROR_CODES.NOT_FOUND"]
  },
  {
    file: "services/ingest/src/index.js",
    required: ["@swarmcast/config/errors", "publicError", "httpStatusForError", "ERROR_CODES.UNAUTHORIZED", "ERROR_CODES.NOT_FOUND", "sendError(res, demand.error"]
  },
  {
    file: "services/control-plane/src/catalogServer.js",
    required: ["@swarmcast/config/errors", "publicError", "httpStatusForError", "ERROR_CODES.TRACKER_UNAVAILABLE", "ERROR_CODES.CAPACITY", "ERROR_CODES.NOT_FOUND", "gzipSync", "content-encoding", "Accept-Encoding"]
  },
  {
    file: "services/control-plane/test/catalogServer.test.js",
    required: ["gzips public catalog responses", "gunzipSync", "accept-encoding", "content-encoding", "304"]
  },
  {
    file: "services/retention-worker/src/index.js",
    required: ["@swarmcast/config/errors", "publicError", "httpStatusForError", "ERROR_CODES.NOT_FOUND"]
  },
  {
    file: "services/tracker/src/index.js",
    required: ["@swarmcast/config/errors", "publicError", "ERROR_CODES.TRACKER_UNAVAILABLE", "code: error.error", "msg: error.message"]
  }
]) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing error taxonomy adoption text: ${required}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
const featureFlagText = readFileSync("docs/feature-flags.md", "utf8");
for (const required of [
  "`P2P_ENABLED`",
  "`RLNC_ENABLED`",
  "`TAIL_DOWNSCALE_ENABLED`",
  "`EDGE_ONLY_MODE`",
  "`CONTRIBUTION_ENFORCEMENT_ENABLED`",
  "`SUPER_PEER_THRESHOLD_KBPS`",
  "Tracker join behavior consumes `P2P_ENABLED` and `EDGE_ONLY_MODE`",
  "Android manifest configuration consumes `P2P_ENABLED`, `EDGE_ONLY_MODE`, and `RLNC_ENABLED`",
  "explicit waiver"
]) {
  if (!featureFlagText.includes(required)) {
    console.error(`docs/feature-flags.md: missing feature flag text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
for (const check of [
  {
    file: "services/tracker/src/policy.js",
    required: ["loadFeatureFlags", "assertSafeProductionFlags", "p2pEnabled", "edgeOnlyMode"]
  },
  {
    file: "services/tracker/test/messages.test.js",
    required: ["join feature flags can force Delivery-Fleet-only mode", "join sends peer list when P2P mode is enabled by policy"]
  }
]) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing feature flag consumption text: ${required}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
for (const check of [
  {
    file: "services/ingest/src/isoBmff.js",
    required: [
      "parseIsoBmffBoxes",
      "inspectFmp4InitSegment",
      "inspectFmp4MediaSegment",
      "must contain exactly one moof and one mdat",
      "mdat payload must not be empty",
      "tfhd",
      "trun"
    ]
  },
  {
    file: "services/ingest/src/segmentWatcher.js",
    required: ["inspectFmp4MediaSegment(buf)", "createHash(\"sha256\")"]
  },
  {
    file: "services/ingest/test/isoBmff.test.js",
    required: [
      "committed fMP4 init fixture has two tracks",
      "committed fMP4 media fixtures contain ordered moof and mdat boxes",
      "rejects truncated headers and box overruns",
      "rejects an empty mdat payload"
    ]
  },
  {
    file: "scripts/validate-fmp4-fixtures.js",
    required: [
      "containsCustomerData must be false",
      "regular non-symlink file",
      "SHA-256 does not match manifest",
      "playlist must reference the exact two committed media segments",
      "fMP4 fixtures must contain video and audio tracks"
    ]
  },
  {
    file: "scripts/smoke-fmp4-fixture-validation.js",
    required: [
      "fixture hash mismatch",
      "truncated media fragment",
      "missing moof",
      "symlinked fixture parent",
      "fMP4 fixture validation smoke OK"
    ]
  },
  {
    file: "scripts/smoke-ingest-demand-playlist.js",
    required: [
      "test-fixtures/media/fmp4/init.mp4",
      "test-fixtures/media/fmp4/seg_00000000.m4s"
    ]
  }
]) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing fMP4 fixture integrity text: ${required}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
const fixtureDocsText = readFileSync("docs/test-fixtures.md", "utf8");
for (const required of [
  "test-fixtures/catalog/sample.m3u",
  "test-fixtures/catalog/duplicates-malformed.m3u",
  "test-fixtures/media/segment-ok.bytes",
  "test-fixtures/media/segment-corrupt.bytes",
  "test-fixtures/media/fmp4/init.mp4",
  "test-fixtures/media/fmp4/seg_00000000.m4s",
  "test-fixtures/media/fmp4/seg_00000001.m4s",
  "test-fixtures/media/fmp4/playlist.m3u8",
  "test-fixtures/media/fmp4/manifest.json",
  "test-fixtures/distributions/zipf-small.json"
]) {
  if (!fixtureDocsText.includes(required)) {
    console.error(`docs/test-fixtures.md: missing fixture documentation: ${required}`);
    failed = true;
  }
  try {
    readFileSync(required, "utf8");
  } catch {
    console.error(`${required}: missing documented fixture`);
    failed = true;
  }
}

for (const required of [
  "npm run media:fixtures:validate",
  "npm run smoke:fmp4-fixture-validation"
]) {
  if (!fixtureDocsText.includes(required)) {
    console.error(`docs/test-fixtures.md: missing fixture command documentation: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const dependencyInventory = JSON.parse(readFileSync("config/dependency-inventory.json", "utf8"));
const dependencyReviewText = readFileSync("docs/dependency-review.md", "utf8");
for (const required of [
  "Review date: 2026-07-16",
  "Node.js runtime",
  "Digest-pinned Node 22 builder / distroless runtime",
  "Node 24 is not approved",
  "`jose`",
  "`uWebSockets.js`",
  "`ffmpeg`",
  "`nginx`",
  "Prometheus",
  "Alertmanager",
  "Grafana",
  "Playwright Core",
  "Android Gradle Plugin",
  "AndroidX Media3",
  "OkHttp",
  "Stream WebRTC Android",
  "Backblaze JavaReedSolomon GF(2^8)",
  "npm audit --audit-level=moderate",
  "npm run sbom:generate -- --output var/sbom/swarmcast-sbom.json",
  "npm run sbom:generate -- --check",
  "npm run release:images:check",
  "npm run image:scan:validate -- var/scans/*.json",
  "npm run smoke:image-scan-report-validation",
  "npm run image:scan:bundle:validate -- --manifest var/release/swarmcast-release-manifest.json var/scans/*.trivy.json",
  "npm run dependency:review:validate -- path/to/dependency-review.json",
  "npm run smoke:dependency-review-validation",
  "required reviewer roles",
  "waiver metadata and expiry",
  "exact evidence markers",
  "test-fixtures/security/image-scan-release-manifest.synthetic.json",
  "test-fixtures/dependency/dependency-review-complete.synthetic.json",
  "digest-pinned images",
  "service and infrastructure images",
  "real-device playback"
]) {
  if (!dependencyReviewText.includes(required)) {
    console.error(`docs/dependency-review.md: missing dependency review text: ${required}`);
    failed = true;
  }
}

for (const id of [
  "node-runtime",
  "jose",
  "uwebsockets-js",
  "ffmpeg",
  "nginx",
  "prometheus",
  "alertmanager",
  "grafana",
  "node-exporter",
  "playwright-core",
  "android-gradle-plugin",
  "kotlin",
  "media3",
  "okhttp",
  "stream-webrtc-android",
  "android-rlnc-library"
]) {
  const item = dependencyInventory.items?.find((entry) => entry.id === id);
  if (!item) {
    console.error(`config/dependency-inventory.json: missing dependency item ${id}`);
    failed = true;
    continue;
  }
  for (const key of ["area", "name", "current", "source", "pinning", "launchDecision", "releaseGate"]) {
    if (typeof item[key] !== "string" || item[key].length === 0) {
      console.error(`config/dependency-inventory.json: ${id} missing ${key}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
for (const check of [
  {
    file: "scripts/generate-sbom.js",
    required: [
      "package-lock.json",
      "android/app/build.gradle.kts",
      "infra/docker-compose.release.yml",
      "services/*/Dockerfile",
      "collectNpm",
      "collectDockerfiles",
      "collectComposeImages",
      "collectAndroid",
      "assertCoverage",
      "SBOM OK"
    ]
  }
  ,
  {
    file: "scripts/validate-release-images.js",
    required: [
      "SWARMCAST_AUTH_IMAGE",
      "SWARMCAST_INGEST_IMAGE",
      "SWARMCAST_TRACKER_IMAGE",
      "SWARMCAST_CONTROL_PLANE_IMAGE",
      "SWARMCAST_RETENTION_WORKER_IMAGE",
      "SWARMCAST_PROMETHEUS_IMAGE",
      "SWARMCAST_NODE_EXPORTER_IMAGE",
      "@sha256:<64 hex chars>",
      "Release image refs OK"
    ]
  },
  {
    file: "scripts/validate-image-scan-report.js",
    required: [
      "Vulnerabilities",
      "HIGH",
      "CRITICAL",
      "Image scan validation OK",
      "--allow-high"
    ]
  },
  {
    file: "scripts/smoke-image-scan-report-validation.js",
    required: [
      "scripts/validate-image-scan-report.js",
      "CVE-2099-0002",
      "CVE-2099-0003",
      "--allow-high",
      "Image scan validation failed: 1 blocked findings across 1 reports",
      "image scan report validation smoke OK: pass=3 failures=3"
    ]
  },
  {
    file: "scripts/validate-image-scan-bundle.js",
    required: [
      "requiredServices",
      "node-exporter",
      "images=",
      "expectedImageScans",
      "image must be digest-pinned",
      "ArtifactName must match release manifest image",
      "synthetic image scan bundle requires --allow-synthetic",
      "synthetic image scan report requires --allow-synthetic",
      "Image scan bundle OK",
      "--allow-high"
    ]
  },
  {
    file: "test-fixtures/security/image-scan-release-manifest.synthetic.json",
    required: [
      "\"synthetic\": true",
      "\"service\": \"auth\"",
      "\"service\": \"retention-worker\"",
      "\"service\": \"node-exporter\"",
      "\"var/scans/auth.trivy.json\"",
      "\"var/scans/retention-worker.trivy.json\"",
      "\"var/scans/node-exporter.trivy.json\"",
      "image:scan:bundle:validate",
      "@sha256:"
    ]
  },
  {
    file: "test-fixtures/security/scans/node-exporter.trivy.json",
    required: [
      "\"Synthetic\": true",
      "\"ArtifactType\": \"container_image\"",
      "prom/node-exporter:v1.8.0@sha256",
      "\"VulnerabilityID\": \"CVE-2099-0107\"",
      "\"Severity\": \"LOW\""
    ]
  },
  {
    file: "test-fixtures/security/scans/retention-worker.trivy.json",
    required: [
      "\"Synthetic\": true",
      "\"ArtifactType\": \"container_image\"",
      "retention-worker@sha256",
      "\"VulnerabilityID\": \"CVE-2099-0005\"",
      "\"Severity\": \"LOW\""
    ]
  },
  {
    file: "scripts/validate-secrets-evidence.js",
    required: [
      "requiredSecrets",
      "internal-token",
      "auth-signing-key",
      "alertmanager-webhook-critical",
      "requiredChecks",
      "requiredSecretDefinitions",
      "environmentScope must be production",
      "rotationPolicyDays must be an integer between 1 and 92",
      "evidence must mention",
      "rawSecretValuesPresent must be false",
      "synthetic secrets evidence requires --allow-synthetic",
      "Secrets evidence OK"
    ]
  },
  {
    file: "test-fixtures/security/secrets-evidence-complete.synthetic.json",
    required: [
      "\"evidenceId\": \"secrets-evidence-20260705\"",
      "\"rawSecretValuesPresent\": false",
      "\"id\": \"internal-token\"",
      "\"purpose\": \"internal service authentication\"",
      "\"environmentScope\": \"production\"",
      "\"rotationPolicyDays\": 92",
      "\"id\": \"auth-signing-key\"",
      "\"id\": \"alertmanager-webhook-critical\"",
      "\"id\": \"production-env-validated\"",
      "\"id\": \"redaction-proof-reviewed\"",
      "\"synthetic\": true"
    ]
  },
  {
    file: "scripts/validate-deployment-evidence.js",
    required: [
      "requiredServices",
      "requiredChecks",
      "deployed-up-no-build",
      "commands must include service",
      "deployment commands must not build images",
      "evidence must mention",
      "thirdPartyCdnUsed must be false",
      "synthetic deployment evidence requires --allow-synthetic",
      "Deployment evidence OK"
    ]
  },
  {
    file: "test-fixtures/deployment/deployment-complete.synthetic.json",
    required: [
      "\"deploymentId\": \"deployment-20260705\"",
      "\"thirdPartyCdnUsed\": false",
      "up -d --no-build",
      "\"name\": \"auth\"",
      "\"name\": \"retention-worker\"",
      "\"id\": \"release-manifest-validated\"",
      "release-manifest-validated release:manifest check synthetic-pass",
      "\"id\": \"post-deploy-smokes\"",
      "post-deploy-smokes production:smoke:evidence:validate synthetic-pass",
      "\"id\": \"rollback-ready\"",
      "\"synthetic\": true"
    ]
  },
  {
    file: "scripts/validate-canary-rollout-evidence.js",
    required: [
      "requiredStages",
      "one-percent",
      "twenty-five-percent",
      "full-public",
      "canary:metrics:validate",
      "peerHashFailures5m=0",
      "peerDisconnects5m=0",
      "rollbackAvailable must be true",
      "thirdPartyCdnUsed must be false",
      "synthetic canary rollout evidence requires --allow-synthetic",
      "Canary rollout evidence OK"
    ]
  },
  {
    file: "test-fixtures/launch/canary-rollout-complete.synthetic.json",
    required: [
      "\"rolloutId\": \"canary-rollout-20260705\"",
      "\"id\": \"internal\"",
      "\"id\": \"one-percent\"",
      "\"id\": \"twenty-five-percent\"",
      "\"id\": \"full-public\"",
      "peerTimeouts5m=8",
      "peerHashFailures5m=0",
      "peerDisconnects5m=0",
      "\"id\": \"canary-metrics-validated\"",
      "\"id\": \"rollback-halt-tested\"",
      "\"thirdPartyCdnUsed\": false",
      "\"synthetic\": true"
    ]
  },
  {
    file: "scripts/validate-dependency-review.js",
    required: [
      "requiredChecks",
      "npm-audit",
      "android-release-build",
      "allowedDecisionStatuses",
      "requiredReviewerRoles",
      "reviewers must include",
      "evidence must mention",
      "waiver.expiresAt must be after reviewedAt",
      "missing dependency decision",
      "inventoryArgIndex !== -1",
      "synthetic dependency review requires --allow-synthetic",
      "Dependency review OK"
    ]
  },
  {
    file: "scripts/smoke-dependency-review-validation.js",
    required: [
      "scripts/validate-dependency-review.js",
      "synthetic dependency review requires --allow-synthetic",
      "android-release-build",
      "image-scans",
      "missing-security-reviewer",
      "check-evidence-missing-id",
      "decision-evidence-missing-id",
      "waiver-expired",
      "jose",
      "unknown-library",
      "ffmpeg",
      "android-rlnc-library",
      "password=synthetic-secret",
      "dependency review validation smoke OK"
    ]
  },
  {
    file: "test-fixtures/dependency/dependency-review-complete.synthetic.json",
    required: [
      "\"reviewId\": \"dependency-review-20260705\"",
      "\"synthetic\": true",
      "\"id\": \"node-runtime\"",
      "\"id\": \"android-rlnc-library\"",
      "\"id\": \"android-release-build\"",
      "npm-audit npm audit --audit-level=moderate",
      "node-runtime config/dependency-inventory.json#node-runtime",
      "\"status\": \"waived\"",
      "\"approvedBy\": \"synthetic-release-board\""
    ]
  },
  {
    file: "test-fixtures/security/trivy-clean.json",
    required: [
      "SchemaVersion",
      "ArtifactType",
      "container_image",
      "Vulnerabilities",
      "Severity"
    ]
  }
]) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing SBOM generator text: ${required}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
const androidReadmeText = readFileSync("android/README.md", "utf8");
for (const required of [
  "Gradle wrapper is pinned to Gradle 8.9",
  "CI is configured to install Android SDK platform 35/build-tools 35.0.0",
  "Catalog search cache uses an app-private SQLite database",
  "Catalog and auth API calls share a 32 MB OkHttp cache",
  "./gradlew --no-daemon testDebugUnitTest assembleDebug assembleRelease",
  "npm run android:release-config:validate -- path/to/release.properties",
  "npm run smoke:android-release-config-validation",
  "test-fixtures/android/release-config.complete.properties",
  "npm run android:ci:evidence:validate -- path/to/android-ci-evidence.json",
  "npm run smoke:android-ci-evidence-validation",
  "test-fixtures/android/ci-build-complete.synthetic.json",
  "Delivery-Fleet-only device playback evidence must include 30-minute WiFi and cellular soaks",
  "npm run android:playback:evidence:validate -- path/to/android-playback-evidence.json",
  "npm run smoke:android-playback-evidence-validation",
  "test-fixtures/android/playback-delivery-fleet-complete.synthetic.json",
  "Android P2P transfer evidence must include WebRTC DataChannel, tracker-signaling relay, verified segment hashes, edge fallback, P2P-disable closure, cellular receive-only/no-upload proof, and reconciled ICE attempts/outcomes/selected candidate types for WiFi and cellular",
  "Tracker joins have a 10-second acknowledgement watchdog",
  "Tracker byte, playback, peer-health, and ICE deltas are retained",
  "npm run android:p2p:evidence:validate -- path/to/android-p2p-evidence.json",
  "npm run smoke:android-p2p-evidence-validation",
  "test-fixtures/android/p2p-transfer-complete.synthetic.json"
]) {
  if (!androidReadmeText.includes(required)) {
    console.error(`android/README.md: missing Android CI evidence text: ${required}`);
    failed = true;
  }
}

const androidCiEvidenceScriptText = readFileSync("scripts/validate-android-ci-evidence.js", "utf8");
for (const required of [
  "requiredSteps",
  "requiredArtifacts",
  "testDebugUnitTest",
  "assembleDebug",
  "assembleRelease",
  "computeApkChecksums",
  "uploadDebugArtifact",
  "uploadReleaseArtifact",
  "requiredArtifactEvidence",
  "swarmcast-android-debug-apk",
  "swarmcast-android-release-unsigned-apk",
  ".sha256",
  "missing required Android CI artifact",
  "synthetic Android CI evidence requires --allow-synthetic",
  "Android CI evidence OK"
]) {
  if (!androidCiEvidenceScriptText.includes(required)) {
    console.error(`scripts/validate-android-ci-evidence.js: missing Android CI validator text: ${required}`);
    failed = true;
  }
}

const androidCiEvidenceSmokeText = readFileSync("scripts/smoke-android-ci-evidence-validation.js", "utf8");
for (const required of [
  "scripts/validate-android-ci-evidence.js",
  "test-fixtures/android/ci-build-complete.synthetic.json",
  "synthetic Android CI evidence requires --allow-synthetic",
  "runUrl has invalid format",
  "completedAt must be after startedAt",
  "toolchain\\.androidPlatform has invalid format",
  "missing required Android CI step testDebugUnitTest",
  "missing required Android CI step assembleRelease",
  "missing required Android CI step uploadReleaseArtifact",
  "assembleDebug\\.status must be pass",
  "duplicate step checkout",
  "setup-android\\.evidence evidence reference looks like it may contain sensitive material",
  "missing required Android CI artifact release",
  "release\\.path has invalid format",
  "debug\\.sha256 has invalid format",
  "release\\.sizeBytes must be a positive number",
  "duplicate artifact debug",
  "debug\\.evidence must mention swarmcast-android-debug-apk",
  "release\\.evidence must mention \\.sha256",
  "Android CI evidence validation smoke OK: pass=1 failures=17"
]) {
  if (!androidCiEvidenceSmokeText.includes(required)) {
    console.error(`scripts/smoke-android-ci-evidence-validation.js: missing Android CI smoke text: ${required}`);
    failed = true;
  }
}

const androidCiEvidenceFixtureText = readFileSync("test-fixtures/android/ci-build-complete.synthetic.json", "utf8");
for (const required of [
  "\"buildId\": \"android-ci-20260705\"",
  "\"environment\": \"github-actions\"",
  "\"gradleVersion\": \"8.9\"",
  "\"androidPlatform\": \"android-35\"",
  "\"id\": \"testDebugUnitTest\"",
  "\"id\": \"assembleDebug\"",
  "\"id\": \"assembleRelease\"",
  "\"id\": \"computeApkChecksums\"",
  "\"id\": \"uploadDebugArtifact\"",
  "\"id\": \"uploadReleaseArtifact\"",
  "\"swarmcast-android-debug-apk\"",
  "\"swarmcast-android-release-unsigned-apk\"",
  ".sha256",
  "\"variant\": \"debug\"",
  "\"variant\": \"release\"",
  "\"synthetic\": true"
]) {
  if (!androidCiEvidenceFixtureText.includes(required)) {
    console.error(`test-fixtures/android/ci-build-complete.synthetic.json: missing Android CI fixture text: ${required}`);
    failed = true;
  }
}

const androidReleaseConfigScriptText = readFileSync("scripts/validate-android-release-config.js", "utf8");
for (const required of [
  "requiredKeys",
  "SWARMCAST_API_BASE",
  "SWARMCAST_TRACKER_WS_URL",
  "SWARMCAST_APP_API_KEY",
  "SWARMCAST_PLAY_INTEGRITY_ENABLED",
  "SWARMCAST_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER",
  "SWARMCAST_RLNC_ENABLED requires --rlnc-decision with approved non-synthetic evidence",
  "scripts/validate-android-rlnc-decision.js",
  "ownedUrlEnv",
  "Android release config OK"
]) {
  if (!androidReleaseConfigScriptText.includes(required)) {
    console.error(`scripts/validate-android-release-config.js: missing Android release config validator text: ${required}`);
    failed = true;
  }
}

const androidReleaseConfigSmokeText = readFileSync("scripts/smoke-android-release-config-validation.js", "utf8");
for (const required of [
  "scripts/validate-android-release-config.js",
  "test-fixtures/android/release-config.complete.properties",
  "SWARMCAST_API_BASE is required",
  "SWARMCAST_API_BASE must use one of: https:",
  "SWARMCAST_TRACKER_WS_URL must use one of: wss:",
  "SWARMCAST_APP_API_KEY still contains a placeholder value",
  "SWARMCAST_APP_API_KEY must be 64 hex characters",
  "SWARMCAST_RLNC_ENABLED requires --rlnc-decision",
  "SWARMCAST_PLAY_INTEGRITY_ENABLED must be true",
  "SWARMCAST_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER",
  "synthetic Android RLNC decision requires --allow-synthetic",
  "SWARMCAST_API_BASE must not point to a third-party CDN provider",
  "Android release config validation smoke OK: pass=1 failures=11"
]) {
  if (!androidReleaseConfigSmokeText.includes(required)) {
    console.error(`scripts/smoke-android-release-config-validation.js: missing Android release config smoke text: ${required}`);
    failed = true;
  }
}

const androidReleaseConfigFixtureText = readFileSync("test-fixtures/android/release-config.complete.properties", "utf8");
for (const required of [
  "SWARMCAST_API_BASE=https://api.swarmcast.tv",
  "SWARMCAST_TRACKER_WS_URL=wss://tracker.swarmcast.tv/ws",
  "SWARMCAST_APP_API_KEY=fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
  "SWARMCAST_P2P_ENABLED=1",
  "SWARMCAST_EDGE_ONLY_MODE=0",
  "SWARMCAST_RLNC_ENABLED=0",
  "SWARMCAST_PLAY_INTEGRITY_ENABLED=1",
  "SWARMCAST_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER=123456789012"
]) {
  if (!androidReleaseConfigFixtureText.includes(required)) {
    console.error(`test-fixtures/android/release-config.complete.properties: missing Android release config fixture text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const androidPlaybackEvidenceScriptText = readFileSync("scripts/validate-android-playback-evidence.js", "utf8");
for (const required of [
  "minimumSoakSeconds",
  "budgetArgIndex !== -1",
  "delivery-fleet-only",
  "requiredPlaybackNetworks",
  "requiredSessionEvidence",
  "30m-soak",
  "edge-cache-hit",
  "crash-free",
  "duplicate playback session",
  "playback sessions must include",
  "androidStartupLatencyMsP95",
  "androidStallRateMax",
  "androidBufferMsMin",
  "edgeCacheHitRatioMin",
  "synthetic Android playback evidence requires --allow-synthetic",
  "Android playback evidence OK"
]) {
  if (!androidPlaybackEvidenceScriptText.includes(required)) {
    console.error(`scripts/validate-android-playback-evidence.js: missing Android playback validator text: ${required}`);
    failed = true;
  }
}

const androidPlaybackEvidenceSmokeText = readFileSync("scripts/smoke-android-playback-evidence-validation.js", "utf8");
for (const required of [
  "scripts/validate-android-playback-evidence.js",
  "test-fixtures/android/playback-delivery-fleet-complete.synthetic.json",
  "synthetic Android playback evidence requires --allow-synthetic",
  "duplicate device pixel-8",
  "wifi-edge-soak references unknown device missing-device",
  "duplicate playback session wifi-edge-soak",
  "playback sessions must include cellular device evidence",
  "wifi-edge-soak\\.p2pEnabled must be false",
  "wifi-edge-soak\\.authenticated must be true",
  "wifi-edge-soak\\.crashFree must be true",
  "wifi-edge-soak\\.durationSeconds must be between 1800 and Infinity",
  "wifi-edge-soak\\.startupLatencyMsP95 must be between 0 and 5000",
  "wifi-edge-soak\\.stallRate must be between 0 and 0.01",
  "wifi-edge-soak\\.bufferMsMin must be between 10000 and Infinity",
  "wifi-edge-soak\\.edgeCacheHitRatio must be between 0.8 and 1",
  "wifi-edge-soak\\.batteryDrainPctPerHour must be between 0 and 8",
  "wifi-edge-soak\\.evidence must mention edge-cache-hit",
  "wifi-edge-soak\\.evidence evidence reference looks like it may contain sensitive material",
  "Android playback evidence validation smoke OK: pass=1 failures=16"
]) {
  if (!androidPlaybackEvidenceSmokeText.includes(required)) {
    console.error(`scripts/smoke-android-playback-evidence-validation.js: missing Android playback smoke text: ${required}`);
    failed = true;
  }
}

const androidPlaybackEvidenceFixtureText = readFileSync("test-fixtures/android/playback-delivery-fleet-complete.synthetic.json", "utf8");
for (const required of [
  "\"reviewId\": \"android-playback-20260705\"",
  "\"deliveryMode\": \"delivery-fleet-only\"",
  "\"p2pEnabled\": false",
  "\"durationSeconds\": 1800",
  "30m-soak",
  "edge-cache-hit",
  "crash-free",
  "\"network\": \"wifi\"",
  "\"network\": \"cellular\"",
  "\"startupLatencyMsP95\": 3200",
  "\"edgeCacheHitRatio\": 0.92",
  "\"synthetic\": true"
]) {
  if (!androidPlaybackEvidenceFixtureText.includes(required)) {
    console.error(`test-fixtures/android/playback-delivery-fleet-complete.synthetic.json: missing Android playback fixture text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const androidP2pEvidenceScriptText = readFileSync("scripts/validate-android-p2p-evidence.js", "utf8");
for (const required of [
  "requiredChecks",
  "budgetArgIndex !== -1",
  "webrtc-offer-answer",
  "datachannel-open",
  "peer-segment-transfer",
  "hash-verification",
  "cellular-receive-only",
  "relay-accounting",
  "requiredDeviceNetworks",
  "requiredTransferEvidence",
  "webrtc-datachannel",
  "tracker-signaling-relay",
  "verified-segment-hash",
  "cellular-no-upload",
  "physical-devices",
  "two-wifi-networks",
  "two-cellular-carriers",
  "play-installed",
  "cellular-zero-upload-measured",
  "30m-soak",
  "devices must include at least four physical devices",
  "devices must include at least two WiFi network failure domains",
  "devices must include at least two cellular carrier failure domains",
  "transfer source device must be wifi for upload evidence",
  "transfer sink device must be cellular for receive-only evidence",
  "connectivity.devices must be an array",
  "ice-network-class",
  "ice-selected-candidate-type",
  "directP2pBytes",
  "bootstrapOriginBytes",
  "relayAccessEgressBytes",
  "edgeAccessEgressBytes",
  "originAccessBootstrapBytes",
  "trackerP2pDownloadBytes",
  "trackerRelayDownloadBytes",
  "trackerUploadBytes",
  "measuredUploadBytes must prove useful WiFi upload",
  "measuredUploadBytes must be zero on cellular",
  "transfer device upload",
  "direct-relay-payload-attribution",
  "relay-egress-reconciled",
  "edge-egress-reconciled",
  "origin-bootstrap-reconciled",
  "transfer.offloadRatio does not match direct P2P over all delivery bytes",
  "transfer relay egress",
  "transfer edge egress",
  "transfer origin bootstrap",
  "transfer tracker direct P2P",
  "selected candidates must not be unknown",
  "edge-fallback",
  "p2p-with-edge-fallback",
  "synthetic Android P2P evidence requires --allow-synthetic",
  "Android P2P evidence OK"
]) {
  if (!androidP2pEvidenceScriptText.includes(required)) {
    console.error(`scripts/validate-android-p2p-evidence.js: missing Android P2P validator text: ${required}`);
    failed = true;
  }
}

const androidP2pEvidenceSmokeText = readFileSync("scripts/smoke-android-p2p-evidence-validation.js", "utf8");
for (const required of [
  "scripts/validate-android-p2p-evidence.js",
  "test-fixtures/android/p2p-transfer-complete.synthetic.json",
  "synthetic Android P2P evidence requires --allow-synthetic",
  "devices must include at least four physical devices",
  "devices must include cellular Android P2P evidence",
  "missing required Android P2P check datachannel-open",
  "missing required Android P2P check cellular-receive-only",
  "missing required Android P2P check relay-accounting",
  "ice-connected\\.status must pass before Android P2P approval",
  "webrtc-offer-answer references unknown device missing-device",
  "duplicate P2P check tracker-stats",
  "tracker-stats\\.evidence evidence reference looks like it may contain sensitive material",
  "transfer\\.p2pEnabled must be true",
  "transfer\\.edgeFallbackVerified must be true",
  "transfer source and sink devices must differ",
  "transfer source device must be wifi for upload evidence",
  "transfer\\.verifiedSegments must be between 100 and Infinity",
  "transfer\\.hashFailures must be between 0 and 0",
  "transfer\\.disconnects must be between 0 and 0",
  "transfer\\.offloadRatio must be between 0.9 and 1",
  "transfer\\.directP2pBytes must be an integer",
  "transfer\\.offloadRatio does not match direct P2P over all delivery bytes",
  "transfer relay egress is not reconciled within tolerance",
  "transfer\\.stallRate must be between 0 and 0.01",
  "transfer\\.bufferMsMin must be between 10000 and Infinity",
  "transfer\\.evidence must mention webrtc-datachannel",
  "transfer\\.evidence must mention direct-relay-payload-attribution",
  "transfer\\.evidence evidence reference looks like it may contain sensitive material",
  "connectivity must include device pixel-8-b",
  "connectivity\\.pixel-8-a outcomes must equal attempts",
  "connectivity\\.pixel-8-b selected candidates must sum to successes",
  "connectivity\\.evidence must mention ice-selected-candidate-type",
  "pixel-8-a\\.physical must be true",
  "duplicate physical device fingerprint for pixel-8-b",
  "at least two WiFi network failure domains",
  "at least two cellular carrier failure domains",
  "pixel-8-a\\.installationSource has invalid format",
  "pixel-8-a\\.apkSha256 must match releaseApkSha256",
  "pixel-8-c\\.measuredUploadBytes must prove useful WiFi upload",
  "pixel-8-d\\.measuredUploadBytes must be zero on cellular",
  "transfer\\.durationSeconds must be between 1800 and Infinity",
  "sourceUploadBytes must cover direct and relayed peer payload",
  "transfer\\.sinkUploadBytes must be between 0 and 0",
  "transfer edge egress is not reconciled within tolerance",
  "transfer origin bootstrap is not reconciled within tolerance",
  "transfer tracker direct P2P is not reconciled within tolerance",
  "transfer\\.batteryDrainPctPerHour must be between 0 and 8",
  "selected candidates must not be unknown",
  "transfer\\.p2pDisabledActiveLinks must be between 0 and 0",
  "transfer\\.p2pDisabledEdgeBytes must be between 1 and Infinity",
  "Android P2P evidence validation smoke OK: pass=1 failures=50"
]) {
  if (!androidP2pEvidenceSmokeText.includes(required)) {
    console.error(`scripts/smoke-android-p2p-evidence-validation.js: missing Android P2P smoke text: ${required}`);
    failed = true;
  }
}

const androidP2pEvidenceFixtureText = readFileSync("test-fixtures/android/p2p-transfer-complete.synthetic.json", "utf8");
for (const required of [
  "\"reviewId\": \"android-p2p-20260705\"",
  "\"id\": \"webrtc-offer-answer\"",
  "\"id\": \"peer-segment-transfer\"",
  "\"id\": \"hash-verification\"",
  "\"id\": \"cellular-receive-only\"",
  "\"id\": \"relay-accounting\"",
  "\"network\": \"cellular\"",
  "webrtc-datachannel",
  "tracker-signaling-relay",
  "verified-segment-hash",
  "cellular-no-upload",
  "\"physical\": true",
  "\"installationSource\": \"play-store\"",
  "\"measuredUploadBytes\": 5000000",
  "\"wifiNetworkId\": \"wifi-lab-b\"",
  "\"carrierId\": \"carrier-lab-b\"",
  "\"deliveryMode\": \"p2p-with-edge-fallback\"",
  "\"durationSeconds\": 1800",
  "\"verifiedSegments\": 300",
  "\"hashFailures\": 0",
  "\"directP2pBytes\": 9000000",
  "\"bootstrapOriginBytes\": 250000",
  "\"relayBytes\": 250000",
  "\"relayAccessEgressBytes\": 250000",
  "\"edgeAccessEgressBytes\": 500000",
  "\"originAccessBootstrapBytes\": 250000",
  "\"offloadRatio\": 0.9",
  "\"selectedCandidates\"",
  "ice-network-class.ice-selected-candidate-type",
  "\"synthetic\": true"
]) {
  if (!androidP2pEvidenceFixtureText.includes(required)) {
    console.error(`test-fixtures/android/p2p-transfer-complete.synthetic.json: missing Android P2P fixture text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const androidDeviceLabRunnerText = readFileSync("scripts/android-device-lab-runner.js", "utf8");
for (const required of [
  "devices must include at least four physical devices",
  "manifest must include two WiFi network failure domains",
  "manifest must include two cellular carrier failure domains",
  "synthetic device-lab runs require --allow-synthetic",
  "each configured entry must resolve to a distinct physical device",
  "was not installed by Google Play",
  "installed APK does not match releaseApkSha256",
  "must remain unplugged during measurement",
  "did not provide useful WiFi upload",
  "uploaded payload on cellular",
  "ICE outcomes are incomplete",
  "has unknown selected ICE candidates",
  "retained P2P state after disable",
  "did not prove edge fallback after P2P disable",
  "below 0.90",
  "SWARMCAST_DEVICE_FINGERPRINT_SALT",
  "FORBIDDEN_SNAPSHOT_KEYS",
  "finally"
]) {
  if (!androidDeviceLabRunnerText.includes(required)) {
    console.error(`scripts/android-device-lab-runner.js: missing device-lab runner text: ${required}`);
    failed = true;
  }
}

const androidDeviceLabCliText = readFileSync("scripts/run-android-device-lab.js", "utf8");
for (const required of [
  "--acknowledge-physical-device-test",
  "--allow-synthetic",
  "maxBuffer: 512 * 1024 * 1024",
  "mode: 0o600",
  "chmodSync(outputPath, 0o600)",
  "Android device lab OK"
]) {
  if (!androidDeviceLabCliText.includes(required)) {
    console.error(`scripts/run-android-device-lab.js: missing device-lab CLI text: ${required}`);
    failed = true;
  }
}

const androidDeviceLabSmokeText = readFileSync("scripts/smoke-android-device-lab.js", "utf8");
for (const required of [
  "test-fixtures/android/device-lab-manifest.complete.synthetic.json",
  "require --allow-synthetic",
  "duplicate device serial environment",
  "forbidden key accessToken",
  "is an emulator",
  "was not installed by Google Play",
  "does not match releaseApkSha256",
  "uploaded payload on cellular",
  "below 0.90",
  "ICE outcomes are incomplete",
  "retained P2P state after disable",
  "must remain unplugged during measurement",
  "Android device lab smoke OK: pass=1 failures=11 devices=4"
]) {
  if (!androidDeviceLabSmokeText.includes(required)) {
    console.error(`scripts/smoke-android-device-lab.js: missing device-lab smoke text: ${required}`);
    failed = true;
  }
}

const androidDeviceLabDocsText = readFileSync("docs/android-device-lab.md", "utf8");
for (const required of [
  "At least four distinct physical Android devices",
  "distinct WiFi failure domains",
  "distinct cellular carriers",
  "Google Play test or production track",
  "android.permission.DUMP",
  "releaseApkSha256",
  "--acknowledge-physical-device-test",
  "The output is a raw, sanitized measurement record. It is not launch-valid by itself",
  "direct `rho = direct / (direct + edge + origin-bootstrap + relay)` is at least `0.90`",
  "Synthetic output cannot satisfy a launch gate"
]) {
  if (!androidDeviceLabDocsText.includes(required)) {
    console.error(`docs/android-device-lab.md: missing device-lab runbook text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const accessibilityText = readFileSync("docs/accessibility-ux-baseline.md", "utf8");
for (const required of [
  "Review date: 2026-07-05",
  "Catalog search",
  "Player controls",
  "Error states",
  "Loading states",
  "Settings",
  "Localization readiness",
  "TalkBack",
  "Font scaling at 200%",
  "Large-font 200% and small-screen screenshots are reviewed",
  "Touch-target evidence is recorded",
  "No user-facing string is introduced outside Android resources",
  "npm run android:accessibility:validate -- path/to/android-accessibility-evidence.json",
  "npm run smoke:android-accessibility-evidence-validation",
  "test-fixtures/android/accessibility-complete.synthetic.json"
]) {
  if (!accessibilityText.includes(required)) {
    console.error(`docs/accessibility-ux-baseline.md: missing accessibility text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
const androidAccessibilityScriptText = readFileSync("scripts/validate-android-accessibility-evidence.js", "utf8");
for (const required of [
  "requiredChecks",
  "requiredCheckEvidence",
  "talkback-focus-order",
  "large-font-200",
  "small-screen-layout",
  "touch-targets",
  "devices must include a 200% font scale device",
  "devices must include a small-screen device",
  "localization-pseudolocale",
  "missing required accessibility check",
  "synthetic Android accessibility evidence requires --allow-synthetic",
  "Android accessibility evidence OK"
]) {
  if (!androidAccessibilityScriptText.includes(required)) {
    console.error(`scripts/validate-android-accessibility-evidence.js: missing accessibility validator text: ${required}`);
    failed = true;
  }
}

const androidAccessibilitySmokeText = readFileSync("scripts/smoke-android-accessibility-evidence-validation.js", "utf8");
for (const required of [
  "scripts/validate-android-accessibility-evidence.js",
  "test-fixtures/android/accessibility-complete.synthetic.json",
  "synthetic Android accessibility evidence requires --allow-synthetic",
  "devices must include at least one device",
  "duplicate device pixel-8",
  "small-phone\\.fontScale must be a positive number",
  "devices must include a 200% font scale device",
  "devices must include a small-screen device",
  "missing required accessibility check media3-controls",
  "missing required accessibility check touch-targets",
  "talkback-focus-order\\.status must pass before accessibility approval",
  "duplicate accessibility check p2p-toggle",
  "privacy-dialog\\.deviceIds must include at least one device",
  "large-font-200 references unknown device missing-device",
  "talkback-focus-order\\.evidence must mention talkback-focus-order",
  "error-states\\.evidence evidence reference looks like it may contain sensitive material",
  "Android accessibility evidence validation smoke OK: pass=1 failures=14"
]) {
  if (!androidAccessibilitySmokeText.includes(required)) {
    console.error(`scripts/smoke-android-accessibility-evidence-validation.js: missing accessibility smoke text: ${required}`);
    failed = true;
  }
}

const androidAccessibilityFixtureText = readFileSync("test-fixtures/android/accessibility-complete.synthetic.json", "utf8");
for (const required of [
  "\"reviewId\": \"android-accessibility-20260705\"",
  "\"id\": \"pixel-8\"",
  "\"id\": \"small-phone\"",
  "\"id\": \"talkback-focus-order\"",
  "\"id\": \"large-font-200\"",
  "\"id\": \"small-screen-layout\"",
  "\"id\": \"media3-controls\"",
  "\"id\": \"localization-pseudolocale\"",
  "\"id\": \"touch-targets\"",
  "\"fontScale\": 2",
  "\"screen\": \"360x640dp\"",
  "\"synthetic\": true"
]) {
  if (!androidAccessibilityFixtureText.includes(required)) {
    console.error(`test-fixtures/android/accessibility-complete.synthetic.json: missing accessibility fixture text: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
for (const file of [
  "android/settings.gradle.kts",
  "android/app/build.gradle.kts",
  "android/app/src/main/AndroidManifest.xml",
  "android/app/src/main/res/values/styles.xml",
  "android/app/src/main/res/values/strings.xml",
  "android/app/src/main/java/tv/swarmcast/data/AppConfig.kt",
  "android/app/src/main/java/tv/swarmcast/data/AuthRepository.kt",
  "android/app/src/main/java/tv/swarmcast/data/CatalogDiskCache.kt",
  "android/app/src/main/java/tv/swarmcast/data/ChannelRepository.kt",
  "android/app/src/main/java/tv/swarmcast/data/ErrorTaxonomy.kt",
  "android/app/src/main/java/tv/swarmcast/diagnostics/DeviceLabControlReceiver.kt",
  "android/app/src/main/java/tv/swarmcast/diagnostics/DeviceLabDiagnostics.kt",
  "android/app/src/main/java/tv/swarmcast/playback/PlaybackUrls.kt",
  "android/app/src/main/java/tv/swarmcast/playback/PlaybackSessionCoordinator.kt",
  "android/app/src/main/java/tv/swarmcast/playback/PlaybackBufferPolicy.kt",
  "android/app/src/main/java/tv/swarmcast/playback/PlayerHolder.kt",
  "android/app/src/main/java/tv/swarmcast/playback/SwarmSegmentDataSource.kt",
  "android/app/src/main/java/tv/swarmcast/p2p/PeerConnectionManager.kt",
  "android/app/src/main/java/tv/swarmcast/p2p/IceConnectivityTelemetry.kt",
  "android/app/src/main/java/tv/swarmcast/p2p/CodedFetch.kt",
  "android/app/src/main/java/tv/swarmcast/p2p/NetworkCodingDecoder.kt",
  "android/app/src/main/java/tv/swarmcast/p2p/RlncCodec.kt",
  "android/app/src/test/java/tv/swarmcast/p2p/RlncCodecTest.kt",
  "android/app/gradle.lockfile",
  "android/app/src/main/java/tv/swarmcast/p2p/PeerLink.kt",
  "android/app/src/main/java/tv/swarmcast/p2p/PeerReputation.kt",
  "android/app/src/main/java/tv/swarmcast/p2p/SegmentScheduler.kt",
  "android/app/src/main/java/tv/swarmcast/p2p/UploadBudget.kt",
  "android/app/src/main/java/tv/swarmcast/p2p/TrackerClient.kt",
  "android/app/src/main/java/tv/swarmcast/p2p/Wire.kt",
  "android/app/src/main/java/tv/swarmcast/p2p/SegmentStore.kt",
  "android/app/src/test/java/tv/swarmcast/diagnostics/DeviceLabDiagnosticsTest.kt",
  "android/app/src/test/java/tv/swarmcast/p2p/IceConnectivityTelemetryTest.kt",
  "android/app/src/main/java/tv/swarmcast/ui/SwarmCastScreen.kt",
  "scripts/smoke-android-runtime.js"
]) {
  try {
    readFileSync(file, "utf8");
  } catch {
    console.error(`${file}: missing required Android scaffold file`);
    failed = true;
  }
}

const androidTextChecks = [
  {
    file: "android/settings.gradle.kts",
    required: [
      "https://jitpack.io",
      "includeGroup(\"com.github.Backblaze\")"
    ]
  },
  {
    file: "android/app/build.gradle.kts",
    required: [
      "org.jetbrains.kotlin.plugin.compose",
      "SWARMCAST_P2P_ENABLED",
      "SWARMCAST_EDGE_ONLY_MODE",
      "SWARMCAST_RLNC_ENABLED",
      "JavaReedSolomon:d3c481dc69471e0c47ff6f67f33d53bde941675e",
      "dependencyLocking"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/data/AppConfig.kt",
    required: [
      "data class AppFeatureFlags",
      "p2pToggleAllowed",
      "initialP2pEnabled",
      "tv.swarmcast.P2P_ENABLED",
      "tv.swarmcast.EDGE_ONLY_MODE",
      "tv.swarmcast.RLNC_ENABLED"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/data/AuthRepository.kt",
    required: [
      "suspend fun session()",
      "suspend fun token()",
      "suspend fun refresh()",
      "data class IceServerResponse",
      "iceServers",
      "refreshMutex.withLock",
      "apiExceptionFromResponse",
      "response.body?.string()",
      "x-app-key"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/data/ChannelRepository.kt",
    required: [
      "suspend fun channels",
      "suspend fun groups",
      "apiExceptionFromResponse",
      "response.body?.string()",
      "urlComponent"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/data/NetworkPolicy.kt",
    required: [
      "data class NetworkPolicySnapshot",
      "MIN_UPLOAD_BATTERY_PERCENT = 25",
      "TRANSPORT_WIFI",
      "TRANSPORT_CELLULAR",
      "NET_CAPABILITY_NOT_METERED",
      "cm.isActiveNetworkMetered",
      "uploadAllowed = isWifi && !metered && batteryOk",
      "uplinkKbps = if (uploadAllowed)",
      "batteryPercent"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/data/ErrorTaxonomy.kt",
    required: [
      "object ErrorCodes",
      "const val NOT_FOUND = \"not_found\"",
      "const val EDGE_UNAVAILABLE = \"edge_unavailable\"",
      "data class ApiErrorBody",
      "class SwarmCastApiException",
      "fun apiExceptionFromResponse",
      "fun Throwable.userMessage",
      "private fun codeFromHttpStatus"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/playback/PlaybackUrls.kt",
    required: [
      "addQueryParameter(\"token\", token)",
      "template.contains(\"{file}\")"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/playback/PlayerHolder.kt",
    required: [
      "ExoPlayer.Builder",
      "DefaultLoadControl.Builder",
      "setBufferDurationsMs",
      "HlsMediaSource.Factory",
      "MimeTypes.APPLICATION_M3U8",
      "PlaybackUrls.authenticated",
      "scheduler: SegmentScheduler? = null",
      "SwarmSegmentDataSource.Factory",
      "bufferPolicy.segmentUrgencyMs",
      "Player.Listener",
      "bufferedDurationMs",
      "rebufferCount",
      "hasStartedPlayback"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/playback/SwarmSegmentDataSource.kt",
    required: [
      "BaseDataSource(true)",
      "DataSpec.HTTP_METHOD_GET",
      "scheduler.fetchSegment(segment.seq, segment.fileName, segmentUrgencyMs)",
      "fallbackDataSource.open(dataSpec)",
      "C.LENGTH_UNSET",
      "C.RESULT_END_OF_INPUT",
      "uri.lastPathSegment",
      "supportedExtensions",
      "runBlocking(Dispatchers.IO)"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/playback/PlaybackBufferPolicy.kt",
    required: [
      "minBufferMs: Int = 30_000",
      "maxBufferMs: Int = 60_000",
      "segmentUrgencyMs: Long = 1_500"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/playback/PlaybackSessionCoordinator.kt",
    required: [
      "authRepository.session()",
      "peerManager.updateIceServers",
      "ICE_REFRESH_POLL_MS",
      "tracker.connect",
      "playerHolder.play",
      "scheduler.configure",
      "tracker.reportStats",
      "val networkSnapshot = networkPolicy.snapshot()",
      "applyNetworkPolicy(networkSnapshot)",
      "uploadAllowed = ::refreshUploadPolicy",
      "val snapshot = networkPolicy.snapshot()",
      "val allowed = p2pPermissions(p2pEnabled, snapshot).uploadAllowed",
      "uploadBudget.configureForUplink",
      "p2pDownloadAllowed = permissions.downloadAllowed",
      "if (!p2pDownloadAllowed)",
      "if (p2pDownloadAllowed && swarmMode != \"edge-only\")",
      "TrackerEvent.SwarmMode",
      "schedulePeerReplenishment",
      "onUploaded = { _, bytes -> scheduler.recordUploaded(bytes) }",
      "peerTimeouts = current.peerTimeouts - lastStats.peerTimeouts",
      "hashFailures = current.peerHashFailures - lastStats.peerHashFailures",
      "peerDisconnects = current.peerDisconnects - lastStats.peerDisconnects",
      "startupLatencyReported",
      "playerHolder.bufferedDurationMs()",
      "playerHolder.rebufferCount()",
      "startupMs",
      "TrackerEvent.Redirect"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/ui/SwarmCastScreen.kt",
    required: [
      "OutlinedTextField",
      "LazyColumn",
      "Switch",
      "AlertDialog",
      "stringResource",
      "R.string.search_label",
      "R.string.privacy_body",
      "LiveRegionMode",
      "Role.Button",
      "stateDescription",
      "AndroidView",
      "PlayerView",
      "p2pToggleEnabled",
      "enabled = p2pToggleEnabled",
      "items(items = channels, key = { it.id })",
      "hasMore",
      "onLoadMore",
      "R.string.loading_more_channels",
      "R.string.load_more_action",
      "onChannelSelected"
    ]
  },
  {
    file: "android/app/src/main/res/values/strings.xml",
    required: [
      "search_label",
      "refresh_action",
      "p2p_upload_label",
      "privacy_body",
      "player_content_description",
      "loading_channels",
      "loading_more_channels",
      "load_more_action",
      "channel_row_content_description",
      "catalog_request_failed"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/ui/CatalogViewModel.kt",
    required: [
      "repository.channels",
      "cache?.query",
      "cache?.upsert",
      "hasMore = response.hasMore",
      "MutableStateFlow",
      "fallbackErrorMessage",
      "userMessage(fallbackErrorMessage)",
      "fun search",
      "fun refresh",
      "fun loadMore"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/data/CatalogDiskCache.kt",
    required: [
      "SQLiteOpenHelper",
      "swarmcast-catalog-cache.sqlite",
      "catalog_cache_channels",
      "catalog_cache_name_idx",
      "catalog_cache_group_idx",
      "setWriteAheadLoggingEnabled(true)",
      "insertWithOnConflict",
      "SQLiteDatabase.CONFLICT_REPLACE",
      "trimToMaxRows",
      "escapeLike",
      "maxRows: Int = 20_000",
      "fun query",
      "fun upsert"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/ui/MainActivity.kt",
    required: [
      "startPlayback",
      "PlaybackSessionCoordinator",
      "TrackerClient",
      "SegmentScheduler",
      "OkHttpClient.Builder",
      "Cache(File(cacheDir, HTTP_CACHE_DIR), HTTP_CACHE_BYTES)",
      "private const val HTTP_CACHE_DIR = \"swarmcast-http-cache\"",
      "private const val HTTP_CACHE_BYTES = 32L * 1024L * 1024L",
      "ChannelRepository(appConfig.apiBase, http = httpClient)",
      "enableEdgeToEdge",
      "SystemBarStyle.light",
      "decoderFactory = if (appConfig.featureFlags.rlncEnabled)",
      "RlncCodec.decoderFactory",
      "RlncCodec.encoderFactory",
      "PlayerHolder(this, scheduler = scheduler)",
      "LaunchedEffect",
      "appConfig.featureFlags.initialP2pEnabled",
      "appConfig.featureFlags.p2pToggleAllowed",
      "R.string.catalog_request_failed",
      "onLoadMore = { catalogViewModel.loadMore() }",
      "session.setP2pEnabled"
    ]
  },
  {
    file: "android/app/src/main/res/values/styles.xml",
    required: [
      "android:windowLightStatusBar",
      "android:statusBarColor",
      "android:navigationBarColor",
      "AppTheme.Base"
    ]
  },
  {
    file: "android/app/src/main/res/values-v27/styles.xml",
    required: [
      "android:windowLightNavigationBar",
      "AppTheme.Base"
    ]
  },
  {
    file: "scripts/smoke-android-runtime.js",
    required: [
      "--allow-emulator",
      "launchGateEligible: false",
      "Emulator results do not satisfy physical-device launch gates.",
      "FATAL EXCEPTION",
      "ANR in tv\\.swarmcast",
      "foregroundActivity",
      "apkSha256"
    ]
  },
  {
    file: "android/app/src/main/AndroidManifest.xml",
    required: [
      "tv.swarmcast.API_BASE",
      "tv.swarmcast.TRACKER_WS_URL",
      "tv.swarmcast.APP_API_KEY",
      "tv.swarmcast.P2P_ENABLED",
      "tv.swarmcast.EDGE_ONLY_MODE",
      "tv.swarmcast.RLNC_ENABLED",
      "android:dataExtractionRules=\"@xml/data_extraction_rules\"",
      "android:fullBackupContent=\"@xml/backup_rules\"",
      "android:icon=\"@mipmap/ic_launcher\"",
      "android:roundIcon=\"@mipmap/ic_launcher_round\"",
      ".diagnostics.DeviceLabControlReceiver",
      "android:permission=\"android.permission.DUMP\"",
      "tv.swarmcast.action.DEVICE_LAB_SNAPSHOT",
      "tv.swarmcast.action.DEVICE_LAB_SET_P2P"
    ]
  },
  {
    file: "android/app/src/main/res/xml/data_extraction_rules.xml",
    required: ["cloud-backup", "device-transfer", "domain=\"root\"", "domain=\"file\"", "domain=\"database\"", "domain=\"sharedpref\"", "domain=\"external\""]
  },
  {
    file: "android/app/src/main/res/xml/backup_rules.xml",
    required: ["full-backup-content", "domain=\"root\"", "domain=\"file\"", "domain=\"database\"", "domain=\"sharedpref\"", "domain=\"external\""]
  },
  {
    file: "android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
    required: ["adaptive-icon", "@color/launcher_background", "@drawable/ic_launcher_foreground"]
  },
  {
    file: "android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml",
    required: ["adaptive-icon", "@color/launcher_background", "@drawable/ic_launcher_foreground"]
  },
  {
    file: "android/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml",
    required: ["adaptive-icon", "@color/launcher_background", "@drawable/ic_launcher_foreground", "monochrome"]
  },
  {
    file: "android/app/src/main/res/mipmap-anydpi-v33/ic_launcher_round.xml",
    required: ["adaptive-icon", "@color/launcher_background", "@drawable/ic_launcher_foreground", "monochrome"]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/diagnostics/DeviceLabDiagnostics.kt",
    required: [
      "data class DeviceLabSnapshot",
      "capturedAtElapsedRealtimeMs",
      "downloadedFromBootstrapOrigin",
      "iceCandidateUnknown",
      "Base64.getUrlEncoder()",
      "AtomicReference<Registration?>",
      "if (registration?.owner === owner) null else registration"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/diagnostics/DeviceLabControlReceiver.kt",
    required: [
      "ACTION_SNAPSHOT",
      "ACTION_SET_P2P",
      "DeviceLabDiagnostics.setP2pEnabled",
      "ERROR_NO_ACTIVE_SESSION"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/playback/PlaybackSessionCoordinator.kt",
    required: [
      "DeviceLabDiagnostics.register",
      "DeviceLabDiagnostics.unregister",
      "fun deviceLabSnapshot(): DeviceLabSnapshot",
      "iceTelemetrySnapshot()"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/IceConnectivityTelemetry.kt",
    required: [
      "private var cumulative = IceConnectivityDelta()",
      "cumulative = cumulative.copy",
      "fun snapshot(): IceConnectivityDelta = cumulative"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/TrackerClient.kt",
    required: [
      "TrackerEvent.Joined",
      "TrackerEvent.Segment",
      "edgeSeedTier",
      "fun reportStats",
      "TrackerEvent.Redirect",
      "assignmentKey",
      "cellId",
      "MAX_TRACKER_REDIRECTS",
      "MAX_RECONNECT_DELAY_MS",
      "DEFAULT_JOIN_ACK_TIMEOUT_MS",
      "armJoinAckWatchdog",
      "cancelJoinAckWatchdog",
      "TrackerStatsBuffer",
      "flushPendingStatsLocked",
      "scheduleReconnect()",
      "openWebSocket(targetWsUrl",
      "fun requestPeers",
      "fun signal",
      "ErrorCodes.CONFIG_INVALID"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/TrackerStatsBuffer.kt",
    required: [
      "saturatedAdd",
      "incrementJoinTimeout",
      "startup_ms",
      "buffer_ms",
      "peer_timeouts",
      "hash_failures",
      "peer_disconnects",
      "tracker_join_timeouts",
      "ice_attempts"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/PeerConnectionManager.kt",
    required: [
      "PeerConnectionFactory.initialize",
      "iceServerConfigs: List<IceServerConfig> = emptyList()",
      "fun updateIceServers",
      "createDataChannel(\"sc-data\"",
      "fun onSignal",
      "fun closeAll",
      "DataChannel.State.OPEN",
      "recordIceSuccess(peerId) { candidateType ->",
      "isDirectP2pCandidateType(candidateType)",
      "fun iceTelemetrySnapshot(): IceConnectivityDelta = iceTelemetry.snapshot()",
      "closeDataChannel",
      "runCatching { channel.unregisterObserver() }",
      "runCatching { channel.dispose() }",
      "runCatching { peer.dispose() }"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/PeerLink.kt",
    required: [
      "Wire.REQUEST",
      "Wire.DATA_END",
      "Wire.BITFIELD",
      "requestCoded",
      "sendRank",
      "Wire.CODED",
      "Wire.RANK",
      "val directP2p: Boolean = true",
      "uploadBudget.tryReserve",
      "channel.bufferedAmount()",
      "onUploaded",
      "uploaded += len",
      "if (uploaded > 0L) onUploaded(peerId, uploaded)",
      "onUploaded(peerId, (coeffs.size + data.size).toLong())",
      "fun close(notifyClosed: Boolean = true)",
      "codedInflight?.second?.complete(null)",
      "Wire.CODED_REQUEST",
      "codedPacketProvider",
      "serveCoded",
      "if (!uploadAllowed()) break",
      "if (!uploadAllowed()) break@upload",
      "sendFrame(Wire.REJECT, seq, byteArrayOf(REJECT_POLICY))",
      "runCatching { channel.unregisterObserver() }",
      "runCatching { channel.dispose() }",
      "while (isOpen() && channel.bufferedAmount() > MAX_BUFFERED_BYTES)"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/CodedFetch.kt",
    required: [
      "class CodedFetch",
      "rankFor(seq)",
      "requestCoded(seq)",
      "CodedPacketCandidate",
      "directP2p = link.directP2p",
      "withTimeoutOrNull"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/RlncCodec.kt",
    required: [
      "com.backblaze.erasure.Galois",
      "object RlncCodec",
      "class RlncEncoder",
      "class RlncDecoder",
      "override fun accept",
      "override fun decode",
      "override fun recode",
      "Galois.multiply",
      "Galois.divide"
    ]
  },
  {
    file: "android/app/src/test/java/tv/swarmcast/p2p/RlncCodecTest.kt",
    required: [
      "matchesServerGf256WireVector",
      "reconstructsNonAlignedSegmentFromIndependentPackets",
      "rejectsDependentAndMalformedPacketsWithoutIncreasingRank",
      "partialDecoderRecodesUsefulPacketForAnotherPeer"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/NetworkCodingDecoder.kt",
    required: [
      "interface NetworkCodingDecoder",
      "DisabledNetworkCodingDecoder",
      "NetworkCodingDecoderFactory",
      "Android RLNC library decision is still open"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/UploadBudget.kt",
    required: [
      "class UploadBudget",
      "fun tryReserve",
      "System::nanoTime",
      "configureForUplink",
      "payloadRateForUplinkKbps",
      "UPLINK_UTILIZATION_PERCENT = 80L",
      "availableScaled",
      "elapsedNanos * rateBytesPerSecond",
      "upload budget capacity is too large"
    ]
  },
  {
    file: "android/app/src/test/java/tv/swarmcast/p2p/UploadBudgetTest.kt",
    required: [
      "enforcesBurstCapacityAndSustainedRefillRate",
      "preservesFractionalRefillCreditAcrossReservations",
      "ignoresClockRegressionWithoutMintingTokens",
      "reconfigurationClampsCapacityAndDoesNotMintASecondBurst",
      "derivesConservativePayloadRateFromReportedUplink",
      "rejectsInvalidOrOverflowingConfigurationAndRequests",
      "serializesConcurrentReservationsAgainstOneSharedCapacity"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/PeerReputation.kt",
    required: [
      "enum class PeerReputationEvent",
      "HASH_MISMATCH",
      "maxPoisonOffenses: Int = 2",
      "score = (score - 25).coerceAtLeast(minScore)",
      "if (poisonOffenses >= maxPoisonOffenses) disconnected = true",
      "fun candidates()"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/SegmentScheduler.kt",
    required: [
      "store.get(seq)",
      "tryPeerPaths",
      "collectCodedPackets",
      "tryDecodeCodedSegment",
      "decoderFactory.create",
      "fetchOwnedSegment",
      "originTemplate",
      "checkNotNull(manifest[seq])",
      "meta.seedTier",
      "meta.edgeSeedTier",
      "downloadedFromBootstrapOriginCounter",
      "downloadedFromRelayCounter",
      "peerDownloadAttribution",
      "recordPeerDownload",
      "if (packet.directP2p) acceptedDirectWeight",
      "segment hash mismatch",
      "PlaybackUrls.segmentUrl",
      "downloadedFromPeers",
      "downloadedFromEdge",
      "activePeerLinks = links.size",
      "apiExceptionFromResponse",
      "ErrorCodes.EDGE_UNAVAILABLE",
      "links.remove(link.peerId)?.close(notifyClosed = false)",
      "links.remove(peerId)?.close(notifyClosed = false)",
      "PeerReputationBook",
      "PeerReputationEvent.HASH_MISMATCH",
      "PeerReputationEvent.TIMEOUT",
      "recordPeerEvent(link, PeerReputationEvent.SUCCESS)",
      "disconnectPeer(link)",
      "val meta = manifest[seq] ?: return null",
      "AtomicLong",
      "uploadedToPeersCounter",
      "fun recordUploaded(bytes: Long)",
      "SchedulerStats(",
      "peerTimeoutsCounter",
      "peerHashFailuresCounter",
      "peerDisconnectsCounter",
      "PeerReputationEvent.TIMEOUT -> peerTimeoutsCounter.incrementAndGet()",
      "PeerReputationEvent.HASH_MISMATCH -> peerHashFailuresCounter.incrementAndGet()"
    ]
  },
  {
    file: "android/app/src/main/java/tv/swarmcast/p2p/Wire.kt",
    required: [
      "fun codedPayload",
      "fun parseCodedPayload",
      "fun rankPayload",
      "fun parseRankPayload",
      "CODED_REQUEST"
    ]
  }
];

for (const check of androidTextChecks) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing required Android scaffold text: ${required}`);
      failed = true;
    }
  }
}

for (const check of [
  {
    file: "infra/monitoring/Dockerfile.alertmanager",
    required: [
      "golang:1.26.5-alpine3.23@sha256:622e56dbc11a8cfe87cafa2331e9a201877271cbff918af53d3be315f3da88cc",
      "gcr.io/distroless/static-debian13:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6",
      "ARG ALERTMANAGER_COMMIT=2c8da51e03f3dbbed24f9711ca2d76aab4eef9c5",
      "test \"$(git rev-parse HEAD)\" = \"${ALERTMANAGER_COMMIT}\"",
      "golang.org/x/crypto@v0.53.0",
      "ARG TARGETOS\nARG TARGETARCH\n",
      "GOOS=\"${TARGETOS}\" GOARCH=\"${TARGETARCH}\""
    ],
    forbidden: ["ARG TARGETOS=", "ARG TARGETARCH="]
  },
  {
    file: "infra/monitoring/Dockerfile.grafana",
    required: [
      "golang:1.26.5-alpine3.23@sha256:622e56dbc11a8cfe87cafa2331e9a201877271cbff918af53d3be315f3da88cc",
      "grafana/grafana:13.1.0-distroless-slim@sha256:0dc2ccd5cb5bc09ce8d77817faf51a7958c2dd59f29db95854f97ba8a4dd69e2",
      "ARG GRAFANA_COMMIT=b309c9bb3b81a748c3a75289236a27309ed2566a",
      "test \"$(git rev-parse HEAD)\" = \"${GRAFANA_COMMIT}\"",
      "COPY infra/monitoring/grafana-no-tempo.patch /tmp/grafana-no-tempo.patch",
      "git apply --check /tmp/grafana-no-tempo.patch",
      "ARG TARGETOS\nARG TARGETARCH\n",
      "GOOS=\"${TARGETOS}\" GOARCH=\"${TARGETARCH}\""
    ],
    forbidden: ["ARG TARGETOS=", "ARG TARGETARCH="]
  },
  {
    file: "infra/monitoring/grafana-no-tempo.patch",
    required: [
      "pkg/server/wire.go",
      "pkg/services/pluginsintegration/coreplugin/coreplugins.go",
      "-\ttempo.ProvideService",
      "-\t\tsvc = tempo.ProvideService"
    ],
    forbidden: []
  },
  {
    file: ".github/workflows/release.yml",
    required: [
      "dockerfile: infra/monitoring/Dockerfile.alertmanager",
      "dockerfile: infra/monitoring/Dockerfile.grafana",
      "prom/prometheus:v3.13.1-distroless@sha256:214f8427c8fba80c327bb94a75feb802ae12f2d6ca30812aa6e7d22f09bbea80",
      "prom/node-exporter:v1.12.0-distroless@sha256:843ed23bb564f897ddcc6b6b9b605e398779487a561aae36fddd2933394836cd",
      "node scripts/select-owned-image-ref.js \"$IMAGE\"",
      "^${IMAGE}@sha256:[a-f0-9]{64}$"
    ],
    forbidden: []
  }
]) {
  const text = readFileSync(check.file, "utf8");
  for (const required of check.required) {
    if (!text.includes(required)) {
      console.error(`${check.file}: missing hardened monitoring build text: ${required}`);
      failed = true;
    }
  }
  for (const forbidden of check.forbidden) {
    if (text.includes(forbidden)) {
      console.error(`${check.file}: forbidden hardened monitoring build text: ${forbidden}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`Config validation OK: ${checks.length} files, ${jsonFiles.length} JSON files`);
