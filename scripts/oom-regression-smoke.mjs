import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import process from "node:process";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { chromium } from "playwright-core";
import { buildOomRegressionFixture } from "./oom-regression-fixture.mjs";
import { reportCliError, startViteDevServer, withTimeout } from "./lib/managed-vite-server.mjs";

const baseUrl = process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4188";
const executablePath = process.env.CHROME_PATH ?? [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function structure(root) {
  if (!root) return [];
  return [root, ...root.querySelectorAll("[data-editor-id]")].map((element) => ({
    tag: element.localName,
    id: element.getAttribute("data-editor-id"),
    parentId: element === root ? null : element.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") ?? null,
  }));
}

function sourceStructure(source, elementId) {
  const document = new JSDOM(source).window.document;
  return structure(document.querySelector(`[data-editor-id="${elementId}"]`));
}

async function chooseIoAction(page, menuId, actionSelector) {
  const menu = page.locator(menuId);
  if (!(await menu.getAttribute("open"))) await menu.locator(":scope > summary").click();
  await page.locator(actionSelector).click();
}

async function saveAndExportFragment(page, elementId, name) {
  await page.locator(`[data-layer-id="${elementId}"]`).click();
  const renderedStructure = await page.locator("#canvas-host").evaluate((host, id) => {
    const root = host.shadowRoot?.querySelector(`[data-editor-id="${id}"]`);
    if (!root) return [];
    return [root, ...root.querySelectorAll("[data-editor-id]")].map((element) => ({
      tag: element.localName,
      id: element.getAttribute("data-editor-id"),
      parentId: element === root ? null : element.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") ?? null,
    }));
  }, elementId);
  await chooseIoAction(page, "#export-menu", "#export-selection-action");
  await page.locator("#fragment-save-dialog").waitFor({ state: "visible" });
  await page.locator("#fragment-name").fill(name);
  await page.locator("#fragment-type").selectOption("component");
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.locator("#fragment-save-submit").click();
  await page.locator("#fragment-save-dialog").waitFor({ state: "hidden", timeout: 60_000 });
  const download = await downloadPromise;
  const path = await download.path();
  assert(path, `${name} did not produce a .vfrag download.`);

  const bytes = await readFile(path);
  const zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const content = await zip.file(manifest.entry).async("string");
  const styles = await zip.file(manifest.styles).async("string");
  const parsed = new JSDOM(content).window.document;
  const packagedStructure = structure(parsed.querySelector(`[data-editor-id="${elementId}"]`));
  return {
    bytes: bytes.byteLength,
    contentBytes: Buffer.byteLength(content),
    styleBytes: Buffer.byteLength(styles),
    renderedStructure,
    packagedStructure,
    content,
  };
}

async function run() {
  assert(executablePath, "Chrome/Chromium was not found.");
  const fixture = buildOomRegressionFixture();
  const originalBytes = Buffer.byteLength(fixture.source);
  assert(originalBytes > 8 * 1024 * 1024, `Deterministic OOM fixture is too small: ${originalBytes}.`);
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
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(60_000);
    const errors = [];
    const failures = [];
    const check = (condition, message) => {
      if (!condition) failures.push(message);
    };
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#file-input").setInputFiles({
      name: fixture.sourceName,
      mimeType: "text/html",
      buffer: Buffer.from(fixture.source),
    });
    await page.waitForFunction((pageCount) => document.querySelector("#page-count")?.textContent?.trim().endsWith(`/ ${pageCount}`), fixture.pageCount);
    await page.waitForTimeout(1_000);

    const rendering = await page.evaluate(() => {
      const main = document.querySelector("#canvas-host")?.shadowRoot;
      const rendered = Array.from(document.querySelectorAll("[data-thumbnail-host]"))
        .map((host) => host.shadowRoot)
        .filter((shadow) => shadow?.querySelector(".editor-preview-shell"));
      return {
        pages: document.querySelectorAll(".page-thumbnail").length,
        renderedThumbnails: rendered.length,
        mainSheets: main?.adoptedStyleSheets.length ?? 0,
        sharedSheet: Boolean(main?.adoptedStyleSheets.length && rendered.length &&
          main.adoptedStyleSheets[0] === rendered[0].adoptedStyleSheets[0]),
        mainStyleElements: main?.querySelectorAll(":scope > style").length ?? 0,
      };
    });
    assert(rendering.pages === fixture.pageCount, `Expected ${fixture.pageCount} editable pages, got ${rendering.pages}.`);
    check(rendering.renderedThumbnails < rendering.pages, `All ${rendering.pages} thumbnails were eagerly rendered.`);
    check(rendering.mainSheets > 0 && rendering.sharedSheet, "Canvas and thumbnails did not share constructable stylesheets.");

    await page.locator("#page-select").selectOption("14");
    await page.locator(`[data-layer-id="${fixture.ids.fragmentRoot}"]`).waitFor();
    const fragment = await saveAndExportFragment(page, fixture.ids.fragmentRoot, "OOM Structure Fixture");
    const canonicalFragmentStructure = sourceStructure(fixture.source, fixture.ids.fragmentRoot);
    check(JSON.stringify(fragment.renderedStructure) === JSON.stringify(canonicalFragmentStructure),
      "The rendered fragment structure differs from the canonical fixture structure.");
    check(JSON.stringify(fragment.packagedStructure) === JSON.stringify(canonicalFragmentStructure),
      "The packaged fragment structure differs from the canonical fixture structure.");
    check(fragment.styleBytes < 12 * 1024 * 1024, `Fragment styles still exceed 12 MiB: ${fragment.styleBytes}.`);

    await page.locator("#page-select").selectOption("17");
    await page.locator(`[data-layer-id="${fixture.ids.copyRoot}"]`).waitFor();
    const copy = await saveAndExportFragment(page, fixture.ids.copyRoot, "OOM Copy Fixture");
    const canonicalCopyStructure = sourceStructure(fixture.source, fixture.ids.copyRoot);
    check(copy.content.includes("Same α · same predicted latency map"), "The copy fragment package lost its authored content.");
    check(JSON.stringify(copy.renderedStructure) === JSON.stringify(canonicalCopyStructure),
      "The rendered copy structure differs from the canonical fixture structure.");
    check(JSON.stringify(copy.packagedStructure) === JSON.stringify(canonicalCopyStructure),
      "The packaged copy structure differs from the canonical fixture structure.");

    await page.locator("#page-select").selectOption("14");
    await page.locator(`[data-layer-id="${fixture.ids.editableText}"]`).click();
    for (let index = 0; index < 20; index += 1) {
      const editor = page.locator('textarea[data-prop="text"]');
      await editor.fill(`A800 × Llama ${index}`);
      await editor.press("Tab");
      await page.waitForFunction(({ id, expected }) => document.querySelector("#canvas-host")?.shadowRoot
        ?.querySelector(`[data-editor-id="${id}"]`)?.textContent === expected,
      { id: fixture.ids.editableText, expected: `A800 × Llama ${index}` });
    }
    for (let index = 0; index < 10; index += 1) await page.locator("#undo").click();
    for (let index = 0; index < 10; index += 1) await page.locator("#redo").click();
    await page.waitForFunction(({ id, expected }) => document.querySelector("#canvas-host")?.shadowRoot
      ?.querySelector(`[data-editor-id="${id}"]`)?.textContent === expected,
    { id: fixture.ids.editableText, expected: "A800 × Llama 19" });

    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = await cdp.send("Performance.getMetrics");
    const metric = Object.fromEntries(metrics.metrics.map(({ name, value }) => [name, value]));
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await chooseIoAction(page, "#export-menu", "#export-document-action");
    const exportedPath = await (await downloadPromise).path();
    assert(exportedPath, "Optimized HTML export produced no file.");
    const exportedBytes = (await readFile(exportedPath)).byteLength;
    check(exportedBytes < 8 * 1024 * 1024, `In-memory document remains too large: ${exportedBytes}.`);
    check(errors.length === 0, `Browser errors occurred:\n${errors.join("\n")}`);

    const result = {
      ok: failures.length === 0,
      failures,
      originalBytes,
      exportedBytes,
      rendering,
      fragment: { ...fragment, content: undefined },
      copy: { ...copy, content: undefined },
      jsHeapUsedMiB: Number((metric.JSHeapUsedSize / 1024 / 1024).toFixed(2)),
      nodes: metric.Nodes,
      documents: metric.Documents,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    assert(failures.length === 0, `Regression checks failed:\n- ${failures.join("\n- ")}`);
  } finally {
    try {
      if (browser) await withTimeout(browser.close(), 10_000, "OOM regression Chromium shutdown");
    } finally {
      await server.close();
    }
  }
}

run().catch((error) => reportCliError(error, "OOM regression failed"));
