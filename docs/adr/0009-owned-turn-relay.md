# ADR 0009: Owned TURN Relay For Restrictive Networks

## Status

Accepted. Supersedes ADR 0006.

## Context

STUN-only WebRTC cannot provide reliable connectivity across restrictive carrier NAT, UDP blocking, or enterprise firewalls. Falling every failed connection back to edge delivery preserves playback but can reduce direct P2P offload enough to invalidate the fleet economics. Static TURN credentials embedded in Android would create an uncontrolled relay-abuse credential.

## Decision

Production uses an owned coturn fleet alongside direct ICE candidates. The auth service issues coturn REST credentials bound to the viewer subject and an expiration no longer than the viewer JWT. Android obtains the complete ICE server configuration from `/token`, applies it before tracker join, and refreshes it before TURN expiry.

Production configuration must provide owned STUN hosts and TURN/UDP, TURN/TCP, and TURN/TLS endpoints. Relays use digest-pinned images, TLS certificates, explicit allocation and bandwidth quotas, private-peer denial, Prometheus metrics, and short-lived HMAC credentials. Direct host, server-reflexive, and peer-reflexive paths remain preferred by ICE; TURN is a connectivity fallback.

Every TURN byte is owned relay egress. It is excluded from direct-P2P offload and included in capacity and provider-traffic calculations.

## Consequences

- Restrictive-network viewers can participate in the P2P protocol instead of immediately becoming edge-only.
- TURN can improve playback reachability while increasing owned egress; real carrier measurements determine whether that trade is economical.
- The auth and relay fleets share a rotation-managed secret. During rotation coturn accepts current and previous secrets until the previous credential lifetime expires.
- Production launch remains blocked until representative devices prove ICE outcomes, relay selection, verified transfer, playback quality, and reconciled relay egress.
