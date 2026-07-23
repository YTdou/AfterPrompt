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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertLocale(browser, locale, expected) {
  const context = await browser.newContext({ locale, viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#document-status").waitFor();
    assert(await page.locator("html").getAttribute("lang") === expected.htmlLang, `Expected ${expected.htmlLang} document language for ${locale}.`);
    assert((await page.locator(".brand small").textContent()) === expected.tagline, `Unexpected tagline for ${locale}.`);
    assert((await page.locator("#export-document-label").textContent()) === expected.exportLabel, `Unexpected export label for ${locale}.`);
    assert(await page.locator(`[data-locale-switch="${expected.switch}"]`).getAttribute("aria-pressed") === "true", `Incorrect active language switch for ${locale}.`);

    if (locale === "en-US") {
      assert(await page.locator(".language-switcher").getAttribute("aria-label") === "Language", "Language control aria-label was not localized.");
      const sourceName = await page.locator("#code-file-name").textContent();
      const pageLabel = await page.locator("#page-select option:checked").textContent();
      const layerCount = await page.locator("[data-layer-id]").count();
      await page.locator("[data-layer-id]").first().click();
      assert((await page.locator("#build-selection-controls").textContent()).includes("selected"), "Dynamic Build selection UI was not localized to English.");
      assert((await page.locator("#inspector-content").textContent()).includes("Identity"), "Dynamic inspector UI was not localized to English.");

      await page.locator("#export-menu > summary").click();
      await page.locator("#export-selection-action").click();
      await page.locator("#fragment-save-dialog").waitFor({ state: "visible" });
      assert((await page.locator("#fragment-save-title").textContent()) === "Save local fragment", "Fragment dialog was not localized to English.");
      assert((await page.locator('#fragment-save-target option[value="file"]').textContent()) === "Download .vfrag file", "Fragment dialog options were not localized to English.");
      await page.locator('#fragment-save-dialog .fragment-dialog-actions [value="cancel"]').click();

      await page.locator("#import-menu > summary").click();
      await page.locator("#paste-source-action").click();
      await page.locator("#paste-dialog").waitFor({ state: "visible" });
      assert((await page.locator("#paste-dialog-title").textContent()) === "Paste HTML or SVG", "Paste dialog was not localized to English.");
      assert(await page.locator("#paste-editor").getAttribute("aria-label") === "HTML or SVG source", "Paste dialog aria-label was not localized to English.");
      await page.locator('#paste-dialog .dialog-actions [value="cancel"]').click();

      await page.locator('[data-locale-switch="zh-CN"]').click();
      assert(await page.locator("html").getAttribute("lang") === "zh-CN", "Language switch did not update html[lang].");
      assert((await page.locator("#export-document-label").textContent()) === "导出 HTML", "Language switch did not translate export label.");
      assert(await page.locator(".language-switcher").getAttribute("aria-label") === "语言", "Language control aria-label did not switch to Chinese.");
      assert((await page.locator("#build-selection-controls").textContent()).includes("已选择"), "Dynamic Build selection UI did not switch to Chinese.");
      assert((await page.locator("#inspector-content").textContent()).includes("标识"), "Dynamic inspector UI did not switch to Chinese.");
      const localizedSourceName = await page.locator("#code-file-name").textContent();
      assert(localizedSourceName === sourceName, `Language switch changed the source document display: ${sourceName} -> ${localizedSourceName}.`);
      assert(await page.locator("#page-select option:checked").textContent() === pageLabel, "Language switch changed the imported page label.");
      assert(await page.locator("[data-layer-id]").count() === layerCount, "Language switch changed the layer tree.");
    }
    assert(errors.length === 0, `Page errors for ${locale}: ${errors.join("; ")}`);
  } finally {
    await context.close();
  }
}

async function run() {
  if (!executablePath) throw new Error("Chrome/Chromium was not found. Set CHROME_PATH to its executable.");
  const server = await startViteDevServer({ baseUrl, reuseExisting: Boolean(process.env.STUDIO_BASE_URL) });
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    await assertLocale(browser, "zh-CN", {
      htmlLang: "zh-CN",
      tagline: "可视化完善 AI 生成的内容。",
      exportLabel: "导出 HTML",
      switch: "zh-CN",
    });
    await assertLocale(browser, "en-US", {
      htmlLang: "en",
      tagline: "Visually refine what AI generates.",
      exportLabel: "Export HTML",
      switch: "en",
    });
    process.stdout.write("[language-smoke] Chinese and English editor modes passed.\n");
  } finally {
    try {
      if (browser) await withTimeout(browser.close(), 10_000, "Language smoke Chromium shutdown");
    } finally {
      await server.close();
    }
  }
}

run().catch((error) => reportCliError(error, "Language smoke test failed"));
