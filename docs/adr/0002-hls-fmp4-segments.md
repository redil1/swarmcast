# ADR 0002: HLS fMP4 Segments

## Status

Accepted.

## Context

The P2P exchange unit must be simple to hash, cache, and recover through fallback delivery.

## Decision

Use HLS with fMP4/CMAF segments, two-second target duration, and a sliding playlist window. The first implementation copy-remuxes source streams without transcoding.

## Consequences

- Whole segments are easy to verify with SHA-256.
- ExoPlayer can consume the output through a custom DataSource.
- Low-latency HLS partial segments are deferred because they fragment the P2P exchange unit.
