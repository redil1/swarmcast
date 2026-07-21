# ADR-0011: JetStream Segment Metadata Bus

Status: Accepted

Date: 2026-07-21

## Context

Ingest previously sent every segment announcement to every tracker endpoint. Adding tracker cells therefore removed the per-channel socket ceiling but made metadata delivery grow with tracker count and left no durable recovery path after a tracker restart or network interruption.

## Decision

Use a self-hosted three-node NATS JetStream cluster for channel segment metadata.

- Ingest publishes one validated message per channel segment and waits for a JetStream acknowledgement.
- The stream uses file storage, limits retention, per-subject bounds, duplicate suppression, and three replicas in production.
- A tracker subscribes only while it owns at least one local cell for that channel.
- A new or reconnected subscription reads the latest persisted message before relying on live delivery.
- Per-channel sequence gates reject duplicate and out-of-order metadata.
- Ingest and tracker use distinct credentials and subject permissions.
- Production stream creation/update is a deployment operation; runtime ingest credentials cannot manage streams.
- Production client traffic uses hostname-verified TLS plus role credentials; broker route traffic uses mutual-CA-verified TLS. Local Compose uses a single plaintext node only for development and smoke tests.

## Consequences

Segment publication is O(1) from ingest instead of O(tracker processes). Broker delivery remains proportional to active tracker cells, which is the required work. The bus is now a critical control-plane dependency and needs quorum, local SSD storage, monitoring, backup-aware recovery procedures, and capacity evidence. Latest-only replay favors live-stream freshness; it is not an archive or a replacement for HLS storage.
