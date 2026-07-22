# Web Player

The browser player is served from `https://watch.<public-suffix>`. It obtains a short-lived playback token through the web backend, loads the paginated catalog, plays fMP4 HLS through `hls.js`, and joins the same tracker and WebRTC DataChannel swarm as Android clients.

## Runtime Behavior

- The browser never receives `APP_API_KEY`; only the server-side web service can exchange it for short-lived playback credentials.
- Playlist, initialization, edge, and origin requests carry the short-lived playback token.
- Tracker-designated super-peers prefetch announced segments from origin, verify SHA-256 and size, cache them in a bounded 64 MiB store, and advertise availability.
- Other viewers wait briefly for verified peer data before using authenticated edge fallback.
- TURN-delivered bytes are reported as relay cost, not direct P2P offload.
- Closing the page or changing channel closes tracker, peer, and HLS resources.

## Deployment

Set `SWARMCAST_WEB_IMAGE` for an immutable release or allow Compose to build the local image. `APP_API_KEY`, `TRACKER_BASE`, auth, and catalog services must already be configured. The single-host deployment publishes the player automatically and verifies `/health`.

## Acceptance

Run the local responsive UI smoke:

```bash
npm run smoke:web-ui
```

Run the public playback and peer-transfer smoke with three isolated viewers:

```bash
WEB_URL=https://watch.example.tv \
WEB_CHANNEL_QUERY='Known live channel' \
WEB_EXPECTED_PEERS=3 \
WEB_REQUIRE_P2P=1 \
npm run smoke:web-live
```

The command fails unless playback starts, the expected swarm forms, browser errors remain empty, and at least one viewer records non-zero direct P2P bytes. This proves functional browser exchange; it does not replace mixed-network physical-device offload measurement.
