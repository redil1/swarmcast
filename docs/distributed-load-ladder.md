# Distributed WebRTC Load Ladder

The distributed load ladder is a staging release gate. It creates sustained WebRTC traffic and must run only against an approved staging or production deployment with an explicit load window.

The repository probe is an evidence boundary, not a synthetic load generator. It launches an exact-hash WebRTC driver on each independent load host, passes the assigned peer range over standard input, validates the driver's measured output, removes target URLs and credentials, and writes a mode `0600` raw probe bundle. The final ladder validator reads and hashes those bundles before accepting a stage.

## Required Host Shape

- Every distributed stage uses at least two load-generator hosts in separate providers and failure domains.
- The 100K stage uses at least five generators.
- Generators have distinct HMAC-derived network-egress fingerprints. Do not record public IP addresses.
- Peer ranges are contiguous, non-overlapping, and cover the exact stage population.
- At least 10% of stage endpoints complete a transfer with a peer on another generator.
- All generators use the same immutable driver SHA-256 and image digest.
- Generator starts differ by no more than five seconds.
- The 200-peer stage runs for at least 300 seconds; 2K, 1K, and 10K stages run for at least 600 seconds; the 100K stage runs for at least 900 seconds.

## Driver Contract

The driver is an executable supplied with `--driver`. The probe verifies it against `driver.sha256` before execution and passes one JSON request on standard input:

```json
{
  "schemaVersion": 1,
  "runId": "run-10k-20260721",
  "stageId": "1-channel-10000-cell-peers",
  "target": {
    "id": "staging-eu",
    "trackerUrl": "wss://tracker.staging.example/ws",
    "channelId": "load-channel"
  },
  "assignment": {
    "peerStart": 0,
    "peerCount": 5000
  },
  "generatorId": "load-a",
  "durationSeconds": 600,
  "startAt": "2026-07-21T20:00:00.000Z"
}
```

The driver must obtain one short-lived viewer authorization per simulated viewer, join the real tracker, exchange offer/answer/ICE through tracker signaling, transfer SHA-256-verified payloads over WebRTC DataChannels, and report only the supported measurement fields. It must identify remote generator IDs for cross-host connections and expose selected ICE types with zero unknown candidates.

Driver secrets are injected only through environment variables prefixed `SWARMCAST_LOAD_DRIVER_`. The probe passes a minimal environment and redacts secret-like prefixed values from driver failure output. Never place API keys, viewer tokens, TURN credentials, URLs with query parameters, public IP addresses, or source URLs in the manifest, command line, stdout, stderr, or evidence files.

## Probe Manifest

Create one manifest per generator and stage. Each generator receives a distinct `probeId`, `generator.id`, failure domain, egress fingerprint, and peer range. All manifests for one stage share the run ID, target ID, commit, release version, synchronized start time, duration, driver hash, and driver image digest.

```json
{
  "schemaVersion": 1,
  "synthetic": false,
  "probeId": "run-10k-load-a",
  "runId": "run-10k-20260721",
  "stageId": "1-channel-10000-cell-peers",
  "environment": "staging",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "releaseVersion": "v0.1.0-rc7",
  "startAt": "2026-07-21T20:00:00.000Z",
  "durationSeconds": 600,
  "target": {
    "id": "staging-eu",
    "trackerUrl": "wss://tracker.staging.example/ws",
    "channelId": "load-channel"
  },
  "generator": {
    "id": "load-a",
    "provider": "provider-a",
    "region": "eu-west",
    "failureDomain": "provider-a-eu",
    "networkEgressFingerprintSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "assignment": {
    "peerStart": 0,
    "peerCount": 5000
  },
  "driver": {
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "imageDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }
}
```

## Execute A Stage

Synchronize host clocks before the run. Choose a start time between 15 seconds and 30 minutes in the future, then launch every generator with its own manifest:

```bash
npm run load:ladder:probe -- \
  --acknowledge-staging-load \
  --manifest evidence/load/run-10k-load-a.manifest.json \
  --driver /opt/swarmcast/bin/webrtc-load-driver \
  --output evidence/load/run-10k-load-a.raw.json
```

The command fails closed for private or non-TLS tracker targets, stale schedules, a driver hash mismatch, unsupported driver output, incomplete joins, failed connections or transfers, unknown ICE candidates, missing cross-generator traffic, byte-accounting drift, oversized output, and probe timeout. Synthetic test mode requires both a synthetic manifest and `--allow-synthetic`; it is never launch evidence.

Repeat the command simultaneously on every generator. Preserve each raw file with mode `0600` and compute its SHA-256. Place raw files beside the final ladder record and list each relative path and hash in `probeArtifacts`. Each distributed stage lists the exact `generatorProbeIds` it consumes.

## Final Validation

Join probe totals with tracker metrics, edge/origin/relay access-log exports, cache metrics, alert state, cell fanout, cell-failure recovery, and the physical-device record. The final validator independently checks raw artifact hashes, permissions, release bindings, time windows, provider and failure-domain diversity, egress identity, exact peer coverage, cross-host transfer coverage, selected ICE classification, tracker-cell observations, upload/delivery totals, and offload reconciliation.

```bash
npm run load:ladder:validate -- evidence/load/load-ladder-final.json
```

Local contract coverage is intentionally synthetic:

```bash
npm run smoke:load-ladder-probe
npm run smoke:load-ladder-evidence-validation
```

Passing local coverage proves collection and rejection behavior only. The public launch gate remains closed until the real multi-host raw artifacts and server/provider records pass validation without `--allow-synthetic`.
