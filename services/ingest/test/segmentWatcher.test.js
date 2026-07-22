import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { announceSegment, deliverSegmentMetadata, describeSegment, describeSegmentWithRetry, segmentSeqFromFilename } from "../src/segmentWatcher.js";

test("segmentSeqFromFilename extracts numeric sequence", () => {
  assert.equal(segmentSeqFromFilename("channel/seg_00000042.m4s"), 42);
  assert.equal(segmentSeqFromFilename("channel/init.mp4"), null);
});

test("describeSegment returns hash, size, seq, channel, and k", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-segment-"));
  const channelDir = path.join(dir, "demo");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(channelDir, { recursive: true }));
  const fullPath = path.join(channelDir, "seg_00000007.m4s");
  const bytes = readFileSync(new URL("../../../test-fixtures/media/fmp4/seg_00000000.m4s", import.meta.url));
  writeFileSync(fullPath, bytes);

  const segment = await describeSegment({
    fullPath,
    relativePath: path.join("demo", "seg_00000007.m4s"),
    rlncK: 32
  });

  assert.deepEqual(segment, {
    channelId: "demo",
    seq: 7,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    k: 32
  });
});

test("describeSegment rejects malformed fMP4 before announcement", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-segment-malformed-"));
  const fullPath = path.join(dir, "seg_00000008.m4s");
  writeFileSync(fullPath, Buffer.from("not-an-fmp4-fragment"));
  await assert.rejects(() => describeSegment({
    fullPath,
    relativePath: path.join("demo", "seg_00000008.m4s"),
    rlncK: 32
  }), /ISO-BMFF|fMP4/);
});

test("describeSegmentWithRetry waits for ffmpeg to finish an observed segment", async () => {
  let attempts = 0;
  let sleeps = 0;
  const result = await describeSegmentWithRetry({ fullPath: "segment" }, {
    attempts: 4,
    retryDelayMs: 10,
    describeFn: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("incomplete fMP4");
      return { seq: 7 };
    },
    sleep: async (ms) => { assert.equal(ms, 10); sleeps += 1; }
  });
  assert.deepEqual(result, { seq: 7 });
  assert.equal(attempts, 3);
  assert.equal(sleeps, 2);
});

test("announceSegment posts internal token and segment body", async () => {
  const calls = [];
  await announceSegment({
    trackerInternalUrl: "http://tracker.local",
    internalToken: "secret",
    segment: { channelId: "demo", seq: 1, sha256: "abc", size: 10, k: 32 },
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return { ok: true };
    }
  });

  assert.equal(calls[0].url, "http://tracker.local/internal/segment");
  assert.equal(calls[0].options.headers["x-internal-token"], "secret");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    channelId: "demo",
    seq: 1,
    sha256: "abc",
    size: 10,
    k: 32
  });
});

test("announceSegment distributes metadata to every tracker cell endpoint and retries failures", async () => {
  const attempts = new Map();
  await announceSegment({
    trackerInternalUrls: ["http://tracker-a.local", "http://tracker-b.local"],
    internalToken: "secret",
    segment: { channelId: "demo", seq: 2, sha256: "abc", size: 10, k: 32 },
    retryDelayMs: 0,
    fetchFn: async (url) => {
      attempts.set(url, (attempts.get(url) || 0) + 1);
      return { ok: !url.includes("tracker-b") || attempts.get(url) >= 2, status: 503 };
    }
  });

  assert.equal(attempts.get("http://tracker-a.local/internal/segment"), 1);
  assert.equal(attempts.get("http://tracker-b.local/internal/segment"), 2);
});

test("durable publisher replaces direct tracker fanout without fallback", async () => {
  const published = [];
  let fetches = 0;
  const value = await deliverSegmentMetadata({
    segment: { channelId: "demo", seq: 3, sha256: "a".repeat(64), size: 10, k: 32 },
    publishSegment: async (segment) => {
      published.push(segment);
      return { duplicate: false, seq: 7 };
    },
    trackerInternalUrls: ["http://tracker-a.local", "http://tracker-b.local"],
    internalToken: "secret",
    fetchFn: async () => {
      fetches += 1;
      throw new Error("HTTP fallback must not run when durable publishing is enabled");
    }
  });
  assert.equal(value.seq, 7);
  assert.equal(published.length, 1);
  assert.equal(fetches, 0);
});
