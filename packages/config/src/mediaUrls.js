import { ConfigError } from "./env.js";

const FORBIDDEN_CDN_HOST_PARTS = Object.freeze(["cloudfront", "akamai", "fastly"]);

function safePathId(value, key) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text)) {
    throw new ConfigError(`${key} must be a safe path identifier`, { key });
  }
  return text;
}

function normalizeBaseUrl(value, key, { protocols = ["http:", "https:"] } = {}) {
  const text = String(value || "").trim();
  if (!text) throw new ConfigError(`${key} is required`, { key });
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new ConfigError(`${key} must be a valid URL`, { key });
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new ConfigError(`${key} must use one of: ${protocols.join(", ")}`, { key });
  }
  if (parsed.username || parsed.password) {
    throw new ConfigError(`${key} must not contain URL credentials`, { key });
  }
  const provider = FORBIDDEN_CDN_HOST_PARTS.find((part) => parsed.hostname.toLowerCase().includes(part));
  if (provider) throw new ConfigError(`${key} must not point to a third-party CDN provider`, { key });
  return text.replace(/\/+$/, "");
}

export function buildMediaUrlContract({ channelId, edgeBase, originBase, placement = null }) {
  const safeChannelId = safePathId(channelId, "channelId");
  const normalizedEdgeBase = normalizeBaseUrl(edgeBase, "edgeBase");

  if (!placement?.node) {
    const normalizedOriginBase = normalizeBaseUrl(originBase, "originBase");
    return {
      playlistUrl: `${normalizedEdgeBase}/live/${safeChannelId}/playlist.m3u8`,
      edgeUrlTemplate: `${normalizedEdgeBase}/live/${safeChannelId}/{file}`,
      originUrlTemplate: `${normalizedOriginBase}/live/${safeChannelId}/{file}`,
      demandUrl: null
    };
  }

  const nodeId = safePathId(placement.node.id, "placement.node.id");
  const nodeBaseUrl = normalizeBaseUrl(placement.node.baseUrl, "placement.node.baseUrl");
  const demandUrl = placement.node.ingestUrl
    ? normalizeBaseUrl(placement.node.ingestUrl, "placement.node.ingestUrl")
    : null;

  return {
    playlistUrl: `${normalizedEdgeBase}/edge/${nodeId}/live/${safeChannelId}/playlist.m3u8`,
    edgeUrlTemplate: `${normalizedEdgeBase}/edge/${nodeId}/live/${safeChannelId}/{file}`,
    originUrlTemplate: `${nodeBaseUrl}/live/${safeChannelId}/{file}`,
    demandUrl
  };
}

export function validateMediaUrlContract(contract) {
  if (!contract || typeof contract !== "object") throw new ConfigError("media URL contract is required");
  for (const key of ["playlistUrl", "edgeUrlTemplate", "originUrlTemplate"]) {
    normalizeBaseUrl(String(contract[key] || "").replace("/{file}", "/placeholder.m4s"), key);
  }
  if (!String(contract.playlistUrl).endsWith("/playlist.m3u8")) {
    throw new ConfigError("playlistUrl must end with /playlist.m3u8", { key: "playlistUrl" });
  }
  if (!String(contract.edgeUrlTemplate).includes("{file}")) {
    throw new ConfigError("edgeUrlTemplate must include {file}", { key: "edgeUrlTemplate" });
  }
  if (!String(contract.originUrlTemplate).includes("{file}")) {
    throw new ConfigError("originUrlTemplate must include {file}", { key: "originUrlTemplate" });
  }
  if (contract.demandUrl != null) normalizeBaseUrl(contract.demandUrl, "demandUrl");
  return true;
}
