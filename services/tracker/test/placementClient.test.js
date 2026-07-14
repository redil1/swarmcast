import test from "node:test";
import assert from "node:assert/strict";
import { buildMediaTemplates, resolveChannelPlacement } from "../src/placementClient.js";

test("resolveChannelPlacement calls control plane assignment route", async () => {
  const calls = [];
  const placement = await resolveChannelPlacement({
    channelId: "demo",
    controlPlaneUrl: "http://control.local",
    internalToken: "secret",
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          channelId: "demo",
          node: { id: "n1", baseUrl: "https://n1.origin.example.tv", ingestUrl: "http://n1:7001" }
        })
      };
    }
  });

  assert.equal(calls[0].url, "http://control.local/internal/channels/demo/assign");
  assert.equal(calls[0].options.headers["x-internal-token"], "secret");
  assert.equal(placement.node.id, "n1");
});

test("buildMediaTemplates uses placement-aware edge and origin URLs", () => {
  const templates = buildMediaTemplates({
    channelId: "demo",
    edgeBase: "https://edge.example.tv",
    originBase: "https://origin.example.tv",
    placement: {
      node: { id: "n1", baseUrl: "https://n1.origin.example.tv", ingestUrl: "http://n1:7001" }
    }
  });

  assert.deepEqual(templates, {
    playlistUrl: "https://edge.example.tv/edge/n1/live/demo/playlist.m3u8",
    edgeUrlTemplate: "https://edge.example.tv/edge/n1/live/demo/{file}",
    originUrlTemplate: "https://n1.origin.example.tv/live/demo/{file}",
    demandUrl: "http://n1:7001"
  });
});

test("buildMediaTemplates keeps single-node fallback without placement", () => {
  const templates = buildMediaTemplates({
    channelId: "demo",
    edgeBase: "https://edge.example.tv",
    originBase: "https://origin.example.tv"
  });

  assert.equal(templates.playlistUrl, "https://edge.example.tv/live/demo/playlist.m3u8");
  assert.equal(templates.demandUrl, null);
});
