# Capacity Plan

The machine-readable capacity plan lives in `config/capacity-plan.json` and is validated with:

```bash
npm run capacity:plan:validate -- config/capacity-plan.json
```

`npm run smoke:capacity-plan-validation` must stay in `npm run check` so bad offload, cache, edge-node, and origin-node assumptions keep failing locally.

The plan converts measured launch inputs into owned infrastructure counts:

- `peakConcurrentViewers * averageBitrateMbps` estimates gross viewer traffic.
- `measuredOffloadRatio` reduces the Delivery Fleet load after P2P contribution.
- `selfSustainingSuperPeerFraction` records the measured super-peer fraction where edge fallback flattens.
- `helperUploadPacketsPerSegment` records the helper upload budget used for that sweep.
- `superPeerSweepEvidence` points to the sanitized load-ladder evidence for the sweep.
- `edgeCacheHitRatio` estimates origin fill from edge misses.
- `headroomRatio` reserves spare capacity for burst, failure, and regional imbalance.
- `plannedEdgeNodes` must cover residual edge delivery Mbps with headroom.
- `plannedOriginNodes` must cover active channel packaging capacity with headroom.

Launch remains blocked until `measuredOffloadRatio >= 0.90`, `selfSustainingSuperPeerFraction <= 0.25`, `edgeCacheHitRatio >= 0.80`, and the plan is updated with staging or production measurements rather than blueprint estimates.
