# Feature Flags

Feature flags are runtime controls for rollout, incident response, and unfinished production gates.

## Flags

| Env Var | Default | Purpose |
|---|---:|---|
| `P2P_ENABLED` | `true` | Enables peer-assisted delivery when client/network policy allows it |
| `RLNC_ENABLED` | `false` | Enables coded packet scheduler/decoder path after Android RLNC approval |
| `TAIL_DOWNSCALE_ENABLED` | `false` | Enables cold-tail bitrate/downscale policy after validation |
| `EDGE_ONLY_MODE` | `false` | Forces Delivery-Fleet-only behavior during P2P incidents |
| `CONTRIBUTION_ENFORCEMENT_ENABLED` | `true` | Enables contribution-aware peer prioritization |
| `SUPER_PEER_THRESHOLD_KBPS` | `15000` | Minimum reported WiFi uplink for super-peer promotion |

## Rules

- `RLNC_ENABLED` must stay off until the Android RLNC library gate is complete.
- `EDGE_ONLY_MODE` is the primary incident switch for P2P instability.
- Tracker join behavior consumes `P2P_ENABLED` and `EDGE_ONLY_MODE`; either can force Delivery-Fleet-only mode and suppress peer lists during incidents.
- Android manifest configuration consumes `P2P_ENABLED`, `EDGE_ONLY_MODE`, and `RLNC_ENABLED`; edge-only or disabled P2P starts the app in Delivery-Fleet-only mode and disables the P2P switch.
- `TAIL_DOWNSCALE_ENABLED` requires measured playback quality validation; ingest uses it only below `TAIL_SWARM_THRESHOLD` and promotes a channel back to source-copy packaging when demand rises.
- Flag changes must be recorded in the incident or release notes.
- Defaults must remain conservative and safe for launch.

## Launch Gate

Before production launch, service and Android runtime code must consume the shared flag contract or have an explicit waiver in `docs/launch-readiness.md`.
