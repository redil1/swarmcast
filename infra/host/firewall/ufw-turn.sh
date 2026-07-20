#!/usr/bin/env bash
set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"
ALLOW_SSH_FROM="${ALLOW_SSH_FROM:-}"
ALLOW_METRICS_FROM="${ALLOW_METRICS_FROM:-}"
TURN_LISTENING_PORT="${TURN_LISTENING_PORT:-3478}"
TURN_TLS_LISTENING_PORT="${TURN_TLS_LISTENING_PORT:-5349}"
TURN_MIN_PORT="${TURN_MIN_PORT:-49152}"
TURN_MAX_PORT="${TURN_MAX_PORT:-65535}"
TURN_PROMETHEUS_PORT="${TURN_PROMETHEUS_PORT:-9641}"
APPLY="${APPLY:-0}"

run() {
  if [[ "${APPLY}" == "1" ]]; then
    "$@"
  else
    printf 'DRY RUN:'
    printf ' %q' "$@"
    printf '\n'
  fi
}

integer_port() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
    echo "$name must be an integer from 1 to 65535" >&2
    exit 1
  fi
}

if ! command -v ufw >/dev/null 2>&1; then
  echo "ufw is required before applying the TURN firewall profile" >&2
  exit 1
fi
if [[ -z "${ALLOW_METRICS_FROM}" ]]; then
  echo "ALLOW_METRICS_FROM is required so coturn metrics are never public" >&2
  exit 1
fi

integer_port TURN_LISTENING_PORT "$TURN_LISTENING_PORT"
integer_port TURN_TLS_LISTENING_PORT "$TURN_TLS_LISTENING_PORT"
integer_port TURN_MIN_PORT "$TURN_MIN_PORT"
integer_port TURN_MAX_PORT "$TURN_MAX_PORT"
integer_port TURN_PROMETHEUS_PORT "$TURN_PROMETHEUS_PORT"
if (( TURN_MIN_PORT > TURN_MAX_PORT )); then
  echo "TURN_MIN_PORT must not exceed TURN_MAX_PORT" >&2
  exit 1
fi

run ufw --force reset
run ufw default deny incoming
run ufw default allow outgoing

if [[ -n "${ALLOW_SSH_FROM}" ]]; then
  run ufw allow from "${ALLOW_SSH_FROM}" to any port "${SSH_PORT}" proto tcp comment "restricted ssh"
else
  run ufw allow "${SSH_PORT}/tcp" comment "ssh"
fi

run ufw allow 80/tcp comment "acme certificate renewal"
run ufw allow "${TURN_LISTENING_PORT}/udp" comment "turn udp"
run ufw allow "${TURN_LISTENING_PORT}/tcp" comment "turn tcp"
run ufw allow "${TURN_TLS_LISTENING_PORT}/udp" comment "turn dtls"
run ufw allow "${TURN_TLS_LISTENING_PORT}/tcp" comment "turn tls"
run ufw allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp" comment "turn udp relay range"
run ufw allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}/tcp" comment "turn tcp relay range"
run ufw allow from "${ALLOW_METRICS_FROM}" to any port "${TURN_PROMETHEUS_PORT}" proto tcp comment "restricted turn metrics"
run ufw deny "${TURN_PROMETHEUS_PORT}/tcp" comment "deny public turn metrics"

run ufw --force enable
run ufw status verbose
