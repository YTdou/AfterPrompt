import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { reportCliError, startViteDevServer, withTimeout } from "./lib/managed-vite-server.mjs";

const baseUrl = process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4173";
const executablePath = process.env.CHROME_PATH ?? [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);

const captures = [
  { locale: "zh-CN", path: "docs/screenshots/afterprompt-hero-zh-CN.png" },
  { locale: "en-US", path: "docs/screenshots/afterprompt-hero-en.png" },
];

async function run() {
  if (!executablePath) throw new Error("Chrome/Chromium was not found. Set CHROME_PATH to its executable.");
  const server = await startViteDevServer({
    baseUrl,
    reuseExisting: Boolean(process.env.STUDIO_BASE_URL),
  });
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    for (const capture of captures) {
      const context = await browser.newContext({ locale: capture.locale, viewport: { width: 1600, height: 1000 } });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.locator("#document-status").waitFor();
      await page.screenshot({ path: capture.path });
      await context.close();
      process.stdout.write(`[readme-screenshot] wrote ${capture.path}\n`);
    }
  } finally {
    try {
      if (browser) await withTimeout(browser.close(), 10_000, "README screenshot Chromium shutdown");
    } finally {
      await server.close();
    }
  }
}

run().catch((error) => reportCliError(error, "README screenshot capture failed"));
