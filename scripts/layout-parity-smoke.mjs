import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4182";
const port = new URL(baseUrl).port || "80";
const executablePath = process.env.CHROME_PATH ?? [
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);
let server;

function assert(condition, message) { if (!condition) throw new Error(message); }
async function reachable() { try { return (await fetch(baseUrl)).ok; } catch { return false; } }
async function startServer() {
  if (await reachable()) return;
  server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", port, "--strictPort", "--force"], { cwd: process.cwd(), stdio: "ignore" });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await reachable()) return;
    if (server.exitCode !== null) throw new Error("Vite exited before becoming ready.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function capture(rootHandle) {
  return rootHandle.evaluate((root) => {
    const selector = "h1[data-editor-id],h2[data-editor-id],h3[data-editor-id],p[data-editor-id],span[data-editor-id],b[data-editor-id],strong[data-editor-id],small[data-editor-id],code[data-editor-id]";
    return Array.from(root.querySelectorAll(selector)).filter((element) => {
      const style = getComputedStyle(element);
      return element.textContent?.trim() && style.display !== "none" && style.visibility !== "hidden";
    }).map((element) => {
      const style = getComputedStyle(element);
      const range = document.createRange();
      range.selectNodeContents(element);
      const tops = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => Math.round(rect.top * 2) / 2);
      return {
        id: element.getAttribute("data-editor-id"),
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        lineCount: Math.max(1, new Set(tops).size),
      };
    });
  });
}

function compare(expected, actual, tolerance = 1) {
  const actualById = new Map(actual.map((item) => [item.id, item]));
  const differences = [];
  for (const baseline of expected) {
    const candidate = actualById.get(baseline.id);
    if (!candidate) continue;
    const fields = ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight", "lineCount"]
      .filter((field) => baseline[field] !== candidate[field]);
    for (const field of ["clientWidth", "clientHeight", "scrollWidth", "scrollHeight"]) {
      if (Math.abs(baseline[field] - candidate[field]) > tolerance) fields.push(field);
    }
    if (fields.length) differences.push({ id: baseline.id, fields, editor: baseline, export: candidate });
  }
  return differences;
}

async function run() {
  assert(executablePath, "Chrome/Chromium was not found.");
  await startServer();
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  try {
    const editor = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await editor.goto(baseUrl, { waitUntil: "networkidle" });
    const fixturePath = "tests/fixtures/layout-parity-deck.html";
    const pageCount = 3;
    const [fixtureTemplate, fontBytes] = await Promise.all([
      readFile(fixturePath, "utf8"),
      readFile("src/assets/fonts/inter-latin-wght-normal.woff2"),
    ]);
    const fixtureSource = fixtureTemplate.replace("__INTER_FONT_DATA_URL__", `data:font/woff2;base64,${fontBytes.toString("base64")}`);
    await editor.locator("#file-input").setInputFiles({
      name: "layout-parity-deck.html",
      mimeType: "text/html",
      buffer: Buffer.from(fixtureSource),
    });
    await editor.waitForFunction((count) => document.querySelector("#document-status")?.textContent?.includes(`page 1/${count}`), pageCount, { timeout: 40_000 });
    await editor.evaluate(() => document.fonts.ready);
    const typographyState = await editor.locator("#canvas-host").evaluate((host) => ({
      attribute: host.getAttribute("data-lms-deterministic-font"),
      hasRule: [
        ...Array.from(host.shadowRoot.querySelectorAll("style"), (style) => style.textContent ?? ""),
        ...Array.from(host.shadowRoot.adoptedStyleSheets ?? [], (sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n")),
      ].some((css) => css.includes("LMS Inter")),
      rootFont: getComputedStyle(host.shadowRoot.querySelector("body")).fontFamily,
    }));
    assert(typographyState.hasRule, `Editor deterministic typography was not installed: ${JSON.stringify(typographyState)}`);
    assert(typographyState.rootFont.includes("LMS Inter"), `Editor deterministic typography selector did not match: ${JSON.stringify(typographyState)}`);
    const editorSnapshots = [];
    for (let index = 0; index < pageCount; index += 1) {
      await editor.locator("#page-select").selectOption(String(index));
      const root = editor.locator("#canvas-host").evaluateHandle((host) => host.shadowRoot.querySelector('[data-editor-preview-page-root="active"]'));
      editorSnapshots.push(...await capture(await root));
    }
    await editor.close();

    const exported = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await exported.setContent(fixtureSource, { waitUntil: "load", timeout: 40_000 });
    await exported.evaluate(() => document.fonts.ready);
    const exportedFontReady = await exported.evaluate(() => document.fonts.check('58px "LMS Inter"'));
    assert(exportedFontReady, "The exported fixture font did not load.");
    const exportSnapshots = [];
    for (let index = 0; index < pageCount; index += 1) {
      await exported.locator("deck-stage").evaluate((stage, pageIndex) => stage.goTo(pageIndex), index);
      const root = exported.locator("section[data-deck-active]");
      exportSnapshots.push(...await capture(root));
    }
    const differences = compare(editorSnapshots, exportSnapshots);
    const lineDifferences = differences.filter(({ fields }) => fields.includes("lineCount"));
    assert(lineDifferences.length === 0, `Text line-count drift:\n${JSON.stringify(lineDifferences.slice(0, 20), null, 2)}`);
    assert(differences.length === 0, `Layout drift:\n${JSON.stringify(differences.slice(0, 20), null, 2)}`);

    process.stdout.write(`${JSON.stringify({ ok: true, pages: pageCount, comparedTextNodes: editorSnapshots.length, lineDifferences: 0, geometryDifferences: 0 })}\n`);
  } finally {
    await browser.close();
    if (server && server.exitCode === null) server.kill("SIGTERM");
  }
}

run().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
