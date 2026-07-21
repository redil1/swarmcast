# ADR 0002: HLS fMP4 Segments

## Status

Accepted.

## Context

The P2P exchange unit must be simple to hash, cache, and recover through fallback delivery.

## Decision

Use HLS with fMP4/CMAF segments, two-second target duration, and a sliding playlist window. The first implementation copy-remuxes source streams without transcoding.

Before a media segment is hashed or announced, ingest parses its ISO-BMFF box boundaries and requires one ordered `moof`/`mdat` pair, non-empty media data, one `mfhd`, and valid per-track `traf` metadata. The committed regression sample contains one H.264 video track and one AAC audio track; its manifest binds the ffmpeg provenance, paths, sizes, and SHA-256 hashes. Run `npm run media:fixtures:validate` and `npm run smoke:fmp4-fixture-validation` to verify it.

## Consequences

- Whole segments are easy to verify with SHA-256.
- ExoPlayer can consume the output through a custom DataSource.
- Low-latency HLS partial segments are deferred because they fragment the P2P exchange unit.
- Truncated or structurally malformed fragments fail before tracker announcement and remain available for operational investigation.
