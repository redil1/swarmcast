# Source URL Policy

The M3U catalog is operator-controlled, but source URLs still need startup validation before ffmpeg can fetch them.

## Runtime Controls

- `SOURCE_ALLOWED_HOSTS`: comma-separated host allowlist for production startup. Exact hosts and wildcard suffixes such as `*.source.example` are supported.
- `SOURCE_ALLOW_PRIVATE_NETWORKS`: defaults to `0`. Keep it disabled in production.

`SOURCE_ALLOWED_HOSTS` is required when production validation is enabled. Ingest and control-plane containers must refuse startup rather than accepting an unrestricted source catalog.

## Validation

When a source policy is passed to catalog import, every channel source URL must:

- use `http` or `https`
- omit URL credentials
- avoid loopback, link-local, carrier-grade NAT, and RFC1918 private networks unless `SOURCE_ALLOW_PRIVATE_NETWORKS=1`
- match `SOURCE_ALLOWED_HOSTS` when the allowlist is non-empty

Both ingest and control-plane startup use the same policy from shared config. Public catalog responses still strip `sourceUrl`.

## Local Gate

Run `npm run smoke:source-policy` to prove an allowed source imports while private and non-allowlisted sources are rejected.

Run `npm run source:preflight` with production `M3U_PATH` and `SOURCE_ALLOWED_HOSTS` before deploying a catalog. The preflight checks upstream playlist reachability and reports channel IDs/status classes without printing raw source URLs. `npm run smoke:catalog-source-preflight` proves the preflight detects an unavailable source and supports ranged `GET` fallback when an upstream rejects `HEAD`.

Before launch, attach a source allowlist evidence record and validate it:

```bash
npm run source:allowlist:evidence:validate -- path/to/source-allowlist-evidence.json
```

Synthetic shape checks can use:

```bash
npm run source:allowlist:evidence:validate -- --allow-synthetic test-fixtures/launch/source-allowlist-complete.synthetic.json
```

After preflight and allowlist approval, validate the signed operator catalog import evidence before promoting a snapshot:

```bash
npm run catalog:import:validate -- path/to/catalog-import-evidence.json
```

Synthetic shape checks can use `npm run catalog:import:validate -- --allow-synthetic test-fixtures/catalog/catalog-import-complete.synthetic.json`; local guard coverage remains `npm run smoke:catalog-import-validation`.
