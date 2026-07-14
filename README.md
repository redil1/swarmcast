# SwarmCast

SwarmCast is a zero-CDN, P2P-assisted live restreaming platform. The production design is described in `STREAMING_PLATFORM_BLUEPRINT.md`; implementation work is tracked in `BACKLOG.md`.

This repository is being built as a staged monorepo:

- `services/ingest`: catalog parsing, lazy ffmpeg lifecycle, segment hashing, and tracker announcements.
- `services/auth`: token issuing, JWKS, and nginx/tracker token verification.
- `services/tracker`: WebSocket signaling, swarm state, segment announcements, peer scoring, and P2P stats.
- `services/control-plane`: catalog storage, ingest placement, fleet routing, and autoscaling.
- `infra`: origin nginx, edge nginx, compose files, and monitoring.
- `android`: Android client implementation, added after Delivery-Fleet playback is stable.

## Current Build Status

The current build slice establishes the production foundation:

- Node workspace and verification scripts.
- Ingest catalog parser and channel manager.
- Tracker protocol, scoring, and swarm primitives.
- Control-plane ingest scheduler.
- Auth service scaffold.
- Docker and nginx deployment skeletons.
- Architecture, legal, and operations docs.

## Local Verification

Use Node 22 or newer.

```bash
npm run verify
```

This runs syntax checks across service code and the initial unit tests.

## Safety Gate

Do not run this system against real streams until redistribution, rebroadcast, and peer relay rights are confirmed. See `docs/legal-gate.md`.
