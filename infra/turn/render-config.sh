#!/bin/sh
set -eu

required() {
  value=$(printenv "$1" || true)
  if [ -z "$value" ]; then
    echo "$1 is required" >&2
    exit 1
  fi
}

integer() {
  value=$(printenv "$1" || true)
  case "$value" in
    ''|*[!0-9]*) echo "$1 must be an integer" >&2; exit 1 ;;
  esac
}

for name in TURN_REALM TURN_SHARED_SECRET TURN_LISTENING_PORT \
  TURN_TLS_LISTENING_PORT TURN_MIN_PORT TURN_MAX_PORT TURN_USER_QUOTA \
  TURN_TOTAL_QUOTA TURN_MAX_BPS TURN_BPS_CAPACITY TURN_PROMETHEUS_PORT; do
  required "$name"
done

case "$TURN_REALM" in
  *[!A-Za-z0-9.-]*|'') echo "TURN_REALM has invalid characters" >&2; exit 1 ;;
esac
case "$TURN_SHARED_SECRET" in
  *[!A-Za-z0-9_-]*|'') echo "TURN_SHARED_SECRET must use URL-safe characters" >&2; exit 1 ;;
esac
if [ "${#TURN_SHARED_SECRET}" -lt 32 ]; then
  echo "TURN_SHARED_SECRET must contain at least 32 characters" >&2
  exit 1
fi
if [ -n "${TURN_PREVIOUS_SHARED_SECRET:-}" ]; then
  case "$TURN_PREVIOUS_SHARED_SECRET" in
    *[!A-Za-z0-9_-]*) echo "TURN_PREVIOUS_SHARED_SECRET must use URL-safe characters" >&2; exit 1 ;;
  esac
  if [ "${#TURN_PREVIOUS_SHARED_SECRET}" -lt 32 ] || [ "$TURN_PREVIOUS_SHARED_SECRET" = "$TURN_SHARED_SECRET" ]; then
    echo "TURN_PREVIOUS_SHARED_SECRET must be distinct and contain at least 32 characters" >&2
    exit 1
  fi
fi

for name in TURN_LISTENING_PORT TURN_TLS_LISTENING_PORT TURN_MIN_PORT TURN_MAX_PORT \
  TURN_USER_QUOTA TURN_TOTAL_QUOTA TURN_MAX_BPS TURN_BPS_CAPACITY TURN_PROMETHEUS_PORT; do
  integer "$name"
done

TURN_PROMETHEUS_ADDRESS=${TURN_PROMETHEUS_ADDRESS:-0.0.0.0}
case "$TURN_PROMETHEUS_ADDRESS" in
  *[!A-Fa-f0-9.:]*|'') echo "TURN_PROMETHEUS_ADDRESS must be an IP address" >&2; exit 1 ;;
esac

if [ "$TURN_MIN_PORT" -gt "$TURN_MAX_PORT" ]; then
  echo "TURN_MIN_PORT must not exceed TURN_MAX_PORT" >&2
  exit 1
fi
if [ ! -r /certs/fullchain.pem ] || [ ! -r /certs/privkey.pem ]; then
  echo "TURN TLS certificate files are required" >&2
  exit 1
fi

umask 077
config=/run/swarmcast-turnserver.conf
cat > "$config" <<EOF
listening-port=$TURN_LISTENING_PORT
tls-listening-port=$TURN_TLS_LISTENING_PORT
min-port=$TURN_MIN_PORT
max-port=$TURN_MAX_PORT
realm=$TURN_REALM
server-name=$TURN_REALM
fingerprint
use-auth-secret
static-auth-secret=$TURN_SHARED_SECRET
stale-nonce=600
max-allocate-lifetime=3600
user-quota=$TURN_USER_QUOTA
total-quota=$TURN_TOTAL_QUOTA
max-bps=$TURN_MAX_BPS
bps-capacity=$TURN_BPS_CAPACITY
cert=/certs/fullchain.pem
pkey=/certs/privkey.pem
no-tlsv1
no-tlsv1_1
no-cli
no-software-attribute
no-multicast-peers
no-rfc5780
prometheus
prometheus-port=$TURN_PROMETHEUS_PORT
prometheus-address=$TURN_PROMETHEUS_ADDRESS
log-file=stdout
simple-log
new-log-timestamp
pidfile=/run/turnserver.pid
proc-user=nobody
proc-group=nogroup
EOF

if [ -n "${TURN_EXTERNAL_IP:-}" ]; then
  printf 'external-ip=%s\n' "$TURN_EXTERNAL_IP" >> "$config"
fi
if [ -n "${TURN_LISTENING_IP:-}" ]; then
  printf 'listening-ip=%s\n' "$TURN_LISTENING_IP" >> "$config"
fi
if [ -n "${TURN_RELAY_IP:-}" ]; then
  printf 'relay-ip=%s\n' "$TURN_RELAY_IP" >> "$config"
fi
if [ -n "${TURN_PREVIOUS_SHARED_SECRET:-}" ]; then
  printf 'static-auth-secret=%s\n' "$TURN_PREVIOUS_SHARED_SECRET" >> "$config"
fi
if [ "${TURN_ALLOW_PRIVATE_PEERS:-0}" != "1" ]; then
  cat >> "$config" <<'EOF'
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
EOF
else
  printf 'allow-loopback-peers\n' >> "$config"
fi

exec turnserver -c "$config"
