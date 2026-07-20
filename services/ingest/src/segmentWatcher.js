import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@swarmcast/config/logging";

export function segmentSeqFromFilename(filename) {
  const match = filename.match(/seg_(\d+)\.m4s$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export async function describeSegment({ fullPath, relativePath, rlncK }) {
  const seq = segmentSeqFromFilename(relativePath);
  if (seq == null) return null;

  const channelId = relativePath.split(path.sep)[0];
  if (!channelId || channelId === relativePath) return null;

  const [buf, st] = await Promise.all([readFile(fullPath), stat(fullPath)]);
  return {
    channelId,
    seq,
    sha256: createHash("sha256").update(buf).digest("hex"),
    size: st.size,
    k: rlncK
  };
}

export async function announceSegment({
  trackerInternalUrl,
  trackerInternalUrls = trackerInternalUrl ? [trackerInternalUrl] : [],
  internalToken,
  segment,
  fetchFn = fetch,
  attempts = 3,
  timeoutMs = 2000,
  retryDelayMs = 50
}) {
  if (trackerInternalUrls.length === 0) throw new Error("tracker segment announce requires at least one target");
  const body = JSON.stringify(segment);
  await Promise.all(trackerInternalUrls.map(async (baseUrl) => {
    let lastStatus = "unavailable";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchFn(`${baseUrl}/internal/segment`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-token": internalToken
          },
          body,
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (response.ok) return;
        lastStatus = response.status;
      } catch (error) {
        lastStatus = error.message;
      }
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
    throw new Error(`tracker segment announce failed for ${baseUrl}: ${lastStatus}`);
  }));
}

export function watchSegments({
  hlsRoot,
  trackerInternalUrl,
  trackerInternalUrls,
  internalToken,
  rlncK,
  logger = createLogger({ service: "ingest" }),
  fetchFn = fetch,
  onSegment = null
}) {
  return watch(hlsRoot, { recursive: true }, async (_event, filename) => {
    if (!filename || !filename.endsWith(".m4s")) return;

    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const fullPath = path.join(hlsRoot, filename);
      const segment = await describeSegment({ fullPath, relativePath: filename, rlncK });
      if (!segment) return;
      await announceSegment({ trackerInternalUrl, trackerInternalUrls, internalToken, segment, fetchFn });
      onSegment?.(segment);
    } catch (error) {
      logger?.warn?.("segment_announce_failed", {
        segment_filename: filename,
        error_class: "segment_announce_failed",
        error
      }, "failed to announce segment");
    }
  });
}
