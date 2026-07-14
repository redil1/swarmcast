# App Incident

## Meaning

The Android app release is causing elevated crashes, startup failures, playback stalls, tracker disconnects, unexpected upload behavior, or privacy/store-review risk.

## First Checks

1. Check crash-free sessions, affected app version, `swarmcast_tracker_stall_rate_5m`, `swarmcast_tracker_startup_latency_ms_avg_5m`, and `swarmcast_tracker_buffer_ms_min_5m`.
2. Compare tracker peer drops, auth verification failures, edge cache hit ratio, and low-offload alerts.
3. Confirm whether the incident affects Delivery-Fleet-only playback, P2P playback, or both.
4. Check whether a feature flag change or Android rollout started shortly before the incident.
5. Review support reports for network class, device model, Android version, and selected channel.

## Immediate Actions

- Pause the Android rollout in the distribution channel.
- Set `EDGE_ONLY_MODE=1` when P2P instability is suspected.
- Set `P2P_ENABLED=0` if any upload, privacy, or peer-transfer behavior is unsafe.
- Keep `RLNC_ENABLED=0` unless the Android RLNC launch gate is complete and the incident is unrelated to coded transfer.
- Add Delivery Fleet capacity for affected regions before forcing edge-only playback at scale.
- Roll back to the previous stable Android release if crashes or playback failures remain above canary thresholds.

## Validation

Before closing the incident, capture:

- Android crash-free sessions returned to target.
- `swarmcast_tracker_stall_rate_5m`, `swarmcast_tracker_startup_latency_ms_avg_5m`, and `swarmcast_tracker_buffer_ms_min_5m` returned below launch thresholds.
- Delivery-Fleet-only playback succeeds on affected device/network classes.
- Tracker peer drops and auth verification failures returned below alert thresholds.
- Edge cache `MISS` then `HIT` still works for authenticated segment fetches.
- P2P toggle behavior is verified when P2P is re-enabled.

## Safety Rules

- Do not enable `RLNC_ENABLED` during an active app incident.
- Do not remove the P2P disclosure or hide the P2P toggle during mitigation.
- Do not paste JWTs, upstream source URLs, precise peer IPs, or user-identifying playback logs into incident channels.
- Record every flag change in the incident record and release notes.

## Follow-Up

- Attach the rollout version, rollback version, flag timeline, affected device matrix, and smoke evidence.
- Add a regression test or staging device drill for the failure mode.
- Update store review notes or support FAQ if the incident affects P2P disclosure, upload behavior, or privacy expectations.
