# ADR 0003: RLNC Production Path

## Status

Accepted for production design, pending library selection.

## Context

Classic chunk exchange leaks fallback traffic because peers often need a specific rare chunk near playback deadlines.

## Decision

The production P2P path uses random linear network coding or a vetted equivalent fountain/network-coding library. Whole-segment P2P is allowed only as an intermediate milestone.

## Consequences

- Shipping clients need coded packet exchange, rank tracking, recoding, and hash verification.
- Library licensing and Android performance must be reviewed before release.
- Origin seeding becomes deficit-only and bounded by coded packet supply rather than viewer count.
