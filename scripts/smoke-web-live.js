import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.WEB_URL;
const channelQuery = process.env.WEB_CHANNEL_QUERY;
const expectedPeers = Number.parseInt(process.env.WEB_EXPECTED_PEERS || "2", 10);
const requireP2p = process.env.WEB_REQUIRE_P2P !== "0";
const p2pTimeoutMs = Number.parseInt(process.env.WEB_P2P_TIMEOUT_MS || "90000", 10);
if (!baseUrl || !channelQuery) throw new Error("WEB_URL and WEB_CHANNEL_QUERY are required");

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"]
});
const pages = [];

async function openViewer(index) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on("response", (response) => { if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() }); });
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });
  const searchResponse = page.waitForResponse((response) => response.url().includes("/web-api/channels?") && response.url().includes("q="));
  await page.locator("#search-input").fill(channelQuery);
  await searchResponse;
  const channel = page.locator(".channel-row", { hasText: channelQuery }).first();
  await channel.waitFor({ timeout: 15_000 });
  await channel.click();
  await page.waitForFunction(() => document.querySelector("#connection-label")?.textContent === "Live", null, { timeout: 60_000 });
  try {
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2, null, { timeout: 30_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      connection: document.querySelector("#connection-label")?.textContent,
      error: document.querySelector("#error-text")?.textContent,
      errorVisible: !document.querySelector("#error-banner")?.hidden,
      video: {
        readyState: document.querySelector("video")?.readyState,
        networkState: document.querySelector("video")?.networkState,
        error: document.querySelector("video")?.error?.message || null
      }
    }));
    throw new Error(`viewer ${index} playback timeout: ${JSON.stringify({ diagnostics, errors, failedRequests: failedRequests.slice(-20) })}`, { cause: error });
  }
  assert.deepEqual(errors, [], `viewer ${index} emitted browser errors`);
  pages.push({ context, page, errors });
}

try {
  await openViewer(1);
  if (expectedPeers > 1) await new Promise((resolve) => setTimeout(resolve, 2_000));
  for (let index = 2; index <= expectedPeers; index += 1) await openViewer(index);

  await Promise.any(pages.map(({ page }) => page.waitForFunction((minimum) =>
    Number.parseInt(document.querySelector("#metric-swarm")?.textContent || "0", 10) >= minimum,
  expectedPeers, { timeout: 30_000 })));

  if (requireP2p) {
    try {
      await Promise.any(pages.map(({ page }) => page.waitForFunction(() => {
        const text = document.querySelector("#metric-p2p")?.textContent || "0 B";
        return !/^0(?:\.0)? B$/.test(text);
      }, null, { timeout: p2pTimeoutMs })));
    } catch (error) {
      const debug = await Promise.all(pages.map(({ page }) => page.evaluate(() => ({
        swarm: document.querySelector("#metric-swarm")?.textContent,
        connected: document.querySelector("#metric-peers")?.textContent,
        p2p: document.querySelector("#metric-p2p")?.textContent,
        uploaded: document.querySelector("#metric-upload")?.textContent,
        cachedSegments: document.querySelector("#video-shell")?.dataset.cachedSegments,
        remoteSegments: document.querySelector("#video-shell")?.dataset.remoteSegments,
        metadataSegments: document.querySelector("#video-shell")?.dataset.metadataSegments,
        lastFetchSeq: document.querySelector("#video-shell")?.dataset.lastFetchSeq,
        lastMetadataSeq: document.querySelector("#video-shell")?.dataset.lastMetadataSeq
      }))));
      throw new Error(`P2P transfer timeout: ${JSON.stringify(debug)}`, { cause: error });
    }
  }

  const evidence = [];
  for (const [index, { page, errors }] of pages.entries()) {
    evidence.push({
      viewer: index + 1,
      readyState: await page.locator("video").evaluate((video) => video.readyState),
      swarm: await page.locator("#metric-swarm").textContent(),
      connected: await page.locator("#metric-peers").textContent(),
      offload: await page.locator("#metric-offload").textContent(),
      p2p: await page.locator("#metric-p2p").textContent(),
      uploaded: await page.locator("#metric-upload").textContent(),
      route: await page.locator("#route-label").textContent(),
      errors
    });
  }
  console.log(JSON.stringify({ ok: true, channelQuery, evidence }, null, 2));
} finally {
  await Promise.all(pages.map(({ context }) => context.close()));
  await browser.close();
}
