import Hls from "hls.js";
import { createIcons, CircleAlert, Menu, RefreshCw, RotateCcw, Search, Share2, Tv } from "lucide";
import { SwarmClient } from "./swarm.js";

createIcons({ icons: { CircleAlert, Menu, RefreshCw, RotateCcw, Search, Share2, Tv } });

const elements = Object.fromEntries([
  "catalog-panel", "channel-list", "catalog-count", "search-input", "group-select", "load-more", "refresh-button",
  "menu-button", "scrim", "video", "video-shell", "player-empty", "player-loading", "active-logo", "active-name",
  "active-group", "connection", "connection-label", "upload-toggle", "metric-swarm", "metric-peers", "metric-offload",
  "metric-p2p", "metric-upload", "route-dot", "route-label", "error-banner", "error-text", "retry-button"
].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

const state = { page: 1, pageSize: 80, query: "", group: "", channels: [], hasMore: false, active: null, hls: null, swarm: null, lastStats: null };
let searchTimer;

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) { value /= 1024; unit = units[index]; }
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} ${unit}`;
}

function setConnection(label, kind = "") {
  elements.connection_label.textContent = label;
  elements.connection.className = `connection ${kind}`;
}

function setError(message = "") {
  elements.error_text.textContent = message;
  elements.error_banner.hidden = !message;
}

async function waitForPlaylist(url, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("The channel source did not become ready");
}

function logoMarkup(channel) {
  const initial = (channel.name || "S").trim().charAt(0).toUpperCase();
  let logo;
  try { logo = new URL(channel.logo); } catch {}
  if (logo?.protocol !== "https:") return `<span>${escapeHtml(initial)}</span>`;
  return `<img src="${escapeHtml(channel.logo)}" alt="" data-fallback="${escapeHtml(initial)}" loading="lazy" referrerpolicy="no-referrer">`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function renderChannels() {
  elements.channel_list.innerHTML = state.channels.map((channel) => `
    <button class="channel-row${state.active?.id === channel.id ? " active" : ""}" data-channel-id="${escapeHtml(channel.id)}" role="option" aria-selected="${state.active?.id === channel.id}">
      <span class="channel-logo">${logoMarkup(channel)}</span>
      <span class="channel-copy"><strong>${escapeHtml(channel.name)}</strong><span>${escapeHtml(channel.group || "Live")}</span></span>
    </button>`).join("");
  elements.catalog_count.textContent = `${state.channels.length} channel${state.channels.length === 1 ? "" : "s"}`;
  elements.load_more.hidden = !state.hasMore;
}

async function loadGroups() {
  const response = await fetch("/web-api/groups");
  if (!response.ok) throw new Error("Could not load channel groups");
  const body = await response.json();
  const groups = Array.isArray(body) ? body : body.items || body.groups || [];
  elements.group_select.innerHTML = '<option value="">All groups</option>' + groups.map((group) => {
    const value = typeof group === "string" ? group : group.name;
    return `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;
  }).join("");
}

async function loadChannels({ append = false } = {}) {
  setConnection("Loading channels");
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
  if (state.query) params.set("q", state.query);
  if (state.group) params.set("group", state.group);
  const response = await fetch(`/web-api/channels?${params}`);
  if (!response.ok) throw new Error("Could not load channels");
  const body = await response.json();
  state.channels = append ? [...state.channels, ...body.items] : body.items;
  state.hasMore = Boolean(body.hasMore);
  renderChannels();
  setConnection(state.active ? "Live" : "Ready", state.active ? "online" : "");
}

function closeCatalog() {
  elements.catalog_panel.classList.remove("open");
  elements.scrim.hidden = true;
}

function createFragmentLoader(swarm) {
  const DefaultLoader = Hls.DefaultConfig.loader;
  return class P2PFragmentLoader {
    constructor(config) {
      this.context = null;
      this.stats = { aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0, loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } };
      this.fallback = new DefaultLoader(config);
      this.controller = new AbortController();
    }
    load(context, config, callbacks) {
      this.context = context;
      this.stats.loading.start = performance.now();
      swarm.fetchFragment(context.url).then((bytes) => {
        if (this.stats.aborted) return;
        this.stats.loading.first = this.stats.loading.end = performance.now();
        this.stats.loaded = this.stats.total = bytes.byteLength;
        callbacks.onSuccess({ url: context.url, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), code: 200 }, this.stats, context, null);
      }).catch((error) => {
        if (!this.stats.aborted) callbacks.onError({ code: 0, text: error.message }, context, null, this.stats);
      });
    }
    abort() { this.stats.aborted = true; this.controller.abort(); this.fallback.abort(); }
    destroy() { this.abort(); this.fallback.destroy(); }
    getCacheAge() { return null; }
    getResponseHeader() { return null; }
  };
}

function updateMetrics(stats) {
  state.lastStats = stats;
  elements.video_shell.dataset.cachedSegments = String(stats.cachedSegments || 0);
  elements.video_shell.dataset.remoteSegments = String(stats.remoteSegments || 0);
  elements.video_shell.dataset.metadataSegments = String(stats.metadataSegments || 0);
  elements.video_shell.dataset.lastFetchSeq = String(stats.lastFetchSeq || 0);
  elements.video_shell.dataset.lastMetadataSeq = String(stats.lastMetadataSeq || 0);
  elements.metric_swarm.textContent = String(stats.swarmSize || 0);
  elements.metric_peers.textContent = String(stats.peers || 0);
  elements.metric_offload.textContent = `${Math.round((stats.offloadRatio || 0) * 100)}%`;
  elements.metric_p2p.textContent = formatBytes(stats.dlP2p || 0);
  elements.metric_upload.textContent = formatBytes(stats.ul || 0);
  const p2p = stats.peers > 0 && stats.swarmMode === "p2p";
  elements.route_dot.className = `route-dot ${p2p ? "p2p" : "edge"}`;
  elements.route_label.textContent = p2p ? "Peer network active" : stats.swarmMode === "edge-only" ? "Waiting for swarm" : "Edge fallback";
}

async function startChannel(channel) {
  if (!channel?.id) return;
  closeCatalog();
  setError();
  elements.player_empty.hidden = true;
  elements.player_loading.hidden = false;
  elements.active_name.textContent = channel.name;
  elements.active_group.textContent = channel.group || "Live";
  elements.active_logo.innerHTML = logoMarkup(channel);
  state.active = channel;
  renderChannels();
  state.hls?.destroy();
  state.swarm?.close();
  elements.video.removeAttribute("src");
  elements.video.load();
  setConnection("Connecting");

  try {
    const response = await fetch("/web-api/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!response.ok) throw new Error(response.status === 429 ? "Too many connection attempts. Try again shortly." : "Could not create a playback session");
    const session = await response.json();
    const swarm = new SwarmClient({ trackerUrl: session.trackerUrl, token: session.token, iceServers: session.iceServers, upload: elements.upload_toggle.checked });
    state.swarm = swarm;
    swarm.addEventListener("status", (event) => updateMetrics(event.detail));
    const joined = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The channel did not start in time")), 12_000);
      swarm.addEventListener("joined", (event) => { clearTimeout(timer); resolve(event.detail); }, { once: true });
    });
    await swarm.connect(channel.id);
    const tracker = await joined;
    if (state.swarm !== swarm) return;
    if (!Hls.isSupported()) throw new Error("This browser does not support the required streaming features");
    const playlistUrl = swarm.authenticatedUrl(tracker.playlistUrl);
    await waitForPlaylist(playlistUrl);
    const hls = new Hls({
      fLoader: createFragmentLoader(swarm),
      lowLatencyMode: false,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 8,
      maxBufferLength: 45,
      backBufferLength: 30,
      enableWorker: true
    });
    state.hls = hls;
    hls.attachMedia(elements.video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(playlistUrl));
    hls.on(Hls.Events.MANIFEST_PARSED, () => elements.video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls.loadSource(playlistUrl), 750);
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else setError("Playback stopped. Retry the channel.");
    });
    elements.video.onplaying = () => { elements.player_loading.hidden = true; setConnection("Live", "online"); };
    elements.video.onwaiting = () => { if (!elements.video.paused) elements.player_loading.hidden = false; };
    elements.video.onstalled = () => state.swarm?.addStat("stalls", 1);
  } catch (error) {
    elements.player_loading.hidden = true;
    setConnection("Playback error", "error");
    setError(error.message || "Playback could not start");
  }
}

elements.channel_list.addEventListener("click", (event) => {
  const row = event.target.closest("[data-channel-id]");
  if (row) startChannel(state.channels.find((channel) => channel.id === row.dataset.channelId));
});
document.addEventListener("error", (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.dataset.fallback) image.replaceWith(document.createTextNode(image.dataset.fallback));
}, true);
elements.search_input.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = elements.search_input.value.trim(); state.page = 1; loadChannels().catch((error) => setError(error.message)); }, 250);
});
elements.group_select.addEventListener("change", () => { state.group = elements.group_select.value; state.page = 1; loadChannels().catch((error) => setError(error.message)); });
elements.load_more.addEventListener("click", () => { state.page += 1; loadChannels({ append: true }).catch((error) => setError(error.message)); });
elements.refresh_button.addEventListener("click", () => { state.page = 1; loadChannels().catch((error) => setError(error.message)); });
elements.upload_toggle.addEventListener("change", () => state.swarm?.setUpload(elements.upload_toggle.checked));
elements.menu_button.addEventListener("click", () => { elements.catalog_panel.classList.add("open"); elements.scrim.hidden = false; });
elements.scrim.addEventListener("click", closeCatalog);
elements.retry_button.addEventListener("click", () => startChannel(state.active));
window.addEventListener("beforeunload", () => state.swarm?.close());

Promise.all([loadGroups(), loadChannels()]).catch((error) => { setConnection("Unavailable", "error"); setError(error.message); });
