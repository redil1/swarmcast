# Service Lifecycle Incident

## Scope

This runbook covers `SwarmcastServiceTargetDown` for auth, ingest, tracker, control-plane, retention-worker, and edge metrics. It also covers a service that is alive but not ready, or a deployment that does not terminate cleanly within its 15-second grace period.

## Detection

- Prometheus `up{job=~"(swarmcast-(auth|ingest|tracker|control-plane|retention-worker)|edge-cache-metrics)"}` identifies scrape availability by service and instance.
- `/health` proves only that the process can answer HTTP. `/ready` proves that startup completed and the process is eligible for traffic.
- During startup and graceful shutdown, `/health` may remain `200` while `/ready` returns `503`. This is expected for a bounded interval.
- The tracker exposes health, readiness, and metrics on its internal port. Its viewer WebSocket listener must also be accepting connections before readiness becomes `200`.

## Triage

1. Identify the exact `job` and `instance` firing in Prometheus. Check whether the failure is isolated or affects a dependency shared by multiple services.
2. Request `/health`, `/ready`, and `/metrics` directly from the affected instance. Record status codes and timestamps without recording tokens, credentials, or source URLs.
3. Review recent structured logs for `service_shutdown_started`, `service_shutdown_completed`, `service_shutdown_failed`, startup errors, and dependency failures.
4. Use `docker inspect` to confirm health status, restart count, exit code, OOM state, read-only root, dropped capabilities, and the configured 15-second stop timeout.
5. For tracker incidents, confirm both the viewer and internal listeners. A graceful tracker restart closes viewers with WebSocket restart code `1012`, allowing clients to reconnect and obtain a healthy cell.

## Recovery

1. Remove the failing instance from traffic while `/ready` is not `200`. Keep healthy replicas serving.
2. Correct the dependency, configuration, resource, filesystem, or image problem. Do not mutate a running container or bypass the read-only filesystem controls.
3. Stop the affected container with `docker stop --time 15 <container>`. A normal shutdown must exit with code `0` and emit `service_shutdown_completed` before the deadline.
4. If shutdown times out or exits nonzero, preserve logs and inspect blocked requests, retention work, WebSocket peers, and external dependencies before replacement.
5. Start the digest-pinned replacement. Verify Docker health, `/ready` status `200`, expected metrics, and a service-specific smoke test.
6. Do not restore traffic until readiness is stable, dependencies are healthy, the replacement has no restart loop, and the active incident commander records the recovery evidence.

## Escalation And Rollback

- Roll back to the previously verified digest when the new image cannot become ready, repeatedly exits, or fails its service smoke.
- Follow `docs/runbooks/rollback-drill.md` for deployment rollback and `docs/runbooks/app-incident.md` for Delivery-Fleet-only playback when tracker or peer delivery is impaired.
- Escalate immediately when more than one core service is down, when auth or tracker has no healthy instance, or when edge fallback capacity approaches its reviewed limit.

## Closure Evidence

Record the alert interval, affected digest and instance, liveness/readiness results, root cause, shutdown duration and exit code, `service_shutdown_completed` log event, replacement health result, smoke result, rollback decision, and incident owner. Do not include raw secrets, JWTs, Play Integrity tokens, TURN credentials, or source URLs.
