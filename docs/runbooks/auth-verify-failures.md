# Auth Verification Failures

Alert: `SwarmcastAuthVerifyFailures`

## Meaning

Token verification failures are elevated. This can be expired clients, scraping, clock issues, or a bad app/token rollout.

If `/health`, `/jwks`, `/token`, or `/verify` are unavailable instead of merely returning elevated failures, follow `docs/runbooks/auth-outage.md`.

## First Checks

1. Compare failures with token issuance rate.
2. Check whether failures are concentrated by IP range or app version.
3. Verify auth signing key persisted correctly after deployment.
4. Check system clock drift on auth, tracker, origin, and edge nodes.

## Immediate Actions

- Roll back recent auth or client releases if failures started after deployment.
- Rate-limit abusive IPs at the edge if scraping is obvious.
- Do not rotate signing keys during an active incident unless key compromise is suspected.
- If key compromise is suspected, follow `docs/runbooks/auth-key-rotation.md` and preserve the overlap evidence.

## Follow-Up

- Route Play Integrity verdict failures through `docs/runbooks/app-attestation.md`.
- Attach `/jwks` and `/verify` evidence from the key rotation runbook after planned rotations.
