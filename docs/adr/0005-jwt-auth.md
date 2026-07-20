# ADR 0005: JWT Auth For Media And Tracker Access

## Status

Accepted.

## Context

Origin, edge, and tracker endpoints must not become public restreaming infrastructure. The Android app needs short-lived credentials that nginx and tracker services can validate cheaply.

## Decision

Use ES256 JWTs with a JWKS endpoint. nginx validates media requests through an auth subrequest. The tracker verifies tokens at WebSocket upgrade.

## Consequences

- Media URLs include `?token=...`.
- Signing keys must be stored on persistent volumes and backed up.
- Key rotation policy is required before production launch.
- App API key gating remains a coarse abuse control; production token issuance additionally requires the request-bound Play Integrity flow in ADR 0010.
