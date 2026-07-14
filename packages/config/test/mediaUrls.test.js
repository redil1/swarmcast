import test from "node:test";
import assert from "node:assert/strict";
import { ConfigError } from "../src/env.js";
import { buildMediaUrlContract, validateMediaUrlContract } from "../src/mediaUrls.js";

test("buildMediaUrlContract builds single-node fallback URLs", () => {
  const contract = buildMediaUrlContract({
    channelId: "demo",
    edgeBase: "https://edge.example.tv/",
    originBase: "https://origin.example.tv/"
  });

  assert.deepEqual(contract, {
    playlistUrl: "https://edge.example.tv/live/demo/playlist.m3u8",
    edgeUrlTemplate: "https://edge.example.tv/live/demo/{file}",
    originUrlTemplate: "https://origin.example.tv/live/demo/{file}",
    demandUrl: null
  });
  assert.equal(validateMediaUrlContract(contract), true);
});

test("buildMediaUrlContract builds placement-aware URLs", () => {
  const contract = buildMediaUrlContract({
    channelId: "demo",
    edgeBase: "https://edge.example.tv",
    originBase: "https://origin.example.tv",
    placement: {
      node: { id: "n1", baseUrl: "https://n1.origin.example.tv/", ingestUrl: "http://n1:7001/" }
    }
  });

  assert.deepEqual(contract, {
    playlistUrl: "https://edge.example.tv/edge/n1/live/demo/playlist.m3u8",
    edgeUrlTemplate: "https://edge.example.tv/edge/n1/live/demo/{file}",
    originUrlTemplate: "https://n1.origin.example.tv/live/demo/{file}",
    demandUrl: "http://n1:7001"
  });
  assert.equal(validateMediaUrlContract(contract), true);
});

test("buildMediaUrlContract rejects unsafe IDs and third-party media hosts", () => {
  assert.throws(() => buildMediaUrlContract({
    channelId: "../demo",
    edgeBase: "https://edge.example.tv",
    originBase: "https://origin.example.tv"
  }), ConfigError);

  assert.throws(() => buildMediaUrlContract({
    channelId: "demo",
    edgeBase: "https://edge.global.fastly.net",
    originBase: "https://origin.example.tv"
  }), /third-party CDN/);

  assert.throws(() => buildMediaUrlContract({
    channelId: "demo",
    edgeBase: "https://edge.example.tv",
    originBase: "https://origin.example.tv",
    placement: { node: { id: "bad/node", baseUrl: "https://n1.origin.example.tv" } }
  }), /safe path identifier/);
});

test("validateMediaUrlContract rejects malformed templates", () => {
  assert.throws(() => validateMediaUrlContract({
    playlistUrl: "https://edge.example.tv/live/demo/not-playlist.txt",
    edgeUrlTemplate: "https://edge.example.tv/live/demo/{file}",
    originUrlTemplate: "https://origin.example.tv/live/demo/{file}",
    demandUrl: null
  }), /playlistUrl/);

  assert.throws(() => validateMediaUrlContract({
    playlistUrl: "https://edge.example.tv/live/demo/playlist.m3u8",
    edgeUrlTemplate: "https://edge.example.tv/live/demo/static.m4s",
    originUrlTemplate: "https://origin.example.tv/live/demo/{file}",
    demandUrl: null
  }), /edgeUrlTemplate/);
});
