# ADR 0001: Zero-CDN Delivery Fleet

## Status

Accepted.

## Context

The target system must avoid third-party CDN per-GB costs. The blueprint requires all fallback delivery to use rented Hetzner infrastructure.

## Decision

Use a self-hosted Delivery Fleet of nginx edge nodes with tmpfs caching and cache locking. Clients use HTTPS segment URLs from this fleet whenever P2P cannot satisfy a segment before its deadline.

## Consequences

- Cost is fixed by box count rather than traffic volume.
- Edge capacity must be autoscaled from measured offload ratio.
- No production code may depend on third-party CDN hostnames.
- The long tail must be explicitly managed because low-viewer channels do not form efficient swarms.
