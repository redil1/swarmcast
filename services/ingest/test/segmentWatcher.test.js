import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { announceSegment, describeSegment, segmentSeqFromFilename } from "../src/segmentWatcher.js";

test("segmentSeqFromFilename extracts numeric sequence", () => {
  assert.equal(segmentSeqFromFilename("channel/seg_00000042.m4s"), 42);
  assert.equal(segmentSeqFromFilename("channel/init.mp4"), null);
});

test("describeSegment returns hash, size, seq, channel, and k", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarmcast-segment-"));
  const channelDir = path.join(dir, "demo");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(channelDir, { recursive: true }));
  const fullPath = path.join(channelDir, "seg_00000007.m4s");
  const bytes = Buffer.from("segment-bytes");
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
