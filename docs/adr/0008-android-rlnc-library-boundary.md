# ADR 0008: Android RLNC Library Boundary

## Status

Implementation selected and integrated. Production approval remains gated on the evidence below.

## Context

The repository contains a tested JavaScript GF(2^8)/RLNC harness for deterministic server and headless swarm validation. That harness proves protocol behavior, poisoning resistance, rank exchange, recoding, and fallback logic, but it is not automatically approved for the shipping Android client.

Android playback has tighter constraints:

- predictable CPU use during Media3 playback
- bounded heap allocation for segment decode buffers
- battery impact under sustained live viewing
- license compatibility for app-store distribution
- native crash and ABI risk if a native codec is selected

## Decision

The Android app keeps RLNC behind the `NetworkCodingDecoder` and `NetworkCodingEncoder` boundaries. The selected finite-field implementation is Backblaze JavaReedSolomon `Galois`, pinned to commit `d3c481dc69471e0c47ff6f67f33d53bde941675e` through a group-restricted JitPack repository.

Selection reasons:

- its GF(2^8) field uses the same `0x11d` polynomial as the server/headless codec
- it is pure Java, so it adds no Android native ABI or JNI crash surface
- its `Galois` API provides the finite-field multiplication and division used by Android row reduction and recoding
- the upstream project is MIT licensed and the dependency is pinned to an immutable commit
- the Android codec rejects malformed and dependent packets, tracks rank, reconstructs non-aligned segments, and recodes partial rank in local tests

The RLNC row-reduction, rank state, segment splitting, and recoding orchestration live in `RlncCodec.kt`; finite-field arithmetic is not reimplemented in the app. Decoded bytes still enter `SegmentStore` only through SHA-256 verification in `SegmentScheduler`.

The shipping app must not ship hand-rolled finite-field math; changing the selected field dependency requires a new dependency, license, compatibility, and performance review.

This selection does not approve production enablement. `SWARMCAST_RLNC_ENABLED` remains false in the release fixture and release validator until the real decision evidence passes.

## Required Android Decoder Contract

The eventual decoder must expose:

- `accept(coeffs, data)`: reject dependent packets without increasing rank
- `rank`: current independent rank for tracker/peer announcements
- `complete`: true only when reconstruction is possible
- `decode()`: returns bytes that are verified against tracker segment SHA-256 before storage
- `recode()`: returns a fresh coded packet when the local rank is useful to another peer

## Dependency Provenance

- project: `Backblaze/JavaReedSolomon`
- revision: `d3c481dc69471e0c47ff6f67f33d53bde941675e`
- license: MIT
- build coordinate: `com.github.Backblaze:JavaReedSolomon:d3c481dc69471e0c47ff6f67f33d53bde941675e`
- repository scope: JitPack is restricted to `com.github.Backblaze`
- Android ABI risk: low, because the selected dependency is Java bytecode only
- production status: blocked pending legal/security/performance reviewers, fuzz evidence, and real-device decode/battery evidence

## Release Gate

Before production release:

- benchmark decode CPU and allocation at the target segment size and `k`
- run malformed coefficient/data fuzz tests
- verify bad decodes never enter `SegmentStore`
- document license, ABI, and maintenance owner
- run at least one device swarm test proving decoded bytes match tracker SHA-256
- validate the final decision record:

```bash
npm run android:rlnc:decision:validate -- path/to/android-rlnc-decision.json
```

Synthetic fixtures must be validated explicitly:

```bash
npm run android:rlnc:decision:validate -- --allow-synthetic test-fixtures/android/rlnc-decision-complete.synthetic.json
```

Local guard coverage remains:

```bash
npm run smoke:android-rlnc-decision-validation
```
