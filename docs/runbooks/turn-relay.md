# TURN Relay Operations

## Scope

This runbook covers the owned coturn fleet used when direct WebRTC connectivity fails. TURN is not counted as direct P2P offload. Client-to-relay and relay-to-peer traffic must be included in owned egress and capacity evidence.

## Deployment

1. Point an owned `turn` DNS name directly at each relay host. Do not proxy TURN through a CDN.
2. Install a certificate and private key as `fullchain.pem` and `privkey.pem` under `TURN_CERT_DIR`. The coturn container user `65534:65534` must be able to read both files.
3. Generate a random 64-hex `TURN_SHARED_SECRET`. Inject the same secret into auth and every relay through the production secret store; never commit or log it.
4. Set `ALLOW_METRICS_FROM` to the monitoring CIDR, review `infra/host/firewall/ufw-turn.sh` in dry-run mode, then apply it. The profile opens TURN UDP/TCP/TLS and the relay range while restricting `TURN_PROMETHEUS_PORT` to monitoring sources.
5. Render and validate both configurations:

```bash
npm run env:production:validate -- /etc/swarmcast/production.env
docker compose --env-file /etc/swarmcast/production.env -f infra/turn/docker-compose.yml config
```

6. Start the relay with the digest-pinned `SWARMCAST_TURN_IMAGE`, then run `npm run smoke:turn` and a real external `turnutils_uclient` probe through UDP and TLS.
7. Add every relay metric endpoint to `TURN_TARGETS_DIR` using Prometheus file discovery.

## Monitoring

- `up{job="swarmcast-turn"}` must remain `1` for every configured relay.
- `turn_total_allocations` tracks active allocation pressure.
- `turn_total_traffic_sentb` and `turn_total_traffic_rcvb` are used for relay throughput and egress reconciliation.
- `swarmcast_auth_turn_credentials_issued_total` confirms credential issuance.
- Android `relay` selected-candidate telemetry must reconcile with tracker relay bytes and coturn traffic within the launch evidence tolerance.

`SwarmcastTurnTargetDown`, `SwarmcastTurnAllocationPressure`, and `SwarmcastTurnBandwidthPressure` route operators to this runbook. Capacity alerts assume the committed default quotas; adjust alert thresholds together with reviewed production quota changes.

## Incident Response

1. Confirm whether failure is DNS, certificate, listener, port-range exhaustion, allocation quota, or bandwidth capacity.
2. Keep direct ICE enabled. Clients that cannot use TURN degrade to the owned Delivery Fleet rather than stalling.
3. Remove an unhealthy relay URL from auth configuration, restart auth, and wait for client credential refresh. Do not revoke healthy established paths unnecessarily.
4. Scale by adding relay hosts and URLs only after measuring per-host allocations, CPU, packet loss, and sustained bytes per second.
5. Reconcile the incident interval against edge egress. A TURN outage may lower relay traffic while sharply increasing edge delivery.

## Secret Rotation

1. Generate a new current secret and deploy it to coturn as `TURN_SHARED_SECRET`, retaining the old value as `TURN_PREVIOUS_SHARED_SECRET`.
2. Confirm coturn is healthy and accepts credentials generated from both secrets.
3. Deploy the new `TURN_SHARED_SECRET` to auth. New `/token` responses now use the new secret.
4. Wait longer than `TURN_CREDENTIAL_TTL_SECONDS` plus clock-skew allowance.
5. Remove `TURN_PREVIOUS_SHARED_SECRET` from coturn and verify UDP/TLS allocation, metrics, Android relay selection, and edge fallback.

Never place raw current or previous secrets in incident evidence, screenshots, logs, or chat systems.
