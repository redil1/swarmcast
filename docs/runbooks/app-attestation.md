# App Attestation Failures

Alert: `SwarmcastAppAttestationFailures`

## Impact

Affected Android clients cannot obtain viewer JWTs or TURN credentials. Existing sessions continue until their credentials expire.

## Triage

1. Compare `swarmcast_auth_attestation_verify_ok_total` and `swarmcast_auth_attestation_verify_fail_total` rates by deployment revision.
2. Confirm the Play Integrity API is enabled and the Google Cloud project remains linked to `tv.swarmcast` in Play Console.
3. Confirm the auth service account can call `decodeIntegrityToken` and its credential file is mounted read-only at `AUTH_PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH`.
4. Compare the production app-signing digest with `AUTH_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS` using unpadded base64url encoding.
5. Confirm Android release properties use the linked `SWARMCAST_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER`.
6. Check Google Play Integrity quota, status, and verdict distribution without logging encrypted tokens or decoded device identifiers.

## Recovery

1. Restore the Cloud project link, API access, service-account credential, project number, or approved certificate digest.
2. Redeploy auth or Android only after the corrected configuration passes its production validator.
3. Verify a Play-installed staging build receives `PLAY_RECOGNIZED`, `LICENSED`, and `MEETS_DEVICE_INTEGRITY`, the request hash matches, a replay is rejected, and `/token` succeeds.
4. Keep `AUTH_PLAY_INTEGRITY_ENABLED=1`; disabling attestation is not an accepted production recovery action.

## Challenge Secret Rotation

1. Set the existing challenge secret as `AUTH_ATTESTATION_PREVIOUS_CHALLENGE_SECRET` and deploy it together with the new `AUTH_ATTESTATION_CHALLENGE_SECRET`.
2. Confirm challenges issued before and after the deployment both complete token issuance.
3. Wait at least `AUTH_ATTESTATION_CHALLENGE_TTL_SECONDS` after every auth instance serves the new secret.
4. Remove the previous secret and redeploy. Never keep more than one previous secret or retain it beyond the overlap window.

## Evidence

- Store only sanitized verdict categories, configuration checks, timestamps, and aggregate metrics.
- Never store or attach integrity tokens, service-account JSON, access tokens, challenge secrets, or raw device identifiers.
- Validate the final record with `npm run android:attestation:evidence:validate -- path/to/android-attestation-evidence.json`.
