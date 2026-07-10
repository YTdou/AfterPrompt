import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import { chromium } from "playwright-core";

const baseUrl = process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4173";
const executablePath = process.env.CHROME_PATH ?? [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/home/ldaphome/zkm/bin/google-chrome",
].find(existsSync);
let server;

async function reachable() {
  try {
    const response = await fetch(baseUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable()) return;
  server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await reachable()) return;
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.\n${output}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function shadowText(page, id) {
  return page.evaluate((elementId) => {
    const host = document.querySelector("#canvas-host");
    return host?.shadowRoot?.querySelector(`[data-editor-id="${elementId}"]`)?.textContent ?? null;
  }, id);
}

async function run() {
  if (!executablePath) throw new Error("Chrome/Chromium was not found. Set CHROME_PATH to its executable.");
  await ensureServer();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#document-status").waitFor();
    assert((await page.locator("#document-status").textContent())?.includes("HTML"), "HTML example did not load.");
    assert(await page.locator("[data-layer-id]").count() >= 12, "Layer tree is unexpectedly empty.");

    await page.locator('[data-layer-id="hero-image-001"]').click();
    const imageBox = await page.locator('#canvas-host [data-editor-id="hero-image-001"]').boundingBox();
    assert(imageBox, "Hero image has no rendered browser bounds.");
    await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(imageBox.x + imageBox.width / 2 + 32, imageBox.y + imageBox.height / 2 + 12, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => {
      const host = document.querySelector("#canvas-host");
      const value = host?.shadowRoot?.querySelector('[data-editor-id="hero-image-001"]')?.getAttribute("data-editor-translate-x");
      return value !== null && value !== undefined && Math.abs(Number(value)) > 1;
    });
    assert((await page.locator(".cm-content").innerText()).includes("data-editor-translate-x"), "Drag did not synchronize to source code.");

    const resizeHandle = page.locator(".moveable-control-box .moveable-se");
    await resizeHandle.waitFor({ state: "visible" });
    const handleBox = await resizeHandle.boundingBox();
    assert(handleBox, "Moveable resize handle has no browser bounds.");
    const handlePoint = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
    await page.mouse.move(handlePoint.x, handlePoint.y);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 28, handleBox.y + handleBox.height / 2 + 18, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const resizedWidth = await page.evaluate(() => {
      const host = document.querySelector("#canvas-host");
      return host?.shadowRoot?.querySelector('[data-editor-id="hero-image-001"]')?.style.width ?? "";
    });
    assert(Boolean(resizedWidth) && Math.abs(Number.parseFloat(resizedWidth) - 480) > 1, `Resize did not change inline width (received ${resizedWidth || "empty"}).`);
    assert((await page.locator(".cm-content").innerText()).includes("width:"), "Resize did not synchronize to source code.");

    await page.locator('[data-layer-id="title-001"]').click();
    await page.locator('[data-prop="text"]').waitFor();
    assert((await shadowText(page, "title-001")) === "Energy-Proportional LLM Inference", "HTML title selection did not map to the Shadow DOM node.");

    const textEditor = page.locator('textarea[data-prop="text"]');
    await textEditor.fill("Browser smoke title");
    await textEditor.press("Tab");
    await page.waitForFunction(() => document.querySelector("#sync-status")?.textContent === "代码已同步");
    assert((await shadowText(page, "title-001")) === "Browser smoke title", "Inspector text edit did not reach the canvas.");
    assert((await page.locator(".cm-content").innerText()).includes("Browser smoke title"), "Visual edit did not reach the code view.");

    await page.locator("#format-code").click();
    await page.waitForFunction(() => document.querySelector("#sync-status")?.textContent === "格式化结果尚未应用");
    await page.locator("#apply-code").click();
    await page.waitForFunction(() => document.querySelector("#sync-status")?.textContent === "代码已同步");
    assert((await shadowText(page, "title-001")) === "Browser smoke title", "Formatted source did not re-render correctly.");

    await page.locator("#undo").click();
    if ((await shadowText(page, "title-001")) !== "Energy-Proportional LLM Inference") {
      await page.locator("#undo").click();
    }
    await page.waitForFunction(() => {
      const host = document.querySelector("#canvas-host");
      return host?.shadowRoot?.querySelector('[data-editor-id="title-001"]')?.textContent === "Energy-Proportional LLM Inference";
    });

    await page.locator("#example-select").selectOption("svg");
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.startsWith("SVG"));
    assert(await page.locator('[data-layer-id="svg-title"]').count() === 1, "SVG layer tree did not load.");
    await page.locator('[data-layer-id="svg-title"]').click();
    assert((await shadowText(page, "svg-title")) === "Editable SVG energy curve", "SVG selection did not map to the native SVG node.");

    assert(errors.length === 0, `Browser runtime errors:\n${errors.join("\n")}`);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      htmlSelection: true,
      moveableDragToCode: true,
      moveableResizeToCode: true,
      inspectorToCanvas: true,
      canvasToCode: true,
      formatAndApplyCode: true,
      undo: true,
      svgSelection: true,
    }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

run()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server && server.exitCode === null) server.kill("SIGTERM");
  });
