# Source Failure

## Meaning

One or more upstream catalog sources are unavailable, returning unexpected HTTP status codes, or rejecting lightweight playlist probes before ingest starts.

## First Checks

1. Run `npm run source:preflight` from the same network path the ingest hosts use.
2. Set `M3U_PATH` to the candidate catalog and set `SOURCE_ALLOWED_HOSTS` to the approved upstream host list.
3. Keep `SOURCE_ALLOW_PRIVATE_NETWORKS=0` unless a documented private upstream exception is approved.
4. Compare failures with provider status, account limits, and recent catalog changes.

## Immediate Actions

- Quarantine failed channels from the release catalog when a production rollout is pending.
- Use Delivery Fleet fallback for already-active channels while the source owner investigates.
- Avoid restart storms: do not repeatedly demand-start channels whose source preflight is failing.
- Do not paste upstream source URLs into tickets, chat, metrics, dashboards, or public logs.

## Validation

Use the deterministic local smoke `npm run smoke:catalog-source-preflight` before changing source validation or runbook logic:

```bash
npm run smoke:catalog-source-preflight
```

The smoke proves healthy sources pass, sources that reject `HEAD` can pass through ranged `GET` fallback, and failing sources are detected without exposing `sourceUrl` in result objects.

## Follow-Up

- Attach only channel IDs, channel names, HTTP status classes, and timestamps to the incident record.
- Re-run `npm run source:preflight` after the provider claims recovery.
- Add or update provider-specific allowlist entries only through the production configuration review.
