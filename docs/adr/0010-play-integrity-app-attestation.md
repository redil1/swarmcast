# ADR 0010: Play Integrity App Attestation

## Status

Accepted and implemented. Production activation remains gated on Play Console and physical-device evidence.

## Context

The Android app API key is distributed inside the APK and cannot prove that `/token` requests come from the recognized Play build on an acceptable device. Rate limiting alone does not prevent scripted token and TURN-credential acquisition after key extraction.

## Decision

Use Play Integrity standard requests for viewer token issuance.

1. Auth issues a short-lived stateless challenge signed with `AUTH_ATTESTATION_CHALLENGE_SECRET`. During rotation, auth may verify the bounded `AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET`, but never issues new challenges with it.
2. Android hashes the complete challenge with SHA-256 and supplies the unpadded base64url digest as the standard request hash.
3. Android sends the encrypted integrity token and original challenge to `/token`.
4. Auth verifies challenge signature and expiry, sends the integrity token to Google's `decodeIntegrityToken` endpoint using a read-only service-account mount, and compares the decoded request hash.
5. Auth requires the configured package, approved Play signing-certificate digest, `PLAY_RECOGNIZED`, `LICENSED`, `MEETS_DEVICE_INTEGRITY`, and a fresh verdict before issuing JWT and TURN credentials.
6. Production environment and Android release validators reject disabled or incomplete attestation configuration.

## Consequences

- New production sessions depend on Play Integrity and Google API availability; existing JWT/TURN sessions continue until expiry.
- Development builds may explicitly disable attestation, but production configuration cannot.
- Challenge and verdict outcome counters are monitored; encrypted tokens, decoded device identifiers, service-account credentials, and challenge secrets are never logged or retained as evidence.
- Play Console linking, API quota, service-account authorization, Play signing digest, real-device verdicts, request binding, and replay rejection must be proved before launch.
