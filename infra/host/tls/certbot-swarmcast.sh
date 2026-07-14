#!/usr/bin/env bash
set -euo pipefail

APPLY="${APPLY:-0}"
CERTBOT_MODE="${CERTBOT_MODE:-webroot}"
DOMAINS_RAW="${DOMAINS:-origin.example.tv,api.example.tv,tracker.example.tv}"
WEBROOT="${WEBROOT:-/var/www/certbot}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
STAGING="${STAGING:-1}"
ALLOW_PLACEHOLDER_DOMAINS="${ALLOW_PLACEHOLDER_DOMAINS:-0}"

if [[ "$CERTBOT_MODE" == "webroot" ]]; then
  RELOAD_COMMAND="${RELOAD_COMMAND:-docker compose -f infra/docker-compose.yml exec -T nginx nginx -s reload}"
else
  RELOAD_COMMAND="${RELOAD_COMMAND:-}"
fi

die() {
  echo "ERROR: $*" >&2
  exit 1
}

run_or_print() {
  if [[ "$APPLY" == "1" ]]; then
    "$@"
    return
  fi

  printf 'DRY RUN:'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'
}

require_flag() {
  local name="$1"
  local value="$2"
  [[ "$value" == "0" || "$value" == "1" ]] || die "$name must be 0 or 1"
}

require_flag "APPLY" "$APPLY"
require_flag "STAGING" "$STAGING"
require_flag "ALLOW_PLACEHOLDER_DOMAINS" "$ALLOW_PLACEHOLDER_DOMAINS"

[[ "$CERTBOT_MODE" == "webroot" || "$CERTBOT_MODE" == "standalone" ]] || die "CERTBOT_MODE must be webroot or standalone"

domains=()
for domain in ${DOMAINS_RAW//,/ }; do
  [[ -n "$domain" ]] || continue
  [[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]] || die "invalid domain: $domain"
  if [[ "$APPLY" == "1" && "$ALLOW_PLACEHOLDER_DOMAINS" != "1" && "$domain" == *.example.tv ]]; then
    die "replace placeholder domain $domain before APPLY=1, or set ALLOW_PLACEHOLDER_DOMAINS=1 for a controlled test"
  fi
  domains+=("$domain")
done

[[ "${#domains[@]}" -gt 0 ]] || die "DOMAINS must contain at least one hostname"

if [[ "$APPLY" == "1" ]]; then
  command -v certbot >/dev/null 2>&1 || die "certbot is required"
  [[ -n "$CERTBOT_EMAIL" ]] || die "CERTBOT_EMAIL is required when APPLY=1"
fi

email_arg="${CERTBOT_EMAIL:-ops@example.com}"

if [[ "$CERTBOT_MODE" == "webroot" ]]; then
  run_or_print install -d -m 0755 "$WEBROOT/.well-known/acme-challenge"
fi

for domain in "${domains[@]}"; do
  cmd=(
    certbot certonly
    --non-interactive
    --agree-tos
    --email "$email_arg"
    --cert-name "$domain"
    -d "$domain"
  )

  if [[ "$CERTBOT_MODE" == "webroot" ]]; then
    cmd+=(--webroot --webroot-path "$WEBROOT")
  else
    cmd+=(--standalone --preferred-challenges http)
  fi

  if [[ "$STAGING" == "1" ]]; then
    cmd+=(--staging)
  fi

  if [[ -n "$RELOAD_COMMAND" ]]; then
    cmd+=(--deploy-hook "$RELOAD_COMMAND")
  fi

  run_or_print "${cmd[@]}"
done
