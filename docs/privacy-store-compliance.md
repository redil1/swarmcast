# Privacy And Store Compliance Notes

## P2P Disclosure

SwarmCast uses WebRTC DataChannels for peer-assisted delivery when P2P is enabled. Peers watching the same channel may see each other's IP addresses as part of normal WebRTC connectivity.

Required product copy:

- P2P upload can be turned off.
- Cellular connections never upload.
- Low-battery WiFi upload is disabled by policy.
- Turning P2P off keeps playback available through the Delivery Fleet.

## Data Collection

The client reports aggregate playback and contribution counters:

- bytes downloaded from peers
- bytes downloaded from edge
- bytes uploaded to peers
- playback stalls
- network class needed for upload policy

The client must not report upstream source URLs or viewer content history beyond channel/session operational metrics needed for delivery health.

## Retention

- Canonical retention rules live in `docs/data-retention-policy.md` and `config/data-retention.json`.
- Tracker stats are operational telemetry and should be retained only as long as needed for reliability and abuse defense.
- Raw peer IDs should be treated as ephemeral.
- Aggregated metrics may be retained for capacity planning.

## Store Review Notes

- Explain peer-assisted delivery and IP visibility in privacy review materials.
- Confirm the P2P toggle is reachable before playback.
- Confirm disabling P2P immediately closes peer links.
- Confirm no upload occurs on cellular.

## Launch Gate

Production launch is blocked until privacy policy text, app store notes, and support FAQ are reviewed against this document.

Validate the review evidence before launch:

```bash
npm run privacy:store:validate -- path/to/privacy-store-compliance.json
```

Synthetic shape checks can use:

```bash
npm run privacy:store:validate -- --allow-synthetic test-fixtures/privacy/privacy-store-compliance-complete.synthetic.json
```

Local guard coverage remains:

```bash
npm run smoke:privacy-store-compliance-validation
```
