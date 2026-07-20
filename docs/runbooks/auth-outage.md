# Auth Outage

## Meaning

The auth service is unavailable, cannot issue viewer JWTs, cannot publish JWKS, or cannot verify tokens for nginx, tracker, and edge checks.

## First Checks

1. Check `/health` on each auth instance from the service network and edge network.
2. Check `/jwks` returns the expected current `kid` and no private key fields.
3. Check `/attestation/challenge` with the production app key from a controlled operator host.
4. Check `/token` with a fresh challenge and a real Play Integrity token from the approved Android release.
5. Check `/verify` with a newly issued token.
6. Compare auth attestation failures, `verify` failures, token issuance rate, process restarts, and host disk state.

## Immediate Actions

- Keep existing viewer tokens valid by preserving `AUTH_KEY_PATH`, `AUTH_KEY_ID`, `AUTH_JWT_AUDIENCE`, and `AUTH_JWT_ISSUER`.
- Roll back the auth image or configuration if outage started after a deployment.
- If the signing key file disappeared or changed unexpectedly, restore it from the approved backup before restarting.
- Do not rotate signing keys during an availability outage unless key compromise is suspected.
- If key compromise is suspected, follow `docs/runbooks/auth-key-rotation.md` and preserve overlap evidence.
- If challenge or Play Integrity verification fails while auth remains healthy, follow `docs/runbooks/app-attestation.md`; do not disable production attestation.

## Service Impact

- New viewers cannot obtain tokens while `/token` is down.
- Origin, edge, and tracker auth checks fail if `/verify` or `/jwks` are unavailable or misconfigured.
- Already-buffered playback can continue through cached media, but new playlist/segment authorization may fail.
- Delivery Fleet fallback does not bypass auth; it depends on the same viewer JWT contract.

## Recovery Validation

Capture these checks before closing the incident:

```bash
curl -fsS "$AUTH_BASE/health"
curl -fsS "$AUTH_BASE/jwks"
```

- One successful `/token` response with the expected `expiresIn`.
- One successful `/verify` response with HTTP 204 for a newly issued token.
- Tracker WebSocket smoke or staging join evidence after auth recovery.
- Auth metrics showing token issuance and verification successes have resumed.

## Follow-Up

- Attach deployment diff, image tag, config values excluding secrets, and key backup/restore evidence.
- Confirm Alertmanager routed the auth alert to the expected on-call receiver.
- Add a staging outage drill if the failure mode was not covered by existing smoke tests.
