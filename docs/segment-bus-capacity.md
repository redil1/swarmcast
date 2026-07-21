# Segment Metadata Bus Capacity Proof

This procedure produces the non-synthetic staging evidence required by the `segment-metadata-bus` launch gate. Local Docker cluster tests and synthetic fixtures prove behavior and validator shape only. They do not prove failure-domain independence, host capacity, storage behavior, or launch readiness.

## Required Staging Shape

- Exactly three NATS JetStream brokers in three failure domains and at least two infrastructure providers.
- One unique public DNS name, TLS certificate fingerprint, storage-volume fingerprint, and monitoring fingerprint per broker.
- Client hostname verification, mutually authenticated routes, and no plaintext listener.
- `SWARMCAST_SEGMENTS` uses file storage, three replicas, subject `swarmcast.segment.>`, and deployment-only stream administration.
- The driver executable and container image are immutable and recorded by SHA-256 and image digest.
- Broker access and TLS material are supplied only through `SWARMCAST_SEGMENT_BUS_DRIVER_*` environment variables. They must never appear in the manifest or output.

The current capacity plan derives 250 publications per second from 500 peak active channels and two-second segments. With 30% headroom, the synchronized target is 325 acknowledged publications per second. Change the plan first when the catalog or segment cadence changes; the probe rejects a manifest that repeats stale arithmetic.

## Collection

Prepare an exact manifest using the schema enforced by `scripts/segment-bus-capacity-probe-runner.js`. Schedule `startAt` between 15 seconds and 30 minutes in the future and use at least 900 seconds for a real run. Each topology entry records independently reviewed provider, region, failure domain, server name, TLS endpoint, and immutable broker image digest.

Run the exact driver from an isolated staging operator host:

```bash
npm run segment-bus:capacity:probe -- \
  --acknowledge-staging-disruption \
  --manifest path/to/segment-bus-capacity-manifest.json \
  --driver path/to/segment-bus-capacity-driver \
  --output path/to/segment-bus-capacity-raw.json
```

The acknowledgement is mandatory because the run stops the active stream leader and later restarts all three brokers. Output creation is exclusive, refuses symlink overwrite, and uses mode `0600`. The runner supplies a minimal child environment, limits each output stream to 16 MiB, enforces a bounded timeout, verifies the executable hash, rejects secret material, and combines operator-owned topology with driver-observed broker identity.

During the run, the driver must:

1. Sustain at least the plan target for the full run with two independent subscribers, exact publish/delivery/byte reconciliation, zero invalid or missing deliveries, and p99 latency within `config/performance-budgets.json`.
2. Record CPU, memory, disk latency, storage use, storage growth, API errors, slow consumers, restarts, OOM kills, and filesystem errors for every broker.
3. Stop the current stream leader while publication continues, observe two replicas, elect a new leader, preserve quorum publication and delivery without loss, then restore three replicas.
4. Restart the full cluster and prove the exact latest sequence and SHA-256 replay from persistent storage.
5. Prove ingest stream-management denial, tracker publish denial, admin-only provisioning, ingest/tracker credential rotation, old-credential rejection, and zero plaintext-password warnings.
6. Reconcile monitoring samples and storage growth against all three broker records.

## Review And Validation

Do not edit the raw probe after collection. Compute its SHA-256 and create the final evidence record beside it. The final record binds the release, cluster, and raw artifact and includes distinct `platform`, `performance`, and `security` reviewers. Every `reviewedAt` must be at or after probe completion.

Set `segmentBusCapacityMeasurementStatus` to `measured` and `segmentBusCapacityEvidence` to the exact final evidence path only after all reviewers approve. Validate it with:

```bash
npm run segment-bus:capacity:evidence:validate -- path/to/segment-bus-capacity-evidence.json
```

The final validator rejects unsafe artifact paths, symlinks, non-`0600` real raw evidence, hash drift, release or cluster drift, fewer than three failure domains, single-provider topology, throughput shortfall, latency or resource-budget breaches, message loss, replay mismatch, permission or rotation failures, monitoring drift, pre-run approvals, and capacity-plan mismatch.

Local contract coverage remains:

```bash
npm run smoke:segment-bus-capacity-probe
npm run smoke:segment-bus-capacity-evidence-validation
npm run smoke:segment-bus-cluster
```

The fixture under `test-fixtures/segment-bus/` requires `--allow-synthetic`. It is shape-only evidence and cannot satisfy the launch gate.
