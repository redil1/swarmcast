# Runbook: Auth Key Rotation

## Purpose

Rotate the ES256 JWT signing key without invalidating active viewer tokens during the overlap window.

## Preconditions

- Current `AUTH_KEY_PATH` is backed up.
- New private key is generated on the auth host or secret manager, never committed.
- Previous public key is exported to a JWKS file containing only public fields.
- Tracker instances can refresh `AUTH_JWKS_URL`.
- Auth and tracker are configured with the same `AUTH_JWT_AUDIENCE` and `AUTH_JWT_ISSUER`.

## Rotation Steps

1. Export the current public key to `AUTH_PREVIOUS_JWKS_PATH` as a JWKS object: `{"keys":[...]}`.
2. Generate a new ES256 private key at the new `AUTH_KEY_PATH`.
3. Set `AUTH_KEY_ID` to a new safe `kid`, for example `swarmcast-2026-07`.
4. Deploy auth with the new key path, new key ID, and previous JWKS path.
5. Confirm `AUTH_TOKEN_TTL_SECONDS` matches the approved token lifetime.
6. Confirm `/jwks` publishes both the new key and the previous public key, with no private `d` field.
7. Issue a new token and confirm its protected header uses the new `kid`, with the expected issuer, audience, and TTL claims.
8. Verify an old token still passes `/verify` during the overlap window.
9. Wait longer than the maximum token lifetime and tracker JWKS cache window.
10. Remove `AUTH_PREVIOUS_JWKS_PATH` and redeploy auth so only the current public key remains.

## Rollback

- If new-token verification fails, restore the previous `AUTH_KEY_PATH` and `AUTH_KEY_ID`.
- Keep the previous public JWKS file in place until all tokens signed during the failed rollout have expired.
- Do not delete the backed-up private key until the rollback window is closed.

## Evidence

- `/jwks` response before and after rotation.
- One old-token `/verify` success during overlap.
- One new-token `/verify` success after rotation.
- New-token `iss`, `aud`, and `exp - iat` values.
- Auth metrics showing no spike in `swarmcast_auth_verify_fail_total`.
