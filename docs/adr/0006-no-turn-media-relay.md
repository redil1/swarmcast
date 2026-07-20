# ADR 0006: No TURN Media Relay

## Status

Superseded by ADR 0009.

## Context

TURN would improve peer connectivity for restrictive NATs, but relayed media would flow through servers and consume the same bandwidth the P2P layer is designed to avoid.

## Decision

Do not use TURN for media relay in the baseline zero-CDN design. Use public or self-hosted STUN only. Peers that cannot establish a direct WebRTC path use the Delivery Fleet.

## Consequences

- Some peers will be edge-only because direct P2P connectivity fails.
- Delivery Fleet sizing must account for NAT-blocked and cellular peers.
- The product remains operational without TURN because fallback is ordinary HTTPS segment delivery.
