import { randomUUID } from "node:crypto";
import { loadTrackerConfig } from "@swarmcast/config/env";
import { ERROR_CODES, publicError } from "@swarmcast/config/errors";
import { createLogger } from "@swarmcast/config/logging";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { parseMessage } from "./protocol.js";
import { TokenBucketRateLimiter } from "./rateLimit.js";
import { isSuperPeer } from "./scoring.js";
import { Swarm } from "./swarm.js";
import { metricsForState } from "./metrics.js";
import { buildMediaTemplates, resolveChannelPlacement } from "./placementClient.js";
import { parseTrackerPolicy, swarmModeForSize } from "./policy.js";
import { announceSegmentToState } from "./segments.js";
import { routeTrackerJoin } from "./sharding.js";
import { recordPeerStats } from "./stats.js";

const DEFAULT_CONFIG = loadTrackerConfig();
const TRACKER_POLICY = parseTrackerPolicy();

export function createTrackerState() {
  return {
    swarms: new Map(),
    peersById: new Map()
  };
}

export function swarmFor(state, channelId) {
  if (!state.swarms.has(channelId)) state.swarms.set(channelId, new Swarm(channelId));
  return state.swarms.get(channelId);
}

export function createPeer(userData = {}) {
  return {
    ...userData,
    id: randomUUID(),
    channelId: null,
    transport: "cell",
    uploadEnabled: false,
    uplinkKbps: 0,
    superPeer: false,
    bytesUp: 0,
    bytesDownP2p: 0,
    bytesDownEdge: 0,
    peerTimeouts: 0,
    peerHashFailures: 0,
    peerDisconnects: 0,
    transfersOk: 0,
    transfersFail: 0,
    lastSeenMs: Date.now(),
    haves: new Set()
  };
}

export function canAcceptTrackerConnection(state, maxConnections = DEFAULT_CONFIG.maxConnections) {
  return state.peersById.size < maxConnections;
}

function sendToPeer(state, peer, message, send = null) {
  if (send) {
    send(peer, message);
    return;
  }
  state.peersById.get(peer.id)?.send?.(JSON.stringify(message));
}

function broadcastSwarmMode(state, swarm, policy, send = null, excludedPeerId = null) {
  const swarmMode = swarmModeForSize(swarm.size, policy);
  swarm.mode = swarmMode;
  for (const member of swarm.peers.values()) {
    if (member.id === excludedPeerId) continue;
    sendToPeer(state, member, { t: "swarm_mode", swarmMode, swarmSize: swarm.size }, send);
    if (swarmMode === "p2p") {
      sendToPeer(state, member, { t: "peers", peers: swarm.peersFor(member) }, send);
    }
  }
}

export function removePeerFromState(state, peer, { policy = TRACKER_POLICY, send = null } = {}) {
  if (!peer?.id) return;
  state.peersById.delete(peer.id);
  if (peer.channelId) {
    const swarm = state.swarms.get(peer.channelId);
    const previousMode = swarm?.mode || (swarm ? swarmModeForSize(swarm.size, policy) : null);
    swarm?.removePeer(peer.id);
    if (swarm?.size === 0) {
      state.swarms.delete(peer.channelId);
    } else if (previousMode !== swarmModeForSize(swarm.size, policy)) {
      broadcastSwarmMode(state, swarm, policy, send);
    }
  }
}

export function reapIdleTrackerPeers({
  state,
  nowMs = Date.now(),
  idleTimeoutMs = DEFAULT_CONFIG.idleTimeoutSeconds * 1000,
  policy = TRACKER_POLICY,
  send = null
}) {
  if (idleTimeoutMs <= 0) return 0;

  let closed = 0;
  for (const ws of state.peersById.values()) {
    const peer = ws.getUserData?.() || ws.peer || ws;
    if (!peer?.lastSeenMs || nowMs - peer.lastSeenMs <= idleTimeoutMs) continue;
    ws.end?.(1001, "idle timeout");
    removePeerFromState(state, peer, { policy, send });
    closed += 1;
  }
  return closed;
}

export async function sendDemandHeartbeats({
  state,
  fetchFn = fetch,
  ingestUrl = DEFAULT_CONFIG.ingestUrl,
  internalToken = DEFAULT_CONFIG.internalToken
}) {
  const requests = [];
  for (const [channelId, swarm] of state.swarms) {
    if (swarm.size === 0) continue;
    const demandUrl = swarm.demandUrl || ingestUrl;
    requests.push(fetchFn(`${demandUrl}/channels/${channelId}/demand`, {
      method: "POST",
      headers: { "x-internal-token": internalToken, "content-type": "application/json" },
      body: JSON.stringify({ swarmSize: swarm.size })
    }).catch(() => null));
  }
  await Promise.all(requests);
  return requests.length;
}

export async function handlePeerMessage({
  state,
  peer,
  ws,
  raw,
  fetchFn = fetch,
  rateLimiter = null,
  controlPlaneUrl = DEFAULT_CONFIG.controlPlaneUrl,
  internalToken = DEFAULT_CONFIG.internalToken,
  ingestUrl = DEFAULT_CONFIG.ingestUrl,
  originBase = DEFAULT_CONFIG.originBase,
  edgeBase = DEFAULT_CONFIG.edgeBase,
  policy = TRACKER_POLICY,
  send = null,
  trackerShardConfig = {
    selfShardId: DEFAULT_CONFIG.trackerShardId,
    shards: DEFAULT_CONFIG.trackerShards
  },
  logger = null
}) {
  if (rateLimiter && !rateLimiter.allow(peer)) {
    logger?.warn("tracker_peer_dropped", {
      peer_id: peer.id,
      channel_id: peer.channelId,
      error_class: "rate_limited"
    }, "peer dropped by rate limiter");
    ws.end?.(1008, "rate limit");
    return;
  }

  const msg = parseMessage(raw);
  if (!msg) {
    logger?.warn("tracker_peer_dropped", {
      peer_id: peer.id,
      channel_id: peer.channelId,
      error_class: "bad_message"
    }, "peer sent invalid message");
    ws.end?.(1008, "bad message");
    return;
  }

  switch (msg.t) {
    case "join": {
      const channelId = String(msg.channelId);
      const shardRoute = routeTrackerJoin({
        channelId,
        selfShardId: trackerShardConfig.selfShardId,
        shards: trackerShardConfig.shards
      });
      if (shardRoute.redirect) {
        logger?.info("tracker_shard_redirect", {
          peer_id: peer.id,
          channel_id: channelId,
          shard_id: shardRoute.redirect.id
        }, "peer redirected to owning tracker shard");
        ws.send(JSON.stringify({
          t: "redirect",
          channelId,
          shardId: shardRoute.redirect.id,
          trackerUrl: shardRoute.redirect.wsUrl
        }));
        ws.end?.(1012, "tracker shard redirect");
        return;
      }

      if (peer.channelId) state.swarms.get(peer.channelId)?.removePeer(peer.id);
      peer.channelId = channelId;
      peer.transport = msg.caps?.transport === "wifi" ? "wifi" : "cell";
      peer.uploadEnabled = !!msg.caps?.upload && peer.transport === "wifi";
      peer.uplinkKbps = msg.caps?.uplinkKbps | 0;
      peer.superPeer = isSuperPeer(peer);

      const placement = await resolveChannelPlacement({
        channelId: peer.channelId,
        controlPlaneUrl,
        internalToken,
        fetchFn
      });
      if (placement?.error) {
        const code = placement.error === ERROR_CODES.CAPACITY ? ERROR_CODES.CAPACITY : ERROR_CODES.TRACKER_UNAVAILABLE;
        const error = publicError(code, "channel placement failed");
        ws.send(JSON.stringify({ t: "error", code: error.error, msg: error.message }));
        return;
      }

      const media = buildMediaTemplates({
        channelId: peer.channelId,
        edgeBase,
        originBase,
        placement
      });
      const demandUrl = media.demandUrl || ingestUrl;

      const swarm = swarmFor(state, peer.channelId);
      const previousMode = swarm.mode || swarmModeForSize(swarm.size, policy);
      swarm.demandUrl = demandUrl;
      swarm.addPeer(peer);
      const swarmMode = swarmModeForSize(swarm.size, policy);
      swarm.mode = swarmMode;
      logger?.info("tracker_joined", {
        peer_id: peer.id,
        channel_id: peer.channelId,
        swarm_id: peer.channelId,
        swarm_size: swarm.size
      }, "peer joined tracker swarm");

      fetchFn(`${demandUrl}/channels/${peer.channelId}/demand`, {
        method: "POST",
        headers: { "x-internal-token": internalToken, "content-type": "application/json" },
        body: JSON.stringify({ swarmSize: swarm.size })
      }).catch(() => {});

      ws.send(JSON.stringify({
        t: "joined",
        peerId: peer.id,
        swarmSize: swarm.size,
        swarmMode,
        superPeer: peer.superPeer,
        playlistUrl: media.playlistUrl,
        edgeUrlTemplate: media.edgeUrlTemplate,
        originUrlTemplate: media.originUrlTemplate
      }));

      if (swarmMode === "p2p") {
        ws.send(JSON.stringify({ t: "peers", peers: swarm.peersFor(peer) }));
      }
      if (previousMode !== swarmMode) {
        broadcastSwarmMode(state, swarm, policy, send, peer.id);
      }
      return;
    }
    case "have":
      if (Array.isArray(msg.seqs)) {
        for (const seq of msg.seqs.slice(0, 64)) peer.haves.add(seq | 0);
      }
      return;
    case "stats":
      recordPeerStats(peer, msg);
      return;
    case "need_peers": {
      if (!peer.channelId) return;
      const swarm = state.swarms.get(peer.channelId);
      if (!swarm || swarmModeForSize(swarm.size, policy) !== "p2p") {
        ws.send(JSON.stringify({ t: "peers", peers: [] }));
        return;
      }
      const excludedPeerIds = new Set(
        Array.isArray(msg.exclude) ? msg.exclude.slice(0, 64).map(String) : []
      );
      ws.send(JSON.stringify({
        t: "peers",
        peers: swarm.peersFor(peer, 12, excludedPeerIds)
      }));
      return;
    }
    case "signal": {
      const targetId = String(msg.to || "");
      const target = targetId.length <= 128 ? state.peersById.get(targetId) : null;
      const targetPeer = target?.getUserData?.() || target?.peer;
      if (target && peer.channelId && targetPeer?.channelId === peer.channelId) {
        target.send?.(JSON.stringify({ t: "signal", from: peer.id, data: msg.data || {} }));
        logger?.debug("tracker_signal_relayed", {
          peer_id: peer.id,
          target_peer_id: target.getUserData?.()?.id || String(msg.to),
          channel_id: peer.channelId
        }, "tracker signal relayed");
      }
      return;
    }
    case "leave":
      ws.end?.(1000, "leave");
      return;
    case "ping":
      ws.send('{"t":"pong"}');
      return;
    default:
      return;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtimeConfig = loadTrackerConfig(process.env, { requireSecrets: true });
  const logger = createLogger({ service: "tracker" });
  const [{ default: uWS }] = await Promise.all([import("uWebSockets.js")]);
  const jwks = createRemoteJWKSet(new URL(runtimeConfig.authJwksUrl));
  const state = createTrackerState();
  const rateLimiter = new TokenBucketRateLimiter({
    capacity: runtimeConfig.rateLimitCapacity,
    refillPerSecond: runtimeConfig.rateLimitRefillPerSecond
  });

  const send = (peer, obj) => {
    const ws = state.peersById.get(peer.id);
    if (ws) ws.send(JSON.stringify(obj));
  };

  uWS.App()
    .ws("/ws", {
      maxPayloadLength: runtimeConfig.maxPayloadBytes,
      idleTimeout: runtimeConfig.idleTimeoutSeconds,
      maxBackpressure: runtimeConfig.maxBackpressureBytes,
      upgrade: async (res, req, ctx) => {
        if (!canAcceptTrackerConnection(state, runtimeConfig.maxConnections)) {
          logger.warn("tracker_connection_rejected", {
            error_class: "connection_limit",
            peers: state.peersById.size,
            max_connections: runtimeConfig.maxConnections
          }, "tracker connection rejected by connection limit");
          return res.cork(() => res.writeStatus("503").end());
        }

        const token = new URLSearchParams(req.getQuery()).get("token");
        const key = req.getHeader("sec-websocket-key");
        const proto = req.getHeader("sec-websocket-protocol");
        const ext = req.getHeader("sec-websocket-extensions");
        let aborted = false;
        res.onAborted(() => {
          aborted = true;
        });
        try {
          const { payload } = await jwtVerify(token, jwks, {
            audience: runtimeConfig.authJwtAudience,
            issuer: runtimeConfig.authJwtIssuer
          });
          if (!aborted) res.cork(() => res.upgrade({ sub: payload.sub }, key, proto, ext, ctx));
        } catch {
          if (!aborted) res.cork(() => res.writeStatus("401").end());
        }
      },
      open: (ws) => {
        const peer = createPeer(ws.getUserData());
        Object.assign(ws.getUserData(), peer);
        state.peersById.set(peer.id, ws);
      },
      message: (ws, raw) => {
        ws.getUserData().lastSeenMs = Date.now();
        handlePeerMessage({
          state,
          peer: ws.getUserData(),
          ws,
          send,
          raw,
          rateLimiter,
          controlPlaneUrl: runtimeConfig.controlPlaneUrl,
          internalToken: runtimeConfig.internalToken,
          ingestUrl: runtimeConfig.ingestUrl,
          originBase: runtimeConfig.originBase,
          edgeBase: runtimeConfig.edgeBase,
          logger
        });
      },
      close: (ws) => {
        removePeerFromState(state, ws.getUserData(), { policy: TRACKER_POLICY, send });
      }
    })
    .listen(runtimeConfig.port, (ok) => logger.info(ok ? "service_started" : "service_start_failed", {
      node_id: "tracker",
      port: runtimeConfig.port,
      error_class: ok ? null : "listen_failed"
    }, ok ? "tracker ws listening" : "tracker failed"));

  uWS.App()
    .get("/metrics", (res) => {
      res.writeHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
      res.end(metricsForState(state));
    })
    .post("/internal/segment", (res, req) => {
      if (req.getHeader("x-internal-token") !== runtimeConfig.internalToken) return res.writeStatus("401").end();
      let aborted = false;
      res.onAborted(() => {
        aborted = true;
      });
      let body = Buffer.alloc(0);
      res.onData((chunk, last) => {
        if (aborted) return;
        body = Buffer.concat([body, Buffer.from(chunk)]);
        if (!last) return;
        try {
          const segment = JSON.parse(body.toString("utf8"));
          const result = announceSegmentToState({ state, segment, send });
          if (!result.ok) {
            logger.warn("segment_announce_rejected", {
              error_class: "bad_request",
              error: result.error
            }, "segment announce rejected");
            res.cork(() => res.writeStatus("400").end());
            return;
          }
          logger.info("segment_announced", {
            channel_id: result.segment.channelId,
            segment_seq: result.segment.seq,
            swarm_id: result.segment.channelId,
            recipients: result.recipients
          }, "segment announced to swarm");
          res.cork(() => res.end("ok"));
        } catch {
          logger.warn("segment_announce_rejected", { error_class: "bad_request" }, "segment announce rejected");
          res.cork(() => res.writeStatus("400").end());
        }
      });
    })
    .listen(runtimeConfig.internalPort, (ok) => logger.info(ok ? "service_started" : "service_start_failed", {
      node_id: "tracker-internal",
      port: runtimeConfig.internalPort,
      error_class: ok ? null : "listen_failed"
    }, ok ? "tracker internal listening" : "tracker internal failed"));

  setInterval(() => {
    sendDemandHeartbeats({
      state,
      ingestUrl: runtimeConfig.ingestUrl,
      internalToken: runtimeConfig.internalToken
    }).catch(() => {});
  }, runtimeConfig.demandHeartbeatSeconds * 1000);

  if (runtimeConfig.idleTimeoutSeconds > 0) {
    const idleTimeoutMs = runtimeConfig.idleTimeoutSeconds * 1000;
    setInterval(() => {
      const closed = reapIdleTrackerPeers({ state, idleTimeoutMs, policy: TRACKER_POLICY, send });
      if (closed > 0) {
        logger.info("tracker_idle_peers_closed", {
          error_class: null,
          peers_closed: closed
        }, "tracker idle peers closed");
      }
    }, Math.max(1000, Math.min(15_000, Math.floor(idleTimeoutMs / 2))));
  }
}
