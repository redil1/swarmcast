# ADR 0004: WebRTC DataChannels For Peer Transport

## Status

Accepted.

## Context

Peers need a browser/mobile-safe transport that handles NAT traversal and encryption without building a custom UDP protocol.

## Decision

Use WebRTC DataChannels for peer-to-peer segment and coded-packet exchange. The tracker relays only signaling messages; it never carries media payloads.

## Consequences

- Android can use prebuilt libwebrtc.
- DTLS encryption is built into peer transport.
- NAT traversal uses ICE and STUN.
- Failed peer connectivity degrades to Delivery Fleet fallback instead of adding server relay media traffic.
