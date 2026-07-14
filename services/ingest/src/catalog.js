import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateSourceUrl } from "@swarmcast/config/env";

function attr(line, key) {
  const match = line.match(new RegExp(`${key}="([^"]*)"`));
  return match ? match[1] : "";
}

export function stableChannelId(sourceUrl) {
  return createHash("sha1").update(sourceUrl).digest("hex").slice(0, 12);
}

export function parseM3uText(text, { sourcePolicy = null } = {}) {
  const lines = text.split(/\r?\n/);
  const channels = new Map();
  let pending = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      pending = {
        name: line.includes(",") ? line.split(",").pop().trim() : "Unnamed Channel",
        logo: attr(line, "tvg-logo"),
        group: attr(line, "group-title"),
        tvgId: attr(line, "tvg-id")
      };
      continue;
    }

    if (line.startsWith("#")) continue;
    if (!pending) continue;

    const sourceUrl = sourcePolicy ? validateSourceUrl(line, sourcePolicy, "M3U_SOURCE_URL") : line;
    const id = stableChannelId(sourceUrl);
    channels.set(id, { id, ...pending, sourceUrl });
    pending = null;
  }

  return channels;
}

export function parseM3u(path, options = {}) {
  return parseM3uText(readFileSync(path, "utf8"), options);
}

export function publicChannel(channel) {
  const { sourceUrl, ...safe } = channel;
  return safe;
}
