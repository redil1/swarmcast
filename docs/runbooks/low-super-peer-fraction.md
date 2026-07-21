# Low Super-Peer Fraction

Alert: `SwarmcastLowSuperPeerFraction`

## Meaning

Too few peers are eligible to carry upload load for the swarm.

## First Checks

1. Confirm client network policy is reporting WiFi and uplink values.
2. Check whether a channel audience has shifted toward cellular.
3. Check app version rollout for upload policy changes.
4. Compare useful payload upload with physical link egress. The client bucket allows at most 80% of reported uplink, caps payload at 1.5 MB/s, and does not include WebRTC/IP transport overhead.

## Immediate Actions

- Keep Delivery Fleet capacity ahead of residual demand.
- Consider temporarily lowering super-peer promotion threshold only after confirming upload headroom.
- Do not raise the client payload cap to hide a supply deficit; first prove battery, thermal, playback, and provider-link headroom on physical devices.

## Follow-Up

- Compare measured upload availability against the assumptions register.
- Add permanent helper nodes for critical popular channels if needed.
