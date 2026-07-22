# Single-Host Staging

This overlay is a real-host functional test, not production capacity evidence. It runs the core SwarmCast services on one host and terminates automatic TLS through Caddy. The committed synthetic H.264/AAC fMP4 fixture is the default source; an isolated source-generator service loops it into a genuinely advancing staging stream.

Use a DNS suffix whose `origin`, `api`, and `tracker` names resolve to the host. Set `SWARMCAST_PUBLIC_SUFFIX` to that suffix, and set:

- `ORIGIN_BASE=https://origin.<suffix>`
- `EDGE_BASE=https://origin.<suffix>`
- `M3U_PATH` is set by the overlay to the read-only service-local catalog mount.
- `SOURCE_ALLOWED_HOSTS` must contain every source hostname in the selected catalog.
- `SOURCE_ALLOW_PRIVATE_NETWORKS=1` is required only for the synthetic `gateway` source; keep it `0` for public upstreams.
- `INGEST_NODES=[{"id":"single-host","baseUrl":"https://origin.<suffix>","ingestUrl":"http://ingest:7001"}]`

The deployment command generates unique staging secrets outside the repository for `INTERNAL_TOKEN`, `APP_API_KEY`, `NATS_INGEST_PASSWORD`, and `NATS_TRACKER_PASSWORD`. It starts only the listed services so the production nginx service does not contend for ports 80/443.

To use a sensitive catalog without copying it into Git, set `STAGING_M3U_FILE`
to an absolute host path. Keep that file root-readable only, granting read access
only to the container UIDs that need it. The committed synthetic catalog remains
the default when the variable is unset.

The legacy eight-field pipe backup can be converted without exposing stream URLs
in console output. The converter writes mode `0600`, refuses accidental overwrite,
and can emit the source hostname allowlist separately:

```bash
node scripts/convert-channel-backup-to-m3u.js \
  --input /secure/channels-backup.txt \
  --output /secure/source.m3u \
  --hosts-output /secure/source-hosts.txt
```

On a clean compatible Ubuntu host, clone the committed repository and deploy with:

```bash
sudo infra/staging-single-host/deploy.sh \
  --public-suffix 203.0.113.10.sslip.io \
  --catalog /secure/source.m3u \
  --env /opt/swarmcast/.env.staging
```

Replace the suffix with the server IP under `sslip.io`, or a DNS suffix whose
`origin`, `api`, and `tracker` names resolve to the host. The host must already
provide Node.js 20-24, Docker Compose, `curl`, `setfacl`, open TCP 80/443 and UDP
443, and outbound access to every source hostname. The command is idempotent:
it validates and preserves an existing secret file instead of rotating secrets,
enforces catalog ACLs for only the required container UIDs, validates the fully
rendered Compose model, builds and starts the staging services, waits for their
health checks, and verifies both public HTTPS health endpoints.

Use `--prepare-only` without `sudo` to validate the catalog and generate or
check the mode-`0600` environment before making host changes. The deploy command
never installs system packages, stops unrelated containers, opens firewall
ports, or replaces DNS; those host-owner actions remain explicit prerequisites.

The overlay intentionally leaves Play Integrity and owned TURN to their separate real-device and relay-capacity gates. It cannot prove multi-host availability, mobile NAT traversal, physical-device playback, or fleet capacity.
