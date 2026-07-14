#!/usr/bin/env bash
set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"
ALLOW_SSH_FROM="${ALLOW_SSH_FROM:-}"
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

if ! command -v ufw >/dev/null 2>&1; then
  echo "ufw is required before applying the SwarmCast firewall profile" >&2
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

run ufw allow 80/tcp comment "http acme"
run ufw allow 443/tcp comment "public tls entrypoints"

for port in 7000 7001 7002 7003 7010 7020 9101; do
  run ufw deny "${port}/tcp" comment "swarmcast internal port"
done

run ufw --force enable
run ufw status verbose
