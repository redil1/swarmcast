# Performance Budgets

Machine-readable launch budgets live in `config/performance-budgets.json`.

## Budgets

| Budget | Value | Measurement |
|---|---:|---|
| Tracker CPU per message p95 | 2 ms | tracker load test |
| Tracker memory per peer | 4096 bytes | heap delta during peer ladder |
| Segment hash latency p95 | 20 ms | ingest segment watcher benchmark |
| Android decode CPU per segment p95 | 100 ms | real device playback profile |
| Android battery drain | 8% per hour | one-hour playback soak |
| Android startup latency p95 | 5000 ms | tracker client stats and real device playback profile |
| Android stall rate maximum | 0.01 | tracker rolling 5-minute playback stats |
| Android buffer minimum | 10000 ms | tracker rolling 5-minute playback stats |
| Edge cache hit ratio minimum | 0.80 | edge metrics over rolling 5 minutes |

## Rules

- Budgets are launch gates, not aspirational notes.
- VM/WebRTC load ladder results must include tracker CPU and memory.
- Android device soaks must include startup latency, stall rate, buffer depth, decode CPU, and battery drain.
- Edge cache hit ratio must be measured on real edge nodes before launch.
- Budget changes require launch-readiness review.
- Canary rollout snapshots must pass `npm run canary:metrics:validate -- path/to/canary-metrics.json` before expanding traffic, including zero peer hash failures, zero peer disconnects, and bounded peer timeouts.
- `npm run smoke:canary-metrics-validation` protects canary budget regressions in the default check.
