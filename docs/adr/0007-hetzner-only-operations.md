# ADR 0007: Hetzner-Only Operations

## Status

Accepted.

## Context

The product goal is fixed infrastructure cost without a third-party CDN or per-GB delivery bill.

## Decision

Run ingest nodes, tracker/control nodes, and Delivery Fleet edge nodes on rented Hetzner infrastructure. Autoscale edge nodes from measured residual demand and P2P offload ratio.

## Consequences

- The main cost function is box count, not traffic volume.
- `rho` is a first-class production metric.
- Cold-tail channels must be explicitly managed because owned fixed-capacity boxes are least efficient for sparse demand.
- Any future third-party fallback must be documented as a deliberate product and cost exception.
