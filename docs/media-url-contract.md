# Media URL Contract

Trackers return a small set of media URL templates to clients after join:

- `playlistUrl`: authenticated edge playlist URL.
- `edgeUrlTemplate`: authenticated edge fallback template with `{file}`.
- `originUrlTemplate`: origin seed template with `{file}` for controlled seeding policy.
- `demandUrl`: internal ingest demand URL when control-plane placement selects a node.

The shared builder lives in `@swarmcast/config/media-urls`. It validates channel IDs, placement node IDs, owned edge/origin hosts, placement origin hosts, optional ingest demand URLs, and rejects known third-party CDN provider hostnames.

Single-node fallback:

```text
https://edge.example.tv/live/{channelId}/playlist.m3u8
https://edge.example.tv/live/{channelId}/{file}
https://origin.example.tv/live/{channelId}/{file}
```

Placement-aware route:

```text
https://edge.example.tv/edge/{nodeId}/live/{channelId}/playlist.m3u8
https://edge.example.tv/edge/{nodeId}/live/{channelId}/{file}
https://origin-node.example.tv/live/{channelId}/{file}
```

All future edge, Android, and control-plane route changes must preserve this contract or update the shared builder and its tests first.
