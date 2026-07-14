# Retention Job Failures

Alerts: `SwarmcastRetentionJobFailures`, `SwarmcastRetentionJobStale`

## Meaning

Retention deletion or aggregation has failed or has not completed recently. Sensitive raw operational data may be retained longer than policy allows.

## First Checks

1. Check the retention job logs for the failing class and action.
2. Confirm the policy file version matches `config/data-retention.json`.
3. Check datastore connectivity and permissions for peer stats, IP-related logs, auth logs, playback errors, and metrics.
4. Confirm the job is emitting `swarmcast_retention_last_success_timestamp_seconds`.
5. Run `npm run retention:job -- --prometheus` in dry-run mode with the production `RETENTION_STORE_MODULE` to confirm the current failure count and action plan.
6. When using the built-in HTTP adapter, confirm `RETENTION_STORE_HTTP_BASE_URL`, `RETENTION_STORE_HTTP_TOKEN`, and `RETENTION_STORE_HTTP_TIMEOUT_MS` are set correctly and run `npm run smoke:retention-http-store` against a staging-compatible endpoint contract.

## Immediate Actions

- Pause new retention job releases if failures started after deployment.
- Re-run in dry-run mode before any manual deletion; destructive execution requires `RETENTION_EXECUTE=1` and `--execute`.
- If raw data is past retention and deletion is blocked, create an incident hold with owner, reason, scope, and expiry.

## Follow-Up

- Add a regression test for the failed retention class/action.
- Record any retention exception in launch readiness with owner and expiry.
