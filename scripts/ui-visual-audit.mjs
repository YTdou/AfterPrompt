import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const baseUrl = process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4173";
const parsedBaseUrl = new URL(baseUrl);
const outputDir = path.resolve(process.env.UI_AUDIT_DIR ?? "artifacts/ui-audit");
const strict = process.env.UI_STRICT === "1";

const executablePath = process.env.CHROME_PATH ?? [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/home/ldaphome/zkm/bin/google-chrome",
].find(existsSync);

const defaultViewports = [
  { name: "compact", width: 1280, height: 800 },
  { name: "standard", width: 1440, height: 900 },
  { name: "wide", width: 1920, height: 1080 },
];

function parseViewports(value) {
  if (!value) return defaultViewports;
  return value.split(",").map((entry) => {
    const match = entry.trim().match(/^(\d+)x(\d+)$/);
    if (!match) throw new Error(`Invalid UI_VIEWPORTS entry: ${entry}`);
    const width = Number(match[1]);
    const height = Number(match[2]);
    return { name: `${width}x${height}`, width, height };
  });
}

const scenarioNames = (process.env.UI_SCENARIOS ??
  "default,selected,deck,deck-collapsed,svg,code,fragment-library,presentation")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const viewports = parseViewports(process.env.UI_VIEWPORTS);
let server;

function log(message) {
  process.stdout.write(`[ui-audit] ${message}\n`);
}

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
  if (parsedBaseUrl.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(parsedBaseUrl.hostname)) {
    throw new Error(`External UI audit target is unreachable: ${baseUrl}`);
  }

  const port = parsedBaseUrl.port || "80";
  server = spawn(
    "npm",
    ["run", "dev", "--", "--host", parsedBaseUrl.hostname, "--port", port, "--strictPort", "--force"],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );

  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await reachable()) return;
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready.\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${baseUrl}.\n${output}`);
}

async function chooseIoAction(page, menuSelector, actionSelector) {
  const menu = page.locator(menuSelector);
  if (!(await menu.getAttribute("open"))) {
    await menu.locator(":scope > summary").click();
  }
  await page.locator(actionSelector).click();
}

async function loadExample(page, kind) {
  await chooseIoAction(page, "#import-menu", `[data-load-example="${kind}"]`);
}

async function settle(page) {
  await page.locator("#document-status").waitFor();
  try {
    await page.locator("#notice-bar").waitFor({ state: "hidden", timeout: 7_000 });
  } catch {
    // The notice state is reported by the audit; do not hide it artificially.
  }
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(100);
}

async function selectVisibleCanvasElement(page) {
  const candidates = page.locator("#canvas-host [data-editor-id]");
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox();
    if (box && box.width >= 20 && box.height >= 16) {
      await candidate.click({ position: { x: Math.min(8, box.width / 2), y: Math.min(8, box.height / 2) } });
      await page.waitForFunction(() => {
        const value = document.querySelector("#selection-status")?.textContent ?? "";
        return value && value !== "未选择元素";
      });
      return;
    }
  }
  throw new Error("No visible canvas element could be selected.");
}

const scenarioSetups = {
  async default(page) {
    await settle(page);
  },

  async selected(page) {
    await settle(page);
    await selectVisibleCanvasElement(page);
    await settle(page);
  },

  async deck(page) {
    await settle(page);
    await loadExample(page, "deck");
    await page.locator('[data-activity-view="pages"]').click();
    await page.locator("#page-filmstrip").waitFor({ state: "visible" });
    await settle(page);
  },

  async "deck-collapsed"(page) {
    await settle(page);
    await loadExample(page, "deck");
    await page.locator('[data-activity-view="pages"]').click();
    await page.locator("#page-filmstrip").waitFor({ state: "visible" });
    for (const region of ["layers", "inspector"]) {
      await page.locator(`[data-layout-toggle="${region}"]`).click();
    }
    await settle(page);
  },

  async svg(page) {
    await settle(page);
    await loadExample(page, "svg");
    await settle(page);
    await selectVisibleCanvasElement(page);
    await settle(page);
  },

  async code(page) {
    await settle(page);
    const collapsed = await page.locator(".studio-shell").evaluate((element) =>
      element.classList.contains("is-code-collapsed"));
    if (collapsed) await page.locator("#toggle-code").click();
    await page.locator("#apply-code").waitFor({ state: "visible" });
    await settle(page);
  },

  async "fragment-library"(page) {
    await settle(page);
    await chooseIoAction(page, "#import-menu", "#open-temporary-clipboard-action");
    await page.locator("#fragment-library-dialog[open]").waitFor({ state: "visible" });
    await settle(page);
  },

  async presentation(page) {
    await settle(page);
    await loadExample(page, "deck");
    await page.locator("#preview-presentation").click();
    await page.locator("#preview-choice-dialog[open]").waitFor({ state: "visible" });
    await page.locator("#preview-from-start").click();
    await page.locator("#presentation-dialog[open]").waitFor({ state: "visible" });
    await settle(page);
  },
};

async function inspectDom(page) {
  return page.evaluate(() => {
    const critical = [];
    const warnings = [];

    const isVisible = (element) => {
      if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      if (element.getAttribute("aria-hidden") === "true") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
        rect.top < innerHeight && rect.left < innerWidth;
    };

    const accessibleName = (element) => {
      if (!(element instanceof HTMLElement)) return "";
      const labels = "labels" in element && element.labels
        ? Array.from(element.labels).map((label) => label.textContent ?? "").join(" ")
        : "";
      return [
        element.getAttribute("aria-label"),
        element.getAttribute("aria-labelledby"),
        element.getAttribute("title"),
        labels,
        element.textContent,
        element.getAttribute("placeholder"),
        element.getAttribute("name"),
      ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    };

    const ids = new Map();
    document.querySelectorAll("[id]").forEach((element) => {
      const id = element.id;
      ids.set(id, (ids.get(id) ?? 0) + 1);
    });
    const duplicateIds = Array.from(ids.entries()).filter(([, count]) => count > 1);
    if (duplicateIds.length) {
      critical.push({
        type: "duplicate-ids",
        detail: duplicateIds.slice(0, 20),
      });
    }

    const rootOverflow = document.documentElement.scrollWidth - innerWidth;
    if (rootOverflow > 1) {
      critical.push({
        type: "document-horizontal-overflow",
        detail: `${rootOverflow}px`,
      });
    }

    const shell = document.querySelector(".studio-shell");
    const canvas = document.querySelector("#canvas-viewport");
    const canvasHost = document.querySelector("#canvas-host");

    if (!(shell instanceof HTMLElement)) {
      critical.push({ type: "missing-shell", detail: ".studio-shell" });
    }
    if (!(canvas instanceof HTMLElement)) {
      critical.push({ type: "missing-canvas", detail: "#canvas-viewport" });
    } else {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 360 || rect.height < 220) {
        critical.push({
          type: "canvas-too-small",
          detail: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
        });
      }
    }
    if (!(canvasHost instanceof HTMLElement) || canvasHost.getBoundingClientRect().width <= 0) {
      critical.push({ type: "canvas-host-not-rendered", detail: "#canvas-host" });
    }

    const surfaceSelectors = [
      ".topbar",
      ".canvas-toolbar",
      ".canvas-status",
      ".code-toolbar",
      ".panel-heading",
    ];
    for (const selector of surfaceSelectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (!(element instanceof HTMLElement) || !isVisible(element)) return;
        const overflow = element.scrollWidth - element.clientWidth;
        if (overflow > 2) {
          warnings.push({
            type: "surface-horizontal-overflow",
            selector,
            detail: `${overflow}px`,
          });
        }
      });
    }

    const controls = Array.from(new Set(Array.from(document.querySelectorAll([
      "button",
      "summary",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "[role='button']",
      "[role='menuitem']",
    ].join(","))))).filter(isVisible);

    const unnamed = [];
    const smallTargets = [];
    const tinyText = [];
    const viewportClipped = [];

    for (const element of controls) {
      if (!(element instanceof HTMLElement)) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const selector = element.id
        ? `#${element.id}`
        : element.getAttribute("data-layer-action")
          ? `[data-layer-action="${element.getAttribute("data-layer-action")}"]`
          : `${element.tagName.toLowerCase()}.${Array.from(element.classList).slice(0, 2).join(".")}`;

      if (!accessibleName(element)) unnamed.push(selector);

      const type = element instanceof HTMLInputElement ? element.type : "";
      if (!["range", "color", "checkbox", "radio"].includes(type) && rect.height < 24) {
        smallTargets.push({ selector, height: Math.round(rect.height * 10) / 10 });
      }

      const fontSize = Number.parseFloat(style.fontSize);
      if (!["range", "color"].includes(type) && Number.isFinite(fontSize) && fontSize < 10.5) {
        tinyText.push({ selector, fontSize });
      }

      if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) {
        viewportClipped.push({
          selector,
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
          },
        });
      }
    }

    if (unnamed.length) {
      critical.push({
        type: "unnamed-visible-controls",
        detail: unnamed.slice(0, 30),
        count: unnamed.length,
      });
    }
    if (smallTargets.length) {
      warnings.push({
        type: "small-visible-controls",
        detail: smallTargets.slice(0, 30),
        count: smallTargets.length,
      });
    }
    if (tinyText.length) {
      warnings.push({
        type: "tiny-interactive-text",
        detail: tinyText.slice(0, 30),
        count: tinyText.length,
      });
    }
    if (viewportClipped.length) {
      warnings.push({
        type: "viewport-clipped-controls",
        detail: viewportClipped.slice(0, 30),
        count: viewportClipped.length,
      });
    }

    const requiredVisible = ["#import-menu", "#export-menu"];
    for (const selector of requiredVisible) {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement) || !isVisible(element)) {
        critical.push({ type: "required-global-action-not-visible", detail: selector });
      }
    }

    const notice = document.querySelector("#notice-bar");
    const noticeVisible = notice instanceof HTMLElement && isVisible(notice);

    return {
      viewport: { width: innerWidth, height: innerHeight },
      critical,
      warnings,
      metrics: {
        visibleControlCount: controls.length,
        duplicateIdCount: duplicateIds.length,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentScrollHeight: document.documentElement.scrollHeight,
        noticeVisible,
        canvas: canvas instanceof HTMLElement ? {
          width: Math.round(canvas.getBoundingClientRect().width),
          height: Math.round(canvas.getBoundingClientRect().height),
        } : null,
      },
    };
  });
}

async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function runScenario(browser, viewport, scenarioName) {
  const setup = scenarioSetups[scenarioName];
  if (!setup) throw new Error(`Unknown UI scenario: ${scenarioName}`);

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "dark",
    locale: "zh-CN",
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Ignore opaque-origin startup documents.
    }
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      runtimeErrors.push(`console: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      runtimeErrors.push(`response: ${response.status()} ${response.url()}`);
    }
  });

  const screenshotName = `${viewport.name}__${scenarioName}.png`;
  const screenshotPath = path.join(outputDir, screenshotName);

  let domAudit;
  let setupError = null;
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await setup(page);
    domAudit = await inspectDom(page);
  } catch (error) {
    setupError = error instanceof Error ? error.stack ?? error.message : String(error);
    domAudit = {
      viewport: { width: viewport.width, height: viewport.height },
      critical: [{ type: "scenario-setup-failed", detail: setupError }],
      warnings: [],
      metrics: {},
    };
  }

  if (runtimeErrors.length) {
    domAudit.critical.push({
      type: "runtime-errors",
      count: runtimeErrors.length,
      detail: runtimeErrors.slice(0, 20),
    });
  }

  await page.screenshot({
    path: screenshotPath,
    fullPage: false,
    animations: "disabled",
  });

  const screenshotHash = await sha256(screenshotPath);
  await context.close();

  return {
    viewport,
    scenario: scenarioName,
    screenshot: path.relative(process.cwd(), screenshotPath),
    screenshotSha256: screenshotHash,
    setupError,
    ...domAudit,
  };
}

async function main() {
  if (!executablePath) {
    throw new Error("Chrome/Chromium was not found. Set CHROME_PATH to its executable.");
  }

  await mkdir(outputDir, { recursive: true });
  await ensureServer();

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const results = [];
  try {
    for (const viewport of viewports) {
      for (const scenarioName of scenarioNames) {
        log(`running ${viewport.name} / ${scenarioName}`);
        results.push(await runScenario(browser, viewport, scenarioName));
      }
    }
  } finally {
    await browser.close();
    if (server && server.exitCode === null) server.kill("SIGTERM");
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    strict,
    executablePath,
    viewports,
    scenarios: scenarioNames,
    resultCount: results.length,
    criticalCount: results.reduce((sum, result) => sum + result.critical.length, 0),
    warningCount: results.reduce((sum, result) => sum + result.warnings.length, 0),
    results,
  };

  const reportPath = path.join(outputDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  log(`report: ${path.relative(process.cwd(), reportPath)}`);
  log(`critical=${summary.criticalCount} warnings=${summary.warningCount}`);

  if (summary.criticalCount > 0 || (strict && summary.warningCount > 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  console.error(error);
  process.exitCode = 1;
});
