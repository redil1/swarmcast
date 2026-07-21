# Android Physical Device Lab

This runbook collects the client-side half of Android P2P launch evidence. The output is a raw, sanitized measurement record. It is not launch-valid by itself: server-side tracker counters, edge and origin access-log egress, owned TURN egress, reviewer identities, and the required evidence markers must still be reconciled into the final Android P2P evidence record.

## Required Matrix

- At least four distinct physical Android devices.
- At least two devices on distinct WiFi failure domains.
- At least two devices on distinct cellular carriers with WiFi disabled.
- The release installed from a Google Play test or production track.
- Every device playing the same authorized channel for at least 30 minutes.
- Every device unplugged for the measured interval.
- Android Debug Bridge access from one isolated lab controller.

Emulators, duplicate devices reached through multiple ADB aliases, sideloaded builds, synthetic mode, incomplete ICE outcomes, unknown selected candidates, cellular payload upload, direct offload below 90%, and failed P2P-to-edge fallback all fail closed.

## Security Boundary

The app exposes diagnostics through `DeviceLabControlReceiver`, which requires the signature-level `android.permission.DUMP` permission. A normal installed application cannot call it; the ADB shell can. The payload contains only monotonic timestamps, channel ID, network class and policy, battery/playback state, peer-link counts, cumulative delivery/upload counters, peer-health counters, and cumulative ICE outcomes.

The payload must never contain auth tokens, API keys, source or playback URLs, tracker peer IDs, ADB serials, carrier names, SSIDs, BSSIDs, or stable platform device IDs. The runner derives an opaque device fingerprint with an operator-supplied HMAC salt and does not persist the source serial.

Use a fresh random salt for each evidence campaign and keep it outside the repository:

```bash
export SWARMCAST_DEVICE_FINGERPRINT_SALT="$(openssl rand -hex 32)"
```

## Manifest

Start from `test-fixtures/android/device-lab-manifest.complete.synthetic.json`, remove `synthetic`, use a unique run ID, and set the real release commit, version, package, and channel. Physical runs require `durationSeconds >= 1800`, `sampleIntervalSeconds <= 30`, and at least 15 seconds for both policy settlement and edge fallback.

`releaseApkSha256` is the SHA-256 of the Play-delivered installed `base.apk` approved for the campaign. It is not the hash of the source AAB, a locally built universal APK, or an individual configuration split. Capture the approved base APK once from a clean Play installation, record its hash through the release evidence process, and require the same hash on every test device. The runner reads the installed base APK from each device and compares it before measurement.

Each manifest device names an environment variable containing its ADB serial. Do not put serials in the manifest:

```bash
export SWARMCAST_DEVICE_WIFI_A_SERIAL="..."
export SWARMCAST_DEVICE_WIFI_B_SERIAL="..."
export SWARMCAST_DEVICE_CELL_A_SERIAL="..."
export SWARMCAST_DEVICE_CELL_B_SERIAL="..."
```

The WiFi and carrier IDs in the manifest are opaque campaign labels such as `wifi-lab-a` and `carrier-lab-b`; do not use real SSIDs or carrier account identifiers.

## Execution

1. Install the approved release from Google Play on every device.
2. Put each device on its declared network and disable automatic network switching, VPNs, and tethering.
3. Start the same channel on every device and wait until playback is stable.
4. Confirm all devices are unplugged and authorized in ADB.
5. Run the bounded collector:

```bash
npm run android:device-lab -- \
  --acknowledge-physical-device-test \
  --manifest path/to/device-lab-manifest.json \
  --output path/to/android-device-lab-raw.json
```

The runner verifies the device and installation boundary, records the original P2P setting, forces a clean P2P-off baseline, enables P2P for the bounded soak, disables it again, proves edge fallback, and restores the original setting even when collection fails. The raw output is written with mode `0600`.

Synthetic mode is only for deterministic orchestration regression tests and must be explicit:

```bash
npm run android:device-lab -- \
  --allow-synthetic \
  --acknowledge-physical-device-test \
  --manifest test-fixtures/android/device-lab-manifest.complete.synthetic.json \
  --output /tmp/android-device-lab.synthetic.json
```

Synthetic output cannot satisfy a launch gate.

## Evidence Reconciliation

For the exact measurement window and channel:

1. Export tracker direct-P2P, relay-download, and peer-upload counters.
2. Export authenticated edge access-log egress and origin-bootstrap egress.
3. Export owned TURN application payload attribution and provider/host egress.
4. Reconcile each source within the Android P2P evidence validator tolerance.
5. Verify every cellular device has exactly zero measured upload and every WiFi failure domain contributed useful upload.
6. Verify ICE attempts equal successes plus failures for every device, successful candidate classes reconcile, and unknown candidates are zero.
7. Verify direct `rho = direct / (direct + edge + origin-bootstrap + relay)` is at least `0.90`.
8. Add the required operations, performance, and security reviews and retain evidence under the approved access and retention policy.

Validate the assembled non-synthetic record without `--allow-synthetic`:

```bash
npm run android:p2p:evidence:validate -- path/to/android-p2p-evidence.json
```

The repository control path is covered by `npm run smoke:android-device-lab` and `npm run smoke:android-p2p-evidence-validation`.
