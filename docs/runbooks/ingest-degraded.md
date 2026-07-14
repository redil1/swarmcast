# Ingest Degraded Channels

Alerts: `SwarmcastIngestDegradedChannels`, `SwarmcastIngestStaleSegments`, `SwarmcastFfmpegFailureSpike`

## Meaning

One or more ffmpeg workers are failing or stuck in degraded state.

## First Checks

1. Inspect channel source URL health from the ingest host.
2. Check upstream provider status and connection limits.
3. Check host CPU, memory, and network saturation.
4. Confirm `/var/hls` tmpfs has available space.
5. Check `swarmcast_ingest_segment_age_seconds`; values above 30 seconds indicate a channel is not producing or announcing fresh segments.
6. Reproduce the restart/degrade path with `npm run smoke:ingest-ffmpeg-chaos` when investigating restart storms.

## Immediate Actions

- Restart the specific channel worker if the upstream source is healthy.
- Move hot channels to a less loaded ingest node when fleet placement exists.
- If upstream is failing, mark the channel degraded and avoid restart storms.

## Follow-Up

- Capture ffmpeg stderr tail for the affected channel.
- Add source-specific retry or quarantine rules if failures repeat.
- Attach `smoke:ingest-ffmpeg-chaos` output when validating changes to restart backoff or degraded-state behavior.
