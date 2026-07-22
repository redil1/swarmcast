#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
COMPOSE_FILES=(-f "$ROOT_DIR/infra/docker-compose.yml" -f "$ROOT_DIR/infra/staging-single-host/docker-compose.yml")
SERVICES=(source-generator segment-bus segment-bus-exporter ingest tracker auth control-plane retention-worker prometheus alertmanager grafana gateway turn-cert-init turn)
HEALTH_SERVICES=(source-generator segment-bus ingest tracker auth control-plane retention-worker gateway turn)

PUBLIC_SUFFIX=""
CATALOG_PATH=""
ENV_PATH="$ROOT_DIR/.env.staging"
TURN_EXTERNAL_IP=""
PREPARE_ONLY=0

usage() {
  cat <<'EOF'
Usage: sudo infra/staging-single-host/deploy.sh \
  --public-suffix <dns-suffix> \
  --catalog </absolute/path/source.m3u> \
  [--env </absolute/path/.env.staging>] \
  [--turn-external-ip <public-ipv4>] \
  [--prepare-only]

The host must already provide Node.js 20-24, Docker Compose, curl, setfacl,
DNS for origin/api/tracker.<suffix>, and available TCP 80/443/3478/5349,
UDP 443/3478/5349, plus TCP/UDP 55000-55999.
EOF
}

while (($#)); do
  case "$1" in
    --public-suffix) PUBLIC_SUFFIX=${2:-}; shift 2 ;;
    --catalog) CATALOG_PATH=${2:-}; shift 2 ;;
    --env) ENV_PATH=${2:-}; shift 2 ;;
    --turn-external-ip) TURN_EXTERNAL_IP=${2:-}; shift 2 ;;
    --prepare-only) PREPARE_ONLY=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$PUBLIC_SUFFIX" || -z "$CATALOG_PATH" ]]; then
  usage >&2
  exit 2
fi
if [[ "$CATALOG_PATH" != /* || "$ENV_PATH" != /* ]]; then
  printf 'Catalog and env paths must be absolute.\n' >&2
  exit 2
fi

for command in node; do
  command -v "$command" >/dev/null || { printf 'Missing required command: %s\n' "$command" >&2; exit 1; }
done
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if ((NODE_MAJOR < 20 || NODE_MAJOR > 24)); then
  printf 'Node.js 20-24 is required for host-side configuration; found %s.\n' "$(node -v)" >&2
  exit 1
fi

if [[ -e "$ENV_PATH" ]]; then
  ENV_COMMAND=(node "$ROOT_DIR/scripts/render-staging-single-host-env.js" \
    --enable-turn --public-suffix "$PUBLIC_SUFFIX" --catalog "$CATALOG_PATH" --output "$ENV_PATH")
else
  ENV_COMMAND=(node "$ROOT_DIR/scripts/render-staging-single-host-env.js" \
    --public-suffix "$PUBLIC_SUFFIX" --catalog "$CATALOG_PATH" --output "$ENV_PATH")
fi
if [[ -n "$TURN_EXTERNAL_IP" ]]; then
  ENV_COMMAND+=(--turn-external-ip "$TURN_EXTERNAL_IP")
fi
"${ENV_COMMAND[@]}"

if [[ "$PREPARE_ONLY" == "1" ]]; then
  printf 'Staging preparation validated: env=%s catalog=%s\n' "$ENV_PATH" "$CATALOG_PATH"
  exit 0
fi

if [[ "$EUID" != "0" ]]; then
  printf 'Root is required for catalog ACLs, /var/hls ownership, and Docker deployment.\n' >&2
  exit 1
fi
for command in docker curl setfacl; do
  command -v "$command" >/dev/null || { printf 'Missing required command: %s\n' "$command" >&2; exit 1; }
done
docker compose version >/dev/null

chown root:root "$CATALOG_PATH" "$ENV_PATH"
chmod 0600 "$CATALOG_PATH" "$ENV_PATH"
setfacl -m u:1000:r,u:65532:r "$CATALOG_PATH"
install -d -o 1000 -g 1000 -m 0755 /var/hls

COMPOSE=(docker compose --project-directory "$ROOT_DIR/infra" --env-file "$ENV_PATH" "${COMPOSE_FILES[@]}")
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up -d --build "${SERVICES[@]}"

deadline=$((SECONDS + 240))
for service in "${HEALTH_SERVICES[@]}"; do
  while true; do
    container_id=$("${COMPOSE[@]}" ps -q "$service")
    status=""
    if [[ -n "$container_id" ]]; then
      status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
    fi
    [[ "$status" == "healthy" || "$status" == "running" ]] && break
    if ((SECONDS >= deadline)); then
      printf 'Timed out waiting for %s; last status=%s\n' "$service" "${status:-missing}" >&2
      "${COMPOSE[@]}" ps >&2
      exit 1
    fi
    sleep 3
  done
done

curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 \
  "https://origin.$PUBLIC_SUFFIX/health" >/dev/null
curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 \
  "https://api.$PUBLIC_SUFFIX/health" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${TURN_PROMETHEUS_PORT:-9641}/metrics" \
  | grep '^# HELP turn_' >/dev/null

printf 'SwarmCast staging deployment is healthy.\n'
printf 'Origin: https://origin.%s\n' "$PUBLIC_SUFFIX"
printf 'API: https://api.%s\n' "$PUBLIC_SUFFIX"
printf 'Tracker: wss://tracker.%s/ws\n' "$PUBLIC_SUFFIX"
printf 'TURN: turn:origin.%s:3478 and turns:origin.%s:5349\n' "$PUBLIC_SUFFIX" "$PUBLIC_SUFFIX"
