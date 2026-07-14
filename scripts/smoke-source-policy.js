import { parseM3uText } from "../services/ingest/src/catalog.js";

const good = `#EXTM3U
#EXTINF:-1 group-title="News",Allowed News
https://source.example/live/news.m3u8
`;

const privateSource = `#EXTM3U
#EXTINF:-1 group-title="News",Private News
http://127.0.0.1/live/news.m3u8
`;

const disallowed = `#EXTM3U
#EXTINF:-1 group-title="News",Disallowed News
https://evil.example/live/news.m3u8
`;

const sourcePolicy = {
  allowedHosts: ["source.example"],
  allowPrivateNetworks: false
};

const channels = parseM3uText(good, { sourcePolicy });
if (channels.size !== 1) throw new Error(`expected 1 allowed channel, got ${channels.size}`);

for (const [label, text] of [["private", privateSource], ["disallowed", disallowed]]) {
  let rejected = false;
  try {
    parseM3uText(text, { sourcePolicy });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`expected ${label} source to be rejected`);
}

console.log(`source policy smoke OK: allowed=${channels.size} privateRejected=true allowlistRejected=true`);
