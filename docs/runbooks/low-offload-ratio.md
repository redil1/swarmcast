# Low Offload Ratio

Alert: `SwarmcastLowOffloadRatio`

## Meaning

The P2P offload ratio is below target, so more traffic is falling back to the Delivery Fleet.

## First Checks

1. Check `swarmcast_tracker_super_peer_fraction`.
2. Check edge egress and cache hit ratio once nginx cache metrics are enabled.
3. Compare WiFi fraction against assumptions in `docs/assumptions.md`.
4. Check recent app releases for P2P disablement, WebRTC failures, or stats regressions.

## Immediate Actions

- If edge nodes are saturated, add Delivery Fleet capacity.
- If super-peer fraction is low, reduce P2P expectations for the current audience mix.
- If tracker signaling errors increased, roll back the tracker release.

## Follow-Up

- Run the self-sustaining drill with the current WiFi/cellular mix.
- Recalculate delivery box requirements from measured `rho`.
