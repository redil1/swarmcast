# Threat Model

Review date: 2026-07-05

This model covers the current SwarmCast architecture: authenticated HLS origin, owned edge cache, auth service, tracker, control plane, lazy ingest workers, durable segment metadata bus, retention worker, owned TURN relay, Android app, WebRTC DataChannels, RLNC/coded-packet path, monitoring, release pipeline, and dependency supply chain.

## Assets

- Upstream source URLs and source credentials.
- Auth signing keys, JWKS, app API key, Play Integrity challenge secret and service-account credential, and internal service token.
- Media playlists, init segments, media segments, and segment SHA-256 manifests.
- Tracker peer IDs, peer IP-adjacent operational metadata, peer stats, and signaling payloads.
- Control-plane placement state, ingest node inventory, and edge/origin routing templates.
- Retention policy, retention worker action logs, and production datastore adapter credentials.
- Android app configuration, P2P privacy controls, and future RLNC decoder library.
- Container images, GitHub release workflow secrets, dependency versions, launch evidence, and artifact bundle hashes.
- Prometheus metrics, Grafana dashboards, Alertmanager routes, and operational logs.

## Trust Boundaries

| Boundary | Direction | Required Controls |
|---|---|---|
| Android app to auth/catalog/tracker/edge | Public internet to service edge | Request-bound Play Integrity verdict, short-lived JWTs, app key throttling, rate limits, no source URL exposure, TLS in production. |
| Nginx edge to auth/origin | Edge proxy to internal services | `auth_request`, cache lock, protected origin paths, no third-party CDN endpoints. |
| Tracker to control plane | Internal service call | `x-internal-token`, strict payload validation, placement response sanitization. |
| Ingest to tracker | Internal segment announce | `x-internal-token`, SHA-256 manifest, bounded channel lifecycle. |
| Ingest and tracker to segment metadata bus | Internal durable messaging | Hostname-verified TLS, NATS-CLI-generated bcrypt credentials in separate broker/client secret scopes, subject permissions, bounded message schema, sequence gate, three replicas, local SSD, and monitored replay. Broker routes require mutual CA verification. |
| Retention worker to operational stores | Internal worker to sensitive logs/metrics stores | Non-destructive default, explicit execution guard, adapter permissions scoped to retention actions, monitored success/failure metrics. |
| Peer to peer | Viewer device to viewer device | WebRTC DTLS, bounded upload policy, segment hash verification, reputation, P2P disable path. |
| Android and auth to TURN | Public viewer and credential service to owned relay | Short-lived HMAC credentials, TLS endpoint, quotas, private-peer denial, secret rotation overlap, metrics, and edge fallback. |
| RLNC decoder boundary | Coded packets to stored bytes | Rank checks, fuzzed decoder, hash verification before `SegmentStore`, license and ABI review. |
| Release pipeline to production | CI artifacts to runtime fleet | Immutable tags, image digest pinning, SBOM, vulnerability scan, rollback record. |
| Launch evidence to approval board | Operator artifacts to production decision | Exact artifact inventory, SHA-256 binding, fixed validators, non-symlink files, release/commit binding, and three independent approvals. |
| Monitoring and logs | Services to operators | Redaction, no JWTs, no source URLs, retention limits. |

## Threat Scenarios

| ID | Threat | Existing Mitigation | Open Launch Gate |
|---|---|---|---|
| T-001 | Unauthorized or modified clients acquire tokens and scrape playlists or segments. | Request-bound Play Integrity checks package, Play signing digest, recognition, license, device integrity, freshness, and replay behavior before JWT/TURN issuance; nginx and tracker then enforce JWTs. | Prove Play Console linking and real Play-installed device verdicts, then confirm real edge-node TLS smoke. |
| T-002 | Upstream source URLs leak to Android clients, logs, metrics, or public catalog responses. | Public channel sanitization, source URL protection checklist, logging standard. | Enforce structured logging in all services before launch. |
| T-003 | Tracker is flooded with oversized or high-rate signaling messages. | Payload size cap, JSON parser rejection, token-bucket peer limiter, disconnect on abuse. | Run VM/WebRTC load ladder and alert on peer drops. |
| T-004 | Malicious peers poison whole segments or RLNC decoded bytes. | Segment SHA-256 manifests, verified `SegmentStore`, coded receiver hash verification, reputation disconnect after repeated mismatches. | Real Android device swarm with chosen RLNC library and malformed-packet fuzzing. |
| T-005 | Bad peer reports frame honest peers and cause denial of contribution. | Security review forbids unauthenticated report trust; current reputation is based on local verification events. | Keep reputation decisions local or require signed evidence before accepting remote reports. |
| T-006 | Peer IP visibility surprises users or violates store disclosure expectations. | Privacy copy, P2P toggle, cellular no-upload policy, P2P disable closes peer links. | Final privacy policy, store notes, and support FAQ approval. |
| T-007 | Control-plane placement is tampered with to redirect clients to malicious origins. | Internal placement routes require token; public placement strips scheduler internals. | Add production service-network isolation and signed/validated edge/origin templates. |
| T-008 | Ingest workers are abused to fetch attacker-controlled or private-network sources. | M3U is config-mounted, not public user input; source URLs are server-only; `SOURCE_ALLOWED_HOSTS` and private-network source rejection validate catalog imports before ffmpeg. | Production must set the source allowlist and keep private-network sources disabled unless explicitly approved. |
| T-009 | Edge cache serves unauthorized or poisoned media. | Auth subrequest on edge/origin routes, cache key excludes token query strings after auth, cache lock, segment hash verification on clients, and local edge nginx TLS cache smoke. | Verify cache key policy against token leakage/replay on real edge nodes. |
| T-010 | Dependency or container compromise ships vulnerable runtime components. | Dependency inventory, npm audit gate, release workflow, immutable image tags. | SBOM, image scanning, digest-pinned images, Android dependency build verification. |
| T-011 | Signing keys, app API key, or internal token are lost or exposed. | Persistent auth key volume, required env validation, backup/restore checklist. | Key rotation runbook, secret manager/provisioning decision, restore drill. |
| T-012 | Metrics/logs expose JWTs, peer identifiers, source URLs, or unnecessary retention. | Logging standard and privacy retention notes. | Implement structured logging and data-retention policy across services. |
| T-013 | Tracker or control-plane outage breaks playback. | Delivery Fleet fallback; tracker carries signaling/stats but not media payloads. | Chaos drill: kill tracker/control-plane during playback and confirm player continues. |
| T-014 | Release workflow publishes mutable or unreviewed artifacts. | Release workflow scaffolds immutable version/SHA tags and release summary. | Protect production environment secrets, require approval, pin images by digest, rehearse rollback. |
| T-015 | Retention worker deletes or aggregates the wrong records. | Dry-run default, `RETENTION_EXECUTE=1` guard, policy-driven actions, fixture tests, failure/staleness alerts. | Production datastore adapter review, scoped credentials, and staging retention drill. |
| T-016 | TURN credentials are abused for bandwidth theft or relays are used to reach private services. | Subject-bound expiring credentials, issuance rate limits, allocation/bandwidth quotas, private-peer denial, restricted metrics, immutable image, and rotation overlap. | Real carrier/device relay proof, relay egress reconciliation, external abuse test, and production secret review. |
| T-017 | Segment metadata is forged, replayed, lost, or made unavailable, causing poisoned scheduling or fleet-wide fallback. | Distinct subject-scoped bcrypt credentials, hostname-verified client TLS, mutually authenticated broker routes, strict metadata/hash validation, JetStream acknowledgements, duplicate suppression, sequence gates, latest replay, quorum replication, readiness, metrics, edge fallback, and a local three-node leader-loss/rotation/recovery proof. | Repeat the proof across three real failure domains and prove sustained peak latency and disk recovery in staging. |
| T-018 | A forged, stale, aliased, symlinked, or validator-substituted evidence bundle is approved as launch-ready. | Schema-version-2 launch records bind a mode-0600 bundle by SHA-256; the bundle binds the exact 52-artifact inventory by SHA-256, rejects aliases/symlinks/test fixtures, executes 38 fixed validator groups without a shell, and requires distinct release, operations, and security approvals after generation. | Use only immutable real artifacts and complete the three-person approval on the final generated bundle. |

## Abuse Cases To Test

- Invalid, expired, wrong-audience, and tampered JWTs against origin, edge, and tracker.
- Forged, expired, stale, wrong-package, wrong-certificate, unlicensed, compromised-device, request-hash-mismatched, and replayed Play Integrity verdicts against `/token`.
- Replayed media URLs after token expiry.
- Oversized tracker messages and rapid-fire signaling.
- Peer sends wrong segment bytes, malformed CODED frames, dependent RLNC packets, and bad rank claims.
- Cellular viewer attempts upload despite policy.
- P2P toggle is switched off mid-session and closes existing peer links.
- Control-plane returns malformed placement with external hostnames.
- Edge receives cacheable segment request with different token values.
- ffmpeg source fails repeatedly and does not leak source URL in logs or metrics.
- Retention worker dry-run and execute modes against staging stores, including incident hold exceptions.
- Compromised dependency or image scan finding blocks launch.
- Expired, forged, and replayed TURN credentials fail; relay attempts toward private and loopback addresses are denied.
- Unauthorized NATS subjects, stale segment sequences, broker restart, one-node loss, credential rotation, and disk pressure fail safely without bypassing segment integrity.
- Missing, extra, hash-mismatched, aliased, traversal, symlinked, synthetic, release-drifted, and command-injected launch artifacts are rejected before approval.

## Required Before Production

- Threat model sign-off evidence is recorded and passes validation:

```bash
npm run threat:model:validate -- path/to/threat-model-review.json
```

Synthetic fixtures must be validated explicitly:

```bash
npm run threat:model:validate -- --allow-synthetic test-fixtures/security/threat-model-review-complete.synthetic.json
```

`npm run smoke:threat-model-review-validation` must stay in `npm run check` to protect required areas, threat IDs, open gate acknowledgements, sign-off roles, evidence redaction, waiver metadata, and synthetic-fixture handling.

- P0/P1 findings from `docs/security-review.md` are fixed or explicitly waived.
- Android RLNC library is selected, license-reviewed, benchmarked, fuzzed, and real-device tested.
- Real nginx/TLS origin and edge playback smoke passes with auth and cache-hit evidence; local coverage is `npm run smoke:nginx-origin-playback` and `npm run smoke:nginx-edge-cache`.
- VM/WebRTC load ladder and tracker chaos tests pass with alert evidence.
- Dependency review gates for SBOM, image scan, digest pinning, and Android build verification are closed.
- Data-retention policy is approved for peer stats, IP-related logs, auth logs, playback errors, and metrics.
- Retention worker production adapter, scoped credentials, and staging execution drill are approved.
