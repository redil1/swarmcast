# Catalog Import Runbook

Production catalog imports must produce a sanitized SQLite-backed catalog database, a sanitized snapshot, and a signed import evidence record before `CATALOG_DB_PATH` or `CATALOG_SNAPSHOT_PATH` is promoted.

## Import Gate

1. Run `npm run source:preflight` with the production `M3U_PATH` and `SOURCE_ALLOWED_HOSTS`.
2. Validate source host approval with `npm run source:allowlist:evidence:validate -- path/to/source-allowlist-evidence.json`.
3. Import the catalog through the control-plane startup path so the shared source URL policy is applied.
4. Write the sanitized SQLite catalog database and snapshot to the release artifact store; verify neither artifact contains `sourceUrl` fields.
5. Sign the snapshot or import manifest with the approved operator key.
6. Smoke the public catalog API against the imported snapshot.
7. Keep the previous signed snapshot available for rollback.

Validate the import evidence before rollout:

```bash
npm run catalog:import:validate -- path/to/catalog-import-evidence.json
```

Synthetic shape checks can use:

```bash
npm run catalog:import:validate -- --allow-synthetic test-fixtures/catalog/catalog-import-complete.synthetic.json
```

Local guard coverage remains:

```bash
npm run smoke:catalog-import-validation
```

Evidence references must point to artifacts or tickets. Do not include upstream playlist URLs, bearer tokens, raw signatures, or source URLs in the record.
