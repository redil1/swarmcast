# Chaos Drills

Local chaos drills are regression gates for expected degradation behavior. They do not replace staging playback drills on real hosts and Android devices.

## Executable Local Gates

- `npm run smoke:tracker-ws-restart`: stops and restarts the tracker while an active WebSocket swarm is connected. Expected result: active sockets close, clients rejoin on the same ports, Delivery Fleet playlist URLs remain available in joined responses, demand resumes, rolling `rho` recovers, and P2P peer-list activation returns.
- `npm run smoke:ingest-ffmpeg-chaos`: simulates repeated ffmpeg worker crashes for a demanded channel. Expected result: restart backoff preserves `swarmSize`, the channel stops restarting after `MAX_FFMPEG_FAILURES`, enters `degraded`, and emits `ffmpeg_worker_failed`.
- `npm run smoke:control-plane-placement-restart`: assigns a channel through the internal control-plane API, restarts the server with the same placement file, verifies placement lookup and reassignment reuse the same ingest node, then releases the placement and confirms the deletion survives another restart.
- `npm run smoke:staging-chaos-evidence-validation`: proves staging chaos evidence rejects missing drills, missing alert observation, failed recovery, cascade, third-party CDN fallback, data loss, missing peer-health runbook evidence, sensitive evidence, and synthetic records without an explicit flag.

## Required Staging Drills

- Kill tracker during real Android playback and confirm already-buffered playback continues through the Delivery Fleet while signaling reconnects.
- Kill ffmpeg for a demanded live channel and confirm operators see degraded state, alert context, and no restart storm.
- Kill an edge node and confirm `android-playback-continuity` plus `owned-edge-failover` without using a third-party CDN.
- Kill one ingest node and confirm `android-playback-continuity` plus `placement-failover` without cascading to unrelated channels.
- Restart control plane during active tracker joins and confirm existing tracker/edge routing state recovers from `durable-placement-restore`.
- Restart multiple services together and confirm `android-playback-continuity`, `owned-edge-failover`, and `placement-failover`.
- Inject a peer-health incident and confirm `SwarmcastPeerHashFailures` fires, `docs/runbooks/peer-health.md` is followed, recovery completes, and rollout canary metrics return to healthy bounds.

Validate staging chaos evidence before launch:

```bash
npm run chaos:staging:validate -- path/to/staging-chaos-evidence.json
```

Synthetic fixtures must be validated explicitly:

```bash
npm run chaos:staging:validate -- --allow-synthetic test-fixtures/chaos/staging-chaos-complete.synthetic.json
```

Production launch remains blocked until staging drill evidence is attached to `docs/launch-readiness.md`.
