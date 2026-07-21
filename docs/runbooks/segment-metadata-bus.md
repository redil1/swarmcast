# Segment Metadata Bus Runbook

## Scope

This runbook covers the NATS JetStream cluster that durably carries segment hash, size, sequence, and coding metadata from ingest to active tracker cells. It carries no media bytes.

## Alerts

- `SwarmcastSegmentBusPublishFailures`: ingest did not receive a durable publish acknowledgement.
- `SwarmcastSegmentBusSubscriberFailures`: a tracker failed to consume or replay metadata.
- `SwarmcastSegmentBusStoragePressure`: stored metadata exceeds 80% of configured capacity.
- `SwarmcastSegmentBusApiErrors`: JetStream reported API errors.
- `SwarmcastServiceTargetDown` for `swarmcast-segment-bus`: the exporter or broker health path is unavailable.

## Immediate Checks

1. Confirm at least two of three JetStream nodes are healthy and the stream leader is elected.
2. Compare ingest publish rate with aggregate tracker receive rate and active channel subscriptions.
3. Check stream replicas, storage usage, filesystem latency, API errors, slow consumers, and reconnect counters.
4. Confirm TLS certificate validity and that ingest and tracker credentials still have their intended subject permissions.
5. Confirm the stream exists with the reviewed limits before restarting ingest; production runtime credentials cannot create or update it.
6. Check whether the incident is isolated to one tracker, one region, or the cluster.

## Mitigation

- Keep tracker and Android edge fallback enabled. Do not bypass segment hash validation.
- Restart one failed broker at a time. Preserve `/data/jetstream`; never delete quorum state as a recovery shortcut.
- If storage is high, verify retention settings and disk availability before increasing the limit. Metadata expires automatically.
- If one tracker is failing, drain and restart that tracker; active channels replay their latest metadata after reconnect.
- If publication is failing cluster-wide, stop risky deployments and restore JetStream quorum before increasing ingest load.

## Recovery Verification

1. All three nodes report healthy JetStream status and expected cluster membership.
2. Stream replica count is three and no replica is behind.
3. Publish and subscriber failure counters stop increasing.
4. A tracker with no local viewers has no channel subscription; first join creates one and receives latest metadata.
5. Run `npm run smoke:segment-bus` to verify publish-once delivery, selective subscriptions, duplicate suppression, restart persistence, and replay.
6. Run `npm run smoke:segment-bus-cluster` to verify hostname-checked TLS, three current replicas, leader loss, quorum publishing, bcrypt authentication, role permissions, rolling credential rotation, full-cluster restart persistence, and bounded local publish latency.
7. Confirm new segments reach every active tracker cell and Android playback leaves edge fallback without integrity failures.

Provision or reconcile the stream with the deployment-only identity before application rollout:

```bash
SEGMENT_BUS_USER="$NATS_ADMIN_USER" SEGMENT_BUS_PASSWORD="$NATS_ADMIN_PASSWORD" npm run segment-bus:provision
```

## Credential Provisioning And Rotation

Generate each broker-side hash with the pinned NATS CLI or the same reviewed CLI version used by deployment automation:

```bash
nats server passwd
```

The broker configuration expands unquoted NATS variables. Because bcrypt hashes contain `$`, each `NATS_*_PASSWORD_HASH` secret must contain the hash as a JSON string, including the double-quote characters. An environment-file representation uses single quotes to preserve that value:

```text
NATS_INGEST_PASSWORD_HASH='"$2a$11$..."'
```

The clear `NATS_INGEST_PASSWORD`, `NATS_TRACKER_PASSWORD`, and `NATS_ADMIN_PASSWORD` values are injected only into their clients. Never inject clear passwords into the broker or hashes into application containers. Verify that broker logs do not contain `Plaintext passwords detected`.

Rotate one role at a time:

1. Generate a new clear credential and its cost-11 NATS bcrypt hash; store them in their separate application and broker secret scopes.
2. Restart or reload two non-leader brokers with the new hash, one at a time. After each change, require quorum, a leader, and current stream replicas.
3. Switch that role's clients to the new clear credential and require successful publish or replay through the two updated brokers.
4. Restart or reload the final broker with the new hash, then prove the old credential is rejected.
5. Remove the retired secrets and retain only redacted rotation evidence.

## Production Requirements

- Three failure-domain-separated nodes with local SSD, `SEGMENT_BUS_REPLICAS=3`, hostname-validated client TLS, mutually authenticated broker routes, and encrypted backups of configuration and credentials.
- Capacity tests must measure publish acknowledgement latency, delivery latency, reconnect recovery, disk latency, storage growth, and one-node loss at projected peak channel rate.
- Rotate ingest and tracker credentials independently and retain evidence without recording secret values.
- The local cluster smoke proves behavior on one Docker host only. It does not replace staging proof across three real failure domains or peak-rate capacity evidence.
