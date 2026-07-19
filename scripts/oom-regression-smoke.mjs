import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import process from "node:process";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { chromium } from "playwright-core";

const baseUrl = process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4188";
const samplePath = process.env.OOM_SAMPLE_PATH ?? "problem/0716_1849.html";
const executablePath = process.env.CHROME_PATH ?? [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/home/ldaphome/zkm/bin/google-chrome",
].find(existsSync);
let server;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function chooseIoAction(page, menuId, actionSelector) {
  const menu = page.locator(menuId);
  if (!(await menu.getAttribute("open"))) await menu.locator(":scope > summary").click();
  await page.locator(actionSelector).click();
}

async function reachable() {
  try {
    return (await fetch(baseUrl)).ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable()) return;
  const url = new URL(baseUrl);
  server = spawn("npm", ["run", "dev", "--", "--host", url.hostname, "--port", url.port, "--strictPort", "--force"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await reachable()) return;
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.\n${output}`);
}

async function saveAndExportFragment(page, elementId, name) {
  await page.locator(`[data-layer-id="${elementId}"]`).click();
  const renderedStructure = await page.locator("#canvas-host").evaluate((host, id) => {
    const root = host.shadowRoot?.querySelector(`[data-editor-id="${id}"]`);
    if (!root) return [];
    return [root, ...root.querySelectorAll("[data-editor-id]")].map((element) => ({
      id: element.getAttribute("data-editor-id"),
      parentId: element === root ? null : element.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") ?? null,
    }));
  }, elementId);
  await chooseIoAction(page, "#export-menu", "#export-selection-action");
  await page.locator("#fragment-save-dialog").waitFor({ state: "visible" });
  await page.locator("#fragment-name").fill(name);
  await page.locator("#fragment-type").selectOption("component");
  const downloadPromise = page.waitForEvent("download");
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
  const root = parsed.body.firstElementChild;
  const packagedStructure = renderedStructure.map(({ id }) => {
    const element = root?.querySelector(`[data-editor-id="${id}"]`);
    return {
      id,
      found: Boolean(element),
      parentId: id === elementId ? null : element?.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") ?? null,
    };
  });
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
  await ensureServer();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#file-input").setInputFiles(samplePath);
    await page.waitForFunction(() => document.querySelector("#page-count")?.textContent?.trim().endsWith("/ 18"));
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
    assert(rendering.pages === 18, `Expected 18 editable pages, got ${rendering.pages}.`);
    assert(rendering.renderedThumbnails < rendering.pages, `All ${rendering.pages} thumbnails were eagerly rendered.`);
    assert(rendering.mainSheets > 0 && rendering.sharedSheet, "Canvas and thumbnails did not share constructable stylesheets.");

    await page.locator("#page-select").selectOption("14");
    await page.locator('[data-layer-id="div-348"]').waitFor();
    const div348 = await saveAndExportFragment(page, "div-348", "OOM Div 348");
    assert(div348.renderedStructure.length === 8, `div-348 rendered node count changed: ${div348.renderedStructure.length}.`);
    assert(div348.packagedStructure.every((node) => node.found), "div-348 package lost one or more authored layers.");
    assert(div348.packagedStructure.every((node, index) => node.parentId === div348.renderedStructure[index].parentId),
      "div-348 package changed an authored parent-child relationship.");
    assert(div348.styleBytes < 12 * 1024 * 1024, `div-348 styles still exceed 12 MiB: ${div348.styleBytes}.`);

    await page.locator("#page-select").selectOption("17");
    await page.locator('[data-layer-id="div-298"]').waitFor();
    const div298 = await saveAndExportFragment(page, "div-298", "OOM Div 298");
    assert(div298.content.includes("Same α · same predicted latency map"), "div-298 package lost its authored content.");
    assert(div298.packagedStructure.every((node) => node.found), "div-298 package lost its authored root.");

    await page.locator("#page-select").selectOption("14");
    await page.locator('[data-layer-id="b-059"]').click();
    for (let index = 0; index < 20; index += 1) {
      const editor = page.locator('textarea[data-prop="text"]');
      await editor.fill(`A800 × Llama ${index}`);
      await editor.press("Tab");
      await page.waitForFunction((expected) => document.querySelector("#canvas-host")?.shadowRoot
        ?.querySelector('[data-editor-id="b-059"]')?.textContent === expected, `A800 × Llama ${index}`);
    }
    for (let index = 0; index < 10; index += 1) await page.locator("#undo").click();
    for (let index = 0; index < 10; index += 1) await page.locator("#redo").click();
    await page.waitForFunction(() => document.querySelector("#canvas-host")?.shadowRoot
      ?.querySelector('[data-editor-id="b-059"]')?.textContent === "A800 × Llama 19");

    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = await cdp.send("Performance.getMetrics");
    const metric = Object.fromEntries(metrics.metrics.map(({ name, value }) => [name, value]));
    const downloadPromise = page.waitForEvent("download");
    await chooseIoAction(page, "#export-menu", "#export-document-action");
    const exportedPath = await (await downloadPromise).path();
    assert(exportedPath, "Optimized HTML export produced no file.");
    const exportedBytes = (await readFile(exportedPath)).byteLength;
    assert(exportedBytes < 8 * 1024 * 1024, `In-memory document remains too large: ${exportedBytes}.`);
    assert(errors.length === 0, `Browser errors occurred:\n${errors.join("\n")}`);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      originalBytes: (await readFile(samplePath)).byteLength,
      exportedBytes,
      rendering,
      div348: { ...div348, content: undefined },
      div298: { ...div298, content: undefined },
      jsHeapUsedMiB: Number((metric.JSHeapUsedSize / 1024 / 1024).toFixed(2)),
      nodes: metric.Nodes,
      documents: metric.Documents,
    }, null, 2)}\n`);
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  if (server) server.kill("SIGTERM");
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
