import { existsSync } from "node:fs";
import process from "node:process";
import { chromium } from "playwright-core";
import { reportCliError, startVitePreviewServer, withTimeout } from "./lib/managed-vite-server.mjs";

const host = "127.0.0.1";
const port = process.env.PRODUCTION_SMOKE_PORT ?? "4193";
const baseUrl = process.env.PRODUCTION_BASE_URL ?? `http://${host}:${port}/AfterPrompt/`;
const executablePath = process.env.CHROME_PATH ?? [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);

function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  if (!executablePath) throw new Error("Chrome/Chromium was not found. Set CHROME_PATH to its executable.");
  const server = await startVitePreviewServer({
    baseUrl,
    basePath: "/AfterPrompt/",
    reuseExisting: Boolean(process.env.PRODUCTION_BASE_URL),
  });

  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(20_000);
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.stack ?? error.message));
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
        failures.push(`${response.status()} ${response.url()}`);
      }
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#document-status").waitFor();
    assert(await page.title() === "AfterPrompt — Visually refine what AI generates.", "The production page title is incorrect.");
    assert((await page.locator(".brand strong").textContent()) === "AfterPrompt", "The production editor did not initialize.");
    assert(failures.length === 0, `Production smoke observed browser failures:\n${failures.join("\n")}`);
    process.stdout.write(`${JSON.stringify({ ok: true, baseUrl, assets: true, editor: true })}\n`);
  } finally {
    try {
      if (browser) await withTimeout(browser.close(), 10_000, "Production smoke Chromium shutdown");
    } finally {
      await server.close();
    }
  }
}

main().catch((error) => reportCliError(error, "Production smoke failed"));
