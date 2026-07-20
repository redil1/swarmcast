# Capacity Plan

The machine-readable capacity plan lives in `config/capacity-plan.json`. The committed file is intentionally a non-launchable draft because physical-device offload, sustained host throughput, and provider traffic terms have not been measured or approved. Validate its calculations and schema with:

```bash
npm run capacity:plan:validate -- --allow-draft config/capacity-plan.json
```

Launch validation must run without the draft flag:

```bash
npm run capacity:plan:validate -- config/capacity-plan.json
```

`npm run smoke:capacity-plan-validation` must stay in `npm run check` so unmeasured launch inputs, bad offload, omitted relay egress, invalid host throughput, unapproved traffic terms, sensitivity drift, cache, edge-node, and origin-node assumptions keep failing locally.

The plan converts measured launch inputs into owned infrastructure counts:

- `peakConcurrentViewers * averageBitrateMbps` estimates gross viewer traffic.
- `directP2pOffloadRatio` reduces owned delivery load only after direct P2P transfer; origin bootstrap, edge HTTPS, and any TURN/relay bytes remain in the owned-delivery denominator.
- Android counts a peer payload as direct only after the selected ICE pair is classified as host, server-reflexive, or peer-reflexive. Relay and unclassified paths fail closed into owned relay delivery; mixed coded reconstruction is attributed proportionally by accepted packet weight.
- `offloadMeasurementStatus` and `offloadMeasurementEvidence` distinguish a model from completed physical-device and VM/WebRTC measurement.
- `selfSustainingSuperPeerFraction` records the measured super-peer fraction where edge fallback flattens.
- `helperUploadPacketsPerSegment` records the helper upload budget used for that sweep.
- `superPeerSweepEvidence` points to the sanitized load-ladder evidence for the sweep.
- `edgeCacheHitRatio` estimates origin fill from edge misses.
- `edgeNodeLinkCapacityMbps * edgeNodeSustainedUtilizationRatio` caps the capacity that may be credited to one host.
- `edgeNodeCapacityMeasurementStatus` and `edgeNodeCapacityEvidence` require a sustained TLS egress test before launch.
- `providerTrafficTermsApproved` and `providerTrafficTermsEvidence` prevent an unreviewed traffic allowance or billing assumption from closing launch readiness.
- `relayEgressIncluded` must be true; owned TURN traffic is delivery egress and never counts as direct P2P offload.
- `headroomRatio` reserves spare capacity for burst, failure, and regional imbalance.
- `plannedEdgeNodes` must cover residual edge delivery Mbps with headroom.
- `plannedOriginNodes` must cover active channel packaging capacity with headroom.

The draft uses the corrected model `rho=0.85`, a conservative 800 Mbps allowance on a 1 Gbps link, 30% headroom, and therefore 25 edge nodes for 20K viewers at 5 Mbps. These are planning assumptions, not measurements.

The required one-million-viewer sensitivity table makes the economics explicit. At 5 Mbps, 800 Mbps per edge node, and 30% headroom, it computes 82 nodes at `rho=0.99`, 813 at `rho=0.90`, 2,438 at `rho=0.70`, and 4,063 at `rho=0.50`. This table is a capacity sensitivity calculation, not proof that any `rho` is achievable.

Launch remains blocked until `offloadMeasurementStatus=measured`, `directP2pOffloadRatio >= 0.90`, `edgeNodeCapacityMeasurementStatus=measured`, provider traffic terms are approved, all referenced evidence is non-synthetic, `selfSustainingSuperPeerFraction <= 0.25`, and `edgeCacheHitRatio >= 0.80`.
