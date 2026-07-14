# SwarmCast — Production Blueprint
### P2P-Assisted Live Restreaming Platform (Hetzner origin + Android app)

**Version:** 1.0 — 2026-07-05
**Scope:** This single document contains everything required to build, deploy, and operate the complete system: origin server (Hetzner AX41, 64 GB RAM, 1 Gbps), signaling/tracker, **self-hosted Delivery Fleet (edge-origin nodes — no third-party CDN)**, the P2P distribution protocol with network coding, and the Android client app.

> **⚠️ ZERO-CDN CANONICAL NOTE (read first):** This blueprint is the **zero-CDN, Hetzner-only** design. Your only cost is rented Hetzner boxes; there is no third-party CDN and no per-GB bill. The fallback tier is a **Delivery Fleet** of your own edge-origin nodes (§10). **§21 (physics/economics) and §22 (production code) are canonical.** Sections 5–9 and 11–13 describe the shared core; wherever an early snippet says "CDN", read it as "**Delivery Fleet edge node**" — the URL contract is identical (an HTTPS segment URL), only the host is yours. The four production techniques that make zero-CDN work — network coding, mandatory contribution, super-peers, deficit-only seeding — are fully coded in **§22**, which supersedes any CDN-era detail above it.

> **Legal gate (read first):** This system redistributes streams from an m3u source to the public. You MUST hold a license that explicitly permits *redistribution/rebroadcast* — a subscription that lets you *watch* is not that. With P2P, every viewer's device also *re-transmits* the stream to other viewers, making each viewer a redistributor — so the license must cover peer relay, not just playback. Verify before building. Everything below assumes you are authorized.

---

## Table of Contents

1. [Physics & Capacity Model](#1-physics--capacity-model)
2. [System Architecture](#2-system-architecture)
3. [Technology Decisions](#3-technology-decisions)
4. [Server: OS & Network Tuning](#4-server-os--network-tuning)
5. [Server: Ingest & Packaging Service](#5-server-ingest--packaging-service)
6. [Server: Origin HTTP (nginx)](#6-server-origin-http-nginx)
7. [Server: Tracker / Signaling Server](#7-server-tracker--signaling-server)
8. [Server: Auth Service](#8-server-auth-service)
9. [P2P Protocol Specification](#9-p2p-protocol-specification)
10. [Delivery Fleet (Self-Hosted Edge Nodes — replaces CDN)](#10-delivery-fleet-self-hosted-edge-origin-nodes--replaces-the-cdn)
11. [Android App: Project Setup](#11-android-app-project-setup)
12. [Android App: Core Code](#12-android-app-core-code)
13. [Android App: UI](#13-android-app-ui)
14. [Security Model](#14-security-model)
15. [Deployment (Docker Compose + runbook)](#15-deployment)
16. [Monitoring & Alerting](#16-monitoring--alerting)
17. [Load & Chaos Testing](#17-load--chaos-testing)
18. [Scaling Roadmap](#18-scaling-roadmap)
19. [Build Order Checklist](#19-build-order-checklist)
20. [The 20,000-Channel Problem: Deep Analysis & Fleet Design](#20-the-20000-channel-problem-deep-analysis--fleet-design)
21. [Zero-CDN Architecture: Hetzner-Only Cost (State of the Art)](#21-zero-cdn-architecture-hetzner-only-cost-state-of-the-art)
22. [Zero-CDN Production Implementation (canonical code)](#22-zero-cdn-production-implementation-canonical-code)

---

## 1. Physics & Capacity Model

Non-negotiable constraint: every viewer receives the full stream bitrate. Total egress required:

```
total_egress = viewers × bitrate
1,000,000 viewers × 5 Mbps = 5,000 Gbps
```

Your origin has 1 Gbps. Therefore the origin's role is **seed + coordinate**, never **serve everyone**. The delivery capacity comes from three pools:

| Pool | Capacity | Cost | Role |
|---|---|---|---|
| Origin/ingest (Hetzner AX41) | 1 Gbps/box | flat (rent) | Ingest, packaging, tracker, injecting first coded seeds |
| Peer swarm (viewers' uplinks) | grows with audience | free | Bulk delivery — the primary delivery network |
| **Delivery Fleet** (your own Hetzner edge-origin nodes) | 1 Gbps/box × N | flat (rent) | **Self-hosted fallback**: long-tail channels, cellular/NAT-blocked peers, cold-start, churn deficit. Sized by `(1−ρ)×V×B` — see §21. **This replaces the CDN.** |

### Origin budget (1 Gbps = 1000 Mbps usable ≈ 900 Mbps planned)

| Consumer | Budget |
|---|---|
| Channel ingest (inbound — separate direction, full duplex, but plan it) | up to 150 channels × 5 Mbps = 750 Mbps **in** |
| Injecting coded seeds into swarms | 700 Mbps **out** |
| Tracker WebSocket traffic (~1 kbps/peer avg) | 100,000 peers ≈ 100 Mbps **out** peak, ~10 Mbps typical |
| Metrics, SSH, overhead | 50 Mbps |

**Rules that keep you inside budget:**
- Lazy ingest: a channel is pulled from the m3u source **only while ≥1 viewer watches it**. Idle 60 s → torn down.
- **Deficit-only seeding** (§22): origin/edge injects each coded segment only until the swarm holds enough independent packets, then goes silent — with network coding the swarm regenerates the rest itself. Origin egress per channel is bounded by seed count, **not** viewer count.
- Delivery-Fleet edge nodes absorb the residual `(1−ρ)×V×B` that the swarm can't cover; this is your own hardware, a fixed cost, never a per-GB bill.
- Hard cap concurrent ingested channels at **140** (config value). Beyond that, new channel requests get a "capacity" error — raise the cap only after measuring real ingest bitrates.
- **With a 20,000-channel catalog this cap becomes the binding constraint well before viewer count does — read §20 before sizing anything.** The single-box design in §1–§8 is the correct *unit*; §20 turns it into a fleet.

### Expected offload (design targets)

| Audience segment | P2P offload target | Served by |
|---|---|---|
| Popular channel, ≥1000 concurrent, WiFi-heavy | 95–99 % (with network coding, §22) | swarm |
| Mid channel, 50–1000 concurrent | 50–85 % | swarm + Delivery Fleet |
| Long tail, <50 concurrent | 0–40 % | Delivery Fleet (downscaled, §21.6) |
| Cellular / symmetric-NAT peers | 0 % upload (leech-only) | swarm download where possible, else Delivery Fleet |

### RAM budget (64 GB)

| Component | Budget |
|---|---|
| Tracker (peer sessions, swarms, segment maps) | 24 GB (≈ 500k sessions at ~40 KB effective) |
| Segment cache in tmpfs (140 ch × 30 segs × ~1.3 MB) | 8 GB |
| ffmpeg workers (140 × ~60 MB) | 10 GB |
| nginx, auth, Prometheus, OS page cache | remainder |

---

## 2. System Architecture

```
                        m3u SOURCE (upstream provider)
                                   │  (pull, per active channel)
                                   ▼
┌─────────────────────────── HETZNER AX41 ────────────────────────────┐
│                                                                      │
│  ┌────────────────┐   spawns    ┌─────────────────────────────────┐  │
│  │ Ingest          │──────────► │ ffmpeg worker (per channel)     │  │
│  │ Orchestrator    │   1/chan   │ copy-remux → CMAF/fMP4 HLS      │  │
│  │ (Node)          │            │ 2 s segments → /dev/shm/hls/    │  │
│  └───────┬────────┘            └──────────────┬──────────────────┘  │
│          │ REST (internal)                     │ writes               │
│          │                                     ▼                      │
│  ┌───────┴────────┐             ┌─────────────────────────────────┐  │
│  │ Auth service    │             │ tmpfs /dev/shm/hls/<chan>/      │  │
│  │ (JWT issue/     │             │  playlist.m3u8 + seg_*.m4s      │  │
│  │  verify)        │             └──────────────┬──────────────────┘  │
│  └────────────────┘                             │ serves               │
│                                                 ▼                      │
│  ┌────────────────┐             ┌─────────────────────────────────┐  │
│  │ Tracker /       │             │ nginx origin :443               │  │
│  │ Signaling (WS)  │             │  /live/<chan>/...  (token-gated)│  │
│  │ uWebSockets.js  │             │  rate-limited, edge-allowlisted │  │
│  └───────┬────────┘             └──────────────┬──────────────────┘  │
│          │                                      │ cache-fill (once    │
└──────────┼──────────────────────────────────────┼──── per edge node)─┘
           │ WSS (join/offer/answer/ice/have)     ▼
           │              ┌────────────────────────────────────┐
           │              │  DELIVERY FLEET (your Hetzner boxes) │
           │              │  nginx caching reverse-proxy, tmpfs  │
           │              │  NO third-party CDN — §10            │
           │              └─────────┬──────────────────────────┘
           │                        │ HTTPS fallback (your hardware)
           ▼                        ▼
   ┌──────────────────────── VIEWER SWARM (per channel) ───────────────┐
   │   Android app: ExoPlayer ◄─ P2P DataSource ◄─ WebRTC DataChannels │
   │   WiFi super-peers seed the swarm; cellular peers leech;          │
   │   swarm misses → your own Delivery Fleet edge node (not a CDN)    │
   └────────────────────────────────────────────────────────────────────┘
```

**Data flow for one segment, one popular channel (zero-CDN):**
1. ffmpeg writes `seg_1041.m4s` to tmpfs; orchestrator splits it into `k` coded blocks (network coding, §22), computes SHA-256, pushes `{channel, seq: 1041, sha256, size, k}` to tracker.
2. Tracker broadcasts `segment_announce` to the channel swarm and marks a few high-uplink WiFi **super-peers** as seed-tier for this segment.
3. Seed-tier super-peers fetch the initial coded packets from origin/edge; **deficit-only seeding** stops origin once the swarm collectively holds `k` independent packets.
4. Every peer thereafter obtains *any* `k` independent coded packets from neighbours over WebRTC — order and source don't matter (network coding), then verifies the reassembled segment against the SHA-256.
5. Any peer that can't reach `k` packets from the swarm before its deadline fetches the segment from your **Delivery Fleet edge node** (your hardware, fixed cost). Quality never degrades; only which of *your* boxes pays.

---

## 3. Technology Decisions

| Concern | Choice | Why (and what was rejected) |
|---|---|---|
| Packaging | HLS with **fMP4/CMAF, 2 s segments**, sliding window 30 | Whole-segment granularity is P2P-friendly (one hash, one transfer unit). LL-HLS partial segments rejected: parts fragment the swarm's unit of exchange for ~2 s latency gain that live TV doesn't need. Target glass-to-glass latency: 8–12 s. |
| Transcoding | **None for head channels — copy remux only** (`-c copy`); **downscale for cold tail** (§21.6) | Copy-remux guarantees "same quality as original" *by construction* at ~0 CPU. Cold tail channels are transcoded to a lower bitrate to shrink the Delivery-Fleet residual they cause. |
| **Delivery efficiency** | **Random Linear Network Coding (RLNC), GF(2⁸), k=32** (§22) | Any `k` independent coded packets reconstruct a segment — eliminates the "rare last chunk" that leaks origin egress; pushes offload ρ toward 1. This is the core zero-CDN enabler. |
| **Contribution** | **Mandatory tit-for-tat** — upload to watch smoothly (§22) | Free viewers pay in bandwidth, not money; keeps the swarm self-sustaining so your only cost is boxes. |
| Tracker | **Node 22 + uWebSockets.js** | Handles 500k+ WS connections on one box; JSON protocol keeps client simple. Rejected: Go (fine too, but Node shares code/types with orchestrator); raw BitTorrent trackers (no WebRTC signaling). |
| P2P transport | **WebRTC DataChannels (libwebrtc)** | NAT traversal built in, DTLS encryption built in, works on Android natively. Rejected: raw UDP/QUIC custom protocol — months of NAT-traversal pain to reinvent ICE. |
| Origin HTTP | **nginx** serving tmpfs | Boring, fast, battle-tested. |
| Android player | **Media3 ExoPlayer** + custom `DataSource` | The DataSource seam lets P2P sit invisibly under a stock player: zero player-side quality compromise. |
| Android WebRTC | `io.getstream:stream-webrtc-android` (prebuilt libwebrtc) | Maintained prebuilt of google libwebrtc. |
| Auth | Short-lived **JWT (ES256)** per session + per-channel claims | Stops your origin becoming a free public restreamer for others. |
| **Fallback** | **Self-hosted Delivery Fleet** — Hetzner edge-origin nodes (§10) | **No third-party CDN, no per-GB bill.** Fixed cost = box count = `(1−ρ)×V×B / 0.8 Gbps`. This is the whole "Hetzner-only" strategy. |
| Containers | Docker Compose per host | No k8s ceremony. Systemd units also provided. |

---

## 4. Server: OS & Network Tuning

Ubuntu 24.04 LTS. Apply once, reboot.

### /etc/sysctl.d/90-swarmcast.conf

```conf
# --- file descriptors / connections (tracker holds 100k+ sockets) ---
fs.file-max = 4194304
fs.nr_open  = 4194304

# --- network core ---
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65536
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.ipv4.tcp_rmem = 4096 87380 33554432
net.ipv4.tcp_wmem = 4096 65536 33554432

# --- many short-lived + many idle connections ---
net.ipv4.tcp_max_syn_backlog = 65536
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_fin_timeout = 15

# --- keep idle WS sessions cheap ---
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 4

# --- BBR: better egress utilization on a saturated 1 Gbps uplink ---
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
```

### /etc/security/limits.d/90-swarmcast.conf

```conf
*    soft nofile 2097152
*    hard nofile 2097152
root soft nofile 2097152
root hard nofile 2097152
```

### tmpfs for segments — /etc/fstab

```fstab
tmpfs /var/hls tmpfs rw,size=10G,mode=0755,noatime 0 0
```

Segments live in RAM: zero disk I/O in the hot path, and a crash/reboot loses only a sliding window that is stale anyway.

### Firewall (ufw)

```bash
ufw default deny incoming
ufw allow 22/tcp        # SSH (restrict to your IP if static)
ufw allow 443/tcp       # nginx: HLS origin + tracker WSS (reverse-proxied)
ufw allow 80/tcp        # ACME challenges only
ufw enable
```

TLS: use certbot (`certbot certonly --webroot`) for `origin.yourdomain.tv` and `tracker.yourdomain.tv`. Auto-renewal via the packaged systemd timer.

---

## 5. Server: Ingest & Packaging Service

Node 22 service. Responsibilities:

- Parse the source m3u once at boot (and on SIGHUP) → channel catalog.
- Expose internal REST for the tracker/auth: `POST /channels/:id/demand` (viewer wants it), `GET /channels` (catalog), `GET /channels/:id/status`.
- Spawn/reap one ffmpeg per active channel (lazy ingest, 60 s idle teardown, hard cap 140).
- Watch the tmpfs output dir; on each finished segment: SHA-256 it, notify tracker.
- Restart crashed ffmpeg with exponential backoff; mark channel `degraded` after 5 consecutive failures.

### 5.1 Directory layout (server repo)

```
swarmcast-server/
├── docker-compose.yml
├── .env                        # secrets (never commit)
├── ingest/
│   ├── package.json
│   ├── src/
│   │   ├── index.js            # boot + REST
│   │   ├── catalog.js          # m3u parsing
│   │   ├── channelManager.js   # ffmpeg lifecycle
│   │   ├── segmentWatcher.js   # hash + tracker notify
│   │   └── config.js
│   └── Dockerfile
├── tracker/
│   ├── package.json
│   ├── src/
│   │   ├── index.js            # uWS server
│   │   ├── swarm.js            # per-channel swarm state
│   │   ├── protocol.js         # message validation
│   │   └── scoring.js          # peer selection
│   └── Dockerfile
├── auth/
│   ├── package.json
│   ├── src/index.js
│   └── Dockerfile
└── nginx/
    ├── nginx.conf
    └── conf.d/swarmcast.conf
```

### 5.2 ingest/src/config.js

```js
export const config = {
  m3uPath: process.env.M3U_PATH || "/config/source.m3u",
  hlsRoot: process.env.HLS_ROOT || "/var/hls",
  maxChannels: parseInt(process.env.MAX_CHANNELS || "140", 10),
  idleTeardownMs: 60_000,
  segmentSeconds: 2,
  windowSegments: 30,           // sliding window kept on disk/playlist
  restApiPort: 7001,
  trackerInternalUrl: process.env.TRACKER_INTERNAL_URL || "http://tracker:7002",
  internalToken: process.env.INTERNAL_TOKEN,   // shared secret between services
  ffmpegBin: "ffmpeg",
  ffprobeBin: "ffprobe",
  restartBackoffMs: [1000, 2000, 5000, 10000, 30000],
};
```

### 5.3 ingest/src/catalog.js — m3u parser

```js
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

/** Parse #EXTINF m3u/m3u_plus into a channel catalog. */
export function parseM3u(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const channels = new Map();
  let pending = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF")) {
      const name = line.split(",").pop().trim();
      const attr = (k) => (line.match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || "";
      pending = {
        name,
        logo: attr("tvg-logo"),
        group: attr("group-title"),
        tvgId: attr("tvg-id"),
      };
    } else if (line && !line.startsWith("#") && pending) {
      // Stable id: hash of source URL — survives catalog reorders.
      const id = createHash("sha1").update(line).digest("hex").slice(0, 12);
      channels.set(id, { id, ...pending, sourceUrl: line });
      pending = null;
    }
  }
  return channels;
}
```

### 5.4 ingest/src/channelManager.js — ffmpeg lifecycle

```js
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const CH_STATE = { IDLE: "idle", STARTING: "starting", LIVE: "live", DEGRADED: "degraded" };

export class ChannelManager {
  constructor(catalog, onSegment) {
    this.catalog = catalog;          // Map<id, channelMeta>
    this.onSegment = onSegment;      // (channelId, segFile) => void
    this.active = new Map();         // id -> { proc, state, lastDemand, failures, watcher }
  }

  /** Called whenever any viewer requests the channel (join or heartbeat). */
  demand(channelId) {
    const meta = this.catalog.get(channelId);
    if (!meta) return { ok: false, error: "unknown_channel" };

    const existing = this.active.get(channelId);
    if (existing) {
      existing.lastDemand = Date.now();
      return { ok: true, state: existing.state };
    }
    if (this.active.size >= config.maxChannels) {
      return { ok: false, error: "capacity" };
    }
    this.#start(channelId, meta);
    return { ok: true, state: CH_STATE.STARTING };
  }

  #start(channelId, meta) {
    const outDir = path.join(config.hlsRoot, channelId);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    // Copy-remux: no transcode → source quality preserved, ~0 CPU.
    const args = [
      "-hide_banner", "-loglevel", "warning",
      "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
      "-i", meta.sourceUrl,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c", "copy",
      "-f", "hls",
      "-hls_time", String(config.segmentSeconds),
      "-hls_list_size", String(config.windowSegments),
      "-hls_flags", "delete_segments+independent_segments+program_date_time",
      "-hls_segment_type", "fmp4",
      "-hls_fmp4_init_filename", "init.mp4",
      "-hls_segment_filename", path.join(outDir, "seg_%08d.m4s"),
      path.join(outDir, "playlist.m3u8"),
    ];

    const proc = spawn(config.ffmpegBin, args, { stdio: ["ignore", "ignore", "pipe"] });
    const entry = {
      proc, state: CH_STATE.STARTING, lastDemand: Date.now(),
      failures: 0, stderrTail: [],
    };
    this.active.set(channelId, entry);

    proc.stderr.on("data", (d) => {
      entry.stderrTail.push(d.toString());
      if (entry.stderrTail.length > 20) entry.stderrTail.shift();
    });

    proc.on("exit", (code) => {
      const e = this.active.get(channelId);
      if (!e || e.proc !== proc) return;
      const recentDemand = Date.now() - e.lastDemand < config.idleTeardownMs;
      if (recentDemand && code !== 0) {
        e.failures += 1;
        if (e.failures >= 5) { e.state = CH_STATE.DEGRADED; return; }
        const backoff = config.restartBackoffMs[Math.min(e.failures - 1, 4)];
        setTimeout(() => {
          if (this.active.get(channelId) === e) {
            this.active.delete(channelId);
            this.#start(channelId, meta);
          }
        }, backoff);
      } else {
        this.active.delete(channelId);
        rmSync(outDir, { recursive: true, force: true });
      }
    });

    entry.state = CH_STATE.LIVE; // watcher flips to LIVE on first real segment; simplified here
  }

  /** Run every 15 s from index.js. */
  reapIdle() {
    const now = Date.now();
    for (const [id, e] of this.active) {
      if (now - e.lastDemand > config.idleTeardownMs) {
        e.proc.kill("SIGTERM");
        this.active.delete(id);
      }
    }
  }

  status(channelId) {
    const e = this.active.get(channelId);
    return e ? { state: e.state, failures: e.failures } : { state: CH_STATE.IDLE };
  }
}
```

### 5.5 ingest/src/segmentWatcher.js — hash + announce

```js
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "./config.js";

/**
 * Watches HLS_ROOT for new segments. When a segment file stops growing
 * (ffmpeg writes then renames — rename event is our trigger), hash and
 * announce to the tracker so peers can verify integrity.
 */
export function watchSegments(hlsRoot) {
  watch(hlsRoot, { recursive: true }, async (event, filename) => {
    if (!filename || !filename.endsWith(".m4s")) return;
    const full = path.join(hlsRoot, filename);
    const channelId = filename.split(path.sep)[0];
    const seqMatch = filename.match(/seg_(\d+)\.m4s$/);
    if (!seqMatch) return;
    const seq = parseInt(seqMatch[1], 10);

    try {
      // Debounce: ffmpeg may fire multiple events per file.
      await new Promise((r) => setTimeout(r, 150));
      const [buf, st] = [await readFile(full), await stat(full)];
      const sha256 = createHash("sha256").update(buf).digest("hex");

      await fetch(`${config.trackerInternalUrl}/internal/segment`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": config.internalToken,
        },
        body: JSON.stringify({ channelId, seq, sha256, size: st.size }),
      });
    } catch { /* segment may have been reaped from sliding window; ignore */ }
  });
}
```

### 5.6 ingest/src/index.js — REST + boot

```js
import http from "node:http";
import { parseM3u } from "./catalog.js";
import { ChannelManager } from "./channelManager.js";
import { watchSegments } from "./segmentWatcher.js";
import { config } from "./config.js";

const catalog = parseM3u(config.m3uPath);
const manager = new ChannelManager(catalog);
watchSegments(config.hlsRoot);
setInterval(() => manager.reapIdle(), 15_000);

process.on("SIGHUP", () => {
  const next = parseM3u(config.m3uPath);
  catalog.clear();
  for (const [k, v] of next) catalog.set(k, v);
});

const server = http.createServer((req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (req.headers["x-internal-token"] !== config.internalToken)
    return send(401, { error: "unauthorized" });

  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/channels") {
    return send(200, [...catalog.values()].map(({ sourceUrl, ...pub }) => pub));
  }
  if (req.method === "POST" && parts[0] === "channels" && parts[2] === "demand") {
    return send(200, manager.demand(parts[1]));
  }
  if (req.method === "GET" && parts[0] === "channels" && parts[2] === "status") {
    return send(200, manager.status(parts[1]));
  }
  send(404, { error: "not_found" });
});

server.listen(config.restApiPort, () =>
  console.log(`ingest REST on :${config.restApiPort}, ${catalog.size} channels in catalog`));
```

### 5.7 ingest/Dockerfile

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY src ./src
USER node
CMD ["node", "src/index.js"]
```

`ingest/package.json`:

```json
{
  "name": "swarmcast-ingest",
  "type": "module",
  "version": "1.0.0",
  "dependencies": {}
}
```

(Deliberately zero runtime deps — Node 22 stdlib covers all of it.)

---

## 6. Server: Origin HTTP (nginx)

Serves HLS from tmpfs, terminates TLS, reverse-proxies the tracker WSS, and gates everything behind JWT (via `auth_request` to the auth service). Only the **Delivery-Fleet edge nodes** (§10) and first-tier seeded super-peers should hit `/live/` in steady state.

### nginx/conf.d/swarmcast.conf

```nginx
# Rate-limit direct segment fetches — the swarm and Delivery Fleet should carry the bulk.
limit_req_zone $binary_remote_addr zone=seg:50m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=segconn:50m;

upstream tracker_ws { server tracker:7000; keepalive 64; }
upstream auth_svc   { server auth:7003;    keepalive 16; }

# ---- Origin: HLS ----
server {
    listen 443 ssl;
    http2 on;
    server_name origin.yourdomain.tv;

    ssl_certificate     /etc/letsencrypt/live/origin.yourdomain.tv/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/origin.yourdomain.tv/privkey.pem;

    # JWT check on every media request (subrequest; ~0.2 ms, keepalive'd)
    location = /_auth {
        internal;
        proxy_pass http://auth_svc/verify;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Auth-Token $arg_token;
    }

    location /live/ {
        auth_request /_auth;
        root /var/hls_alias;              # /var/hls mounted; see compose
        rewrite ^/live/(.*)$ /$1 break;

        limit_req  zone=seg burst=30 nodelay;
        limit_conn segconn 20;

        # Delivery-Fleet edge nodes bypass rate limits (allowlist your edge-node IPs here)
        # include /etc/nginx/edge_allowlist.conf;

        location ~ \.m3u8$ {
            add_header Cache-Control "no-cache";
            add_header Access-Control-Allow-Origin "*";
        }
        location ~ \.(m4s|mp4)$ {
            add_header Cache-Control "public, max-age=300, immutable";
            add_header Access-Control-Allow-Origin "*";
        }
    }
}

# ---- Tracker WSS ----
server {
    listen 443 ssl;
    http2 on;
    server_name tracker.yourdomain.tv;

    ssl_certificate     /etc/letsencrypt/live/tracker.yourdomain.tv/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tracker.yourdomain.tv/privkey.pem;

    location /ws {
        proxy_pass http://tracker_ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

Worker tuning in the main `nginx.conf`: `worker_processes auto; worker_rlimit_nofile 1048576; events { worker_connections 65536; multi_accept on; }`.

---

## 7. Server: Tracker / Signaling Server

The heart of the P2P layer. One process, uWebSockets.js, holds every peer session and every swarm. Responsibilities:

1. Authenticate peers (JWT from auth service) at WS upgrade.
2. Maintain per-channel swarms: peer list, per-peer segment bitmaps, upload scores.
3. Relay WebRTC signaling (offer/answer/ICE) between peers — the tracker never touches media.
4. Receive segment announcements (hash manifests) from ingest; broadcast to swarms.
5. Elect **first-tier seeders** per segment (the few peers allowed to hit origin directly).
6. Report demand to ingest (`POST /channels/:id/demand`) on join and every 30 s per active swarm.

### 7.1 tracker/package.json

```json
{
  "name": "swarmcast-tracker",
  "type": "module",
  "version": "1.0.0",
  "dependencies": {
    "uWebSockets.js": "github:uNetworking/uWebSockets.js#v20.51.0",
    "jose": "^5.9.0"
  }
}
```

### 7.2 tracker/src/protocol.js — wire protocol

All messages are JSON text frames. Every message has `t` (type). Sizes are capped at 16 KB; oversized frames disconnect the peer.

```js
// Client -> Tracker
// {t:"join",    channelId, caps:{upload:boolean, transport:"wifi"|"cell"}}
// {t:"leave"}
// {t:"have",    seqs:[int]}          // segments this peer now holds
// {t:"signal",  to:peerId, data:{}}  // opaque WebRTC offer/answer/ICE blob
// {t:"stats",   dl_p2p:int, dl_edge:int, ul:int}  // bytes since last report (edge = Delivery Fleet)
// {t:"ping"}

// Tracker -> Client
// {t:"joined",  peerId, swarmSize, swarmMode, superPeer, playlistUrl, edgeUrlTemplate, originUrlTemplate}
// {t:"peers",   peers:[{id, transport}]}       // candidates to connect to
// {t:"signal",  from:peerId, data:{}}
// {t:"segment", seq, sha256, size, seedTier:boolean} // seedTier: YOU fetch from origin
// {t:"pong"}
// {t:"error",   code, msg}

const MAX_MSG = 16 * 1024;

export function parse(buf) {
  if (buf.byteLength > MAX_MSG) return null;
  try {
    const m = JSON.parse(Buffer.from(buf).toString("utf8"));
    if (typeof m?.t !== "string") return null;
    return m;
  } catch { return null; }
}
```

### 7.3 tracker/src/scoring.js — peer selection & seeder election

```js
/**
 * Peer score drives two decisions:
 *  - which peers to hand out as connection candidates (prefer good uploaders)
 *  - which peers get seedTier=true for a new segment (fetch from origin, fan out)
 *
 * score = 0.5*uploadRatio + 0.3*reliability + 0.2*capacityHint
 *  uploadRatio: bytes uploaded / bytes downloaded (capped at 3, normalized)
 *  reliability: 1 - (failed transfers / total transfers)
 *  capacityHint: wifi=1, cell=0 (cell peers never seed)
 */
export function score(peer) {
  const ratio = Math.min(peer.bytesUp / Math.max(peer.bytesDownP2p + peer.bytesDownEdge, 1), 3) / 3;
  const total = peer.transfersOk + peer.transfersFail;
  const reliability = total === 0 ? 0.5 : peer.transfersOk / total;
  const capacity = peer.transport === "wifi" && peer.uploadEnabled ? 1 : 0;
  return 0.5 * ratio + 0.3 * reliability + 0.2 * capacity;
}

/** Pick N seeders for a new segment: top-scored WiFi peers, round-robined so no one is hammered. */
export function electSeeders(swarm, n) {
  const eligible = [...swarm.peers.values()]
    .filter((p) => p.transport === "wifi" && p.uploadEnabled)
    .sort((a, b) => score(b) - score(a));
  const start = swarm.seedRotation % Math.max(eligible.length, 1);
  swarm.seedRotation += 1;
  const out = [];
  for (let i = 0; i < eligible.length && out.length < n; i++) {
    out.push(eligible[(start + i) % eligible.length]);
  }
  return out;
}

/** Candidate peers to hand a newcomer: mix of top uploaders + random (keeps mesh connected). */
export function candidatePeers(swarm, forPeer, n = 12) {
  const others = [...swarm.peers.values()].filter((p) => p.id !== forPeer.id);
  others.sort((a, b) => score(b) - score(a));
  const top = others.slice(0, Math.ceil(n / 2));
  const rest = others.slice(Math.ceil(n / 2));
  for (let i = rest.length - 1; i > 0; i--) {          // shuffle remainder
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...top, ...rest.slice(0, n - top.length)]
    .map((p) => ({ id: p.id, transport: p.transport }));
}
```

### 7.4 tracker/src/swarm.js

```js
import { electSeeders, candidatePeers } from "./scoring.js";

const SEEDERS_PER_SEGMENT = (swarmSize) =>
  Math.max(3, Math.min(15, Math.ceil(swarmSize * 0.02)));   // 2 %, clamped [3,15]

export class Swarm {
  constructor(channelId) {
    this.channelId = channelId;
    this.peers = new Map();          // peerId -> peer session object
    this.segments = new Map();       // seq -> {sha256, size, ts}
    this.seedRotation = 0;
  }

  addPeer(peer) { this.peers.set(peer.id, peer); }
  removePeer(peerId) { this.peers.delete(peerId); }

  announceSegment(seq, sha256, size, send) {
    this.segments.set(seq, { sha256, size, ts: Date.now() });
    // keep manifest window bounded
    for (const k of this.segments.keys())
      if (k < seq - 60) this.segments.delete(k);

    const seeders = new Set(
      electSeeders(this, SEEDERS_PER_SEGMENT(this.peers.size)).map((p) => p.id));

    for (const p of this.peers.values()) {
      send(p, { t: "segment", seq, sha256, size, seedTier: seeders.has(p.id) });
    }
  }

  peersFor(peer) { return candidatePeers(this, peer); }
  get size() { return this.peers.size; }
}
```

### 7.5 tracker/src/index.js

```js
import uWS from "uWebSockets.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { parse } from "./protocol.js";
import { Swarm } from "./swarm.js";

const PORT = 7000, INTERNAL_PORT = 7002;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
const INGEST_URL = process.env.INGEST_URL || "http://ingest:7001";
const AUTH_JWKS = createRemoteJWKSet(new URL(process.env.AUTH_JWKS_URL || "http://auth:7003/jwks"));
const ORIGIN_BASE = process.env.ORIGIN_BASE;      // https://origin.yourdomain.tv
const EDGE_BASE = process.env.EDGE_BASE;          // https://e1.edge.yourdomain.tv (Delivery Fleet; §10)

const swarms = new Map();        // channelId -> Swarm
const peersById = new Map();     // peerId -> ws

const swarmFor = (chId) => {
  if (!swarms.has(chId)) swarms.set(chId, new Swarm(chId));
  return swarms.get(chId);
};
const send = (peer, obj) => {
  const ws = peersById.get(peer.id ?? peer);
  if (ws) ws.send(JSON.stringify(obj));
};

// ---------- public WS ----------
uWS.App().ws("/ws", {
  maxPayloadLength: 16 * 1024,
  idleTimeout: 120,
  maxBackpressure: 256 * 1024,

  upgrade: async (res, req, ctx) => {
    const token = new URLSearchParams(req.getQuery()).get("token");
    const key = req.getHeader("sec-websocket-key");
    const proto = req.getHeader("sec-websocket-protocol");
    const ext = req.getHeader("sec-websocket-extensions");
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    try {
      const { payload } = await jwtVerify(token, AUTH_JWKS, { audience: "swarmcast" });
      if (aborted) return;
      res.cork(() => res.upgrade({ sub: payload.sub }, key, proto, ext, ctx));
    } catch {
      if (!aborted) res.cork(() => res.writeStatus("401").end());
    }
  },

  open: (ws) => {
    const p = ws.getUserData();
    p.id = randomUUID();
    p.channelId = null;
    p.transport = "cell"; p.uploadEnabled = false;
    p.bytesUp = 0; p.bytesDownP2p = 0; p.bytesDownEdge = 0;
    p.superPeer = false; p.uplinkKbps = 0;
    p.transfersOk = 0; p.transfersFail = 0;
    p.haves = new Set();
    peersById.set(p.id, ws);
  },

  message: async (ws, buf) => {
    const p = ws.getUserData();
    const m = parse(buf);
    if (!m) return ws.end(1008, "bad message");

    switch (m.t) {
      case "join": {
        if (p.channelId) swarms.get(p.channelId)?.removePeer(p.id);
        p.channelId = String(m.channelId);
        p.transport = m.caps?.transport === "wifi" ? "wifi" : "cell";
        p.uploadEnabled = !!m.caps?.upload && p.transport === "wifi";
        p.uplinkKbps = m.caps?.uplinkKbps | 0;      // measured; drives super-peer promotion (§22.2)

        // fire demand to ingest (starts ffmpeg if idle)
        fetch(`${INGEST_URL}/channels/${p.channelId}/demand`, {
          method: "POST", headers: { "x-internal-token": INTERNAL_TOKEN },
        }).catch(() => {});

        const swarm = swarmFor(p.channelId);
        swarm.addPeer(p);
        // Super-peer: WiFi peer with surplus uplink is promoted to helper (§22.2, Lever 3).
        p.superPeer = p.transport === "wifi" && p.uploadEnabled && p.uplinkKbps > 15000;
        // Tail channels below the swarm threshold run edge-only (skip mesh overhead, §21.6).
        const swarmMode = swarm.size >= 20 ? "p2p" : "edge-only";

        ws.send(JSON.stringify({
          t: "joined", peerId: p.id, swarmSize: swarm.size, swarmMode,
          superPeer: p.superPeer,
          playlistUrl: `${EDGE_BASE}/live/${p.channelId}/playlist.m3u8`,   // via Delivery Fleet (§10.3)
          edgeUrlTemplate: `${EDGE_BASE}/live/${p.channelId}/{file}`,       // Delivery-Fleet fallback (§10)
          originUrlTemplate: `${ORIGIN_BASE}/live/${p.channelId}/{file}`,   // seedTier peers only
        }));
        if (swarmMode === "p2p") ws.send(JSON.stringify({ t: "peers", peers: swarm.peersFor(p) }));
        break;
      }
      case "have":
        if (Array.isArray(m.seqs)) for (const s of m.seqs.slice(0, 64)) p.haves.add(s | 0);
        break;
      case "signal": {
        const target = peersById.get(String(m.to));
        if (target) target.send(JSON.stringify({ t: "signal", from: p.id, data: m.data }));
        break;
      }
      case "stats":
        p.bytesUp += m.ul | 0; p.bytesDownP2p += m.dl_p2p | 0; p.bytesDownEdge += m.dl_edge | 0;
        break;
      case "leave": ws.end(1000); break;
      case "ping": ws.send('{"t":"pong"}'); break;
    }
  },

  close: (ws) => {
    const p = ws.getUserData();
    peersById.delete(p.id);
    if (p.channelId) {
      const s = swarms.get(p.channelId);
      s?.removePeer(p.id);
      if (s && s.size === 0) swarms.delete(p.channelId);
    }
  },
}).listen(PORT, (ok) => console.log(ok ? `tracker ws :${PORT}` : "tracker ws FAILED"));

// ---------- internal HTTP (from ingest) ----------
uWS.App().post("/internal/segment", (res, req) => {
  if (req.getHeader("x-internal-token") !== INTERNAL_TOKEN)
    return res.writeStatus("401").end();
  let body = Buffer.alloc(0);
  res.onAborted(() => {});
  res.onData((chunk, last) => {
    body = Buffer.concat([body, Buffer.from(chunk)]);
    if (!last) return;
    try {
      const { channelId, seq, sha256, size } = JSON.parse(body.toString());
      swarms.get(channelId)?.announceSegment(seq, sha256, size, send);
      res.cork(() => res.end("ok"));
    } catch { res.cork(() => res.writeStatus("400").end()); }
  });
}).listen(INTERNAL_PORT, () => {});

// ---------- keep active channels alive at ingest ----------
setInterval(() => {
  for (const [chId, s] of swarms) {
    if (s.size > 0)
      fetch(`${INGEST_URL}/channels/${chId}/demand`, {
        method: "POST", headers: { "x-internal-token": INTERNAL_TOKEN },
      }).catch(() => {});
  }
}, 30_000);
```

**Capacity note:** uWS on this hardware comfortably holds 300–500k idle WS sessions; the hot path (signal relay) is O(1) map lookups. If tracker CPU becomes the ceiling, shard by channel across N processes behind nginx (`hash $arg_channel`) — the design is already shard-safe because swarms never talk to each other.

---

## 8. Server: Auth Service

Issues short-lived ES256 JWTs; exposes JWKS for the tracker and a `/verify` endpoint for nginx `auth_request`.

### auth/src/index.js

```js
import http from "node:http";
import { generateKeyPairSync, createPrivateKey } from "node:crypto";
import { SignJWT, exportJWK, jwtVerify, importJWK } from "jose";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const KEY_PATH = "/data/es256.pem";
if (!existsSync(KEY_PATH)) {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  writeFileSync(KEY_PATH, privateKey.export({ type: "pkcs8", format: "pem" }));
}
const privateKey = createPrivateKey(readFileSync(KEY_PATH));
const publicJwk = await exportJWK(privateKey);
publicJwk.kid = "swarmcast-1"; publicJwk.alg = "ES256";
delete publicJwk.d;
const pubKey = await importJWK(publicJwk, "ES256");

const APP_API_KEY = process.env.APP_API_KEY;   // baked into the Android app (v1; see §14)

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === "/jwks")
    return json(200, { keys: [publicJwk] });

  if (url.pathname === "/token" && req.method === "POST") {
    if (req.headers["x-app-key"] !== APP_API_KEY) return json(401, {});
    const jwt = await new SignJWT({ scope: "view" })
      .setProtectedHeader({ alg: "ES256", kid: "swarmcast-1" })
      .setSubject(crypto.randomUUID())
      .setAudience("swarmcast")
      .setIssuedAt().setExpirationTime("6h")
      .sign(privateKey);
    return json(200, { token: jwt, expiresIn: 21600 });
  }

  if (url.pathname === "/verify") {  // nginx auth_request
    const token = req.headers["x-auth-token"];
    try {
      await jwtVerify(token, pubKey, { audience: "swarmcast" });
      res.writeHead(204); res.end();
    } catch { res.writeHead(401); res.end(); }
    return;
  }
  json(404, {});
}).listen(7003, () => console.log("auth :7003"));
```

Media URLs carry the token as `?token=<jwt>` (nginx passes `$arg_token` to `/verify`). The app refreshes tokens at 5 h.

---

## 9. P2P Protocol Specification

The exchange unit is **one whole HLS segment** (~2 s, ~1.25 MB at 5 Mbps). Design invariants:

1. **Quality is never negotiated.** A peer that can't fill its buffer from the swarm falls back to a **Delivery-Fleet edge node** *before* the player stalls. The deadline for obtaining segment `seq` is `playbackDeadline(seq) - 3000 ms`.
2. **Every segment is verified.** SHA-256 from the tracker's `segment` announce is the truth. A peer delivering data that fails the hash is scored down and disconnected after 2 offenses (poisoning defense).
3. **Cellular peers never upload.** Enforced client-side (metered check) *and* tracker-side (never elected seeder, `uploadEnabled=false`).

### 9.1 DataChannel wire format

One WebRTC DataChannel per peer pair, label `sc-data`, ordered, reliable. Binary frames:

```
Frame  = Header || Payload
Header = magic(1B = 0x5C) | type(1B) | seq(u32 BE) | length(u32 BE)

type 0x01 REQUEST   payload: empty            "send me segment seq"
type 0x02 DATA      payload: chunk bytes      (chunked at 16 KB; length = chunk size)
type 0x03 DATA_END  payload: empty            "segment seq complete"
type 0x04 CANCEL    payload: empty            "stop sending seq"
type 0x05 BITFIELD  payload: u32[] seqs held  (sent on connect + every 10 s)
type 0x06 REJECT    payload: u8 reason        1=dont_have 2=busy 3=quota
type 0x07 CODED     payload: coeff[k] || codedBytes   network-coded packet (§22.1)
type 0x08 RANK      payload: u32 seq | u16 rank        "I hold `rank` independent packets for seq"
```

**Network coding (canonical for zero-CDN — see §22.1):** the exchange unit is a *coded packet*, not a raw block. `REQUEST seq` asks a neighbour to generate and send a fresh `CODED` packet for `seq`. A receiver needs **any `k` linearly-independent** coded packets to reconstruct the segment; it verifies the reconstruction against the tracker's SHA-256. `RANK` lets peers advertise how close they are, so requests target peers that can still contribute a *useful* (independent) packet.

Per-connection rules:
- Max 2 concurrent inbound REQUESTs served per peer connection; further requests get `REJECT busy`.
- Uploader-side quota: configurable, default 4 Mbps per peer connection, 12 Mbps total upload; when exceeded → `REJECT quota`. Quota is contribution-aware (§22.2): peers with low contribution ratio get served last.
- Receiver timeout: if `k` independent packets haven't arrived in `min(4000 ms, deadline)`, request from the next peer, then the Delivery Fleet.

### 9.2 Download scheduler (client-side algorithm — canonical impl in §22.3)

```
for each segment seq the player will need (from playlist, in order):
  urgency = deadline(seq) - now
  if urgency < 3000 ms and not yet decodable:
      fetch whole segment from DELIVERY FLEET edge node   # never risk a stall
  else if connected peers can still contribute independent CODED packets for seq:
      request CODED packets from best-scored contributing peers until rank == k
      decode → verify SHA-256 → announce "have"/RANK to tracker + peers,
        and thereafter generate coded packets for others (recoding)
      if urgency drops < 3000 ms before rank==k → DELIVERY FLEET
  else if tracker marked us seedTier for seq:
      fetch initial coded packets from ORIGIN/EDGE, then seed the swarm
  else:
      wait up to (urgency - 3000 ms) for packets to appear, then DELIVERY FLEET
```

This loop is the entire "invention": deadline-driven, **network-coded**, hash-verified, tiered sourcing — with your own Delivery Fleet as the only fallback. Everything else is plumbing.

### 9.3 WebRTC session establishment

- ICE servers: 2× public STUN (`stun:stun.l.google.com:19302`, `stun:stun.cloudflare.com:3478`). **No TURN** — a relayed peer link would route media through your servers, consuming the very bandwidth you're trying to save. Peers that fail ICE simply use the Delivery Fleet. (Running STUN is stateless and cheap; you may self-host `coturn` in STUN-only mode on a control box to stay fully first-party.)
- Peer A (newcomer) initiates toward candidates from the tracker `peers` message: creates DataChannel, sends offer via tracker `signal`, standard trickle ICE.
- Target connections per peer: 8 (min 4, max 12). Re-request `peers` from tracker when below min.

---

## 10. Delivery Fleet (Self-Hosted Edge-Origin Nodes — replaces the CDN)

There is **no third-party CDN in this design.** The fallback tier is a pool of your own Hetzner boxes — the **Delivery Fleet** — that serve segments over plain HTTPS exactly like an origin. A peer that can't source a segment from the swarm in time fetches it from a Delivery-Fleet node. The URL contract is identical to any HTTP segment URL, so the client code doesn't care that it's yours and not a CDN's.

### 10.1 What a Delivery-Fleet node is

An `edge` node is the **same nginx + tmpfs stack as an ingest node (§6)**, but instead of running ffmpeg it **mirrors segments from ingest nodes on demand and caches them in tmpfs**:

- On a cache miss, the edge node fetches the segment once from the owning ingest node (found via the control-plane `channel→node` map, §20.5), stores it in tmpfs with a short TTL (segment lifetime ~ window × segment_seconds ≈ 60 s), and serves all subsequent local requests from RAM.
- This is a classic **caching reverse proxy** — nginx does it natively. Config below.
- Result: each segment is pulled from an ingest node **once per edge node**, then served many times locally. With `E` edge nodes, an ingest node uploads each segment at most `E` times regardless of viewer count.

### 10.2 nginx cache config for an edge node (`edge/nginx-edge.conf`)

```nginx
proxy_cache_path /dev/shm/edgecache levels=1:2 keys_zone=seg:200m
                 inactive=90s max_size=8g use_temp_path=off;

server {
    listen 443 ssl; http2 on;
    server_name e1.edge.yourdomain.tv;     # e2, e3, … per node
    ssl_certificate     /etc/letsencrypt/live/e1.edge.yourdomain.tv/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/e1.edge.yourdomain.tv/privkey.pem;

    location = /_auth {                      # same JWT gate as origin (§6)
        internal;
        proxy_pass http://auth_svc/verify;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Auth-Token $arg_token;
    }

    # /edge/<ingestNodeHost>/live/<chan>/<file>  → cache-fill from that ingest node
    location ~ ^/edge/(?<node>[a-z0-9\-]+)/live/(?<rest>.+)$ {
        auth_request /_auth;
        proxy_pass https://$node.origin.yourdomain.tv/live/$rest$is_args$args;
        proxy_cache seg;
        proxy_cache_valid 200 60s;           # segments: RAM-cached ~1 min
        proxy_cache_valid 404 1s;
        proxy_cache_lock on;                 # coalesce concurrent misses → ONE upstream pull
        proxy_cache_use_stale updating error timeout;
        add_header X-Cache $upstream_cache_status;
        add_header Cache-Control "public, max-age=30";
    }

    location ~ \.m3u8$ {                      # playlists: very short cache
        auth_request /_auth;
        proxy_pass https://$arg_node.origin.yourdomain.tv;   # simplified; see note
        proxy_cache seg; proxy_cache_valid 200 1s; proxy_cache_lock on;
    }
}
```

`proxy_cache_lock on` is the load-bearing line: if 10,000 peers miss the same segment at once, nginx makes **one** upstream request and serves the other 9,999 from the single fill. That is what lets a Delivery-Fleet node shield the ingest tier.

### 10.3 Playlist distribution

Playlists (`.m3u8`) change every ~2 s and are polled by every viewer — at 1M viewers that's ~500k req/s. Serve them from the **Delivery Fleet with a 1 s cache** (each edge node fills once per second from the ingest node), and set the client poll interval to the segment duration. `E` edge nodes each doing 1 req/s/channel to ingest is negligible. Never let clients poll the ingest node directly.

### 10.4 Sizing the fleet

Delivery-Fleet node count is set entirely by the swarm residual (§21):

```
edge_nodes = (1 − ρ) × V × B / (usable_Gbps_per_box ≈ 0.8)
```

At ρ=0.97, V=1M, B=5 Mbps → ~188 edge nodes. Autoscale on measured origin/edge egress and ρ (§22.7). **This is the number to watch in Grafana (§16) — ρ is your box count, and box count is your entire bill.** There is no per-GB cost to watch because there is no CDN.

### 10.5 Why this is still "Hetzner-only"

Every byte is served from hardware you rent at a flat monthly price. A traffic spike costs you nothing extra *until* it exceeds current fleet capacity, at which point autoscaling rents another box (or you pre-provision headroom). You trade a CDN's unbounded variable bill for a bounded, predictable, fixed fleet — which is exactly the goal. See §21.3 for the full cost table and §22.5 for the edge-node deployment.

---

## 11. Android App: Project Setup

- **Language:** Kotlin 2.0, coroutines everywhere. **Min SDK 26**, target 35.
- **UI:** Jetpack Compose + Media3 PlayerView (via AndroidView interop).

### Module layout

```
app/
└── src/main/java/tv/swarmcast/
    ├── App.kt
    ├── di/                       # simple manual DI (AppContainer)
    ├── data/
    │   ├── AuthRepository.kt     # /token fetch + refresh
    │   ├── ChannelRepository.kt  # catalog from server
    │   └── NetworkPolicy.kt      # metered/battery rules
    ├── p2p/
    │   ├── TrackerClient.kt      # WSS signaling
    │   ├── PeerConnectionMgr.kt  # WebRTC lifecycle
    │   ├── PeerLink.kt           # one peer: datachannel framing
    │   ├── SegmentStore.kt       # LRU cache of verified segments
    │   ├── Scheduler.kt          # §9.2 algorithm
    │   └── Wire.kt               # frame encode/decode
    ├── player/
    │   ├── P2pDataSource.kt      # ExoPlayer seam
    │   └── PlayerHolder.kt
    └── ui/
        ├── ChannelListScreen.kt
        ├── PlayerScreen.kt
        └── MainActivity.kt
```

### app/build.gradle.kts (essentials)

```kotlin
android {
    namespace = "tv.swarmcast"
    compileSdk = 35
    defaultConfig { minSdk = 26; targetSdk = 35 }
    buildFeatures { compose = true }
}

dependencies {
    val media3 = "1.6.0"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("io.getstream:stream-webrtc-android:1.3.8")   // prebuilt libwebrtc
    implementation("com.squareup.okhttp3:okhttp:4.12.0")          // WSS + HTTP
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation(platform("androidx.compose:compose-bom:2025.01.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("io.coil-kt:coil-compose:2.7.0")               // channel logos
}
```

Manifest: `INTERNET`, `ACCESS_NETWORK_STATE`; `android:usesCleartextTraffic="false"`.

---

## 12. Android App: Core Code

### 12.1 p2p/Wire.kt — frame codec (mirrors §9.1)

```kotlin
package tv.swarmcast.p2p

import java.nio.ByteBuffer

object Wire {
    const val MAGIC: Byte = 0x5C
    const val REQUEST: Byte = 0x01; const val DATA: Byte = 0x02
    const val DATA_END: Byte = 0x03; const val CANCEL: Byte = 0x04
    const val BITFIELD: Byte = 0x05; const val REJECT: Byte = 0x06
    const val CHUNK = 16 * 1024

    fun frame(type: Byte, seq: Int, payload: ByteArray = ByteArray(0)): ByteBuffer =
        ByteBuffer.allocate(10 + payload.size).apply {
            put(MAGIC); put(type); putInt(seq); putInt(payload.size); put(payload); flip()
        }

    data class Msg(val type: Byte, val seq: Int, val payload: ByteArray)

    fun parse(buf: ByteBuffer): Msg? {
        if (buf.remaining() < 10 || buf.get() != MAGIC) return null
        val type = buf.get(); val seq = buf.int; val len = buf.int
        if (len != buf.remaining()) return null
        val payload = ByteArray(len); buf.get(payload)
        return Msg(type, seq, payload)
    }

    fun bitfield(seqs: Collection<Int>): ByteArray =
        ByteBuffer.allocate(seqs.size * 4).apply { seqs.forEach { putInt(it) }; flip() }
            .let { b -> ByteArray(b.remaining()).also { b.get(it) } }

    fun parseBitfield(p: ByteArray): Set<Int> {
        val b = ByteBuffer.wrap(p); val out = HashSet<Int>(p.size / 4)
        while (b.remaining() >= 4) out.add(b.int)
        return out
    }
}
```

### 12.2 p2p/SegmentStore.kt — verified LRU cache

```kotlin
package tv.swarmcast.p2p

import java.security.MessageDigest

class SegmentStore(private val maxBytes: Long = 64L * 1024 * 1024) {
    data class Entry(val seq: Int, val bytes: ByteArray, val sha256: String)
    private val map = LinkedHashMap<Int, Entry>(64, 0.75f, true)  // access-order LRU
    private var totalBytes = 0L

    @Synchronized fun get(seq: Int): Entry? = map[seq]
    @Synchronized fun heldSeqs(): Set<Int> = map.keys.toSet()

    /** Returns false (and stores nothing) if the hash doesn't match — poisoning defense. */
    @Synchronized fun putVerified(seq: Int, bytes: ByteArray, expectedSha256: String): Boolean {
        val actual = MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
        if (actual != expectedSha256) return false
        map[seq]?.let { totalBytes -= it.bytes.size }
        map[seq] = Entry(seq, bytes, actual)
        totalBytes += bytes.size
        val it = map.entries.iterator()
        while (totalBytes > maxBytes && it.hasNext()) {
            totalBytes -= it.next().value.bytes.size; it.remove()
        }
        return true
    }
}
```

### 12.3 p2p/TrackerClient.kt — signaling over WSS

```kotlin
package tv.swarmcast.p2p

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.serialization.json.*
import okhttp3.*
import java.util.concurrent.TimeUnit

sealed class TrackerEvent {
    data class Joined(val peerId: String, val playlistUrl: String, val edgeTemplate: String,
                      val originTemplate: String, val swarmMode: String, val superPeer: Boolean) : TrackerEvent()
    data class Peers(val peers: List<PeerInfo>) : TrackerEvent()
    data class Signal(val from: String, val data: JsonObject) : TrackerEvent()
    data class Segment(val seq: Int, val sha256: String, val size: Long, val seedTier: Boolean) : TrackerEvent()
    object Disconnected : TrackerEvent()
}
data class PeerInfo(val id: String, val transport: String)

class TrackerClient(
    private val wsUrl: String,               // wss://tracker.yourdomain.tv/ws
    private val tokenProvider: suspend () -> String,
    private val scope: CoroutineScope,
) {
    val events = MutableSharedFlow<TrackerEvent>(extraBufferCapacity = 256)
    private var ws: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .pingInterval(45, TimeUnit.SECONDS).build()
    private var reconnectDelay = 1000L

    fun connect(channelId: String, wifi: Boolean, uploadEnabled: Boolean, uplinkKbps: Int = 0) {
        scope.launch {
            val token = tokenProvider()
            val req = Request.Builder().url("$wsUrl?token=$token").build()
            ws = client.newWebSocket(req, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    reconnectDelay = 1000L
                    sendJson(buildJsonObject {
                        put("t", "join"); put("channelId", channelId)
                        putJsonObject("caps") {
                            put("upload", uploadEnabled && wifi)
                            put("transport", if (wifi) "wifi" else "cell")
                            put("uplinkKbps", uplinkKbps)   // measured; enables super-peer promotion (§22.2)
                        }
                    })
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    val m = Json.parseToJsonElement(text).jsonObject
                    val ev = when (m["t"]?.jsonPrimitive?.content) {
                        "joined" -> TrackerEvent.Joined(
                            m["peerId"]!!.jsonPrimitive.content,
                            m["playlistUrl"]!!.jsonPrimitive.content,
                            m["edgeUrlTemplate"]!!.jsonPrimitive.content,
                            m["originUrlTemplate"]!!.jsonPrimitive.content,
                            m["swarmMode"]?.jsonPrimitive?.content ?: "p2p",
                            m["superPeer"]?.jsonPrimitive?.boolean ?: false)
                        "peers" -> TrackerEvent.Peers(m["peers"]!!.jsonArray.map {
                            val o = it.jsonObject
                            PeerInfo(o["id"]!!.jsonPrimitive.content, o["transport"]!!.jsonPrimitive.content)
                        })
                        "signal" -> TrackerEvent.Signal(
                            m["from"]!!.jsonPrimitive.content, m["data"]!!.jsonObject)
                        "segment" -> TrackerEvent.Segment(
                            m["seq"]!!.jsonPrimitive.int, m["sha256"]!!.jsonPrimitive.content,
                            m["size"]!!.jsonPrimitive.long, m["seedTier"]!!.jsonPrimitive.boolean)
                        else -> null
                    }
                    ev?.let { events.tryEmit(it) }
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, r: Response?) {
                    events.tryEmit(TrackerEvent.Disconnected)
                    scope.launch {                      // exponential backoff reconnect
                        delay(reconnectDelay)
                        reconnectDelay = (reconnectDelay * 2).coerceAtMost(30_000L)
                        connect(channelId, wifi, uploadEnabled)
                    }
                }
            })
        }
    }

    fun sendJson(obj: JsonObject) { ws?.send(obj.toString()) }
    fun announceHave(seqs: List<Int>) = sendJson(buildJsonObject {
        put("t", "have"); putJsonArray("seqs") { seqs.forEach { add(it) } }
    })
    fun signal(to: String, data: JsonObject) = sendJson(buildJsonObject {
        put("t", "signal"); put("to", to); put("data", data)
    })
    fun reportStats(dlP2p: Long, dlEdge: Long, ul: Long) = sendJson(buildJsonObject {
        put("t", "stats"); put("dl_p2p", dlP2p); put("dl_edge", dlEdge); put("ul", ul)
    })
    fun close() { ws?.close(1000, null); ws = null }
}
```

### 12.4 p2p/PeerLink.kt — one peer connection

```kotlin
package tv.swarmcast.p2p

import kotlinx.coroutines.CompletableDeferred
import org.webrtc.DataChannel
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/** Wraps one DataChannel: request/serve segments per the §9.1 protocol. */
class PeerLink(
    val peerId: String,
    private val channel: DataChannel,
    private val store: SegmentStore,
    private val onBitfield: (String, Set<Int>) -> Unit,
    private val uploadBudget: UploadBudget,
) : DataChannel.Observer {

    val remoteHas = HashSet<Int>()
    private var inflight: Pair<Int, CompletableDeferred<ByteArray?>>? = null
    private var rxBuf = ByteArrayOutputStream()
    var failures = 0; var successes = 0

    init { channel.registerObserver(this) }

    /** Request a segment; suspends until DATA_END, REJECT, or timeout (caller enforces timeout). */
    fun request(seq: Int): CompletableDeferred<ByteArray?> {
        val d = CompletableDeferred<ByteArray?>()
        inflight = seq to d
        rxBuf = ByteArrayOutputStream()
        channel.send(DataChannel.Buffer(Wire.frame(Wire.REQUEST, seq), true))
        return d
    }

    fun cancel(seq: Int) {
        channel.send(DataChannel.Buffer(Wire.frame(Wire.CANCEL, seq), true))
        inflight?.let { if (it.first == seq) { it.second.complete(null); inflight = null } }
    }

    fun sendBitfield(seqs: Set<Int>) =
        channel.send(DataChannel.Buffer(Wire.frame(Wire.BITFIELD, 0, Wire.bitfield(seqs)), true))

    override fun onMessage(buffer: DataChannel.Buffer) {
        val m = Wire.parse(buffer.data) ?: return
        when (m.type) {
            Wire.BITFIELD -> { remoteHas.addAll(Wire.parseBitfield(m.payload)); onBitfield(peerId, remoteHas) }
            Wire.DATA -> inflight?.let { if (it.first == m.seq) rxBuf.write(m.payload) }
            Wire.DATA_END -> inflight?.let {
                if (it.first == m.seq) { it.second.complete(rxBuf.toByteArray()); inflight = null }
            }
            Wire.REJECT -> inflight?.let {
                if (it.first == m.seq) { it.second.complete(null); inflight = null }
            }
            Wire.REQUEST -> serve(m.seq)
            Wire.CANCEL -> { /* stop an in-progress upload; tracked via servingCancelled set in full impl */ }
        }
    }

    private fun serve(seq: Int) {
        val entry = store.get(seq)
        when {
            entry == null ->
                channel.send(DataChannel.Buffer(Wire.frame(Wire.REJECT, seq, byteArrayOf(1)), true))
            !uploadBudget.tryReserve(entry.bytes.size.toLong()) ->
                channel.send(DataChannel.Buffer(Wire.frame(Wire.REJECT, seq, byteArrayOf(3)), true))
            else -> {
                var off = 0
                while (off < entry.bytes.size) {
                    // Respect WebRTC backpressure: pause while bufferedAmount is high.
                    while (channel.bufferedAmount() > 1_000_000) Thread.sleep(5)
                    val len = minOf(Wire.CHUNK, entry.bytes.size - off)
                    channel.send(DataChannel.Buffer(
                        Wire.frame(Wire.DATA, seq, entry.bytes.copyOfRange(off, off + len)), true))
                    off += len
                }
                channel.send(DataChannel.Buffer(Wire.frame(Wire.DATA_END, seq), true))
            }
        }
    }

    override fun onBufferedAmountChange(previousAmount: Long) {}
    override fun onStateChange() {}
    fun close() { channel.close() }
}

/** Global upload cap: default 12 Mbps, refilled per second (token bucket). */
class UploadBudget(private val maxBytesPerSec: Long = 1_500_000) {
    private var window = System.currentTimeMillis() / 1000
    private var used = 0L
    @Synchronized fun tryReserve(bytes: Long): Boolean {
        val now = System.currentTimeMillis() / 1000
        if (now != window) { window = now; used = 0 }
        if (used + bytes > maxBytesPerSec * 3) return false   // allow 3s burst per segment
        used += bytes; return true
    }
}
```

### 12.5 p2p/PeerConnectionMgr.kt — WebRTC lifecycle

```kotlin
package tv.swarmcast.p2p

import android.content.Context
import kotlinx.serialization.json.*
import org.webrtc.*

class PeerConnectionMgr(
    context: Context,
    private val tracker: TrackerClient,
    private val store: SegmentStore,
    private val uploadBudget: UploadBudget,
    private val onLinkReady: (PeerLink) -> Unit,
    private val onLinkClosed: (String) -> Unit,
) {
    private val factory: PeerConnectionFactory
    private val links = HashMap<String, PeerLink>()
    private val pcs = HashMap<String, PeerConnection>()
    private val iceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun.cloudflare.com:3478").createIceServer(),
    )

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
        factory = PeerConnectionFactory.builder().createPeerConnectionFactory()
    }

    val connectedCount get() = links.size
    fun link(peerId: String): PeerLink? = links[peerId]
    fun allLinks(): Collection<PeerLink> = links.values

    /** We initiate toward a candidate from the tracker's peers list. */
    fun connectTo(peer: PeerInfo) {
        if (pcs.containsKey(peer.id) || pcs.size >= 12) return
        val pc = createPc(peer.id) ?: return
        val dc = pc.createDataChannel("sc-data", DataChannel.Init().apply { ordered = true })
        wireDataChannel(peer.id, dc)
        pc.createOffer(sdpObserver { sdp ->
            pc.setLocalDescription(sdpObserver {}, sdp)
            tracker.signal(peer.id, buildJsonObject {
                put("kind", "offer"); put("sdp", sdp.description)
            })
        }, MediaConstraints())
    }

    /** Handle an incoming signal (offer/answer/ice) relayed by the tracker. */
    fun onSignal(from: String, data: JsonObject) {
        when (data["kind"]?.jsonPrimitive?.content) {
            "offer" -> {
                val pc = pcs[from] ?: createPc(from) ?: return
                pc.setRemoteDescription(sdpObserver {},
                    SessionDescription(SessionDescription.Type.OFFER, data["sdp"]!!.jsonPrimitive.content))
                pc.createAnswer(sdpObserver { sdp ->
                    pc.setLocalDescription(sdpObserver {}, sdp)
                    tracker.signal(from, buildJsonObject {
                        put("kind", "answer"); put("sdp", sdp.description)
                    })
                }, MediaConstraints())
            }
            "answer" -> pcs[from]?.setRemoteDescription(sdpObserver {},
                SessionDescription(SessionDescription.Type.ANSWER, data["sdp"]!!.jsonPrimitive.content))
            "ice" -> pcs[from]?.addIceCandidate(IceCandidate(
                data["mid"]!!.jsonPrimitive.content,
                data["mline"]!!.jsonPrimitive.int,
                data["cand"]!!.jsonPrimitive.content))
        }
    }

    private fun createPc(peerId: String): PeerConnection? {
        val cfg = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val pc = factory.createPeerConnection(cfg, object : PeerConnection.Observer {
            override fun onIceCandidate(c: IceCandidate) {
                tracker.signal(peerId, buildJsonObject {
                    put("kind", "ice"); put("mid", c.sdpMid)
                    put("mline", c.sdpMLineIndex); put("cand", c.sdp)
                })
            }
            override fun onDataChannel(dc: DataChannel) = wireDataChannel(peerId, dc)
            override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
                if (state == PeerConnection.PeerConnectionState.FAILED ||
                    state == PeerConnection.PeerConnectionState.CLOSED) drop(peerId)
            }
            // unused callbacks omitted for brevity — implement as no-ops
            override fun onSignalingChange(s: PeerConnection.SignalingState) {}
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) {}
            override fun onIceConnectionReceivingChange(b: Boolean) {}
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(c: Array<out IceCandidate>) {}
            override fun onAddStream(s: MediaStream) {}
            override fun onRemoveStream(s: MediaStream) {}
            override fun onRenegotiationNeeded() {}
        }) ?: return null
        pcs[peerId] = pc
        return pc
    }

    private fun wireDataChannel(peerId: String, dc: DataChannel) {
        dc.registerObserver(object : DataChannel.Observer {
            override fun onStateChange() {
                if (dc.state() == DataChannel.State.OPEN) {
                    val link = PeerLink(peerId, dc, store,
                        onBitfield = { _, _ -> }, uploadBudget = uploadBudget)
                    links[peerId] = link
                    link.sendBitfield(store.heldSeqs())
                    onLinkReady(link)
                }
                if (dc.state() == DataChannel.State.CLOSED) drop(peerId)
            }
            override fun onMessage(b: DataChannel.Buffer) { links[peerId]?.onMessage(b) }
            override fun onBufferedAmountChange(p: Long) {}
        })
    }

    private fun drop(peerId: String) {
        links.remove(peerId)?.close()
        pcs.remove(peerId)?.close()
        onLinkClosed(peerId)
    }

    fun closeAll() { pcs.keys.toList().forEach(::drop) }

    private fun sdpObserver(onCreate: (SessionDescription) -> Unit) = object : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) = onCreate(sdp)
        override fun onSetSuccess() {}
        override fun onCreateFailure(e: String) {}
        override fun onSetFailure(e: String) {}
    }
}
```

### 12.6 p2p/Scheduler.kt — the deadline-driven fetch loop (§9.2)

```kotlin
package tv.swarmcast.p2p

import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Resolves segment bytes for the player. Priority: local store → swarm → origin(seed) → DELIVERY FLEET.
 * The player-facing call is fetchSegment(); it NEVER fails without trying the Delivery Fleet edge node,
 * so playback quality equals source quality always. There is NO third-party CDN.
 *
 * This is the whole-segment scheduler. §22.3 adds the network-coded (RLNC) packet-level scheduler
 * that supersedes tryPeers() for production zero-CDN offload — swap it in once §22.1 codec is present.
 */
class Scheduler(
    private val store: SegmentStore,
    private val mgr: PeerConnectionMgr,
    private val tracker: TrackerClient,
    private val http: OkHttpClient,
    private val scope: CoroutineScope,
) {
    // seq -> announce metadata from tracker
    private val manifest = HashMap<Int, TrackerEvent.Segment>()
    var edgeTemplate: String = ""     // Delivery-Fleet URL template, set from Joined event
    var originTemplate: String = ""   // origin URL template (seedTier peers only)
    var authToken: String = ""
    var superPeer: Boolean = false    // this device promoted to helper (§22.2)
    var statsDlP2p = 0L; var statsDlEdge = 0L

    fun onSegmentAnnounce(s: TrackerEvent.Segment) {
        manifest[s.seq] = s
        // Deficit-only seeding (§22.4): only seedTier peers pull the initial copy from origin/edge.
        if (s.seedTier) scope.launch { seedFromOrigin(s) }
        manifest.keys.removeAll { it < s.seq - 90 }
    }

    /** Called by P2pDataSource when ExoPlayer wants segment `seq`. urgencyMs = time before stall. */
    suspend fun fetchSegment(seq: Int, url: String, urgencyMs: Long): ByteArray {
        store.get(seq)?.let { return it.bytes }
        val meta = manifest[seq]

        if (meta != null && urgencyMs > 3000) {
            val fromSwarm = tryPeers(seq, meta, deadlineMs = urgencyMs - 3000)
            if (fromSwarm != null) return fromSwarm
        }
        // Fallback: our own Delivery Fleet edge node (not a CDN).
        return fetchHttp(edgeUrl(url)).also { bytes ->
            statsDlEdge += bytes.size
            meta?.let { if (store.putVerified(seq, bytes, it.sha256)) afterAcquire(seq) }
        }
    }

    private suspend fun tryPeers(seq: Int, meta: TrackerEvent.Segment, deadlineMs: Long): ByteArray? {
        val start = System.currentTimeMillis()
        val holders = mgr.allLinks()
            .filter { seq in it.remoteHas }
            .sortedByDescending { it.successes - 3 * it.failures }
        for (link in holders) {
            val remaining = deadlineMs - (System.currentTimeMillis() - start)
            if (remaining < 500) break
            val bytes = withTimeoutOrNull(minOf(4000L, remaining)) { link.request(seq).await() }
            if (bytes == null) { link.failures++; link.cancel(seq); continue }
            if (store.putVerified(seq, bytes, meta.sha256)) {
                link.successes++; statsDlP2p += bytes.size
                afterAcquire(seq)
                return bytes
            } else link.failures += 2          // hash mismatch: poisoning penalty
        }
        return null
    }

    /** seedTier peers pull the initial copy and fan it out; deficit-only means few peers do this. */
    private suspend fun seedFromOrigin(meta: TrackerEvent.Segment) {
        try {
            val base = if (superPeer) originTemplate else edgeTemplate   // helpers may hit origin directly
            val url = base.replace("{file}", "seg_%08d.m4s".format(meta.seq)) + "?token=$authToken"
            val bytes = fetchHttp(url)
            if (store.putVerified(meta.seq, bytes, meta.sha256)) afterAcquire(meta.seq)
        } catch (_: Exception) { /* swarm/edge will cover it via the deadline path */ }
    }

    private fun afterAcquire(seq: Int) {
        tracker.announceHave(listOf(seq))
        mgr.allLinks().forEach { it.sendBitfield(store.heldSeqs()) }
    }

    private fun edgeUrl(originUrl: String): String {
        val file = originUrl.substringAfterLast('/').substringBefore('?')
        return edgeTemplate.replace("{file}", file) + "?token=$authToken"
    }

    private suspend fun fetchHttp(url: String): ByteArray = withContext(Dispatchers.IO) {
        http.newCall(Request.Builder().url(url).build()).execute().use { resp ->
            if (!resp.isSuccessful) throw java.io.IOException("HTTP ${resp.code} for $url")
            resp.body!!.bytes()
        }
    }
}
```

### 12.7 player/P2pDataSource.kt — the ExoPlayer seam

```kotlin
package tv.swarmcast.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import kotlinx.coroutines.runBlocking
import tv.swarmcast.p2p.Scheduler

/**
 * Media3 DataSource that answers segment reads from the P2P scheduler.
 * Playlists and init segments pass through to plain HTTP (Delivery-Fleet edge node).
 * ExoPlayer never knows P2P exists — hence zero quality compromise.
 */
class P2pDataSource(
    private val scheduler: Scheduler,
    private val httpFactory: DefaultHttpDataSource.Factory,
) : BaseDataSource(/* isNetwork = */ true) {

    class Factory(
        private val scheduler: Scheduler,
        private val httpFactory: DefaultHttpDataSource.Factory,
    ) : DataSource.Factory {
        override fun createDataSource() = P2pDataSource(scheduler, httpFactory)
    }

    private var data: ByteArray? = null
    private var pos = 0
    private var passthrough: DataSource? = null
    private var uri: Uri? = null

    override fun open(dataSpec: DataSpec): Long {
        uri = dataSpec.uri
        val path = dataSpec.uri.path ?: ""
        val segMatch = Regex("seg_(\\d+)\\.m4s$").find(path)

        if (segMatch == null) {                     // playlist / init.mp4 → plain HTTP
            passthrough = httpFactory.createDataSource()
            return passthrough!!.open(dataSpec)
        }

        val seq = segMatch.groupValues[1].toInt()
        // Urgency: how much buffer the player has. Conservative fixed floor in v1;
        // v2 can read player.totalBufferedDuration via a shared holder.
        val bytes = runBlocking {
            scheduler.fetchSegment(seq, dataSpec.uri.toString(), urgencyMs = 8000)
        }
        data = bytes
        pos = dataSpec.position.toInt()
        transferStarted(dataSpec)
        return (bytes.size - pos).toLong()
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        passthrough?.let { return it.read(buffer, offset, length) }
        val d = data ?: return C.RESULT_END_OF_INPUT
        if (pos >= d.size) return C.RESULT_END_OF_INPUT
        val n = minOf(length, d.size - pos)
        System.arraycopy(d, pos, buffer, offset, n)
        pos += n
        bytesTransferred(n)
        return n
    }

    override fun getUri(): Uri? = uri
    override fun close() {
        passthrough?.close(); passthrough = null
        data = null
        transferEnded()
    }
}
```

### 12.8 data/NetworkPolicy.kt — the "mobile citizenship" rules

```kotlin
package tv.swarmcast.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager

class NetworkPolicy(private val context: Context) {
    /** Upload (seeding) allowed only on unmetered WiFi with battery > 25% or charging. */
    fun uploadAllowed(): Boolean = isWifiUnmetered() && batteryOk()

    fun isWifiUnmetered(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !cm.isActiveNetworkMetered
    }

    private fun batteryOk(): Boolean {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return bm.isCharging || pct > 25
    }

    /**
     * Reported uplink capacity in kbps. Used by the tracker to promote fat-uplink WiFi peers
     * to super-peers (§22.2). linkDownstreamBandwidthKbps has an upstream sibling; where the OS
     * doesn't populate it, refine with a one-time active probe (upload a segment to an edge node
     * and measure) on first promotion. Returns 0 on cellular/unknown so such peers never seed.
     */
    fun measuredUplinkKbps(): Int {
        if (!isWifiUnmetered()) return 0
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return 0
        return caps.linkUpstreamBandwidthKbps
    }
}
```

### 12.9 player/PlayerHolder.kt — assembling the stack

```kotlin
package tv.swarmcast.player

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import okhttp3.OkHttpClient
import tv.swarmcast.data.NetworkPolicy
import tv.swarmcast.p2p.*

class PlayerHolder(private val context: Context, private val tokenProvider: suspend () -> String) {
    private val scope: CoroutineScope = MainScope()
    private val http = OkHttpClient()
    private val store = SegmentStore()
    private val budget = UploadBudget()
    private val policy = NetworkPolicy(context)

    lateinit var player: ExoPlayer; private set
    private lateinit var tracker: TrackerClient
    private lateinit var mgr: PeerConnectionMgr
    private lateinit var scheduler: Scheduler

    fun play(channelId: String, trackerWsUrl: String) {
        tracker = TrackerClient(trackerWsUrl, tokenProvider, scope)
        mgr = PeerConnectionMgr(context, tracker, store, budget,
            onLinkReady = { it.sendBitfield(store.heldSeqs()) },
            onLinkClosed = {})
        scheduler = Scheduler(store, mgr, tracker, http, scope)

        tracker.events.onEach { ev ->
            when (ev) {
                is TrackerEvent.Joined -> {
                    scheduler.edgeTemplate = ev.edgeTemplate      // Delivery-Fleet fallback (§10)
                    scheduler.originTemplate = ev.originTemplate   // seedTier peers only
                    scheduler.superPeer = ev.superPeer
                    scheduler.authToken = tokenProvider()
                    // Tail channels: tracker says "edge-only" → skip the P2P mesh entirely (§21.6).
                    p2pEnabled = ev.swarmMode == "p2p"
                    startPlayer(ev.playlistUrl)
                }
                is TrackerEvent.Peers -> if (p2pEnabled) ev.peers.forEach { mgr.connectTo(it) }
                is TrackerEvent.Signal -> mgr.onSignal(ev.from, ev.data)
                is TrackerEvent.Segment -> scheduler.onSegmentAnnounce(ev)
                TrackerEvent.Disconnected -> { /* reconnect handled inside TrackerClient */ }
            }
        }.launchIn(scope)

        tracker.connect(channelId,
            wifi = policy.isWifiUnmetered(),
            uploadEnabled = policy.uploadAllowed(),
            uplinkKbps = policy.measuredUplinkKbps())   // drives super-peer promotion (§22.2)
    }

    @Volatile private var p2pEnabled = true

    private fun startPlayer(playlistUrl: String) {
        val httpFactory = DefaultHttpDataSource.Factory()
        val mediaSource = HlsMediaSource.Factory(P2pDataSource.Factory(scheduler, httpFactory))
            .createMediaSource(MediaItem.fromUri(playlistUrl))
        player = ExoPlayer.Builder(context)
            // Deep live buffer (§22.4, Lever 4): 30–60 s of runway lets the swarm source each
            // segment before it's urgent, absorbing peer churn without hitting the Delivery Fleet.
            .setLoadControl(
                androidx.media3.exoplayer.DefaultLoadControl.Builder()
                    .setBufferDurationsMs(30_000, 60_000, 2_500, 5_000)
                    .build())
            .build().apply {
                setMediaSource(mediaSource)
                prepare(); playWhenReady = true
                playerInitialized = true
            }
    }

    @Volatile var playerInitialized = false; private set

    fun release() {
        if (::player.isInitialized) player.release()
        if (::mgr.isInitialized) mgr.closeAll()
        if (::tracker.isInitialized) tracker.close()
        scope.cancel()
    }
}
```

---

## 13. Android App: UI

### ui/ChannelListScreen.kt

```kotlin
package tv.swarmcast.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import tv.swarmcast.data.Channel

@Composable
fun ChannelListScreen(channels: List<Channel>, onSelect: (Channel) -> Unit) {
    var query by remember { mutableStateOf("") }
    val filtered = channels.filter { it.name.contains(query, ignoreCase = true) }

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query, onValueChange = { query = it },
            label = { Text("Search channels") },
            modifier = Modifier.fillMaxWidth().padding(12.dp))
        LazyColumn {
            items(filtered, key = { it.id }) { ch ->
                ListItem(
                    headlineContent = { Text(ch.name) },
                    supportingContent = { Text(ch.group) },
                    leadingContent = {
                        AsyncImage(model = ch.logo, contentDescription = null,
                            modifier = Modifier.size(44.dp))
                    },
                    modifier = Modifier.clickable { onSelect(ch) })
                HorizontalDivider()
            }
        }
    }
}
```

### ui/PlayerScreen.kt

```kotlin
package tv.swarmcast.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.PlayerView
import tv.swarmcast.player.PlayerHolder

@Composable
fun PlayerScreen(holder: PlayerHolder, channelId: String, trackerUrl: String) {
    DisposableEffect(channelId) {
        holder.play(channelId, trackerUrl)
        onDispose { holder.release() }
    }
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx -> PlayerView(ctx).apply { useController = true } },
        update = { view -> if (holder.playerInitialized) view.player = holder.player })
}
```

(`Channel` data class: `id, name, logo, group` — fetched from `GET https://api.yourdomain.tv/channels` which nginx proxies to the ingest REST with the internal token added server-side; never expose the internal token to the app. Add `playerInitialized` as a simple boolean flag on PlayerHolder set in `startPlayer`.)

---

## 14. Security Model

| Threat | Defense |
|---|---|
| Freeloaders scraping your origin (someone else restreaming *you*) | JWT on every playlist/segment request (nginx `auth_request`); 6 h expiry; per-IP rate limits on `/live/` |
| Segment poisoning (malicious peer serves garbage) | SHA-256 per segment announced by tracker over WSS; client stores/serves only verified bytes; 2-strike disconnect + score penalty |
| Tracker spam / signal flooding | 16 KB frame cap, message-type allowlist, per-connection token bucket (add: max 50 msgs/s → disconnect), JWT required at upgrade |
| Fake `have` announcements (peer claims segments it lacks) | Requester timeout + failure scoring naturally routes around liars; repeated failures → link dropped |
| Upstream source URL leakage | `sourceUrl` stripped from all public catalog responses (§5.6); only ffmpeg on the server ever sees it |
| MITM | TLS everywhere: HTTPS origin + Delivery-Fleet edge nodes, WSS tracker, DTLS (built into WebRTC) between peers |
| App API key extraction (v1 weakness) | Accepted for v1: key only gates token issuance, tokens are rate-limited per IP. v2: Play Integrity API attestation on `/token`. |
| Internal API exposure | `INTERNAL_TOKEN` shared secret; internal ports (7001/7002/7003) bound to the Docker network only, never published |

**Privacy note:** peers see each other's IP addresses (inherent to WebRTC). Disclose this in your privacy policy; offer a "P2P off" toggle in settings (player then streams purely from your Delivery Fleet — it still works, just uses more of *your* box capacity).

---

## 15. Deployment

### docker-compose.yml

```yaml
services:
  ingest:
    build: ./ingest
    restart: unless-stopped
    environment:
      M3U_PATH: /config/source.m3u
      HLS_ROOT: /var/hls
      MAX_CHANNELS: "140"
      TRACKER_INTERNAL_URL: http://tracker:7002
      INTERNAL_TOKEN: ${INTERNAL_TOKEN}
    volumes:
      - /var/hls:/var/hls            # tmpfs mount from fstab
      - ./config:/config:ro
    networks: [internal]

  tracker:
    build: ./tracker
    restart: unless-stopped
    environment:
      INTERNAL_TOKEN: ${INTERNAL_TOKEN}
      INGEST_URL: http://ingest:7001
      AUTH_JWKS_URL: http://auth:7003/jwks
      ORIGIN_BASE: https://origin.yourdomain.tv
      EDGE_BASE: https://edge.yourdomain.tv     # Delivery-Fleet entry (LB over edge nodes; §10)
    ulimits:
      nofile: { soft: 1048576, hard: 1048576 }
    networks: [internal]

  auth:
    build: ./auth
    restart: unless-stopped
    environment:
      APP_API_KEY: ${APP_API_KEY}
    volumes:
      - auth-keys:/data
    networks: [internal]

  nginx:
    image: nginx:1.27
    restart: unless-stopped
    ports: ["443:443", "80:80"]
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - /var/hls:/var/hls_alias:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    networks: [internal]

  prometheus:
    image: prom/prometheus:v2.53.0
    restart: unless-stopped
    volumes: [./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro, prom-data:/prometheus]
    networks: [internal]

  grafana:
    image: grafana/grafana:11.1.0
    restart: unless-stopped
    ports: ["127.0.0.1:3000:3000"]   # access via SSH tunnel only
    volumes: [grafana-data:/var/lib/grafana]
    networks: [internal]

networks:
  internal: {}
volumes:
  auth-keys: {}
  prom-data: {}
  grafana-data: {}
```

`.env` (chmod 600, never commit):

```env
INTERNAL_TOKEN=<openssl rand -hex 32>
APP_API_KEY=<openssl rand -hex 32>
```

### First-deploy runbook

```bash
# 1. OS prep (as root)
apt update && apt install -y docker.io docker-compose-v2 certbot ufw
# apply §4 sysctl + limits + fstab, then: sysctl --system && mount -a && reboot

# 2. DNS: A records for origin.yourdomain.tv, tracker.yourdomain.tv, api.yourdomain.tv → server IP
# 3. TLS
certbot certonly --standalone -d origin.yourdomain.tv -d tracker.yourdomain.tv -d api.yourdomain.tv

# 4. App
git clone <your-repo> /opt/swarmcast && cd /opt/swarmcast
cp /path/to/source.m3u config/source.m3u
openssl rand -hex 32   # → INTERNAL_TOKEN in .env
openssl rand -hex 32   # → APP_API_KEY in .env
docker compose up -d --build

# 5. Smoke test
TOKEN=$(curl -s -X POST -H "x-app-key: $APP_API_KEY" https://api.yourdomain.tv/token | jq -r .token)
curl -s "https://api.yourdomain.tv/channels" | jq '.[0]'            # catalog visible
# join a channel via a test WS client, then:
curl -sI "https://origin.yourdomain.tv/live/<chanId>/playlist.m3u8?token=$TOKEN"   # 200 after ~5 s

# 6. Bring up a Delivery-Fleet edge node (§10 nginx-edge.conf), then repeat step 5 against edge.yourdomain.tv
#    Confirm X-Cache: MISS then HIT on a repeated segment fetch (proves RAM caching + shielding).
```

---

## 16. Monitoring & Alerting

**The one metric that is your business:** `offload_ratio ρ = dl_p2p / (dl_p2p + dl_edge)` — computed from the client `stats` the tracker already collects. In a zero-CDN system ρ literally *is* your box count (§21.3): a drop in ρ means the Delivery Fleet must grow. Export from the tracker via a `/metrics` Prometheus endpoint (add `prom-client`; ~20 lines).

Metrics to export and alert on:

| Metric | Source | Alert threshold |
|---|---|---|
| `swarm_peers{channel}` | tracker | — (dashboards) |
| `offload_ratio ρ` (5 m avg) | tracker (client stats) | < 0.90 for 15 m → swarm unhealthy, fleet cost rising |
| `super_peer_fraction` | tracker | < 0.10 → too few uploaders; self-sustaining at risk (§22.2) |
| `origin_egress_mbps` (ingest nodes) | node_exporter | > 800 sustained → add ingest node / raise seed tier |
| `edge_egress_mbps` (per Delivery-Fleet node) | node_exporter | > 800 sustained → **autoscale: add an edge node** |
| `edge_cache_hit_ratio` | nginx `$upstream_cache_status` | < 0.95 → shielding weak, ingest load rising |
| `active_channels{node}` | ingest | ≥ 135 (near per-node cap) |
| `ffmpeg_restarts_total{channel}` | ingest | > 5/h per channel → source problem |
| `segment_age_seconds{channel}` (now − last segment) | ingest | > 10 s → channel stalled |
| `tracker_connections` | tracker | drop > 30 % in 5 m → tracker/network incident |
| Client-side stall rate | app → tracker `stats` (add `stalls` field) | > 2 %/5 m → swarm or edge issue |

Grafana: one dashboard, four rows — **Audience** (peers, per-channel, super-peer fraction), **Cost** (ρ, total fleet egress, live box count — no $/GB line because there is none), **Ingest/Edge health** (egress, cache-hit, CPU, RAM, ffmpeg restarts), **Quality** (stall rate, segment age).

---

## 17. Load & Chaos Testing

You cannot rent a million phones; you can simulate the swarm on cloud VMs with a **headless peer** — a Node script implementing the client protocol (tracker WS + wrtc DataChannels + scheduler) without a player. Build it by porting §12.3/12.6 to Node with the `@roamhq/wrtc` package (~300 lines, shares `Wire` framing logic).

Test ladder (run each before moving on):

1. **1 channel, 3 real devices on one WiFi** — verify P2P transfer actually occurs (watch `dl_p2p` in tracker stats; expect >50 % on devices 2 and 3).
2. **1 channel, 200 headless peers** (4× cloud VMs, 50 peers each) — verify: origin egress stays ≈ seeders-only (~15 × 5 Mbps); offload > 80 %; no tracker CPU saturation.
3. **50 channels, 2000 peers, Zipf-distributed** (realistic audience skew) — verify lazy ingest churn, capacity cap behavior, Delivery-Fleet fallback on tail channels, `edge-only` mode kicks in below 20 peers.
4. **Chaos:** kill 30 % of peers mid-segment every 30 s (verify no client stalls — the Delivery Fleet catches everything); kill ffmpeg for one channel (verify backoff/restart + `segment_age` alert); kill tracker for 60 s (verify players continue streaming from the Delivery Fleet — **this must be true**: tracker death raises your box load, never breaks playback).
5. **Poisoning drill:** run one headless peer that serves random bytes / bad coded packets; verify victims hash-reject after decode, score it down, and disconnect it within 2 requests.
6. **Self-sustaining drill (zero-CDN critical):** 500 headless peers, vary the WiFi-super-peer fraction from 5 %→25 %; confirm the point where `edge_egress` flattens (swarm becomes self-sustaining) matches the §22.2 prediction (~1 in 8). This calibrates your real ρ and therefore your fleet size.

Acceptance criteria for v1 launch: stall rate < 1 %, **ρ > 0.90** on a 200-peer WiFi-majority swarm with network coding on, edge egress flat while swarm size doubles.

---

## 18. Scaling Roadmap

**Phase 1 (this document): one ingest box + one edge box + swarm, zero CDN.** Honest ceiling: audience is effectively unlimited on *popular* channels (swarm scales with viewers, Delivery Fleet grows with residual); your ingest box caps *simultaneously watched distinct channels* (~140) and your edge-node count caps the residual you can serve.

**Phase 2 — when tracker CPU > 60 % or WS connections > 300k:** shard tracker by channel hash across processes/cores (nginx `hash $arg_channel consistent`). No code changes — swarms are already independent.

**Phase 3 — when ingest bandwidth is the limit (>140 concurrent channels):** second cheap Hetzner box as a dedicated ingest/packager; tracker and auth stay on box 1. Channels are partitioned across ingest boxes by hash; each pushes announces to the same tracker.

**Phase 4 — ABR (multi-quality):** transcode popular channels only (GPU box or Hetzner dedicated with iGPU/QSV) into 1080p/720p/480p; each rendition is its own swarm. Long-tail channels stay copy-remux single-quality. This is the point where "same quality as original" becomes "original quality *plus* lower options for weak networks" — do not build this before the P2P core is proven.

**Phase 5 — multi-region seeds:** 2–3 additional cheap boxes (US/Asia) running only nginx + a static peer that joins swarms as a permanent high-score super-peer. Cuts intercontinental peer latency and edge-fleet load. The protocol already treats them as ordinary excellent peers — zero new code, just deployment.

**What never changes across phases:** the client, the wire protocol, the segment-hash trust model, and the Delivery-Fleet-fallback guarantee (your own hardware, never a third party).

---

## 19. Build Order Checklist

Sequenced so every step is testable in isolation. Estimated total: ~6–8 weeks solo, ~3–4 weeks for two people (one server, one Android).

**Week 1 — Origin pipeline (no P2P yet)**
- [ ] §4 OS tuning, tmpfs, TLS, DNS
- [ ] Ingest service: catalog + lazy ffmpeg + idle reaper (§5)
- [ ] nginx serving `/live/` from tmpfs (§6), auth service + JWT gate (§8)
- [ ] ✅ *Milestone: VLC plays any channel via `playlist.m3u8?token=…` with ~10 s latency*

**Week 2 — Delivery Fleet + tracker skeleton**
- [ ] Delivery-Fleet edge node: nginx caching reverse-proxy + `proxy_cache_lock` (§10), playlist-from-edge
- [ ] Tracker: WS auth, join/leave, swarms, segment announce pipeline from ingest (§7)
- [ ] Segment hashing in ingest → tracker → verify announces arrive in a WS test client
- [ ] ✅ *Milestone: test WS client joins, receives peers + segment announces; edge node serves with X-Cache HIT*

**Weeks 3–4 — Android client, Delivery-Fleet-only mode first**
- [ ] Project setup, auth/token flow, channel list UI (§11, §13)
- [ ] ExoPlayer + P2pDataSource with scheduler in edge-only mode (§12.7)
- [ ] ✅ *Milestone: app plays every channel from your Delivery Fleet — this is your fully-working fallback product*

**Weeks 5–6 — P2P engine**
- [ ] TrackerClient, PeerConnectionMgr, PeerLink, SegmentStore, Scheduler (§12)
- [ ] NetworkPolicy gating (metered/battery) + uplink measurement
- [ ] 3-device WiFi test (§17.1)
- [ ] ✅ *Milestone: `dl_p2p > 0` on real devices; hash verification proven with a poisoned-peer test*

**Weeks 7–9 — Zero-CDN production levers (§22)**
- [ ] RLNC codec: ingest block-split + client encode/decode/recode (§22.1)
- [ ] Contribution enforcement + super-peer promotion (§22.2)
- [ ] Deficit-only seeding + deep buffer (§22.4)
- [ ] Delivery-Fleet autoscaler keyed on ρ / edge egress (§22.5, §22.7)
- [ ] ✅ *Milestone: self-sustaining drill (§17.6) shows edge egress flattening → ρ > 0.90 measured*

**Weeks 10–11 — Hardening & scale test**
- [ ] Headless peer + test ladder §17.2–17.6
- [ ] Prometheus/Grafana + alerts (§16)
- [ ] Tracker rate limiting, stats aggregation, ρ / super-peer-fraction dashboard
- [ ] Play Store prep: privacy policy (P2P/IP disclosure), P2P toggle in settings
- [ ] ✅ *Milestone: acceptance criteria in §17 met → launch*

---

## Appendix A — Glass-to-glass latency budget

| Stage | Latency |
|---|---|
| Source → ffmpeg ingest | ~1–2 s |
| Segmenting (2 s segments) | 2 s |
| Playlist propagation via Delivery Fleet (1 s TTL) | ~1–2 s |
| Player buffer (deep, for P2P churn absorption — §22.4) | 30 s |
| **Total** | **≈ 35–40 s** |

Note: the deep buffer is the deliberate latency-for-offload trade of the zero-CDN design (§22.4). For a rebroadcast/live-TV product this is fine. If you need <12 s, shrink the buffer to ~6 s and accept a lower ρ (more edge boxes) — that is the direct latency↔cost dial. If you later need <5 s, that's the LL-HLS + parts redesign — do it only with proven demand, because it further reduces P2P efficiency.

## Appendix B — Cost model cheat sheet (zero-CDN)

```
There is NO per-GB bill. Cost is box count, and box count is set by offload ρ:

delivery_boxes = (1 − ρ) × V × B / (0.8 Gbps usable per box)
monthly_cost  ≈ (ingest_boxes + delivery_boxes + tracker + control) × €40

Example, V=1,000,000 concurrent, B=5 Mbps (V×B = 5,000 Gbps):
  ρ=0.90 → 625 delivery boxes    ρ=0.97 → 188    ρ=0.99 → 63
Add ~118 ingest boxes (20k catalog, §20) + ~5 control/tracker.
→ every point of ρ is BOXES, not dollars-per-GB; §16's dashboard is the P&L. (Full table: §21.3.)
```

## Appendix C — Known v1 limitations (accepted deliberately)

1. Single ingest box per channel = single point of failure for *new* segments (players keep running from Delivery-Fleet-cached content + the swarm during a brief outage; a channel stalls only if its ingest node is down > buffer window). §20 fleet + §22.5 addresses it.
2. App API key is extractable → token endpoint abusable until Play Integrity is added (v2).
3. Zero-CDN quality guarantee is *statistical*, not absolute (§21.5 trilemma): a small fraction of edge-of-swarm peers may briefly re-buffer under heavy churn instead of a CDN catching them. The deep buffer (§22.4) and Delivery Fleet keep this rare.
4. A majority-cellular audience breaks the self-sustaining condition and inflates the delivery fleet (§21.5). Know your audience's WiFi share before sizing.
5. The long tail (~14k near-empty channels) has no swarm and is served by your own downscaled boxes, not cheap CDN bytes — the one place zero-CDN costs more than a CDN would (§21.6).
6. iOS, web, and TV clients are out of scope here; the protocol supports them (web via the same design over browser WebRTC + WebAssembly RLNC).

---

---

## 20. The 20,000-Channel Problem: Deep Analysis & Fleet Design

> **Reading note:** §20 analyzes catalog scale and, for comparison, quotes the *CDN-based* cost baseline. The system you are building is **zero-CDN** — wherever §20 says "CDN," the zero-CDN design replaces it with the **Delivery Fleet** (§10) and the economics of §21/§22 apply (fixed box cost, not per-GB). §20's *catalog* analysis (ingest fan-out, `C_watched`, tail behavior) is fully valid and unchanged; only the *fallback tier* differs. §21.6 covers the tail specifically for zero-CDN.

A 20,000-channel catalog where *any* user can watch *any* channel is a fundamentally different engineering problem from a few hundred channels. The P2P layer (§9) solves *audience* scale. It does **not** solve *catalog* scale. This section is the expert analysis of the second problem and the design that closes it.

### 20.1 The insight most people get wrong

The catalog size (20,000) is **almost irrelevant on its own**. A channel with zero viewers costs zero (lazy ingest, §5). Three numbers actually drive the system, and they are independent:

1. **`C_watched`** — distinct channels being watched *at the same instant*. This drives **ingest bandwidth and ffmpeg count** on your servers.
2. **`V`** — total concurrent viewers. With P2P this drives almost nothing on your servers for popular channels, and CDN cost for the tail.
3. **The shape of the distribution** — how `V` viewers spread across `C_watched` channels. This determines your **P2P offload** and therefore your **CDN bill**.

The trap: people size for `V` (viewers) and forget `C_watched` (ingest fan-out). With 20K channels, **`C_watched` is what breaks the single box**, not `V`.

### 20.2 How many channels are watched at once? (the real math)

Viewership follows a Zipf/Pareto distribution: rank channels by popularity, the *k*-th most popular gets ≈ `1/k^s` of the audience (`s ≈ 0.9–1.1` for TV; use `s = 1.0`). Two forces bound `C_watched`:

- **Coupon-collector effect:** as `V` grows, more of the long tail gets ≥1 viewer. But the tail saturates — beyond a point, new viewers pile onto already-watched channels, not new ones.
- **Catalog ceiling:** `C_watched ≤ 20,000` always.

Modeled results (Zipf s=1.0 over 20,000 channels, one viewer picks one channel):

| Concurrent viewers `V` | Distinct channels watched `C_watched` | Channels with ≥ 1000 viewers (strong P2P) | Channels with 1–10 viewers (edge-only tail) |
|---|---|---|---|
| 1,000 | ~430 | 0 | ~380 |
| 10,000 | ~2,600 | ~2 | ~2,200 |
| 100,000 | ~8,900 | ~12 | ~7,000 |
| 1,000,000 | ~16,500 | ~70 | ~11,000 |
| 5,000,000 | ~19,400 | ~180 | ~10,500 |

**Read this table carefully — it is the whole ballgame:**

- At **1M concurrent viewers**, ~**16,500 distinct channels** are live simultaneously. At 5 Mbps ingest each, that's **16,500 × 5 = 82,500 Mbps = 82.5 Gbps of pure ingest bandwidth** — before you serve a single viewer. One 1 Gbps box does 140 channels. **You need ~120 ingest boxes just to pull the streams.** This is the real headline number, and it has nothing to do with P2P.
- The **head is tiny**: even at 1M viewers only ~70 channels have massive swarms. P2P offload is spectacular *there* and does almost nothing for the ~11,000 channels with a handful of viewers each.
- The **long tail dominates channel-count but not viewer-count**: those 11,000 tail channels might hold only 5–10 % of total viewers, but they force you to ingest 11,000 streams with ~0 % P2P benefit. **The tail is an ingest cost, not a delivery cost.**

### 20.3 The three cost regimes (know which one you're in)

```
                 P2P helps?     Ingest cost?     Edge-fleet cost?  Dominant expense
HEAD  (~70 ch)   ✅ 95-99%      trivial (70)     tiny              ~nothing (swarm carries it)
BODY  (~2000 ch) ⚠️ 50-85%      moderate         moderate          edge boxes for the un-offloaded half
TAIL  (~14000 ch) ❌ ~0%         HUGE (fan-out)   downscaled boxes  INGEST bandwidth + edge boxes per viewer
```

The counterintuitive truth: **with 20K channels your dominant cost is ingesting the long tail, not delivering the head.** Every architectural decision in this section optimizes the tail.

### 20.4 Fleet architecture

The §2 single box becomes a **role-separated fleet**. Each role scales on a different axis.

```
                         ┌──────────────────────────────────────┐
                         │  CONTROL PLANE (1 small box, HA pair)  │
                         │  - Catalog service (20k channels)      │
                         │  - Ingest scheduler / placement        │
                         │  - Auth (JWT/JWKS)                     │
                         │  - Consul/etcd: channel→ingester map    │
                         └───────────────┬──────────────────────┘
                                         │ assigns channels
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                 ▼                                 ▼
┌───────────────┐              ┌───────────────┐              ┌───────────────┐
│ INGEST NODE 1  │              │ INGEST NODE 2  │   ...N       │ INGEST NODE N  │
│ ffmpeg ×140    │              │ ffmpeg ×140    │  (~120 for   │ ffmpeg ×140    │
│ →tmpfs→nginx   │              │ →tmpfs→nginx   │   1M @ 20k)  │ →tmpfs→nginx   │
│ pushes hashes  │              │ pushes hashes  │              │ pushes hashes  │
└──────┬────────┘              └──────┬────────┘              └──────┬────────┘
       │ segment announces + origin pulls                            │
       └───────────────┬───────────────────────────┬────────────────┘
                       ▼                             ▼
              ┌──────────────────┐          ┌──────────────────────┐
              │ TRACKER TIER      │          │ DELIVERY FLEET (yours)│
              │ sharded by chan   │          │ N edge nodes, nginx   │
              │ (N tracker procs/ │          │ cache-lock; each pulls│
              │  boxes, hash ring)│          │ a segment from the    │
              │ 500k peers/box    │          │ OWNING ingest node 1× │
              └────────┬─────────┘          └─────────┬────────────┘
                       │ WSS signaling                 │ HTTPS fallback (your hardware)
                       ▼                               ▼
                 ┌────────────────── VIEWER SWARMS (per channel) ──────────────────┐
                 │  Android app — unchanged. It doesn't know or care how many       │
                 │  ingest boxes exist; it talks to one tracker shard + one edge URL.│
                 └──────────────────────────────────────────────────────────────────┘
```

**Key property: the client and the P2P protocol do not change at all.** Everything in §9–§13 stays identical. Fleet scaling is entirely server-side placement + routing. That's the payoff of the §2 design being shard-safe from day one.

### 20.5 Component-by-component scaling

**Catalog service (new, replaces the in-memory Map for 20K entries).** 20,000 channels is trivial data (~5 MB JSON) but you should not ship it to the app in one blob, and you must not re-scan the m3u per request. Design:
- Load m3u → SQLite (or Postgres) once; index by `group`, full-text on `name`.
- App fetches catalog **paginated + searchable**: `GET /channels?group=Sports&page=2` and `GET /channels?q=bein`. Never send 20K rows to a phone.
- Client caches the catalog locally (Room DB), refreshes via ETag. A 20K catalog is ~3–5 MB gzipped — cache it, don't refetch.

**Ingest scheduler (new, the heart of fleet scaling).** Decides *which ingest node* runs a given channel when demand arrives:
- Consistent-hash `channel_id → ingest_node` (so the same channel always lands on the same node → edge nodes cache correctly, swarms don't fragment across origins).
- On demand (from any tracker shard), scheduler checks: is the channel already running? If yes, return its node's origin URL. If no, pick the owning node by hash-ring, tell it to start ffmpeg, register `channel→node` in etcd/Consul.
- Idle teardown and the 140-cap are now **per node**. Total live-channel capacity = `140 × N nodes`. For 16,500 concurrent channels you need ⌈16500/140⌉ = **118 ingest nodes**.
- **Rebalancing:** when a node is added/removed, consistent hashing moves only `1/N` of channels. Use bounded-load consistent hashing so no node exceeds 140 even under skew.

**Tracker tier.** Shard by `hash(channel_id) % M`. Each shard owns whole channels (a swarm never spans shards → no cross-shard chatter). nginx routes WS by `?channel=` arg: `hash $arg_channel consistent`. One box holds ~500k peers, so `M = ⌈V / 500,000⌉` boxes; at 1M viewers, **2–3 tracker boxes**. Each tracker only needs the `channel→origin-node` map for its own channels (pulled from etcd).

**Origin + Delivery Fleet (zero-CDN).** Each ingest node runs nginx serving only *its* channels from *its* tmpfs at `n<node>.origin.yourdomain.tv`. The **Delivery Fleet** (§10) sits in front: edge nodes are caching reverse-proxies that fill from the owning ingest node via the control-plane `channel→node` map, encoded in the edge URL (`edge.yourdomain.tv/edge/n<node>/live/<chan>/...`). `proxy_cache_lock` guarantees one upstream pull per segment *per edge node* — the self-hosted equivalent of origin shield.

### 20.6 Tail-specific optimizations (this is where the money is)

The ~14,000 tail channels with near-zero P2P are your cost center. Attack them directly:

1. **Aggressive tail teardown.** For channels below a viewer threshold (e.g. <5), drop idle teardown from 60 s to **15 s**. A viewer channel-surfing through the tail shouldn't leave 60 s of ffmpeg + ingest bandwidth behind them. Config: two-tier `idleTeardownMs` keyed on current swarm size.

2. **Tail channels skip P2P entirely → Delivery Fleet only.** Below ~20 viewers, WebRTC mesh overhead (signaling, connection setup, failed ICE) costs more than it saves. The tracker sends the tail client `{swarmMode: "edge-only"}` in the `joined` message; the client skips PeerConnectionMgr and streams straight from a Delivery-Fleet edge node. Cleaner, lower battery, and the swarm was never going to help anyway. *(Implemented in §7.5 join handler and §12.9 `p2pEnabled` flag.)*

3. **Ingest-on-first-frame, not on-join.** For tail channels, the dominant cost is spinning ffmpeg up/down as users surf. Add a **2–3 s "preview" grace**: when a user opens a tail channel, serve the first segments from a Delivery-Fleet edge node while ffmpeg spins up; if they leave within 10 s (channel surfing), you may have avoided a full ingest entirely if someone else's demand didn't sustain it. Combine with a short pre-roll buffer to hide startup latency.

4. **Cap simultaneously-ingestible tail channels globally.** If truly 16,500 channels go live, that's the fleet cost. But you can set a **global tail budget**: e.g. guarantee ingest for the top 3,000 channels always, and serve the remaining tail from a smaller shared pool of ingest slots with best-effort admission ("channel starting, please wait"). Most tail viewers tolerate a 3–5 s start. This trades a little UX for large fleet savings — tune with real data.

5. **Source-side reality check.** 16,500 simultaneous pulls from your *upstream m3u provider* will very likely hit **their** rate limits or connection caps long before your fleet does. This is often the true ceiling. Mitigations: negotiate a redistribution/multi-connection agreement with the source (again, the legal gate); or accept that `C_watched` is capped by what the source allows, which may make the whole fleet much smaller than the table suggests.

### 20.7 Ingest scheduler — reference code (add to control plane)

```js
// control-plane/src/scheduler.js
import { createHash } from "node:crypto";

/** Bounded-load consistent hashing: channel -> ingest node, cap enforced. */
export class IngestScheduler {
  constructor(nodes, perNodeCap = 140) {
    this.nodes = nodes;                 // [{id, baseUrl, load:0}]
    this.perNodeCap = perNodeCap;
    this.placement = new Map();         // channelId -> nodeId (live channels)
  }

  #hashRank(channelId) {
    return this.nodes
      .map((n) => ({
        n,
        h: createHash("sha1").update(channelId + ":" + n.id).digest().readUInt32BE(0),
      }))
      .sort((a, b) => a.h - b.h)
      .map((x) => x.n);
  }

  /** Returns the node that should serve this channel, starting it if needed. */
  assign(channelId) {
    const existing = this.placement.get(channelId);
    if (existing) return this.nodes.find((n) => n.id === existing);

    // walk hash ring; skip nodes at capacity (bounded load)
    for (const node of this.#hashRank(channelId)) {
      if (node.load < this.perNodeCap) {
        node.load += 1;
        this.placement.set(channelId, node.id);
        return node;                    // caller calls node.baseUrl POST /demand
      }
    }
    return null;                        // whole fleet at capacity → "please wait"
  }

  release(channelId) {
    const nodeId = this.placement.get(channelId);
    if (!nodeId) return;
    const node = this.nodes.find((n) => n.id === nodeId);
    if (node) node.load = Math.max(0, node.load - 1);
    this.placement.delete(channelId);
  }

  originUrlFor(channelId) {
    const node = this.assign(channelId);
    return node ? `${node.baseUrl}/live/${channelId}` : null;
  }
}
```

The tracker's `join` handler (§7.5) now asks the scheduler (via the control plane) for the owning node instead of assuming a single origin, and puts the correct per-node **Delivery-Fleet edge URL** (and origin URL for seedTier peers) in the `joined` message. That is the *only* server change beyond deployment topology.

### 20.8 Cost model at 20K channels (the numbers that decide viability)

Fixed fleet cost (Hetzner AX41-class ≈ €40/mo each):

| Concurrent viewers | Ingest nodes (÷140 ch) | Tracker boxes | Control plane | Monthly server cost |
|---|---|---|---|---|
| 10,000 | ~19 | 1 | 1 (HA: 2) | ~€900 |
| 100,000 | ~64 | 1 | 2 | ~€2,700 |
| 1,000,000 | ~118 | 2–3 | 2 | ~€4,900 |
| 5,000,000 | ~139 (near catalog cap) | 8–10 | 2 | ~€6,100 |

> **This subsection is the CDN *comparison baseline* only** — it shows what a third-party CDN *would* cost, to justify going zero-CDN. Your actual design has **no** such bill; substitute the §21.3 box table. Kept here so you can see the number you're avoiding.

Variable CDN cost *if you used one* (Appendix B, blended offload ~40 %, dragged down by the tail):

```
1M viewers × 5 Mbps × 0.45 GB/h/Mbps × (1 − 0.40) × $0.005/GB ≈ $6,750/hour  (~$5M/month)
```

**That terrifying number is exactly why this blueprint is zero-CDN.** In the zero-CDN design that residual `(1−ρ)×V×B` is served by your own Delivery Fleet at a *fixed* box cost instead (§21.3): at ρ=0.97 that's ~188 edge boxes ≈ €7.5K/month, not $5M. The tail still matters most — it's where ρ is lowest — but it costs you *boxes*, not an unbounded per-GB meter.

### 20.9 What "any user can watch any channel" actually requires — summary

| Requirement | Solution | Where |
|---|---|---|
| 20K catalog browsable on a phone | Paginated/searchable catalog API + local cache | §20.5 |
| Any channel startable on demand | Consistent-hash ingest scheduler across N nodes | §20.5, §20.7 |
| Simultaneous distinct channels (`C_watched`) | Ingest fleet, `140 × N` capacity | §20.2, §20.4 |
| Popular channels scale to millions | P2P swarms (unchanged) | §9 |
| Tail channels stay affordable | Tail teardown, edge-only mode, downscale, admission budget | §20.6, §21.6 |
| Source provider connection limits | Commercial agreement / accept `C_watched` cap | §20.6.5 |

### 20.10 Revised build order for 20K scale

Build the single-box system (§19) **first and unchanged** — it is one ingest node. Then:

1. **Extract control plane:** move catalog + auth off the ingest node; put catalog in SQLite with the paginated API. (1 week)
2. **Add the ingest scheduler** (§20.7) + etcd/Consul for `channel→node`. Run with N=1 still — verify placement logic. (1 week)
3. **Add ingest node #2 + a Delivery-Fleet edge node**, confirm consistent hashing places channels correctly and the edge node fills from the right ingest origin (`X-Cache: HIT` on repeat). This proves the fleet. (3 days)
4. **Shard the tracker** by channel hash; verify a swarm never spans shards. (3 days)
5. **Implement tail optimizations** (§20.6, §21.6): edge-only mode flag, two-tier teardown, cold-channel downscale. Measure blended ρ before/after. (1 week)
6. **Autoscale ingest + delivery nodes** (Hetzner Cloud API + scheduler load view + measured ρ/edge egress, §22.7). Scale up at >80 % load, down at <40 %. (1 week)

**Do not build the fleet before the single box + P2P core is proven.** The fleet is deployment topology and one scheduler; the hard, novel engineering (network-coded P2P protocol, hash-verified delivery, Delivery-Fleet-fallback guarantee) is all in the single-box design and does not change.

---

---

## 21. Zero-CDN Architecture: Hetzner-Only Cost (State of the Art)

**Goal:** the *only* cost is rented Hetzner boxes. No CDN, no per-GB bill, no external service. This is achievable — but only under a condition you must engineer for, and with an honest tradeoff. This section is the deep design and the physics that bound it.

### 21.1 The single reframe that makes it work

"No CDN" does not mean "no fallback." It means **the fallback is also your own hardware.** You replace a CDN (variable, per-GB, unbounded cost) with an **origin delivery fleet** (fixed, per-box, bounded cost). That already satisfies your constraint — the question is only *how many boxes* the fallback fleet needs.

That number is governed by one equation. Everything else in this section exists to make the number small.

### 21.2 The Fundamental Theorem of CDN-less delivery

Total bits delivered per second to `V` viewers at bitrate `B` is fixed by physics: `V × B`. Those bits come from exactly two places when there is no CDN:

```
V × B  =  (peer upload delivered)  +  (origin egress)

⇒  origin_egress  =  V × B  −  U_swarm
   where U_swarm = aggregate useful upload the swarm actually delivers
```

Define **offload ratio** `ρ = U_swarm / (V × B)`. Then:

```
origin_egress = (1 − ρ) × V × B
delivery_boxes = origin_egress / (usable_Gbps_per_box ≈ 0.8)
```

**This is the whole game.** `ρ` is the multiplier on your entire hardware budget. The self-sustaining condition — the point where the swarm carries *everything* and origin only injects seeds — is `ρ → 1`, which requires:

```
average useful upload per peer  ≥  B   (the stream bitrate)
```

If your peers, *on average*, can each upload at least one stream's worth, the swarm is self-sustaining and origin cost is bounded by *ingest*, not *audience*. If they can't, origin must cover the deficit in boxes. So the entire zero-CDN program is: **drive average peer upload above the bitrate, and drive `ρ` toward 1.**

### 21.3 What ρ is worth, in boxes (the money math)

At `V = 1,000,000` concurrent, `B = 5 Mbps` → `V×B = 5,000 Gbps`. Usable ~0.8 Gbps/box (AX41, headroom left):

| Offload ρ | Origin egress | **Delivery boxes** | ~Monthly (€40/box) |
|---|---|---|---|
| 80 % | 1,000 Gbps | 1,250 | €50,000 |
| 90 % | 500 Gbps | 625 | €25,000 |
| 95 % | 250 Gbps | 313 | €12,500 |
| **97 %** | 150 Gbps | **188** | **€7,500** |
| 99 % | 50 Gbps | 63 | €2,500 |
| 99.5 % | 25 Gbps | 31 | €1,250 |

Production P2P systems report `ρ = 0.80–0.97` in good conditions (ByteDance's Swarm/PCDN, Peer5, Novage). The jump from 90 % to 99 % is a **10× reduction in delivery fleet.** That is why the four techniques below are not optional polish — each percentage point of `ρ` is directly hardware you don't rent. **Offload ratio is the entire cost function of a zero-CDN system.**

Add the ingest fleet (§20: ~118 boxes for ~16,500 concurrent channels at 1M viewers) and the control/tracker tier (~5 boxes). At `ρ = 97 %`: **~118 ingest + 188 delivery + 5 control ≈ 311 boxes ≈ €12.4K/month, fully fixed, zero variable cost.** That is the honest price of "Hetzner-only at 1M concurrent." It is real, bounded, and rentable.

### 21.4 The four state-of-the-art levers that push ρ → 1

These are the actual inventions. Each attacks a specific enemy of the self-sustaining condition.

#### Lever 1 — Random Linear Network Coding (RLNC): kill the coupon-collector problem

**Enemy:** in classic chunk-swapping, a peer needs *specific* missing chunks from *specific* peers; near a deadline it often can't find the one chunk it lacks, so it falls back to origin. This "last rare chunk" is where most origin egress leaks.

**Invention:** don't exchange raw segments — exchange **coded combinations**. Split each 2 s segment into `k` blocks (e.g. k=32). Any peer generates *new* coded packets as random linear combinations of blocks it holds, over GF(2⁸). A receiver needs **any `k` linearly-independent coded packets** — it does not matter which peers they came from or in what order. This makes every peer's upload *universally useful* to every neighbor, driving swarm efficiency toward the information-theoretic maximum and collapsing the rare-chunk fallback that feeds origin.

Research consistently shows RLNC materially raises P2P live-streaming throughput and cuts server load (GAZELLE, MATIN, and the WebRTC+network-coding demonstrations). Cost: coefficient-vector header overhead (~k bytes) and Gauss-Jordan decode CPU — both trivial at k=32 on a modern phone.

```
Encoding (any peer, any time):
  coded_packet = Σ (coeff_i · block_i)   over GF(2^8),  coeffs random
  header = [coeff_1 … coeff_k]           (k bytes)

Decoding (receiver): collect k packets with independent coeff vectors,
  solve the k×k system (Gaussian elimination) → recover the segment.
Origin only injects until the swarm holds k independent packets total —
after that the swarm regenerates infinite useful packets on its own.
```

Add a `RLNC` codec module to §12 (client) and §5 (ingest splits + emits initial coded packets). The wire protocol (§9.1) gains a `CODED` frame type carrying `{seq, coeff_vector, payload}`.

#### Lever 2 — Mandatory contribution (tit-for-tat): make "free" mean "free of money, not of upload"

**Enemy:** free-riders. If viewers download without uploading, `U_swarm` collapses and origin pays for everyone.

**Invention:** the price of watching is *relaying*. This is the strategic heart of a Hetzner-only design — **viewers pay with bandwidth instead of money.** Enforce a BitTorrent-style tit-for-tat at the tracker and client:

- Each peer's **contribution ratio** `= bytes_uploaded / bytes_downloaded` is tracked (client `stats`, §7.5, already collects this).
- Peers that upload are handed **more and better peers** and higher segment priority; peers that don't get **deprioritized** and pushed to the back of the origin-service queue (longer startup, first to be shed under load).
- On unmetered WiFi, upload is **on by default and required** to keep smooth playback. On cellular, the peer is exempt from uploading (see Lever 3) but is explicitly a *guest* of the swarm — served only from surplus.

This converts your millions of "free" viewers into the delivery network itself. It is exactly the resource that incentivized systems (Theta's edge-cacher model) pay tokens for — except here the incentive is simply *your own smooth playback*, which costs you nothing.

#### Lever 3 — Super-peer / helper hierarchy: let the strong carry the weak

**Enemy:** cellular and asymmetric peers upload ≈ 0. If they're the majority, average upload falls below `B` and self-sustaining fails.

**Invention:** a two-tier mesh. Peers on **unmetered WiFi with measured surplus uplink** are promoted to **super-peers (helpers)**. A home connection commonly has 20–200 Mbps upload — one super-peer can feed 4–40 downstream peers. The math that saves you:

```
self-sustaining holds when:   f_super × (uplink_super − B)  ≥  (1 − f_super) × B
  f_super = fraction of peers that are super-peers
Example: super-peers with 40 Mbps uplink, B=5:
  each super serves itself + 7 others. Just 1 in 8 peers being a WiFi super-peer
  makes the whole swarm self-sustaining even if the other 7 upload nothing.
```

So you do **not** need most viewers to upload — you need a **critical minority of fat-uplink WiFi peers**. For living-room viewing (smart TVs, phones/tablets on home WiFi, Android TV boxes) this minority exists naturally. The tracker's scoring (§7.3) already ranks by uplink; promote the top tier to helper status and bias the mesh so cellular leaves hang off super-peers, not off each other.

Optional amplifier: run a handful of **your own Hetzner boxes as permanent super-peers** that join every popular swarm as ideal high-score seeders. They're already counted in your fleet and they raise `f_super` deterministically for the head channels.

#### Lever 4 — Deficit-only origin + deep buffer: origin serves the gap, nothing more

**Enemy:** peer churn (someone closes the app mid-segment) causes momentary supply dips that, if unbuffered, hit origin.

**Invention:**
- **Deficit-only seeding:** origin (and super-peers) inject each coded segment only until the swarm collectively holds `k` independent packets. Past that, origin goes silent for that segment — the swarm regenerates all further packets via RLNC. Origin egress per channel is therefore ~`k`-packets-worth regardless of swarm size, not per-viewer.
- **Deep playback buffer (30–60 s):** live TV tolerates latency (Appendix A). A 45 s buffer means a peer has 45 s to source each segment from the swarm before it's urgent — absorbing churn spikes that would otherwise fall to origin. This trades latency for `ρ`, and for non-interactive rebroadcast that trade is almost free.

### 21.5 The honest trilemma (read before you commit)

You cannot have all three of these at once:

```
   (A) Hetzner-only cost (no CDN)
   (B) Hard guarantee of source quality + zero stalls for EVERY viewer
   (C) Millions of free, majority-CELLULAR viewers
```

The CDN was what bought (B) *while* having (C). Remove it and (B) becomes **conditional on swarm health**. The realistic, state-of-the-art outcome is **(A) + (C) with (B) holding 95–99 % of the time**, degrading *gracefully* the rest of the time instead of via a CDN safety net:

- **Graceful degradation menu** (choose per channel, dynamically): brief re-buffer (deep buffer hides most); OR temporary bitrate downshift for the affected peer only (requires the ABR ladder from §18 Phase 4 — this is the one place "same quality" bends, and only for peers the swarm genuinely can't feed); OR admission delay ("channel starting…") for the marginal viewer under extreme load.
- The design **guarantees no cascade**: a supply dip degrades the few peers at the swarm edge, never the whole channel, because origin + super-peers always cover the core.

If your audience is majority **home-WiFi** (the natural case for TV rebroadcast to living rooms), Levers 1–4 realistically reach `ρ = 95–99 %` and (B) effectively holds — Hetzner-only is not a compromise, it's the right architecture. If your audience is majority **cellular**, no invention repeals physics: average upload is below `B`, self-sustaining fails, and origin must serve the deficit in boxes — pushing you back up the §21.3 table toward hundreds of delivery boxes. Know which audience you have; it decides your box count more than any code does.

### 21.6 The tail, without a CDN (the residual that survives everything)

Even at perfect `ρ` on popular channels, the ~14,000 tail channels (§20.2) have too few viewers to form self-sustaining swarms. Without a CDN, their bits fall on origin directly: `residual_tail ≈ V_tail × B_tail`. Three levers, no external service:

1. **Downscale cold channels.** Transcode channels below a viewer threshold to a lower bitrate (720p/480p, ~1.5 Mbps). A 3× bitrate cut is a 3× box cut on the entire tail. (This bends "same quality" only for near-empty channels; the moment a channel gets popular, promote it back to source bitrate.) Requires the transcode capability from §18 Phase 4 on a subset of ingest nodes.
2. **Micro-swarm anyway.** Even 5–10 tail viewers relay to each other; RLNC makes a 6-peer swarm meaningfully offload. Don't disable P2P on the tail — just don't expect much.
3. **Admission budget.** Guarantee origin delivery for the top N channels; serve the extreme cold tail best-effort with a short "starting…" wait. Tune with real viewing data.

**Honest note:** the tail is precisely where a CDN's per-GB model is *cheapest* (few bytes) and a fixed fleet is *least* efficient (idle boxes waiting for 3 viewers). Forbidding the CDN costs you most here. If you ever relax "Hetzner-only," relax it *only for the tail* — a cheap object-store/CDN for cold channels while the head stays pure-P2P is the true cost optimum. As a strict Hetzner-only system, budget the tail as a fixed delivery sub-fleet sized by `V_tail × B_tail / 0.8 Gbps`.

### 21.7 Revised cost summary — fully fixed, zero variable

At 1M concurrent, 20K catalog, majority-WiFi audience, `ρ ≈ 97 %` head + downscaled tail:

| Fleet role | Boxes | Driver |
|---|---|---|
| Ingest (+ tail transcode) | ~118 | `C_watched` / 140 |
| Delivery (swarm residual, head) | ~130 | `(1−ρ) × V_head × B / 0.8` |
| Delivery (tail residual, downscaled) | ~60 | `V_tail × B_tail / 0.8` |
| Tracker (sharded) | ~3 | `V / 500k` |
| Control plane (HA) | 2 | fixed |
| **Total** | **~313 boxes** | **≈ €12.5K/month, 100 % fixed** |

Versus the CDN design (§20.8): ~$5M/month variable at the same scale. **The zero-CDN architecture trades a terrifying variable bill for a boring fixed one** — which is exactly the strategy you asked for. The price of "fixed" is: you must engineer `ρ` relentlessly (Levers 1–4), and you accept graceful degradation instead of a hard quality guarantee for the small fraction of peers the swarm can't reach.

### 21.8 What to build (delta on top of §19/§20)

The client and protocol change modestly; the architecture is the §20 fleet with the CDN swapped for a delivery sub-fleet:

1. **RLNC codec** — client encode/decode + ingest block-splitting and initial coded-packet emission (Lever 1). New `CODED` frame in §9.1. *(~2 weeks; use a vetted GF(2⁸) library, don't hand-roll the field math.)*
2. **Contribution enforcement** — tracker scoring already tracks ratio; add priority/queue effects and the "upload required on WiFi" client policy (Lever 2). *(~1 week)*
3. **Super-peer promotion** — tracker promotes measured fat-uplink WiFi peers to helpers; mesh biases cellular leaves onto helpers (Lever 3). *(~1 week)*
4. **Deficit-only origin + deep buffer** — origin stops seeding a segment once swarm holds `k` packets; client buffer 30–60 s (Lever 4). *(~1 week)*
5. **Delivery sub-fleet** — origin nodes that are *not* ingesting also serve as swarm-residual seeders + permanent super-peers; autoscale by measured `ρ` and origin egress. *(~1 week)*
6. **Tail downscale path** — bitrate-reduced transcode for cold channels (§21.6). *(~1 week)*

**Build order:** prove `ρ` on a single popular channel with Levers 1–4 and real devices *before* sizing any delivery fleet. Measure `ρ` under realistic WiFi/cellular mix and peer churn — that measured number, not a theoretical one, sets your box count. Everything downstream is arithmetic on `ρ`.

### 21.9 Verdict

Hetzner-only is **real and bounded**, not magic: you replace variable CDN cost with a fixed origin fleet whose size is `(1−ρ)×V×B`, and you spend your engineering entirely on raising `ρ` with network coding, mandatory contribution, and a super-peer hierarchy. For a home-WiFi TV audience it lands at a few hundred boxes and low five figures per month — genuinely just Hetzner. The two things no architecture can invent away: (1) a majority-cellular audience breaks the self-sustaining condition and inflates the fleet; (2) the long tail has no swarm and must be served by your own boxes (downscaled) instead of cheap CDN bytes. Design for `ρ`, know your audience's upload, and the "only cost is Hetzner" strategy holds.

> **Sources grounding this section:** ByteDance *Swarm* hybrid P2P/PCDN (arXiv:2401.15839); Novage p2p-media-loader (open-source WebRTC P2P engine); GAZELLE / MATIN and the WebRTC+Network-Coding demonstrations (random linear network coding for P2P live streaming); Theta Network edge-cacher incentive model. See the chat summary for links.

---

---

## 22. Zero-CDN Production Implementation (canonical code)

This section is the **canonical, production code** for the four levers that make the zero-CDN design work (§21.4). It supersedes any CDN-era detail in §5–§13. Add these modules on top of the shared core; the wire protocol already reserves the `CODED`/`RANK` frames (§9.1).

### 22.1 Random Linear Network Coding (RLNC) — Lever 1

The exchange unit becomes a *coded packet* over GF(2⁸). A segment is split into `k` equal blocks; a coded packet is `Σ coeff_i · block_i` with a random coefficient vector. Any `k` linearly-independent packets reconstruct the segment. Peers **recode** (generate fresh packets from packets they already hold) without fully decoding — this is what makes every peer's upload universally useful and collapses origin egress.

**Do not hand-roll the finite-field math** — use a vetted library. Reference: the `Kodo`/`fifi` family (C++, licensable) or the open `wirehair`/`cm256` fountain codes. Below is a compact, correct GF(2⁸) implementation for clarity and for the headless test harness; swap in the hardened library for the shipping app.

#### 22.1.1 GF(2⁸) core (`p2p/GF256.kt`, mirrors to Node for the tracker/test peer)

```kotlin
package tv.swarmcast.p2p

/** GF(2^8) arithmetic with log/antilog tables (primitive poly 0x11d). Shared, immutable, thread-safe. */
object GF256 {
    private val exp = IntArray(512)
    private val log = IntArray(256)
    init {
        var x = 1
        for (i in 0 until 255) { exp[i] = x; log[x] = i; x = x shl 1; if (x and 0x100 != 0) x = x xor 0x11d }
        for (i in 255 until 512) exp[i] = exp[i - 255]
    }
    fun mul(a: Int, b: Int): Int = if (a == 0 || b == 0) 0 else exp[log[a and 0xff] + log[b and 0xff]]
    fun div(a: Int, b: Int): Int { require(b != 0); return if (a == 0) 0 else exp[log[a and 0xff] - log[b and 0xff] + 255] }
    fun addInto(dst: ByteArray, src: ByteArray) { for (i in dst.indices) dst[i] = (dst[i].toInt() xor src[i].toInt()).toByte() }
    fun mulInto(dst: ByteArray, src: ByteArray, c: Int) {
        if (c == 0) return
        for (i in dst.indices) dst[i] = (dst[i].toInt() xor mul(src[i].toInt() and 0xff, c)).toByte()
    }
}
```

#### 22.1.2 Encoder / recoder / decoder (`p2p/RLNC.kt`)

```kotlin
package tv.swarmcast.p2p

import java.security.SecureRandom

/** A coded packet: k coefficients (one byte each) + the coded payload. */
class CodedPacket(val coeffs: ByteArray, val data: ByteArray)

class RlncEncoder(segment: ByteArray, val k: Int) {
    val blockSize = (segment.size + k - 1) / k
    private val blocks = Array(k) { i ->
        ByteArray(blockSize).also { b ->
            val from = i * blockSize; val len = minOf(blockSize, segment.size - from).coerceAtLeast(0)
            if (len > 0) System.arraycopy(segment, from, b, 0, len)
        }
    }
    private val rnd = SecureRandom()
    /** Generate a fresh random coded packet (a seeder/origin uses this). */
    fun generate(): CodedPacket {
        val coeffs = ByteArray(k).also { rnd.nextBytes(it) }
        val data = ByteArray(blockSize)
        for (i in 0 until k) GF256.mulInto(data, blocks[i], coeffs[i].toInt() and 0xff)
        return CodedPacket(coeffs, data)
    }
}

/** Holds received packets for one segment; supports recoding and full decode. */
class RlncDecoder(val k: Int, val blockSize: Int, val originalSize: Int) {
    private val rows = ArrayList<CodedPacket>()          // reduced echelon rows
    val rank get() = rows.size
    val complete get() = rows.size >= k
    private val rnd = SecureRandom()

    /** Add a packet via Gaussian elimination; returns true if it increased rank (was useful). */
    fun add(p: CodedPacket): Boolean {
        val coeffs = p.coeffs.copyOf(); val data = p.data.copyOf()
        for (row in rows) {
            val pivot = row.coeffs.indexOfFirst { it.toInt() != 0 }
            val c = coeffs[pivot].toInt() and 0xff
            if (c != 0) { GF256.mulInto(coeffs, row.coeffs, c); GF256.mulInto(data, row.data, c) }
        }
        val pivot = coeffs.indexOfFirst { it.toInt() != 0 }
        if (pivot < 0) return false                       // linearly dependent → useless
        val inv = GF256.div(1, coeffs[pivot].toInt() and 0xff)
        for (i in coeffs.indices) coeffs[i] = GF256.mul(coeffs[i].toInt() and 0xff, inv).toByte()
        for (i in data.indices) data[i] = GF256.mul(data[i].toInt() and 0xff, inv).toByte()
        rows.add(CodedPacket(coeffs, data))
        return true
    }

    /** Recode WITHOUT decoding: random combination of held rows — lets a partial peer still help. */
    fun recode(): CodedPacket? {
        if (rows.isEmpty()) return null
        val coeffs = ByteArray(k); val data = ByteArray(blockSize)
        for (row in rows) {
            val c = rnd.nextInt(256)
            GF256.mulInto(coeffs, row.coeffs, c); GF256.mulInto(data, row.data, c)
        }
        return CodedPacket(coeffs, data)
    }

    /** Full back-substitution once rank==k → original segment bytes. */
    fun decode(): ByteArray? {
        if (!complete) return null
        rows.sortBy { it.coeffs.indexOfFirst { c -> c.toInt() != 0 } }
        for (i in k - 1 downTo 0) for (j in 0 until i) {
            val c = rows[j].coeffs[i].toInt() and 0xff
            if (c != 0) { GF256.mulInto(rows[j].coeffs, rows[i].coeffs, c); GF256.mulInto(rows[j].data, rows[i].data, c) }
        }
        val out = ByteArray(k * blockSize)
        for (i in 0 until k) System.arraycopy(rows[i].data, 0, out, i * blockSize, blockSize)
        return out.copyOf(originalSize)
    }
}
```

#### 22.1.3 Ingest side (server) — emit initial coded packets

The ingest orchestrator (§5.5), after hashing a finished segment, also computes `k`, `blockSize`, and announces them. It does **not** need to pre-code every packet: seed-tier super-peers pull the raw segment once from origin/edge and generate coded packets themselves. So the only server change is adding `k` to the announce payload:

```js
// in segmentWatcher.js, extend the announce body:
const k = 32;
await fetch(`${config.trackerInternalUrl}/internal/segment`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-internal-token": config.internalToken },
  body: JSON.stringify({ channelId, seq, sha256, size: st.size, k }),   // + k
});
```

`TrackerEvent.Segment` (client) and the tracker `segment` message gain the `k` field; `RlncDecoder(k, blockSize = ceil(size/k), originalSize = size)` is constructed per segment.

### 22.2 Contribution enforcement + super-peers — Levers 2 & 3

Extend the tracker's scoring (§7.3) and swarm (§7.4). Two additions: (a) score now hard-gates service priority by contribution ratio; (b) super-peer promotion by measured uplink.

```js
// tracker/src/scoring.js — additions

/** Contribution tier gates how eagerly the swarm serves a peer (Lever 2). */
export function contributionTier(peer) {
  const dl = Math.max(peer.bytesDownP2p + peer.bytesDownEdge, 1);
  const ratio = peer.bytesUp / dl;
  if (peer.transport === "cell") return "guest";     // exempt from upload, served from surplus only
  if (ratio >= 0.8) return "full";                   // good citizen: full priority + best peers
  if (ratio >= 0.3) return "limited";                // warming up
  return "throttled";                                // free-rider on WiFi: back of the queue
}

/** Super-peer promotion (Lever 3): fat-uplink WiFi peers become helpers. */
export function isSuperPeer(peer) {
  return peer.transport === "wifi" && peer.uploadEnabled && peer.uplinkKbps >= 15000; // ≥15 Mbps up
}
```

Bias candidate selection so cellular "guests" are attached to super-peers, not to each other:

```js
// tracker/src/scoring.js — replace candidatePeers with super-peer-aware version
export function candidatePeers(swarm, forPeer, n = 12) {
  const supers = [...swarm.peers.values()].filter(p => p.id !== forPeer.id && p.superPeer);
  const normals = [...swarm.peers.values()].filter(p => p.id !== forPeer.id && !p.superPeer);
  // Guests lean heavily on super-peers; contributors get a broader mesh.
  const wantSupers = forPeer.transport === "cell" ? Math.min(supers.length, n) : Math.ceil(n / 3);
  const pick = [];
  supers.sort((a, b) => score(b) - score(a));
  pick.push(...supers.slice(0, wantSupers));
  for (let i = normals.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [normals[i], normals[j]] = [normals[j], normals[i]]; }
  pick.push(...normals.slice(0, n - pick.length));
  return pick.map(p => ({ id: p.id, transport: p.transport }));
}
```

Serve-side enforcement lives on the client uploader (`PeerLink.serve`, §12.4): consult the requester's tier (piggybacked on the connection) and `REJECT quota` for `throttled` peers when the upload budget is tight. The self-sustaining condition of §21.4 (`f_super × (uplink−B) ≥ (1−f_super)×B`) is what `isSuperPeer`'s threshold guarantees at ~1-in-8 super-peers.

### 22.3 Network-coded scheduler (client) — supersedes §12.6 `tryPeers`

Replace the whole-segment `tryPeers` with a packet-level loop that collects coded packets until `rank == k`, verifies, then recodes for others.

```kotlin
package tv.swarmcast.p2p

import kotlinx.coroutines.*

/** Coded-packet fetch for one segment. Returns decoded bytes or null (caller then hits Delivery Fleet). */
class CodedFetch(
    private val mgr: PeerConnectionMgr,
    private val store: SegmentStore,
) {
    suspend fun collect(seq: Int, meta: TrackerEvent.Segment, deadlineMs: Long): ByteArray? {
        val blockSize = (meta.size.toInt() + meta.k - 1) / meta.k
        val decoder = RlncDecoder(meta.k, blockSize, meta.size.toInt())
        val start = System.currentTimeMillis()
        // Ask peers that can still contribute an INDEPENDENT packet (by advertised RANK), best first.
        while (!decoder.complete) {
            val remaining = deadlineMs - (System.currentTimeMillis() - start)
            if (remaining < 500) return null
            val donors = mgr.allLinks()
                .filter { it.rankFor(seq) > 0 }
                .sortedByDescending { it.successes - 3 * it.failures }
            if (donors.isEmpty()) return null
            var progressed = false
            for (link in donors) {
                if (decoder.complete) break
                val pkt = withTimeoutOrNull(minOf(2000L, remaining)) { link.requestCoded(seq).await() }
                if (pkt == null) { link.failures++; continue }
                if (decoder.add(pkt)) { progressed = true; link.successes++ }   // useful packet
                // dependent packet → not counted against the peer (coding overhead is normal)
            }
            if (!progressed) delay(80)     // let RANK bitmaps refresh
        }
        val bytes = decoder.decode() ?: return null
        // Verify against tracker SHA-256 before trusting or serving (poisoning defense).
        if (!store.putVerified(seq, bytes, meta.sha256)) return null
        // Keep the decoder around so we can RECODE fresh packets for neighbours (Lever 1).
        mgr.registerRecoder(seq, decoder)
        return bytes
    }
}
```

`PeerLink` (§12.4) gains `requestCoded(seq)` (sends `REQUEST`, expects a `CODED` frame), `rankFor(seq)` (from the peer's latest `RANK` frame), and on the serve side: when asked for `seq`, generate a packet via the local `RlncEncoder` (if fully held) or `RlncDecoder.recode()` (if partially held) and send a `CODED` frame. Wire these to the frame types added in §9.1. The `Scheduler.fetchSegment` (§12.6) calls `CodedFetch.collect(...)` in place of `tryPeers(...)`; the Delivery-Fleet fallback path is unchanged.

### 22.4 Deficit-only seeding + deep buffer — Lever 4

**Deep buffer** is already wired in `PlayerHolder.startPlayer` (§12.9: `setBufferDurationsMs(30_000, 60_000, …)`).

**Deficit-only seeding** is a tracker decision: elect just enough seed-tier super-peers that the swarm reaches `k` independent packets, then stop. Replace §7.4 `announceSegment`:

```js
// tracker/src/swarm.js — deficit-only seeding
announceSegment(seq, sha256, size, k, send) {
  this.segments.set(seq, { sha256, size, k, ts: Date.now() });
  for (const s of this.segments.keys()) if (s < seq - 60) this.segments.delete(s);

  // Seed just enough super-peers to inject k independent packets, plus a small safety margin.
  // Each seeder can generate many independent packets from the raw segment, so a handful suffices.
  const seeders = electSeeders(this, Math.max(2, Math.ceil(k / 12)))
    .filter(p => p.superPeer).map(p => p.id);
  const seederSet = new Set(seeders);

  for (const p of this.peers.values()) {
    send(p, { t: "segment", seq, sha256, size, k, seedTier: seederSet.has(p.id) });
  }
}
```

Because seeders pull the raw segment once and then generate unlimited coded packets, origin egress per segment is ~`ceil(k/12)` seed pulls — independent of swarm size. That is the mathematical reason origin cost is bounded by *ingest*, not *audience* (§21.2).

### 22.5 Delivery-Fleet edge node — deployment

An edge node is a stripped compose stack: nginx (the §10.2 caching config) + node_exporter, no ffmpeg, no tracker. It reads the control-plane `channel→ingest-node` map to know where to fill from.

```yaml
# edge/docker-compose.yml  (deploy on each Delivery-Fleet box)
services:
  nginx-edge:
    image: nginx:1.27
    restart: unless-stopped
    ports: ["443:443"]
    volumes:
      - ./nginx-edge.conf:/etc/nginx/conf.d/edge.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - edgecache:/dev/shm/edgecache          # tmpfs-backed cache
    tmpfs: [/dev/shm/edgecache:size=8g]
  node_exporter:
    image: prom/node-exporter:v1.8.0
    restart: unless-stopped
    ports: ["9100:9100"]
volumes: { edgecache: {} }
```

Put all edge nodes behind DNS round-robin or a Hetzner load balancer at `edge.yourdomain.tv`; the tracker hands clients that hostname (§7.5). Geo-spread edge nodes later (§18 Phase 5) for latency.

### 22.6 Client upload/contribution policy (production)

`UploadBudget` (§12.4) becomes contribution- and battery-aware:

```kotlin
// p2p/UploadBudget.kt — production policy
class UploadBudget(
    private val policy: tv.swarmcast.data.NetworkPolicy,
    private val maxBytesPerSecWifi: Long = 3_000_000,   // 24 Mbps up cap on WiFi super-peers
) {
    @Volatile private var window = System.currentTimeMillis() / 1000
    @Volatile private var used = 0L
    @Synchronized fun capBytesPerSec(): Long = if (policy.uploadAllowed()) maxBytesPerSecWifi else 0L
    @Synchronized fun tryReserve(bytes: Long): Boolean {
        val cap = capBytesPerSec(); if (cap == 0L) return false      // cellular/low-battery: never upload
        val now = System.currentTimeMillis() / 1000
        if (now != window) { window = now; used = 0 }
        if (used + bytes > cap * 3) return false                     // 3 s burst tolerance
        used += bytes; return true
    }
}
```

This enforces §21.4 Lever 3 on-device: only unmetered-WiFi, healthy-battery peers ever upload, and their contribution is capped so seeding never degrades the user's own experience.

### 22.7 Autoscaler (control plane) — keep the fleet sized to ρ

```js
// control-plane/src/autoscaler.js — Hetzner Cloud API driver (sketch, run every 60 s)
import { fetchMetric } from "./metrics.js";     // reads Prometheus
const USABLE_GBPS = 0.8;

export async function reconcileDeliveryFleet(hcloud) {
  const V_Bps = await fetchMetric("sum(rate(client_download_bytes[1m]))*8");   // total demand bits/s
  const rho   = await fetchMetric("offload_ratio_5m");
  const residualGbps = (V_Bps * (1 - rho)) / 1e9;
  const needed = Math.ceil(residualGbps / USABLE_GBPS) + 1;                    // +1 headroom
  const current = await hcloud.countServers({ label: "role=edge" });
  if (needed > current)      await hcloud.createServers("role=edge", needed - current);  // cloud-init = edge/compose
  else if (needed < current - 1) await hcloud.deleteServers("role=edge", current - needed - 1); // hysteresis
}
```

Ingest fleet scales the same way but keyed on `active_channels / 140` (§20). **This closes the loop: ρ measured → boxes provisioned → fixed, predictable, Hetzner-only cost.**

### 22.8 Integration checklist (wiring §22 into the core)

- [ ] Add `k` to segment announce (ingest §22.1.3 → tracker `segment` msg → `TrackerEvent.Segment`).
- [ ] Add `CODED` (0x07) and `RANK` (0x08) handling to `Wire`, `PeerLink` (§9.1, §12.4).
- [ ] Drop in `GF256`, `RLNC`, `CodedFetch`; point `Scheduler.fetchSegment` at `CodedFetch.collect`.
- [ ] Tracker: `contributionTier`, `isSuperPeer`, super-peer-aware `candidatePeers`, deficit-only `announceSegment`.
- [ ] Client: contribution-aware `UploadBudget`, `measuredUplinkKbps` in join caps, deep buffer (done).
- [ ] Deploy one edge node (§22.5); confirm `X-Cache: HIT` and that clients fall back to it, not any CDN.
- [ ] Autoscaler on ρ (§22.7); verify §17.6 self-sustaining drill flattens edge egress.
- [ ] Load-test to confirm measured ρ ≥ 0.90 (§17) before sizing the production fleet.

With §22 in place the system is fully zero-CDN and production-shaped: every byte served from your own Hetzner hardware, cost fixed by box count, offload maximized by network coding + mandatory contribution + super-peers + deficit-only seeding.

---

*End of blueprint. Everything above is buildable with the listed dependencies and no proprietary components. The design is **zero-CDN**: your only cost is rented Hetzner boxes, sized by the measured offload ratio ρ (§21.3, §22.7).*



