# Backup And Restore Checklist

## Backup Scope

- auth signing keys and JWKS state
- control-plane SQLite placement registry
- production catalog source and imported catalog snapshot
- Prometheus alert and scrape config
- Grafana dashboards and data source config
- Alertmanager routing config
- nginx edge/origin config
- release workflow evidence and image tags

## Backup Cadence

| Asset | Cadence | Storage | Retention | Owner |
|---|---|---|---|---|
| auth keys | before each release and daily | TBD | TBD | TBD |
| control-plane SQLite placement registry | hourly | TBD | TBD | TBD |
| catalog snapshot | after each import | TBD | TBD | TBD |
| monitoring config | before each release | TBD | TBD | TBD |
| deployment config | before each release | TBD | TBD | TBD |

## Restore Drill

Detailed operator procedure lives in `docs/runbooks/restore-drill.md`.

1. Restore auth keys into staging.
2. Restore control-plane placement state.
3. Restore catalog snapshot.
4. Restore monitoring config and dashboard JSON.
5. Run auth, catalog, tracker, and edge smoke tests.
6. Record elapsed time and failures.

Local SQLite backup/restore coverage:

```bash
npm run smoke:sqlite-backup-restore
```

This smoke backs up catalog and placement SQLite databases with checksums, restores them to fresh paths, and verifies catalog rows and placement mappings load without source URL leakage.

## Launch Gate

Production launch is blocked until a staging restore drill succeeds and a JSON restore evidence record is attached to `docs/launch-readiness.md`.

Validate restore evidence before sign-off:

```bash
npm run restore:evidence:validate -- path/to/restore-evidence.json
```

`npm run smoke:restore-evidence-validation` must remain in `npm run check` to protect required assets, checksums, complete post-restore checks, time ordering, redaction, and synthetic-fixture handling.

The synthetic fixture at `test-fixtures/restore/evidence-complete.synthetic.json` is local schema coverage only.
