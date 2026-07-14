# Security Review Checklist

## Authentication And Tokens

- JWT audience, issuer, expiry, and key rotation are verified.
- Auth token endpoint is rate-limited by client IP.
- JWKS endpoint exposes only public key material.
- App API key extraction risk is documented and mitigated with rate limits and anomaly detection.

## Internal APIs

- Internal routes require `x-internal-token`.
- Internal token is never sent to Android clients.
- Control-plane placement routes reject missing or invalid internal tokens.
- Ingest segment announce route rejects missing or invalid internal tokens.

## Source URL Protection

- Public catalog responses never include upstream source URLs.
- Logs and metrics never emit upstream source URLs.
- Android app receives only edge/origin templates required for playback and seeding policy.
- Catalog source URL imports reject private-network targets and can enforce `SOURCE_ALLOWED_HOSTS` before ffmpeg starts.
- Production ingest and control-plane startup refuse an empty `SOURCE_ALLOWED_HOSTS` allowlist.

## Tracker Abuse

- WebSocket upgrade validates viewer JWT.
- Message payload size is capped.
- Per-peer token bucket rate limiting disconnects abusive clients.
- Signal relay never parses or stores SDP beyond opaque forwarding.

## P2P Poisoning

- Segment bytes are verified against tracker SHA-256 before storage.
- Decoded RLNC output must be verified before storage.
- Repeat hash mismatches reduce reputation and disconnect offenders.
- Bad peer reports must not allow unauthenticated peers to frame honest peers.

## Release Gate

Production launch is blocked until P0/P1 findings are fixed or explicitly waived in `docs/launch-readiness.md`.

Attach a machine-readable review record to the launch evidence and validate it with:

```bash
npm run security:review:validate -- path/to/security-review.json
```

The validator requires all review scopes in this checklist to pass and blocks unresolved P0/P1 findings. The synthetic fixture at `test-fixtures/security/security-review-complete.synthetic.json` is local schema coverage only.

`npm run smoke:security-review-validation` must stay in `npm run check` to protect required scopes, P0/P1 closure, waiver metadata, evidence redaction, and synthetic-fixture handling.
