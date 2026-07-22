import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createWebServer } from "../services/web/src/server.js";

const channels = Array.from({ length: 24 }, (_, index) => ({
  id: `channel-${index + 1}`,
  name: index === 0 ? "International News Live" : `Channel ${index + 1}`,
  group: index % 2 ? "Entertainment" : "News",
  logo: ""
}));

const server = createWebServer({
  appApiKey: "test-key",
  trackerUrl: "wss://tracker.example/ws",
  fetchJson: async (url) => {
    if (url.includes("/groups")) return { groups: ["News", "Entertainment"] };
    if (url.includes("/channels")) return { items: channels, page: 1, pageSize: 80, total: channels.length, hasMore: false };
    return { token: "test-token", expiresIn: 60, iceServers: [{ urls: ["stun:stun.example"] }] };
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });

try {
  await mkdir("var/screenshots", { recursive: true });
  for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator(".channel-row").first().waitFor();
    assert.equal(await page.locator(".channel-row").count(), channels.length);
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true, `${name} has horizontal overflow`);
    if (name === "mobile") {
      await page.locator("#menu-button").click();
      assert.equal(await page.locator("#catalog-panel").evaluate((element) => element.classList.contains("open")), true);
      await page.waitForTimeout(250);
    }
    assert.deepEqual(errors, [], `${name} emitted browser errors`);
    await page.screenshot({ path: `var/screenshots/web-${name}.png`, fullPage: true });
    await page.close();
  }
  console.log("Web UI smoke OK: desktop=1440x900 mobile=390x844 channels=24");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
