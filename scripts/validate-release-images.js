const requiredImages = [
  ["segment-bus", "SWARMCAST_NATS_IMAGE"],
  ["segment-bus-exporter", "SWARMCAST_NATS_EXPORTER_IMAGE"],
  ["auth", "SWARMCAST_AUTH_IMAGE"],
  ["ingest", "SWARMCAST_INGEST_IMAGE"],
  ["tracker", "SWARMCAST_TRACKER_IMAGE"],
  ["control-plane", "SWARMCAST_CONTROL_PLANE_IMAGE"],
  ["web", "SWARMCAST_WEB_IMAGE"],
  ["retention-worker", "SWARMCAST_RETENTION_WORKER_IMAGE"],
  ["nginx", "SWARMCAST_NGINX_IMAGE"],
  ["prometheus", "SWARMCAST_PROMETHEUS_IMAGE"],
  ["alertmanager", "SWARMCAST_ALERTMANAGER_IMAGE"],
  ["grafana", "SWARMCAST_GRAFANA_IMAGE"],
  ["edge-nginx", "SWARMCAST_EDGE_NGINX_IMAGE"],
  ["edge-metrics", "SWARMCAST_EDGE_METRICS_IMAGE"],
  ["node-exporter", "SWARMCAST_NODE_EXPORTER_IMAGE"],
  ["turn", "SWARMCAST_TURN_IMAGE"]
];

const allowTagOnly = process.argv.includes("--allow-tag-only");
const digestPattern = /@sha256:[a-f0-9]{64}$/i;
let failed = false;

for (const [service, envName] of requiredImages) {
  const image = process.env[envName];
  if (!image) {
    console.error(`${envName} is required for ${service}`);
    failed = true;
    continue;
  }
  if (/\s/.test(image)) {
    console.error(`${envName} contains whitespace`);
    failed = true;
  }
  if (!allowTagOnly && !digestPattern.test(image)) {
    console.error(`${envName} must be digest-pinned with @sha256:<64 hex chars>`);
    failed = true;
  }
}

if (failed) process.exit(1);

const mode = allowTagOnly ? "tag-only allowed" : "digest-pinned";
console.log(`Release image refs OK: ${requiredImages.length} ${mode} images`);
