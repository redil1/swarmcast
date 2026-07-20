# SwarmCast Android

This is the initial Android scaffold for the SwarmCast client.

Current status:

- Gradle project files are present.
- Gradle wrapper is pinned to Gradle 8.9.
- CI is configured to install Android SDK platform 35/build-tools 35.0.0, run debug plus release assembly through the wrapper, compute APK checksum sidecars, and upload `swarmcast-android-debug-apk` plus `swarmcast-android-release-unsigned-apk` artifacts.
- Local debug and release APK assembly passed on 2026-07-14 with JDK 17, Android SDK platform 35/build-tools 35.0.0, and the Gradle 8.9 wrapper.
- RLNC-enabled debug packages cold-launch successfully on Android 13 and Android 16 emulators; these results are regression evidence only and do not replace physical-device launch evidence.
- Manifest permissions are present.
- Catalog search cache uses an app-private SQLite database with indexed channel name/group/tvg-id columns and a 20K row cap.
- Catalog and auth API calls share a 32 MB OkHttp cache so catalog ETag/cache-control responses can be reused or revalidated by the client.
- Core P2P wire and verified segment store files are scaffolded.
- Media3 HLS playback now routes numbered media segment requests through the scheduler-backed data source while playlists and unrecognized assets stay on authenticated HTTP.
- Android peer reputation now penalizes timeouts and hash mismatches, disconnecting a peer after two poisoned segment failures.
- Android tracker stats now include peer-upload bytes served through whole-segment and coded-packet DataChannel sends.
- Auth responses now provide owned STUN and short-lived TURN REST credentials; Android refreshes them before expiry and applies them before creating new WebRTC peer connections.
- ICE telemetry reports attempts, outcomes, selected candidate type, and network class so real carrier tests can measure direct versus relayed connectivity.
- Android stat flushes now report peer timeout, hash-failure, and disconnect deltas to the tracker for operational visibility.
- Peer link cleanup now closes replaced links, completes pending peer requests, and disposes stale WebRTC objects when links stop.
- Network policy is scaffolded for WiFi, metered network, and battery checks.

Not yet verified in this workspace:

- Real-device Media3 playback, tracker connectivity, WebRTC peer links, and RLNC Android integration remain open backlog work.
- Protected `main` CI run `29785361703` passed unit tests, debug/release assembly, portable SHA-256 sidecars, and both artifact uploads; the non-synthetic evidence record is `evidence/android/ci-build-29785361703.json`.

Expected local verification:

```bash
cd android
./gradlew --no-daemon testDebugUnitTest assembleDebug assembleRelease
```

With one ready device or emulator attached, a repeatable install/cold-launch smoke can record machine-readable evidence and an optional screenshot. Emulators require an explicit opt-in and are always marked as ineligible for launch-gate closure:

```bash
npm run android:runtime:smoke -- \
  --apk android/app/build/outputs/apk/debug/app-debug.apk \
  --expect-rlnc true \
  --allow-emulator \
  --output evidence/android/emulator-runtime.json \
  --screenshot evidence/android/emulator-runtime.png
```

Android release Gradle properties must be validated before release promotion:

```bash
npm run android:release-config:validate -- path/to/release.properties
```

Synthetic fixture coverage:

```bash
npm run android:release-config:validate -- test-fixtures/android/release-config.complete.properties
npm run smoke:android-release-config-validation
```

Remote CI build evidence must be attached to release readiness and validated with:

```bash
npm run android:ci:evidence:validate -- path/to/android-ci-evidence.json
```

The current real record validates with:

```bash
npm run android:ci:evidence:validate -- evidence/android/ci-build-29785361703.json
```

Expected CI artifacts:

- `swarmcast-android-debug-apk`: `android/app/build/outputs/apk/debug/app-debug.apk` and `android/app/build/outputs/apk/debug/app-debug.apk.sha256`
- `swarmcast-android-release-unsigned-apk`: `android/app/build/outputs/apk/release/app-release-unsigned.apk` and `android/app/build/outputs/apk/release/app-release-unsigned.apk.sha256`

Synthetic fixtures must be validated explicitly:

```bash
npm run android:ci:evidence:validate -- --allow-synthetic test-fixtures/android/ci-build-complete.synthetic.json
```

Local guard coverage remains:

```bash
npm run smoke:android-ci-evidence-validation
```

Delivery-Fleet-only device playback evidence must include 30-minute WiFi and cellular soaks, edge cache hit evidence, and crash-free playback, then be validated with:

```bash
npm run android:playback:evidence:validate -- path/to/android-playback-evidence.json
```

Synthetic fixtures must be validated explicitly:

```bash
npm run android:playback:evidence:validate -- --allow-synthetic test-fixtures/android/playback-delivery-fleet-complete.synthetic.json
```

Local guard coverage remains:

```bash
npm run smoke:android-playback-evidence-validation
```

Android P2P transfer evidence must include WebRTC DataChannel, tracker-signaling relay, verified segment hashes, edge fallback, P2P-disable closure, cellular receive-only/no-upload proof, and reconciled ICE attempts/outcomes/selected candidate types for WiFi and cellular, then be validated with:

```bash
npm run android:p2p:evidence:validate -- path/to/android-p2p-evidence.json
```

Synthetic fixtures must be validated explicitly:

```bash
npm run android:p2p:evidence:validate -- --allow-synthetic test-fixtures/android/p2p-transfer-complete.synthetic.json
```

Local guard coverage remains:

```bash
npm run smoke:android-p2p-evidence-validation
```
