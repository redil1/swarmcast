# Runbook: Control-Plane Storage Backend

## Alerts

- `SwarmcastControlPlaneCatalogNotDurable`
- `SwarmcastControlPlanePlacementNotDurable`

## Impact

The control plane is running with a non-production storage backend. Catalog or channel placement state may not survive process restart, deployment rollback, or restore drill.

## Triage

1. Check the Grafana "Control Plane Storage Backends" panel.
2. Confirm `/metrics` exposes `swarmcast_control_catalog_backend_info` and `swarmcast_control_placement_backend_info`.
3. Verify the running control-plane environment has `CATALOG_DB_PATH` and `PLACEMENT_DB_PATH` set to persistent mounted paths.
4. Check the deploy environment file with `npm run env:production:validate -- path/to/production.env`.
5. Confirm the SQLite files are included in the backup set from `docs/backup-restore.md`.
6. Do not paste catalog source URLs, tokens, or database credentials into the incident record.

## Mitigation

1. If the alert followed a deploy, roll back to the last release that used SQLite-backed control-plane state.
2. If paths are missing, set `CATALOG_DB_PATH` and `PLACEMENT_DB_PATH`, mount durable storage, and redeploy the control-plane service.
3. Run `npm run smoke:catalog-sqlite` and `npm run smoke:control-plane-placement-sqlite` against the fixed environment.
4. Run `npm run smoke:sqlite-backup-restore` before declaring backup/restore readiness restored.
5. Keep tracker joins on Delivery Fleet fallback if placement state cannot be recovered quickly.

## Follow-Up

- Attach sanitized `/metrics` evidence showing both backend info series report `backend="sqlite"`.
- Attach deployment evidence showing persistent volume paths for the catalog and placement databases.
- Attach backup manifest checksums for the restored SQLite databases when recovery was required.
- Update `docs/runbooks/restore-drill.md` if the recovery exposed a missing restore step.
