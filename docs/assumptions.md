# Production Assumptions Register

These assumptions drive architecture and capacity. Replace estimates with measured data as soon as load tests exist.

The structured capacity plan lives in `config/capacity-plan.json`. Its current modeled draft must pass `npm run capacity:plan:validate -- --allow-draft config/capacity-plan.json`; launch requires the same command without `--allow-draft` after real measurements replace pending evidence.

| Area | Initial Assumption | Validation Plan |
|---|---|---|
| Catalog size | 20,000 channels | Import real m3u into catalog service |
| Initial bitrate | 5 Mbps source average | Measure segment sizes per channel |
| Launch audience | Unknown | Instrument private beta |
| WiFi share | Must be majority WiFi for high offload | Client network stats |
| P2P offload target | Direct-P2P rho >= 0.90 before launch; corrected deterministic model currently reports 0.85 | Physical Android devices plus VM/WebRTC load ladder, reconciled with owned edge/origin/relay egress |
| Self-sustaining super-peer threshold | Edge fallback should flatten by 25% super-peers; current deterministic sweep flattens at 15% | `smoke:headless-super-peer-sweep` and VM/WebRTC ladder |
| Popular channel latency | 30-60 s buffer accepted | Product review and beta feedback |
| Tail policy | Edge-only or downscaled below threshold | Measure startup and cost impact |
| Ingest cap per node | 140 active channels | Host-level saturation test |
| Edge delivery host | Draft allows 800 Mbps sustained on a 1 Gbps link | 30-minute sustained TLS egress saturation test plus provider traffic-terms approval |

Open risks:

- Upstream provider connection limits may cap active channels before SwarmCast infrastructure does.
- Majority-cellular viewing can break the self-sustaining P2P condition.
- The cold tail may cost more on owned boxes than it would on a CDN, by design.
