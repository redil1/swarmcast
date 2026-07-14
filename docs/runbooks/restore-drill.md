# Restore Drill

## Meaning

This runbook proves SwarmCast can restore critical production state into staging and resume authenticated playback operations without rebuilding old artifacts or exposing secrets.

## Scope

Restore drills cover:

- auth signing keys and JWKS state
- control-plane SQLite placement registry
- production catalog source and imported catalog snapshot
- monitoring config, Alertmanager routing, and Grafana dashboards
- nginx edge/origin config
- retention policy and retention worker deployment config
- immutable service image tags and release evidence

## Safety Rules

- Restore into staging first; never test an unproven backup directly in production.
- Use scoped staging credentials and replacement Alertmanager receivers.
- Do not paste private keys, app API keys, internal tokens, JWTs, source URLs, or datastore credentials into incident records.
- Record snapshot IDs, checksums, image tags, and restore operator names.

## Drill Steps

1. Create a staging restore record with start time, target environment, backup snapshot IDs, and expected RTO/RPO.
2. Restore auth key material, `AUTH_KEY_ID`, previous JWKS overlap state, and JWT audience/issuer settings.
3. Start auth in staging and verify `/health`, `/jwks`, `/token`, and `/verify`.
4. Restore control-plane SQLite placement registry, ingest-node config, catalog database, and catalog snapshot.
5. Run `npm run source:preflight` from the staging ingest network path with the restored catalog allowlist.
6. Run `npm run smoke:sqlite-backup-restore` to prove catalog and placement SQLite backups restore into fresh paths.
7. Run `npm run smoke:control-plane-placement-sqlite` to prove placement state survives restart.
8. Restore monitoring config, Alertmanager routing, and Grafana dashboard JSON.
9. Run `npm run check` to validate config, docs, dashboards, policies, and runbook gates.
10. Restore retention policy/deployment config and run `npm run retention:job -- --prometheus` in dry-run mode against staging stores.
11. Run authenticated playback smokes for auth, catalog, tracker, edge cache, and origin paths before declaring the drill successful.

## Required Evidence

- Start and end timestamps with elapsed restore time.
- Snapshot IDs and checksums for each restored asset class.
- Auth `/jwks` output proving the expected `kid` without private fields.
- One `/token` success and one `/verify` HTTP 204 for a fresh token.
- Placement restart smoke output with restored node evidence from `npm run smoke:control-plane-placement-sqlite`.
- Source preflight summary with no raw source URLs.
- Monitoring validation output and Alertmanager receiver override confirmation.
- Retention dry-run Prometheus output and last-success timestamp.
- Post-restore smoke results and any rollback decisions.
- A JSON restore evidence record that passes `npm run restore:evidence:validate -- path/to/restore-evidence.json`.
- Local guard output from `npm run smoke:restore-evidence-validation`.

## Failure Handling

- If auth key restore fails, stop the drill and follow `docs/runbooks/auth-outage.md`.
- If placement restore fails, keep tracker joins on Delivery Fleet fallback and follow `docs/runbooks/tracker-peer-drops.md`.
- If source preflight fails, quarantine failed channels and follow `docs/runbooks/source-failure.md`.
- If retention dry run fails, keep `RETENTION_EXECUTE` disabled and follow `docs/runbooks/retention-job-failures.md`.

## Launch Gate

Production launch remains blocked until this drill succeeds in staging and the evidence is attached to `docs/launch-readiness.md`.
