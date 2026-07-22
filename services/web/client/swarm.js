import { Wire, encodeBitfield, frame, parseBitfield, parseFrame } from "./wire.js";
import { SegmentStore, sha256Hex } from "./segmentStore.js";

const MAX_PEERS = 12;
const MAX_BUFFERED = 1_000_000;
const PEER_TIMEOUT_MS = 1_500;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function networkCaps(upload) {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const type = String(connection?.type || "").toLowerCase();
  const cellular = type.includes("cell");
  return {
    upload: upload && !cellular && !connection?.saveData,
    transport: cellular ? "cellular" : "wifi",
    uplinkKbps: cellular ? 0 : 20_000
  };
}

class PeerLink {
  constructor({ id, pc, channel, store, uploadAllowed, onUploaded, onClosed }) {
    this.id = id;
    this.pc = pc;
    this.channel = channel;
    this.store = store;
    this.uploadAllowed = uploadAllowed;
    this.onUploaded = onUploaded;
    this.onClosed = onClosed;
    this.remoteHas = new Set();
    this.pending = null;
    this.chunks = [];
    this.direct = false;
    this.closed = false;
    channel.binaryType = "arraybuffer";
    channel.onmessage = (event) => this.onMessage(event.data);
    channel.onclose = () => this.close();
    channel.onerror = () => this.close();
    channel.onopen = async () => {
      this.direct = await selectedCandidateIsDirect(pc);
      this.send(Wire.BITFIELD, 0, encodeBitfield(store.seqs()));
    };
  }

  isOpen() {
    return !this.closed && this.channel.readyState === "open";
  }

  send(type, seq, payload) {
    if (!this.isOpen()) return false;
    try {
      this.channel.send(frame(type, seq, payload));
      return true;
    } catch {
      return false;
    }
  }

  announce(seqs) {
    this.send(Wire.BITFIELD, 0, encodeBitfield(seqs));
  }

  request(seq, timeoutMs = PEER_TIMEOUT_MS) {
    if (!this.isOpen() || this.pending) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.send(Wire.CANCEL, seq);
        this.pending = null;
        this.chunks = [];
        resolve(null);
      }, timeoutMs);
      this.pending = { seq, resolve, timer };
      this.chunks = [];
      if (!this.send(Wire.REQUEST, seq)) this.finish(null);
    });
  }

  finish(value) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const resolve = this.pending.resolve;
    this.pending = null;
    this.chunks = [];
    resolve(value);
  }

  onMessage(value) {
    const msg = parseFrame(value);
    if (!msg) return;
    if (msg.type === Wire.BITFIELD) {
      const seqs = parseBitfield(msg.payload);
      if (seqs) for (const seq of seqs) this.remoteHas.add(seq);
      return;
    }
    if (msg.type === Wire.REQUEST) {
      this.serve(msg.seq);
      return;
    }
    if (!this.pending || this.pending.seq !== msg.seq) return;
    if (msg.type === Wire.DATA) this.chunks.push(msg.payload);
    if (msg.type === Wire.REJECT) this.finish(null);
    if (msg.type === Wire.DATA_END) {
      const length = this.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of this.chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      this.finish(bytes);
    }
  }

  async serve(seq) {
    const bytes = this.uploadAllowed() ? this.store.get(seq) : null;
    if (!bytes) {
      this.send(Wire.REJECT, seq, new Uint8Array([this.uploadAllowed() ? 1 : 4]));
      return;
    }
    let uploaded = 0;
    for (let offset = 0; offset < bytes.byteLength && this.isOpen(); offset += Wire.CHUNK) {
      while (this.isOpen() && this.channel.bufferedAmount > MAX_BUFFERED) await delay(5);
      const chunk = bytes.slice(offset, Math.min(offset + Wire.CHUNK, bytes.byteLength));
      if (!this.send(Wire.DATA, seq, chunk)) return;
      uploaded += chunk.byteLength;
    }
    if (uploaded === bytes.byteLength && this.send(Wire.DATA_END, seq)) this.onUploaded(uploaded);
  }

  close(notify = true) {
    if (this.closed) return;
    this.closed = true;
    this.finish(null);
    try { this.channel.close(); } catch {}
    try { this.pc.close(); } catch {}
    if (notify) this.onClosed(this.id);
  }
}

async function selectedCandidateIsDirect(pc) {
  try {
    const stats = await pc.getStats();
    let pair;
    stats.forEach((report) => {
      if (report.type === "transport" && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId);
      if (!pair && report.type === "candidate-pair" && report.nominated && report.state === "succeeded") pair = report;
    });
    if (!pair) return false;
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    return local?.candidateType !== "relay" && remote?.candidateType !== "relay";
  } catch {
    return false;
  }
}

export class SwarmClient extends EventTarget {
  constructor({ trackerUrl, token, iceServers, upload = true }) {
    super();
    this.initialTrackerUrl = trackerUrl;
    this.token = token;
    this.iceServers = iceServers;
    this.upload = upload;
    this.assignmentKey = crypto.randomUUID();
    this.store = new SegmentStore();
    this.metadata = new Map();
    this.peers = new Map();
    this.pendingIce = new Map();
    this.peerHints = new Map();
    this.prefetching = new Set();
    this.socket = null;
    this.channelId = null;
    this.joined = null;
    this.reconnectTimer = null;
    this.statsTimer = null;
    this.closed = false;
    this.stats = this.emptyStats();
    this.pendingStats = this.emptyStats();
  }

  emptyStats() {
    return { dlP2p: 0, dlRelay: 0, dlEdge: 0, dlBootstrapOrigin: 0, ul: 0, stalls: 0, peerTimeouts: 0, hashFailures: 0, iceAttempts: 0, iceSuccesses: 0, iceFailures: 0, iceHost: 0, iceSrflx: 0, icePrflx: 0, iceRelay: 0, iceUnknown: 0 };
  }

  snapshot() {
    const paid = this.stats.dlEdge + this.stats.dlRelay + this.stats.dlBootstrapOrigin;
    const total = paid + this.stats.dlP2p;
    return {
      ...this.stats,
      peers: [...this.peers.values()].filter((peer) => peer.isOpen()).length,
      cachedSegments: this.store.entries.size,
      remoteSegments: Math.max(0, ...[...this.peers.values()].map((peer) => peer.remoteHas?.size || 0)),
      metadataSegments: this.metadata.size,
      lastFetchSeq: this.lastFetchSeq || 0,
      lastMetadataSeq: Math.max(0, ...this.metadata.keys()),
      swarmSize: this.joined?.swarmSize || 0,
      swarmMode: this.joined?.swarmMode || "connecting",
      offloadRatio: total ? this.stats.dlP2p / total : 0
    };
  }

  addStat(key, value) {
    this.stats[key] = (this.stats[key] || 0) + value;
    this.pendingStats[key] = (this.pendingStats[key] || 0) + value;
  }

  emitStatus() {
    this.dispatchEvent(new CustomEvent("status", { detail: this.snapshot() }));
  }

  setUpload(enabled) {
    this.upload = enabled;
  }

  async connect(channelId) {
    this.channelId = channelId;
    this.closed = false;
    await this.openTracker(this.initialTrackerUrl, null);
    this.statsTimer = setInterval(() => this.flushStats(), 10_000);
  }

  async openTracker(baseUrl, cellRouteToken) {
    if (this.closed) return;
    const url = new URL(baseUrl);
    url.searchParams.set("token", this.token);
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onmessage = (event) => this.onTrackerMessage(JSON.parse(event.data));
    socket.onclose = () => this.onTrackerClosed(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Tracker connection timed out")), 8_000);
      socket.onopen = () => {
        clearTimeout(timer);
        const caps = networkCaps(this.upload);
        socket.send(JSON.stringify({
          t: "join",
          channelId: this.channelId,
          assignmentKey: this.assignmentKey,
          ...(cellRouteToken ? { cellRouteToken } : {}),
          caps
        }));
        resolve();
      };
      socket.onerror = () => { clearTimeout(timer); reject(new Error("Tracker connection failed")); };
    });
  }

  onTrackerMessage(msg) {
    if (msg.t === "redirect") {
      const current = this.socket;
      current.onclose = null;
      current.close();
      this.openTracker(msg.trackerUrl, msg.cellRouteToken).catch(() => this.scheduleReconnect());
      return;
    }
    if (msg.t === "joined") {
      this.joined = msg;
      this.emitStatus();
      this.dispatchEvent(new CustomEvent("joined", { detail: msg }));
      return;
    }
    if (msg.t === "swarm_mode") {
      if (this.joined) Object.assign(this.joined, msg);
      this.emitStatus();
      return;
    }
    if (msg.t === "segment") {
      this.metadata.set(msg.seq, msg);
      for (const seq of this.metadata.keys()) if (seq < msg.seq - 90) this.metadata.delete(seq);
      if (msg.seedTier) this.prefetchSeed(msg).catch(() => {});
      return;
    }
    if (msg.t === "peers") {
      for (const peer of msg.peers || []) this.considerPeer(peer);
      return;
    }
    if (msg.t === "signal") this.onSignal(msg.from, msg.data).catch(() => this.dropPeer(msg.from));
  }

  onTrackerClosed(socket) {
    if (socket !== this.socket || this.closed) return;
    this.addStat("iceFailures", 1);
    this.joined = null;
    for (const peer of this.peers.values()) peer.close(false);
    this.peers.clear();
    this.emitStatus();
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.openTracker(this.initialTrackerUrl, null).catch(() => this.scheduleReconnect()), 1_500 + Math.random() * 1_000);
  }

  signal(to, data) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ t: "signal", to, data }));
  }

  considerPeer(info) {
    if (!info?.id || info.id === this.joined?.peerId || this.peers.has(info.id) || this.peers.size >= MAX_PEERS) return;
    this.peerHints.set(info.id, info);
    setTimeout(() => {
      if (!this.peers.has(info.id) && this.joined?.peerId?.localeCompare(info.id) < 0) this.createOffer(info.id).catch(() => this.dropPeer(info.id));
    }, 350 + Math.random() * 250);
  }

  createPeer(id) {
    if (this.peers.has(id)) return this.peers.get(id).pc;
    if (this.peers.size >= MAX_PEERS) return null;
    this.addStat("iceAttempts", 1);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
    const placeholder = { id, pc, isOpen: () => false, close: () => pc.close() };
    this.peers.set(id, placeholder);
    pc.onicecandidate = (event) => {
      if (event.candidate) this.signal(id, { kind: "ice", mid: event.candidate.sdpMid, mline: event.candidate.sdpMLineIndex, cand: event.candidate.candidate });
    };
    pc.ondatachannel = (event) => this.wireChannel(id, pc, event.channel);
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        if (pc.connectionState === "failed") this.addStat("iceFailures", 1);
        this.dropPeer(id);
      }
    };
    return pc;
  }

  wireChannel(id, pc, channel) {
    const existing = this.peers.get(id);
    if (existing instanceof PeerLink) existing.close(false);
    const link = new PeerLink({
      id, pc, channel, store: this.store,
      uploadAllowed: () => networkCaps(this.upload).upload,
      onUploaded: (bytes) => { this.addStat("ul", bytes); this.emitStatus(); },
      onClosed: () => this.dropPeer(id)
    });
    const originalOpen = channel.onopen;
    channel.onopen = async (event) => {
      await originalOpen?.(event);
      this.addStat("iceSuccesses", 1);
      const candidate = await this.selectedCandidateType(pc);
      this.addStat(`ice${candidate[0].toUpperCase()}${candidate.slice(1)}`, 1);
      this.emitStatus();
    };
    this.peers.set(id, link);
  }

  async selectedCandidateType(pc) {
    try {
      const reports = await pc.getStats();
      let pair;
      reports.forEach((report) => {
        if (report.type === "transport" && report.selectedCandidatePairId) pair = reports.get(report.selectedCandidatePairId);
        if (!pair && report.type === "candidate-pair" && report.nominated && report.state === "succeeded") pair = report;
      });
      const local = pair && reports.get(pair.localCandidateId);
      return ["host", "srflx", "prflx", "relay"].includes(local?.candidateType) ? local.candidateType : "unknown";
    } catch { return "unknown"; }
  }

  async createOffer(id) {
    const pc = this.createPeer(id);
    if (!pc) return;
    const channel = pc.createDataChannel("sc-data", { ordered: true });
    this.wireChannel(id, pc, channel);
    await pc.setLocalDescription(await pc.createOffer());
    this.signal(id, { kind: "offer", sdp: pc.localDescription.sdp });
  }

  async onSignal(from, data) {
    if (!from || !data?.kind) return;
    if (data.kind === "ice") {
      const candidate = new RTCIceCandidate({ sdpMid: data.mid, sdpMLineIndex: data.mline, candidate: data.cand });
      const pc = this.peers.get(from)?.pc;
      if (pc?.remoteDescription) await pc.addIceCandidate(candidate);
      else this.pendingIce.set(from, [...(this.pendingIce.get(from) || []), candidate]);
      return;
    }
    if (data.kind === "offer") {
      let pc = this.peers.get(from)?.pc;
      if (pc?.signalingState === "have-local-offer") {
        await pc.setLocalDescription({ type: "rollback" });
      }
      pc ||= this.createPeer(from);
      if (!pc) return;
      await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
      for (const candidate of this.pendingIce.get(from) || []) await pc.addIceCandidate(candidate).catch(() => {});
      this.pendingIce.delete(from);
      await pc.setLocalDescription(await pc.createAnswer());
      this.signal(from, { kind: "answer", sdp: pc.localDescription.sdp });
      return;
    }
    if (data.kind === "answer") {
      const pc = this.peers.get(from)?.pc;
      if (pc && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
        for (const candidate of this.pendingIce.get(from) || []) await pc.addIceCandidate(candidate).catch(() => {});
        this.pendingIce.delete(from);
      }
    }
  }

  dropPeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.close(false);
    this.emitStatus();
    if (!this.closed && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ t: "need_peers", exclude: [...this.peers.keys()] }));
    }
  }

  async fetchSegment(seq, edgeUrl) {
    this.lastFetchSeq = seq;
    const cached = this.store.get(seq);
    if (cached) return cached;
    const metadata = this.metadata.get(seq);
    if (metadata && this.joined?.swarmMode === "p2p") {
      const designatedBootstrap = Boolean(metadata.seedTier && this.joined.superPeer);
      const supplyDeadline = Date.now() + (designatedBootstrap ? 120 : 1_400);
      let candidates = [];
      while (Date.now() < supplyDeadline) {
        candidates = [...this.peers.values()].filter((peer) => peer instanceof PeerLink && peer.isOpen() && peer.remoteHas.has(seq));
        if (candidates.length) break;
        await delay(40);
      }
      for (const peer of candidates.slice(0, 3)) {
        const bytes = await peer.request(seq);
        if (!bytes) {
          this.addStat("peerTimeouts", 1);
          continue;
        }
        const digest = await sha256Hex(bytes);
        if (digest !== metadata.sha256 || (metadata.size && bytes.byteLength !== metadata.size)) {
          this.addStat("hashFailures", 1);
          this.dropPeer(peer.id);
          continue;
        }
        this.store.put(seq, bytes, digest);
        this.addStat(peer.direct ? "dlP2p" : "dlRelay", bytes.byteLength);
        this.broadcastHave();
        this.emitStatus();
        return bytes;
      }
    }
    const useOrigin = Boolean(metadata?.seedTier && this.joined?.superPeer && this.joined?.originUrlTemplate);
    const fallbackUrl = useOrigin ? this.templateUrl(this.joined.originUrlTemplate, edgeUrl) : edgeUrl;
    const response = await fetch(fallbackUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Segment request failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (metadata) {
      const digest = await sha256Hex(bytes);
      if (digest !== metadata.sha256 || (metadata.size && bytes.byteLength !== metadata.size)) throw new Error("Edge segment failed integrity verification");
      this.store.put(seq, bytes, digest);
      this.broadcastHave();
    }
    this.addStat(useOrigin ? "dlBootstrapOrigin" : "dlEdge", bytes.byteLength);
    this.emitStatus();
    return bytes;
  }

  async prefetchSeed(metadata) {
    if (!this.joined?.superPeer || !networkCaps(this.upload).upload || !this.joined.originUrlTemplate) return;
    if (this.store.has(metadata.seq) || this.prefetching.has(metadata.seq)) return;
    this.prefetching.add(metadata.seq);
    try {
      const fileName = `seg_${String(metadata.seq).padStart(8, "0")}.m4s`;
      const url = this.authenticatedUrl(this.joined.originUrlTemplate.replace("{file}", fileName));
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = await sha256Hex(bytes);
      if (digest !== metadata.sha256 || (metadata.size && bytes.byteLength !== metadata.size)) return;
      this.store.put(metadata.seq, bytes, digest);
      this.addStat("dlBootstrapOrigin", bytes.byteLength);
      this.broadcastHave();
      this.emitStatus();
    } finally {
      this.prefetching.delete(metadata.seq);
    }
  }

  authenticatedUrl(rawUrl) {
    const url = new URL(rawUrl, location.href);
    url.searchParams.set("token", this.token);
    return url.toString();
  }

  edgeUrlFor(rawUrl) {
    const fileName = new URL(rawUrl, location.href).pathname.split("/").pop();
    const template = this.joined?.edgeUrlTemplate;
    if (!fileName || !template?.includes("{file}")) return this.authenticatedUrl(rawUrl);
    return this.authenticatedUrl(template.replace("{file}", encodeURIComponent(fileName)));
  }

  templateUrl(template, rawUrl) {
    const fileName = new URL(rawUrl, location.href).pathname.split("/").pop();
    if (!fileName || !template?.includes("{file}")) return this.authenticatedUrl(rawUrl);
    return this.authenticatedUrl(template.replace("{file}", encodeURIComponent(fileName)));
  }

  async fetchFragment(rawUrl) {
    const seq = sequenceFromUrl(rawUrl);
    const edgeUrl = this.edgeUrlFor(rawUrl);
    if (seq !== null) return this.fetchSegment(seq, edgeUrl);
    const response = await fetch(edgeUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Fragment request failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.addStat("dlEdge", bytes.byteLength);
    this.emitStatus();
    return bytes;
  }

  broadcastHave() {
    const seqs = this.store.seqs();
    for (const peer of this.peers.values()) if (peer instanceof PeerLink) peer.announce(seqs);
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ t: "have", seqs }));
  }

  flushStats() {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.joined) return;
    const stats = this.pendingStats;
    this.socket.send(JSON.stringify({
      t: "stats", dl_p2p: stats.dlP2p, dl_edge: stats.dlEdge, dl_bootstrap_origin: stats.dlBootstrapOrigin, dl_relay: stats.dlRelay, ul: stats.ul,
      stalls: stats.stalls, peer_timeouts: stats.peerTimeouts, hash_failures: stats.hashFailures,
      ice_attempts: stats.iceAttempts, ice_successes: stats.iceSuccesses, ice_failures: stats.iceFailures,
      ice_candidate_host: stats.iceHost, ice_candidate_srflx: stats.iceSrflx,
      ice_candidate_prflx: stats.icePrflx, ice_candidate_relay: stats.iceRelay,
      ice_candidate_unknown: stats.iceUnknown
    }));
    this.pendingStats = this.emptyStats();
    this.emitStatus();
  }

  close() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.statsTimer);
    this.flushStats();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ t: "leave" }));
    this.socket?.close();
    for (const peer of this.peers.values()) peer.close(false);
    this.peers.clear();
    this.store.clear();
  }
}

export function sequenceFromUrl(url) {
  const fileName = new URL(url, location.href).pathname.split("/").pop() || "";
  if (/init|\.m3u8$/i.test(fileName) || !/\.(m4s|mp4|ts)$/i.test(fileName)) return null;
  const matches = [...fileName.replace(/\.[^.]+$/, "").matchAll(/\d+/g)];
  return matches.length ? Number.parseInt(matches.at(-1)[0], 10) : null;
}
