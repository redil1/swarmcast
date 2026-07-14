# Production Assumptions Register

These assumptions drive architecture and capacity. Replace estimates with measured data as soon as load tests exist.

The structured capacity plan lives in `config/capacity-plan.json` and must pass `npm run capacity:plan:validate -- config/capacity-plan.json` before launch.

| Area | Initial Assumption | Validation Plan |
|---|---|---|
| Catalog size | 20,000 channels | Import real m3u into catalog service |
| Initial bitrate | 5 Mbps source average | Measure segment sizes per channel |
| Launch audience | Unknown | Instrument private beta |
| WiFi share | Must be majority WiFi for high offload | Client network stats |
| P2P offload target | rho >= 0.90 before launch | Headless peer load ladder |
| Self-sustaining super-peer threshold | Edge fallback should flatten by 25% super-peers; current deterministic sweep flattens at 15% | `smoke:headless-super-peer-sweep` and VM/WebRTC ladder |
| Popular channel latency | 30-60 s buffer accepted | Product review and beta feedback |
| Tail policy | Edge-only or downscaled below threshold | Measure startup and cost impact |
| Ingest cap per node | 140 active channels | Host-level saturation test |

Open risks:

- Upstream provider connection limits may cap active channels before SwarmCast infrastructure does.
- Majority-cellular viewing can break the self-sustaining P2P condition.
- The cold tail may cost more on owned boxes than it would on a CDN, by design.
