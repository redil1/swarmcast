# Runbook: Low Edge Cache Hit Ratio

## Alert

- `SwarmcastLowEdgeCacheHitRatio`
- `SwarmcastHighEdgeEgressRate`
- `SwarmcastHighEdgeOriginFillRate`
- `SwarmcastHighEdgeErrorRate`

## Impact

Low edge cache hit ratio increases origin load and can raise startup latency or segment fetch failures.
High total edge egress can indicate unexpected audience growth, low P2P offload, regional imbalance, or Delivery Fleet capacity risk.
High origin-fill egress or edge 5xx error rate can indicate cache churn, origin saturation, bad upstream routing, or auth/edge regressions.

## Triage

1. Check whether the issue is isolated to one edge node or global.
2. Confirm playlist TTL and segment TTL match the current HLS segment duration.
3. Inspect `swarmcast_edge_requests_by_cache_total`, `swarmcast_edge_egress_bytes_total`, `swarmcast_edge_origin_fill_bytes_total`, and upstream response status from edge access-log metrics.
4. Verify Android playback URLs are using Delivery Fleet edge URLs, not origin URLs.
5. Confirm Prometheus can scrape the edge cache metrics exporter on port `9101`.
6. If `SwarmcastHighEdgeErrorRate` fired, inspect status classes and recent origin/auth errors before changing cache policy.
7. If `SwarmcastHighEdgeEgressRate` fired, compare total edge egress with tracker offload ratio, active viewers, and per-node balance.
8. If `SwarmcastHighEdgeOriginFillRate` fired, compare hot misses with tracker offload ratio and active channel demand.
9. Check recent deploys for cache-key, auth, or route-template changes.
10. Run `npm run smoke:edge-cache-metrics` and `npm run smoke:edge-cache-metrics-server` before changing edge log parsing, exporter, or dashboard queries.

## Mitigation

1. Drain or remove a bad edge node from placement.
2. Roll back edge nginx config if cache keys or TTLs changed.
3. Temporarily increase edge capacity for affected popular channels.
4. If total edge egress is high because P2P offload dropped, consider forcing only unstable channels to Delivery-Fleet-only while investigating tracker or app regressions.
5. If origin saturation starts, force tail channels to edge-only and reduce direct origin seed pulls.
6. If edge 5xx errors are localized, remove the affected edge node from rotation.

## Follow-Up

- Store affected node IDs, cache status samples, edge egress deltas, and origin egress deltas.
- Add a regression smoke if the incident was caused by route or cache-key changes.
- Keep raw edge access logs out of broad incident channels; share aggregate metrics and status classes unless security review requires request-level samples.
