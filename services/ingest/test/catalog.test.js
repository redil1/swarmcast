import test from "node:test";
import assert from "node:assert/strict";
import { parseM3uText, publicChannel, stableChannelId } from "../src/catalog.js";

test("parseM3uText parses m3u_plus metadata and stable IDs", () => {
  const text = `#EXTM3U
#EXTINF:-1 tvg-id="abc" tvg-logo="https://logo.test/a.png" group-title="News",News One
https://source.test/news/index.m3u8
#EXTINF:-1 group-title="Sports",Sports One
https://source.test/sports/index.m3u8
`;

  const channels = parseM3uText(text);
  assert.equal(channels.size, 2);

  const id = stableChannelId("https://source.test/news/index.m3u8");
  assert.equal(channels.get(id).name, "News One");
  assert.equal(channels.get(id).logo, "https://logo.test/a.png");
  assert.equal(channels.get(id).group, "News");
  assert.equal(channels.get(id).tvgId, "abc");
});

test("parseM3uText enforces configured source URL policy", () => {
  const text = `#EXTM3U
#EXTINF:-1 group-title="News",Allowed
https://source.test/news/index.m3u8
`;

  const channels = parseM3uText(text, {
    sourcePolicy: { allowedHosts: ["source.test"], allowPrivateNetworks: false }
  });
  assert.equal(channels.size, 1);

  assert.throws(() => parseM3uText(text, {
    sourcePolicy: { allowedHosts: ["other.test"], allowPrivateNetworks: false }
  }), /SOURCE_ALLOWED_HOSTS/);

  assert.throws(() => parseM3uText(`#EXTM3U
#EXTINF:-1,Private
http://192.168.1.10/live.m3u8
`, {
    sourcePolicy: { allowedHosts: [], allowPrivateNetworks: false }
  }), /private or loopback/);
});

test("publicChannel strips sourceUrl", () => {
  const safe = publicChannel({
    id: "1",
    name: "A",
    logo: "",
    group: "",
    tvgId: "",
    sourceUrl: "https://secret.example"
  });

  assert.deepEqual(safe, {
    id: "1",
    name: "A",
    logo: "",
    group: "",
    tvgId: ""
  });
});
