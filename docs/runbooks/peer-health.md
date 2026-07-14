# Runbook: Peer Health

## Alerts

- `SwarmcastPeerHashFailures`
- `SwarmcastPeerDisconnectSpike`
- `SwarmcastPeerTimeoutSpike`

## Meaning

Android clients are reporting failed peer segment validation, local peer disconnects, or elevated peer request timeouts. This can indicate poisoned peer bytes, bad segment metadata, a risky Android rollout, WebRTC instability, or an RLNC decode issue if coded transfer is enabled.

## First Checks

1. Compare `swarmcast_tracker_peer_hash_failures_total`, `swarmcast_tracker_peer_disconnects_total`, and `swarmcast_tracker_peer_timeouts_total` with their rolling 5-minute metrics.
2. Check whether the spike is isolated to one channel, region, app version, Android device class, or network type.
3. Compare low-offload, tracker peer-drop, stall-rate, startup-latency, and low-buffer alerts.
4. Confirm whether `RLNC_ENABLED` changed recently and whether coded transfer is enabled for the affected cohort.
5. Inspect recent segment announcements for missing or changed SHA-256 metadata.

## Immediate Actions

- Set `EDGE_ONLY_MODE=1` for affected channels when peer quality is uncertain.
- Set `P2P_ENABLED=0` if hash failures continue, disconnects climb, or upload/privacy behavior is unsafe.
- Keep `RLNC_ENABLED=0` until coded-transfer validation is clean for the affected release.
- Add Delivery Fleet capacity before forcing a large cohort to edge-only playback.
- Pause or roll back the Android rollout if the spike follows an app release.

## Validation

Before re-enabling P2P, capture:

- Peer hash failures returned to zero for the affected cohort.
- Peer disconnect and timeout rates returned below alert thresholds.
- Delivery-Fleet-only playback succeeds on affected channels.
- Segment announcement hashes match the bytes served by origin and edge.
- Playback stall, startup-latency, and buffer metrics are back inside launch budgets.

## Safety Rules

- Do not ignore hash failures as normal network churn.
- Do not enable RLNC during an active peer-health incident.
- Do not paste JWTs, upstream source URLs, precise peer IPs, or user-identifying playback logs into the incident record.
- Record every P2P, edge-only, and rollout flag change.

## Follow-Up

- Attach the affected channel list, app versions, rollout timeline, and metric screenshots or exported samples.
- Add a staging drill that reproduces the failure mode with poisoned bytes, timeout-heavy peers, or disconnect-heavy peers.
- Review Android peer reputation thresholds if disconnects are correct but too noisy.
