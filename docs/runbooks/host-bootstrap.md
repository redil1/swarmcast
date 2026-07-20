# Host Bootstrap Runbook

Target OS: Ubuntu 24.04 LTS.

1. Install Docker, Compose, certbot, and firewall tooling.
2. Apply sysctl values from `infra/host/sysctl.d/99-swarmcast.conf`.
3. Apply file descriptor limits from `infra/host/security-limits.d/99-swarmcast.conf`.
4. Review and apply the UFW firewall profile from `infra/host/firewall/ufw-swarmcast.sh`.
5. Mount `/var/hls` as tmpfs for origin ingest nodes and make it writable by the container runtime user.
6. Configure DNS for origin, tracker, API, edge, control-plane, retention-worker, TURN, and monitoring hosts.
7. Issue TLS certificates with `infra/host/tls/certbot-swarmcast.sh` before exposing services.
8. Deploy with the compose file in `infra/docker-compose.yml`.
9. Smoke test token issuance, catalog access, origin playlist access, and edge cache hit behavior.

Operational rule:

- Internal service ports must stay on private Docker or host networks. Only public TLS entrypoints should be exposed.
- The firewall profile permits SSH, HTTP, and HTTPS, and denies direct public access to service ports `7000`, `7001`, `7002`, `7003`, `7010`, `7020`, and `9101`.
- TLS certificates are issued one hostname at a time so nginx can read `/etc/letsencrypt/live/<hostname>/fullchain.pem` for each server block.
- TURN hosts use the dedicated `infra/host/firewall/ufw-turn.sh` profile. Their public UDP/TCP/TLS and relay ports are separate from the web-host `[80,443]` policy, and port `9641` must be restricted to monitoring sources.
- Host provisioning evidence must cover origin, edge, API, tracker, control-plane, retention-worker, TURN, and monitoring roles before launch.
- Evidence references for bootstrap checks must explicitly include the check IDs such as `sysctl-applied`, `file-limits-applied`, `tmpfs-var-hls-mounted`, `internal-ports-denied`, `tls-certificates-issued`, `certbot-renew-dry-run`, `compose-renders`, and `public-dns-configured`.

Example tmpfs preparation:

```bash
mount -t tmpfs -o size=10G,mode=0775 tmpfs /var/hls
chown 1000:1000 /var/hls
```

Example tuning application:

```bash
install -m 0644 infra/host/sysctl.d/99-swarmcast.conf /etc/sysctl.d/99-swarmcast.conf
install -m 0644 infra/host/security-limits.d/99-swarmcast.conf /etc/security/limits.d/99-swarmcast.conf
sysctl --system
sysctl net.core.somaxconn net.ipv4.tcp_max_syn_backlog fs.file-max
ulimit -n
```

Example firewall review and application:

```bash
DRY_RUN=1 infra/host/firewall/ufw-swarmcast.sh
ALLOW_SSH_FROM=203.0.113.10/32 APPLY=1 infra/host/firewall/ufw-swarmcast.sh
ufw status verbose
```

Example TLS issuance:

```bash
infra/host/tls/certbot-swarmcast.sh
CERTBOT_MODE=standalone DOMAINS=origin.prod.example,api.prod.example,tracker.prod.example CERTBOT_EMAIL=ops@example.com STAGING=1 APPLY=1 infra/host/tls/certbot-swarmcast.sh
CERTBOT_MODE=webroot DOMAINS=origin.prod.example,api.prod.example,tracker.prod.example CERTBOT_EMAIL=ops@example.com STAGING=0 APPLY=1 infra/host/tls/certbot-swarmcast.sh
RELOAD_COMMAND='docker compose -f infra/edge/docker-compose.yml exec -T nginx-edge nginx -s reload' DOMAINS=edge.prod.example CERTBOT_EMAIL=ops@example.com STAGING=0 APPLY=1 infra/host/tls/certbot-swarmcast.sh
certbot renew --dry-run
```

Use `CERTBOT_MODE=standalone` for first issuance before nginx is running. Use `CERTBOT_MODE=webroot` after compose is up; origin and edge nginx serve `/.well-known/acme-challenge/` from `/var/www/certbot`.

Reboot validation:

- `sysctl net.core.somaxconn` returns `65535`.
- `sysctl fs.file-max` returns at least `2097152`.
- New login shells for the deployment user report `ulimit -n` at `1048576`.
- `ufw status verbose` shows default deny incoming, allows `80/tcp` and `443/tcp`, and denies direct access to internal service ports.
- `certbot certificates` shows one certificate directory for each public hostname used by nginx.
- `certbot renew --dry-run` succeeds and the deploy hook reloads the active nginx service.
- Docker compose renders successfully before starting services.

Host provisioning evidence must be attached before launch:

```bash
npm run host:provisioning:evidence:validate -- path/to/host-provisioning-evidence.json
```

Synthetic shape checks can use:

```bash
npm run host:provisioning:evidence:validate -- --allow-synthetic test-fixtures/infra/host-provisioning-complete.synthetic.json
```
