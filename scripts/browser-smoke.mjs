import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import process from "node:process";
import { chromium } from "playwright-core";

const baseUrl = process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4173";
const parsedBaseUrl = new URL(baseUrl);
const executablePath = process.env.CHROME_PATH ?? [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/opt/google-chrome",
].find(existsSync);
let server;

function progress(message) {
  process.stdout.write(`[browser-smoke] ${message}\n`);
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
  if (parsedBaseUrl.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsedBaseUrl.hostname)) {
    throw new Error(`The external smoke target is unreachable: ${baseUrl}`);
  }
  const port = parsedBaseUrl.port || "80";
  server = spawn("npm", ["run", "dev", "--", "--host", parsedBaseUrl.hostname, "--port", port, "--strictPort"], {
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

function editableSourceFromExport(html) {
  const encoded = html.match(/<template\s+id="lms-document-payload"[^>]*>([^<]+)<\/template>/i)?.[1]?.trim();
  assert(encoded, "Exported HTML does not contain an editable Last Mile Studio payload.");
  const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert(payload.format === "last-mile-studio/editable-html" && payload.version === 1, "Exported HTML payload has an unsupported format.");
  return payload.source;
}

async function shadowText(page, id) {
  return page.evaluate((elementId) => {
    const host = document.querySelector("#canvas-host");
    return host?.shadowRoot?.querySelector(`[data-editor-id="${elementId}"]`)?.textContent ?? null;
  }, id);
}

async function dragBy(page, locator, deltaX, deltaY) {
  const box = await locator.boundingBox();
  assert(box, "Layout resizer has no browser bounds.");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + deltaX, start.y + deltaY, { steps: 6 });
  await page.mouse.up();
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
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });

    progress("loading default HTML example");
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#document-status").waitFor();
    assert((await page.locator("#document-status").textContent())?.includes("HTML"), "HTML example did not load.");
    assert(await page.locator("[data-layer-id]").count() >= 12, "Layer tree is unexpectedly empty.");

    progress("checking the default collapsed source bar and canvas space");
    assert(await page.locator(".studio-shell").evaluate((element) => element.classList.contains("is-code-collapsed")), "The source bar is not collapsed by default.");
    const collapsedDrawerHeight = await page.locator("#code-drawer").evaluate((element) => element.getBoundingClientRect().height);
    assert(collapsedDrawerHeight <= 44, `Collapsed code drawer is still ${collapsedDrawerHeight}px tall.`);
    assert((await page.locator("#toggle-code").textContent()) === "展开源码", "Collapsed source bar does not expose the expected expand action.");
    assert(await page.locator("#code-drawer .code-toolbar button:visible").count() === 1, "Collapsed source bar still exposes source editing actions.");
    const viewportHeightCollapsed = await page.locator("#canvas-viewport").evaluate((element) => element.clientHeight);
    await page.locator("#notice-bar").waitFor({ state: "hidden", timeout: 7_000 });
    const collapsedDrawerHeightAfterNotice = await page.locator("#code-drawer").evaluate((element) => element.getBoundingClientRect().height);
    const viewportHeightAfterNotice = await page.locator("#canvas-viewport").evaluate((element) => element.clientHeight);
    assert(collapsedDrawerHeightAfterNotice <= 44, `Collapsed source bar expanded after the notice disappeared (${collapsedDrawerHeightAfterNotice}px).`);
    const noticeReleasedHeight = viewportHeightAfterNotice - viewportHeightCollapsed;
    assert(noticeReleasedHeight >= 20 && noticeReleasedHeight <= 60, `Notice space was not returned to the canvas as expected (${viewportHeightCollapsed} -> ${viewportHeightAfterNotice}).`);
    await page.locator("#toggle-code").click();
    await page.waitForFunction(() => !document.querySelector(".studio-shell")?.classList.contains("is-code-collapsed"));
    await page.waitForTimeout(50);
    const viewportHeightExpanded = await page.locator("#canvas-viewport").evaluate((element) => element.clientHeight);
    assert(viewportHeightCollapsed >= viewportHeightExpanded + 180, `Default collapsed source bar did not release canvas height (${viewportHeightExpanded} -> ${viewportHeightCollapsed}).`);
    assert((await page.locator("#toggle-code").textContent()) === "收起源码", "Expanded source bar does not expose the expected collapse action.");
    assert(await page.locator("#apply-code").isVisible(), "Source editing actions did not return after expansion.");

    progress("checking direct canvas text editing");
    await page.locator('#canvas-host [data-editor-id="title-001"]').dblclick();
    const inlineEditor = page.locator("#canvas-host .editor-inline-textarea");
    await inlineEditor.waitFor({ state: "visible" });
    await inlineEditor.press("ArrowRight");
    await inlineEditor.press("Backspace");
    assert(await inlineEditor.isVisible(), "Canvas shortcuts closed the inline editor while using text navigation keys.");
    assert(await page.locator('[data-layer-id="title-001"]').count() === 1, "Backspace inside the inline editor deleted the selected canvas element.");
    await inlineEditor.press("Control+A");
    await inlineEditor.pressSequentially("Inline canvas title");
    await page.locator('#canvas-host .editor-inline-actions button[type="submit"]').click();
    await page.waitForFunction(() => {
      const host = document.querySelector("#canvas-host");
      return host?.shadowRoot?.querySelector('[data-editor-id="title-001"]')?.textContent === "Inline canvas title";
    });
    assert((await page.locator(".cm-content").innerText()).includes("Inline canvas title"), "Inline text edit did not synchronize to source code.");
    await page.locator("#undo").click();
    await page.waitForFunction(() => {
      const host = document.querySelector("#canvas-host");
      return host?.shadowRoot?.querySelector('[data-editor-id="title-001"]')?.textContent === "Energy-Proportional LLM Inference";
    });

    await page.locator('#canvas-host [data-editor-id="title-001"]').dblclick();
    await inlineEditor.fill("Blur committed title");
    await page.locator("#fit-canvas").click();
    await page.waitForFunction(() => {
      const host = document.querySelector("#canvas-host");
      return host?.shadowRoot?.querySelector('[data-editor-id="title-001"]')?.textContent === "Blur committed title";
    });
    await page.locator("#undo").click();
    await page.waitForFunction(() => {
      const host = document.querySelector("#canvas-host");
      return host?.shadowRoot?.querySelector('[data-editor-id="title-001"]')?.textContent === "Energy-Proportional LLM Inference";
    });

    await page.locator('#canvas-host [data-editor-id="title-001"]').dblclick();
    await inlineEditor.fill("Cancelled inline title");
    await page.locator('#canvas-host .editor-inline-actions button[type="button"]').click();
    assert((await shadowText(page, "title-001")) === "Energy-Proportional LLM Inference", "Cancelling an inline text edit changed the source document.");

    await page.locator('#canvas-host [data-editor-id="title-001"]').dblclick();
    await inlineEditor.fill("Enter committed title");
    await inlineEditor.press("Enter");
    await page.waitForFunction(() => {
      const host = document.querySelector("#canvas-host");
      return host?.shadowRoot?.querySelector('[data-editor-id="title-001"]')?.textContent === "Enter committed title";
    });
    await page.locator("#undo").click();
    await page.waitForFunction(() => {
      const host = document.querySelector("#canvas-host");
      return host?.shadowRoot?.querySelector('[data-editor-id="title-001"]')?.textContent === "Energy-Proportional LLM Inference";
    });

    progress("checking HTML drag and resize");
    await page.locator('[data-layer-id="hero-image-001"]').click();
    await page.waitForTimeout(100);
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

    await page.locator("#undo").click();
    await page.waitForFunction(() => {
      const host = document.querySelector("#canvas-host");
      return host?.shadowRoot?.querySelector('[data-editor-id="title-001"]')?.textContent === "Energy-Proportional LLM Inference";
    });

    progress("checking inspector parent and child navigation");
    await page.locator('[data-layer-id="accent-block-001"]').click();
    const selectChild = page.locator('[data-inspector-action="select-child"]');
    assert(!(await selectChild.isDisabled()), "The inspector disabled child navigation for an element with editable descendants.");
    await selectChild.click();
    await page.waitForFunction(() => document.querySelector("#selection-status")?.textContent?.startsWith("takeaway-001"));
    assert(await page.locator('[data-inspector-action="select-child"]').isDisabled(), "A leaf text element incorrectly exposes an editable child.");
    await page.locator('[data-inspector-action="select-parent"]').click();
    await page.waitForFunction(() => document.querySelector("#selection-status")?.textContent?.startsWith("accent-block-001"));

    progress("checking child-first canvas hit testing");
    const childHitPoint = await page.evaluate(() => {
      const child = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="takeaway-001"]');
      if (!(child instanceof HTMLElement)) return null;
      child.style.pointerEvents = "none";
      const bounds = child.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    });
    assert(childHitPoint, "Nested child has no browser hit-test bounds.");
    await page.mouse.click(childHitPoint.x, childHitPoint.y);
    await page.waitForFunction(() => document.querySelector("#selection-status")?.textContent?.startsWith("takeaway-001"));
    assert(!(await page.locator('[data-inspector-action="select-parent"]').isDisabled()), "Child-first canvas selection lost parent navigation.");

    progress("checking Visual Fragment save, package export, linked insert, properties, and definition sync");
    await page.locator('[data-layer-id="title-001"]').click();
    await page.locator("#save-fragment").click();
    await page.locator("#fragment-save-dialog").waitFor({ state: "visible" });
    await page.locator("#fragment-name").fill("Browser Title Component");
    await page.locator("#fragment-type").selectOption("component");
    await page.locator("#fragment-add-property").click();
    const propertyRow = page.locator("#fragment-property-rows .fragment-schema-row").first();
    await propertyRow.locator('[data-schema-field="name"]').fill("title");
    await propertyRow.locator('[data-schema-field="label"]').fill("Title");
    await propertyRow.locator('[data-schema-field="type"]').selectOption("text");
    await propertyRow.locator('[data-schema-field="binding"]').selectOption("text");
    await page.locator("#fragment-add-slot").click();
    const slotRow = page.locator("#fragment-slot-rows .fragment-schema-row").first();
    await slotRow.locator('[data-schema-field="name"]').fill("suffix");
    await slotRow.locator('[data-schema-field="label"]').fill("Suffix");
    await slotRow.locator('[data-schema-field="allowed"]').fill("span");
    await slotRow.locator('[data-schema-field="multiple"]').check();
    await page.locator("#fragment-save-submit").click();
    try {
      await page.locator("#fragment-save-dialog").waitFor({ state: "hidden", timeout: 20_000 });
    } catch {
      const toast = await page.locator("#toast").textContent();
      throw new Error(`Visual Fragment save failed: ${toast || "no toast message"}${errors.length ? `\n${errors.join("\n")}` : ""}`);
    }

    await page.locator("#open-fragment-library").click();
    await page.locator("#fragment-library-dialog").waitFor({ state: "visible" });
    const fragmentCard = page.locator('.fragment-card:has-text("Browser Title Component")').first();
    await fragmentCard.waitFor();
    const fragmentId = await fragmentCard.getAttribute("data-fragment-id");
    assert(fragmentId, "Saved Visual Fragment has no definition ID.");
    assert((await page.locator("#fragment-storage-status").textContent())?.includes("IndexedDB"), "Visual Fragment library did not use persistent browser storage.");

    const fragmentDownloadPromise = page.waitForEvent("download");
    await fragmentCard.locator('[data-fragment-action="export"]').click();
    const fragmentDownload = await fragmentDownloadPromise;
    const fragmentDownloadPath = await fragmentDownload.path();
    assert(fragmentDownloadPath, ".vfrag export did not produce a download path.");
    const fragmentBytes = await readFile(fragmentDownloadPath);
    assert(fragmentBytes[0] === 0x50 && fragmentBytes[1] === 0x4b, ".vfrag export is not a ZIP package.");

    const previewPngDownloadPromise = page.waitForEvent("download", { timeout: 8_000 }).catch(() => null);
    await fragmentCard.locator('[data-fragment-action="preview-png"]').click();
    const previewPngDownload = await previewPngDownloadPromise;
    if (!previewPngDownload) throw new Error(`Fragment preview PNG export failed: ${await page.locator("#toast").textContent()}`);
    const previewPngPath = await previewPngDownload.path();
    assert(previewPngPath, "Fragment preview PNG export did not produce a download path.");
    const previewPng = await readFile(previewPngPath);
    assert(previewPng[0] === 0x89 && previewPng.subarray(1, 4).toString() === "PNG", "Fragment preview export is not a PNG file.");

    await fragmentCard.locator('[data-fragment-action="insert-linked"]').click();
    await page.locator("#fragment-report-dialog").waitFor({ state: "visible" });
    const compatibilityText = await page.locator("#fragment-report-content").textContent();
    assert(compatibilityText?.includes("编辑器 ID 重映射"), "Fragment insertion did not show an ID compatibility report.");
    await page.locator("#fragment-report-confirm").click();
    await page.locator("#fragment-report-dialog").waitFor({ state: "hidden" });
    await page.waitForFunction((definitionId) => {
      const host = document.querySelector("#canvas-host");
      return Boolean(Array.from(host?.shadowRoot?.querySelectorAll("[data-vfrag-definition-id]") ?? [])
        .find((element) => element.getAttribute("data-vfrag-definition-id") === definitionId));
    }, fragmentId);
    await page.locator("#fragment-library-close").click();
    await page.locator("#fragment-library-dialog").waitFor({ state: "hidden" });

    const componentRootId = await page.evaluate((definitionId) => {
      const host = document.querySelector("#canvas-host");
      return Array.from(host?.shadowRoot?.querySelectorAll("[data-vfrag-definition-id]") ?? [])
        .find((element) => element.getAttribute("data-vfrag-definition-id") === definitionId)
        ?.getAttribute("data-editor-id") ?? null;
    }, fragmentId);
    assert(componentRootId, "Inserted linked component could not be located by stable editor ID.");
    await page.locator('[data-fragment-property="title"]').fill("Reusable browser title");
    await page.locator('[data-fragment-property="title"]').press("Tab");
    await page.waitForFunction(({ definitionId, expected }) => {
      const host = document.querySelector("#canvas-host");
      const root = Array.from(host?.shadowRoot?.querySelectorAll("[data-vfrag-definition-id]") ?? [])
        .find((element) => element.getAttribute("data-vfrag-definition-id") === definitionId);
      return root?.querySelector('[data-vfrag-node-key="title-001"]')?.textContent === expected;
    }, { definitionId: fragmentId, expected: "Reusable browser title" });
    const componentSourceDownloadPromise = page.waitForEvent("download");
    await page.locator("#export-html").click();
    const componentSourceDownload = await componentSourceDownloadPromise;
    const componentSourcePath = await componentSourceDownload.path();
    assert(componentSourcePath, "Component source export did not produce a download path.");
    const componentSource = editableSourceFromExport(await readFile(componentSourcePath, "utf8"));
    assert(componentSource.includes("data-vfrag-property-overrides") && componentSource.includes("Reusable browser title"), "Component property override did not synchronize to exported source code.");

    await page.locator("#open-fragment-library").click();
    const originalCard = page.locator(`.fragment-card[data-fragment-id="${fragmentId}"][data-fragment-version="1.0.0"]`);
    await originalCard.locator('[data-fragment-action="update"]').click();
    await page.locator("#fragment-save-dialog").waitFor({ state: "visible" });
    assert((await page.locator("#fragment-version").inputValue()) === "1.0.1", "Updating a definition did not advance the patch version.");
    await page.locator("#fragment-save-submit").click();
    await page.locator("#fragment-save-dialog").waitFor({ state: "hidden" });
    const updatedCard = page.locator(`.fragment-card[data-fragment-id="${fragmentId}"][data-fragment-version="1.0.1"]`);
    await updatedCard.waitFor();
    await updatedCard.locator('[data-fragment-action="sync"]').click();
    await page.locator("#fragment-library-close").click();
    await page.waitForFunction(({ definitionId, expected }) => {
      const host = document.querySelector("#canvas-host");
      const root = Array.from(host?.shadowRoot?.querySelectorAll("[data-vfrag-definition-id]") ?? [])
        .find((element) => element.getAttribute("data-vfrag-definition-id") === definitionId);
      return root?.getAttribute("data-vfrag-definition-version") === "1.0.1" &&
        root.querySelector('[data-vfrag-node-key="title-001"]')?.textContent === expected;
    }, { definitionId: fragmentId, expected: "Reusable browser title" });
    const slotControl = page.locator("[data-fragment-slot-control]").first();
    await slotControl.locator("[data-fragment-slot-value]").fill(" · inserted slot");
    await slotControl.locator('[data-fragment-instance-action="insert-slot"]').click();
    await page.waitForFunction((definitionId) => {
      const host = document.querySelector("#canvas-host");
      const root = Array.from(host?.shadowRoot?.querySelectorAll("[data-vfrag-definition-id]") ?? [])
        .find((element) => element.getAttribute("data-vfrag-definition-id") === definitionId);
      return root?.querySelector('[data-vfrag-node-key="title-001"]')?.textContent?.includes("inserted slot");
    }, fragmentId);
    await page.locator('[data-fragment-instance-action="unlink"]').click();
    await page.waitForFunction((definitionId) => {
      const host = document.querySelector("#canvas-host");
      const root = Array.from(host?.shadowRoot?.querySelectorAll("[data-vfrag-definition-id]") ?? [])
        .find((element) => element.getAttribute("data-vfrag-definition-id") === definitionId);
      return root?.getAttribute("data-vfrag-linked") === "false";
    }, fragmentId);

    progress("checking SVG selection and polygon scaling");
    await page.locator("#example-select").selectOption("svg");
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.startsWith("SVG"));
    assert(await page.locator('[data-layer-id="svg-title"]').count() === 1, "SVG layer tree did not load.");
    await page.locator('[data-layer-id="svg-title"]').click();
    assert((await shadowText(page, "svg-title")) === "Editable SVG energy curve", "SVG selection did not map to the native SVG node.");

    await page.locator('[data-layer-id="arrow-mark"]').click();
    const scaleHandle = page.locator(".moveable-control-box .moveable-se");
    await scaleHandle.waitFor({ state: "visible" });
    const scaleHandleBox = await scaleHandle.boundingBox();
    assert(scaleHandleBox, "Polygon scale handle has no browser bounds.");
    await page.mouse.move(scaleHandleBox.x + scaleHandleBox.width / 2, scaleHandleBox.y + scaleHandleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(scaleHandleBox.x + scaleHandleBox.width / 2 + 32, scaleHandleBox.y + scaleHandleBox.height / 2 + 22, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => {
      const host = document.querySelector("#canvas-host");
      const polygon = host?.shadowRoot?.querySelector('[data-editor-id="arrow-mark"]');
      return polygon && Math.abs(Number(polygon.getAttribute("data-editor-scale-x")) - 1) > 0.05;
    });
    await page.waitForTimeout(250);
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-html").click();
    const svgDownload = await downloadPromise;
    const svgDownloadPath = await svgDownload.path();
    assert(svgDownloadPath, "SVG export did not produce a local download path.");
    const exportedSvg = await readFile(svgDownloadPath, "utf8");
    const polygonAfterScale = await page.evaluate(() => {
      const polygon = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="arrow-mark"]');
      return polygon ? Array.from(polygon.attributes).map((attribute) => [attribute.name, attribute.value]) : [];
    });
    const exportedPolygon = exportedSvg.match(/<polygon[^>]*data-editor-id="arrow-mark"[^>]*>/)?.[0] ?? "missing";
    assert(exportedSvg.includes("data-editor-scale-x"), `Polygon scaling did not synchronize to exported source code: ${JSON.stringify({ polygonAfterScale, exportedPolygon, errors })}`);

    progress("checking Phase 4 presentation workflow");
    await page.locator("#example-select").selectOption("deck");
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.includes("page 1/3"));
    assert((await page.locator("#page-select option").count()) === 3, "The bundled deck did not expose three editable pages.");
    assert((await page.locator(".page-thumbnail").count()) === 3, "The page filmstrip did not render three thumbnails.");
    assert((await page.locator("#canvas-width").inputValue()) === "1280", "Deck width was not detected from deck-stage.");
    assert((await page.locator("#canvas-height").inputValue()) === "720", "Deck height was not detected from deck-stage.");
    const firstPage = await page.evaluate(() => {
      const host = document.querySelector("#canvas-host");
      const active = host?.shadowRoot?.querySelector('[data-editor-preview-page-root="active"]');
      const deck = active?.parentElement;
      return {
        label: active?.getAttribute("data-label"),
        visible: active ? getComputedStyle(active).visibility : "missing",
        deckVisible: deck ? getComputedStyle(deck).visibility : "missing",
        text: active?.textContent ?? "",
      };
    });
    assert(firstPage.label === "Opening", `Unexpected first page label: ${firstPage.label}`);
    assert(firstPage.visible === "visible" && firstPage.deckVisible === "visible", "The sanitized static deck is still hidden.");
    assert(firstPage.text.includes("source-first presentation workflow"), "The first imported slide has no visible slide content.");

    progress("checking adjustable workspace panels");
    const canvasWidthBeforePanels = await page.locator(".canvas-panel").evaluate((element) => element.clientWidth);
    const layersWidthBefore = await page.locator("#layers-panel").evaluate((element) => element.clientWidth);
    await dragBy(page, page.locator('[data-layout-resizer="layers"]'), -48, 0);
    const layersWidthAfter = await page.locator("#layers-panel").evaluate((element) => element.clientWidth);
    const canvasWidthAfterLayers = await page.locator(".canvas-panel").evaluate((element) => element.clientWidth);
    assert(layersWidthAfter <= layersWidthBefore - 35, `Layer panel did not shrink (${layersWidthBefore} -> ${layersWidthAfter}).`);
    assert(canvasWidthAfterLayers >= canvasWidthBeforePanels + 35, `Shrinking layers did not release canvas width (${canvasWidthBeforePanels} -> ${canvasWidthAfterLayers}).`);

    await dragBy(page, page.locator('[data-layout-resizer="layers"]'), 86, 0);
    await page.waitForTimeout(50);
    const layersWidthExpanded = await page.locator("#layers-panel").evaluate((element) => element.clientWidth);
    const canvasWidthAfterLayerExpansion = await page.locator(".canvas-panel").evaluate((element) => element.clientWidth);
    assert(layersWidthExpanded >= layersWidthAfter + 70, `Layer panel did not expand (${layersWidthAfter} -> ${layersWidthExpanded}).`);
    assert(canvasWidthAfterLayerExpansion <= canvasWidthAfterLayers - 70, `Expanding layers did not shrink the canvas (${canvasWidthAfterLayers} -> ${canvasWidthAfterLayerExpansion}).`);
    const fittedCanvas = await page.evaluate(() => {
      const panel = document.querySelector(".canvas-panel")?.getBoundingClientRect();
      const viewport = document.querySelector("#canvas-viewport")?.getBoundingClientRect();
      const canvas = document.querySelector("#canvas-host")?.getBoundingClientRect();
      return { panel, viewport, canvas };
    });
    assert(fittedCanvas.panel && fittedCanvas.viewport && Math.abs(fittedCanvas.panel.width - fittedCanvas.viewport.width) <= 2, "Canvas viewport width did not follow the resized workspace column.");
    assert(fittedCanvas.canvas && fittedCanvas.viewport && fittedCanvas.canvas.left >= fittedCanvas.viewport.left && fittedCanvas.canvas.right <= fittedCanvas.viewport.right, "Expanded layers overlapped the fitted canvas content.");

    const inspectorWidthBefore = await page.locator("#inspector-panel").evaluate((element) => element.clientWidth);
    await dragBy(page, page.locator('[data-layout-resizer="inspector"]'), 52, 0);
    const inspectorWidthAfter = await page.locator("#inspector-panel").evaluate((element) => element.clientWidth);
    const canvasWidthAfterInspector = await page.locator(".canvas-panel").evaluate((element) => element.clientWidth);
    assert(inspectorWidthAfter <= inspectorWidthBefore - 38, `Inspector panel did not shrink (${inspectorWidthBefore} -> ${inspectorWidthAfter}).`);
    assert(canvasWidthAfterInspector >= canvasWidthAfterLayerExpansion + 38, `Shrinking inspector did not release canvas width (${canvasWidthAfterLayerExpansion} -> ${canvasWidthAfterInspector}).`);

    const canvasHeightBeforePages = await page.locator("#canvas-viewport").evaluate((element) => element.clientHeight);
    const pagesHeightBefore = await page.locator("#page-filmstrip").evaluate((element) => element.clientHeight);
    await dragBy(page, page.locator('[data-layout-resizer="pages"]'), 0, -24);
    const pagesHeightAfter = await page.locator("#page-filmstrip").evaluate((element) => element.clientHeight);
    const canvasHeightAfterPages = await page.locator("#canvas-viewport").evaluate((element) => element.clientHeight);
    assert(pagesHeightAfter <= pagesHeightBefore - 16, `PAGES bar did not shrink (${pagesHeightBefore} -> ${pagesHeightAfter}).`);
    assert(canvasHeightAfterPages >= canvasHeightBeforePages + 16, `Shrinking PAGES did not release canvas height (${canvasHeightBeforePages} -> ${canvasHeightAfterPages}).`);

    const buildHeightBefore = await page.locator("#build-panel").evaluate((element) => element.clientHeight);
    const propertiesHeightBefore = await page.locator(".element-properties-panel").evaluate((element) => element.clientHeight);
    await dragBy(page, page.locator('[data-layout-resizer="build"]'), 0, 42);
    const buildHeightAfter = await page.locator("#build-panel").evaluate((element) => element.clientHeight);
    const propertiesHeightAfter = await page.locator(".element-properties-panel").evaluate((element) => element.clientHeight);
    assert(buildHeightAfter >= buildHeightBefore + 30, `Build panel did not grow (${buildHeightBefore} -> ${buildHeightAfter}).`);
    assert(propertiesHeightAfter <= propertiesHeightBefore - 30, `Element properties did not yield height (${propertiesHeightBefore} -> ${propertiesHeightAfter}).`);

    const widthBeforeLayerCollapse = await page.locator(".canvas-panel").evaluate((element) => element.clientWidth);
    await page.locator('[data-layout-toggle="layers"]').click();
    assert(await page.locator(".workspace").evaluate((element) => element.classList.contains("is-layers-collapsed")), "Layer panel did not enter collapsed state.");
    assert(await page.locator(".canvas-panel").evaluate((element) => element.clientWidth) >= widthBeforeLayerCollapse + 130, "Collapsed layers did not return their width to the canvas.");
    await page.locator('[data-layout-toggle="layers"]').click();

    const widthBeforeInspectorCollapse = await page.locator(".canvas-panel").evaluate((element) => element.clientWidth);
    await page.locator('[data-layout-toggle="inspector"]').click();
    assert(await page.locator(".workspace").evaluate((element) => element.classList.contains("is-inspector-collapsed")), "Inspector panel did not enter collapsed state.");
    assert(await page.locator(".canvas-panel").evaluate((element) => element.clientWidth) >= widthBeforeInspectorCollapse + 190, "Collapsed inspector did not return its width to the canvas.");
    await page.locator('[data-layout-toggle="inspector"]').click();

    const heightBeforePagesCollapse = await page.locator("#canvas-viewport").evaluate((element) => element.clientHeight);
    await page.locator('[data-layout-toggle="pages"]').click();
    assert(await page.locator(".canvas-panel").evaluate((element) => element.classList.contains("is-pages-collapsed")), "PAGES bar did not enter collapsed state.");
    assert(await page.locator("#canvas-viewport").evaluate((element) => element.clientHeight) >= heightBeforePagesCollapse + 45, "Collapsed PAGES did not return its height to the canvas.");
    await page.locator('[data-layout-toggle="pages"]').click();
    assert(await page.evaluate(() => Boolean(localStorage.getItem("last-mile-studio:layout:v1"))), "Layout preferences were not persisted locally.");

    const persistedLayout = await page.evaluate(() => JSON.parse(localStorage.getItem("last-mile-studio:layout:v1") ?? "null"));
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#document-status").waitFor();
    assert(Math.abs(await page.locator("#layers-panel").evaluate((element) => element.clientWidth) - persistedLayout.layersWidth) <= 2, "Reload did not restore the layer panel width.");
    assert(Math.abs(await page.locator("#inspector-panel").evaluate((element) => element.clientWidth) - persistedLayout.inspectorWidth) <= 2, "Reload did not restore the inspector width.");
    await page.locator("#example-select").selectOption("deck");
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.includes("page 1/3"));
    assert(Math.abs(await page.locator("#page-filmstrip").evaluate((element) => element.clientHeight) - persistedLayout.pagesHeight) <= 2, "Reload did not restore the PAGES height.");
    assert(Math.abs(await page.locator("#build-panel").evaluate((element) => element.clientHeight) - persistedLayout.buildHeight) <= 2, "Reload did not restore the Build panel height.");

    progress("checking Phase A Build state editing and Phase B orchestration");
    assert((await page.locator("#build-status").textContent()) === "Initial / 2", "The first demo page did not initialize at Build Initial / 2.");
    assert((await page.locator(".build-group[data-build-group]").count()) === 2, "The Build panel did not group the first page into two Builds.");
    assert((await page.locator(".page-thumbnail-builds").count()) === 3, "Build-aware thumbnail badges are missing.");
    const initialBuildState = await page.evaluate(() => {
      const root = document.querySelector("#canvas-host")?.shadowRoot;
      const title = root?.querySelector('[data-editor-id="demo-title-1"]');
      const copy = root?.querySelector('[data-editor-id="demo-copy-1"]');
      return {
        title: title?.getAttribute("data-editor-build-visibility"),
        copy: copy?.getAttribute("data-editor-build-visibility"),
      };
    });
    assert(initialBuildState.title === "hidden" && initialBuildState.copy === "hidden", "Initial state exposed future Build elements.");
    await page.locator("#next-build").click();
    await page.waitForFunction(() => document.querySelector("#build-status")?.textContent === "Build 1 / 2");
    const buildOneState = await page.evaluate(() => {
      const root = document.querySelector("#canvas-host")?.shadowRoot;
      return ["demo-title-1", "demo-copy-1"].map((id) => root?.querySelector(`[data-editor-id="${id}"]`)?.getAttribute("data-editor-build-visibility"));
    });
    assert(JSON.stringify(buildOneState) === JSON.stringify(["shown", "hidden"]), `Build 1 visibility is wrong: ${JSON.stringify(buildOneState)}`);
    await page.locator("#next-build").click();
    await page.waitForFunction(() => document.querySelector("#build-status")?.textContent === "Build 2 / 2");

    await page.locator('[data-build-element-id="demo-copy-1"]').click();
    await page.locator("#selected-build-target").selectOption("1");
    await page.locator('[data-build-action="apply-selected"]').click();
    await page.waitForFunction(() => document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="demo-copy-1"]')?.getAttribute("data-build") === "1");
    assert((await page.locator(".build-group[data-build-group]").count()) === 1, "Moving an element across groups did not collapse the empty Build group.");
    await page.locator("#undo").click();
    await page.waitForFunction(() => document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="demo-copy-1"]')?.getAttribute("data-build") === "2");
    const buildElementTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.locator('[data-build-element-id="demo-copy-1"]').dispatchEvent("dragstart", { dataTransfer: buildElementTransfer });
    await page.locator('.build-group[data-build-group="1"] > header').dispatchEvent("drop", { dataTransfer: buildElementTransfer });
    await page.waitForFunction(() => document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="demo-copy-1"]')?.getAttribute("data-build") === "1");
    await page.locator("#undo").click();
    await page.waitForFunction(() => document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="demo-copy-1"]')?.getAttribute("data-build") === "2");
    await page.locator('[data-layer-id="demo-kicker-1"]').click();
    await page.locator('[data-build-action="split-selected"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".build-group[data-build-group]").length === 3);
    await page.locator("#undo").click();
    await page.waitForFunction(() => document.querySelectorAll(".build-group[data-build-group]").length === 2);

    const buildGroupTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.locator('.build-group[data-build-group="1"] > header').dispatchEvent("dragstart", { dataTransfer: buildGroupTransfer });
    await page.locator('.build-group[data-build-group="2"] > header').dispatchEvent("drop", { dataTransfer: buildGroupTransfer });
    await page.waitForFunction(() => document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="demo-title-1"]')?.getAttribute("data-build") === "2");
    await page.locator("#undo").click();
    await page.waitForFunction(() => document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="demo-title-1"]')?.getAttribute("data-build") === "1");

    await page.locator("#previous-build").click();
    await page.locator("#previous-build").click();
    await page.locator("#build-view-mode").selectOption("all");
    await page.waitForFunction(() => document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="demo-copy-1"]')?.getAttribute("data-editor-build-visibility") === "shown");
    await page.locator("#build-view-mode").selectOption("playback");
    await page.locator("#next-build").click();
    await page.locator("#next-build").click();
    await page.locator('#canvas-host [data-editor-id="demo-copy-1"]').dblclick();
    const buildInlineEditor = page.locator("#canvas-host .editor-inline-textarea");
    await buildInlineEditor.fill("Build 2 edited copy");
    await page.locator('#canvas-host .editor-inline-actions button[type="submit"]').click();
    await page.locator("#previous-build").click();
    await page.locator("#previous-build").click();
    await page.locator("#undo").click();
    await page.waitForFunction(() => document.querySelector("#build-status")?.textContent === "Build 2 / 2");
    assert((await shadowText(page, "demo-copy-1"))?.includes("Edit real HTML"), "Undo did not restore Build content and observation context.");
    await page.locator("#redo").click();
    assert((await page.locator(".cm-content").innerText()).includes("Build 2 edited copy"), "Redo did not restore the Build-state text edit in source.");

    const thumbnailText = await page.locator('[data-thumbnail-host="1"]').evaluate((host) => host.shadowRoot?.textContent ?? "");
    assert(thumbnailText.includes("Refine the message"), "The second thumbnail is not a real DOM preview of page two.");
    const secondThumbnailPreview = await page.locator('[data-page-id="demo-page-2"] .page-thumbnail-preview').boundingBox();
    assert(secondThumbnailPreview, "The second page thumbnail preview has no browser bounds.");
    await page.mouse.click(
      secondThumbnailPreview.x + secondThumbnailPreview.width / 2,
      secondThumbnailPreview.y + secondThumbnailPreview.height / 2,
    );
    await page.waitForFunction(() => document.querySelector("#page-count")?.textContent === "2 / 3");
    assert(await page.locator(".page-thumbnail.is-active").getAttribute("data-page-id") === "demo-page-2", "Clicking the thumbnail preview center did not activate page two.");
    const secondPageLabel = await page.evaluate(() => document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-preview-page-root="active"]')?.getAttribute("data-label"));
    assert(secondPageLabel === "Visual editing", `Page switching selected the wrong slide: ${secondPageLabel}`);

    await page.locator("#duplicate-page").click();
    await page.waitForFunction(() => document.querySelectorAll(".page-thumbnail").length === 4);
    assert((await page.locator("#page-select option").allTextContents()).some((label) => label.includes("Visual editing Copy")), "Duplicating a page did not add a labeled copy.");
    assert(await page.locator('[data-page-id="demo-page-2-copy"]').count() === 1, "The duplicated page did not receive a fresh stable ID.");

    await page.locator("#undo").click();
    await page.waitForFunction(() => document.querySelectorAll(".page-thumbnail").length === 3);
    assert((await page.locator("#page-select").inputValue()) === "1", "Undo did not restore the original active page context.");
    await page.locator("#redo").click();
    await page.waitForFunction(() => document.querySelectorAll(".page-thumbnail").length === 4);
    assert(await page.locator(".page-thumbnail.is-active").getAttribute("data-page-id") === "demo-page-2-copy", "Redo did not restore the duplicated active page.");

    await page.locator("#move-page-earlier").click();
    await page.waitForFunction(() => document.querySelector(".page-thumbnail.is-active")?.getAttribute("data-page-index") === "1");
    const sortedIds = await page.locator(".page-thumbnail").evaluateAll((items) => items.map((item) => item.getAttribute("data-page-id")));
    assert(JSON.stringify(sortedIds) === JSON.stringify(["demo-page-1", "demo-page-2-copy", "demo-page-2", "demo-page-3"]), `Page sorting produced the wrong order: ${JSON.stringify(sortedIds)}`);

    await page.locator("#delete-page").click();
    await page.waitForFunction(() => document.querySelectorAll(".page-thumbnail").length === 3);
    assert(await page.locator('[data-page-id="demo-page-2-copy"]').count() === 0, "Deleting a page left the copied page in the source model.");
    await page.locator("#undo").click();
    await page.waitForFunction(() => document.querySelectorAll(".page-thumbnail").length === 4);

    await page.locator("#canvas-preset").selectOption("1024x768");
    await page.waitForFunction(() => document.querySelector("#canvas-width")?.value === "1024" && document.querySelector("#canvas-height")?.value === "768");
    assert((await page.locator(".cm-content").innerText()).includes('width="1024"'), "The 4:3 preset did not update deck metadata in source code.");

    await page.locator("#preview-presentation").click();
    await page.locator("#preview-choice-dialog").waitFor({ state: "visible" });
    await page.locator("#preview-from-start").click();
    await page.locator("#presentation-dialog").waitFor({ state: "visible" });
    const previewFrame = page.frameLocator("#presentation-frame");
    await previewFrame.locator("#lms-status").waitFor();
    assert((await previewFrame.locator("#lms-status").textContent())?.startsWith("1 / 4"), "Presentation preview did not initialize all four pages.");
    await previewFrame.locator("#lms-next").click();
    await previewFrame.locator("#lms-status").filter({ hasText: "Build 1 / 2" }).waitFor();
    await previewFrame.locator("#lms-next").click();
    await previewFrame.locator("#lms-status").filter({ hasText: "Build 2 / 2" }).waitFor();
    await previewFrame.locator("#lms-next").click();
    await previewFrame.locator("#lms-status").filter({ hasText: "2 / 4" }).waitFor();
    await previewFrame.locator("#lms-previous").click();
    await previewFrame.locator("#lms-status").filter({ hasText: "1 / 4 · Build 2 / 2" }).waitFor();
    await page.locator("#close-presentation").click();

    await page.locator("#page-select").selectOption("2");
    await page.locator("#preview-presentation").click();
    await page.locator("#preview-from-current").click();
    await previewFrame.locator("#lms-status").filter({ hasText: "3 / 4 · Initial" }).waitFor();
    await page.locator("#close-presentation").click();

    const slidesDownloadPromise = page.waitForEvent("download");
    await page.locator("#export-html").click();
    const slidesDownload = await slidesDownloadPromise;
    const slidesDownloadPath = await slidesDownload.path();
    assert(slidesDownloadPath, "Standalone Slides export did not produce a local download path.");
    const exportedSlides = await readFile(slidesDownloadPath, "utf8");
    assert(exportedSlides.includes('content="Last Mile Studio 0.3.0"'), "Standalone Slides export has no current generator metadata.");
    assert(exportedSlides.includes('name="lms-format" content="editable-html-presentation"'), "HTML export has no reversible format marker.");
    assert(exportedSlides.includes('sandbox="allow-same-origin"'), "Standalone Slides export does not keep imported content scriptless.");
    assert(exportedSlides.includes("demo-page-2-copy"), "Standalone Slides export lost the duplicated page order.");

    const exportedHtmlPath = "/tmp/last-mile-studio-smoke-export.html";
    await copyFile(slidesDownloadPath, exportedHtmlPath);
    const exportedPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    exportedPage.on("pageerror", (error) => errors.push(`standalone export: ${error.stack ?? error.message}`));
    await exportedPage.goto(`file://${exportedHtmlPath}`);
    await exportedPage.locator("#lms-status").filter({ hasText: "1 / 4" }).waitFor();
    await exportedPage.locator("#lms-next").click();
    await exportedPage.locator("#lms-status").filter({ hasText: "Build 1 / 2" }).waitFor();
    await exportedPage.locator("#lms-next").click();
    await exportedPage.locator("#lms-next").click();
    await exportedPage.locator("#lms-status").filter({ hasText: "2 / 4" }).waitFor();
    await exportedPage.close();

    await page.locator("#file-input").setInputFiles(exportedHtmlPath);
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.includes("page 1/4"));
    assert((await page.locator(".page-thumbnail").count()) === 4, "Re-importing exported HTML did not restore all four editable pages.");
    assert(await page.locator("#canvas-host").evaluate((host) => !host.shadowRoot?.querySelector("#lms-stage")), "Re-importing exported HTML exposed the player shell instead of the canonical document.");
    await page.locator("#duplicate-page").click();
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.includes("page 2/5"));
    const secondRoundDownloadPromise = page.waitForEvent("download");
    await page.locator("#export-html").click();
    const secondRoundDownload = await secondRoundDownloadPromise;
    const secondRoundPath = await secondRoundDownload.path();
    assert(secondRoundPath, "Editing and re-exporting a re-imported HTML file did not produce a download.");
    const secondRoundHtml = await readFile(secondRoundPath, "utf8");
    assert(!editableSourceFromExport(secondRoundHtml).includes('id="lms-stage"'), "A second export nested the presentation player into canonical source.");
    await page.locator("#file-input").setInputFiles(secondRoundPath);
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.includes("page 1/5"));
    assert((await page.locator(".page-thumbnail").count()) === 5, "The second import did not preserve an edit made after the first round trip.");

    progress("checking the real 23-page HotCarbon Build artifact");
    await page.locator("#file-input").setInputFiles("reference/artifacts/HotCarbon_Oral_Slides_SelfContained.html");
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.includes("page 1/23"), null, { timeout: 40_000 });
    assert((await page.locator(".page-thumbnail").count()) === 23, "HotCarbon import did not expose 23 pages.");
    assert((await page.locator(".page-thumbnail-builds").count()) === 14, "HotCarbon import did not identify 14 Build pages.");
    assert((await page.locator("#build-status").textContent()) === "Initial / 2", "HotCarbon first page did not initialize at Initial / 2.");
    assert((await page.locator(".build-group[data-build-group]").count()) === 2, "HotCarbon first page Build groups were not detected.");
    await page.locator("#notice-bar").waitFor({ state: "hidden", timeout: 7_000 });
    await page.locator("#build-warnings").waitFor({ state: "hidden", timeout: 9_000 });
    await page.locator("#next-build").click();
    await page.waitForFunction(() => document.querySelector("#build-status")?.textContent === "Build 1 / 2");
    await page.locator("#next-build").click();
    await page.waitForFunction(() => document.querySelector("#build-status")?.textContent === "Build 2 / 2");

    const hotSourceDownloadPromise = page.waitForEvent("download");
    await page.locator("#export-html").click();
    const hotSourceDownload = await hotSourceDownloadPromise;
    const hotSourcePath = await hotSourceDownload.path();
    assert(hotSourcePath, "HotCarbon sanitized source export did not produce a file.");
    const hotSource = editableSourceFromExport(await readFile(hotSourcePath, "utf8"));
    assert((hotSource.match(/data-build="[123]"/g) ?? []).length === 94, "HotCarbon sanitized source did not preserve all 94 Build elements.");
    assert(!hotSource.includes("<script"), "HotCarbon imported scripts survived sanitization.");
    assert(!hotSource.includes("data-editor-build-visibility"), "Editor Build observation state polluted canonical source.");

    await page.locator("#preview-presentation").click();
    await page.locator("#preview-from-start").click();
    const hotPreview = page.frameLocator("#presentation-frame");
    await hotPreview.locator("#lms-status").filter({ hasText: "1 / 23 · Initial / 2" }).waitFor({ timeout: 40_000 });
    await hotPreview.locator("#lms-next").click();
    await hotPreview.locator("#lms-status").filter({ hasText: "1 / 23 · Build 1 / 2" }).waitFor();
    await hotPreview.locator("#lms-next").click();
    await hotPreview.locator("#lms-next").click();
    await hotPreview.locator("#lms-status").filter({ hasText: "2 / 23" }).waitFor();
    await page.locator("#close-presentation").click();

    const hotSlidesPromise = page.waitForEvent("download", { timeout: 40_000 });
    await page.locator("#export-html").click();
    const hotSlidesDownload = await hotSlidesPromise;
    const hotSlidesPath = await hotSlidesDownload.path();
    assert(hotSlidesPath, "HotCarbon standalone Build Slides export did not produce a file.");
    const hotExportPath = "/tmp/last-mile-studio-hotcarbon-build-export.html";
    await copyFile(hotSlidesPath, hotExportPath);
    const hotExportPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    hotExportPage.on("pageerror", (error) => errors.push(`HotCarbon standalone export: ${error.stack ?? error.message}`));
    await hotExportPage.goto(`file://${hotExportPath}`, { timeout: 40_000 });
    await hotExportPage.locator("#lms-status").filter({ hasText: "1 / 23 · Initial / 2" }).waitFor({ timeout: 40_000 });
    await hotExportPage.locator("#lms-next").click();
    await hotExportPage.locator("#lms-status").filter({ hasText: "Build 1 / 2" }).waitFor();
    await hotExportPage.close();

    assert(errors.length === 0, `Browser runtime errors:\n${errors.join("\n")}`);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      htmlSelection: true,
      moveableDragToCode: true,
      moveableResizeToCode: true,
      inspectorToCanvas: true,
      canvasToCode: true,
      undo: true,
      svgSelection: true,
      inlineTextEditing: true,
      inlineTextKeyboardIsolation: true,
      inlineTextApplyCancel: true,
      inspectorChildNavigation: true,
      polygonScaling: true,
      staticDeckPages: 4,
      pageThumbnails: true,
      thumbnailCenterNavigation: true,
      pageDuplicateDeleteSort: true,
      presentationPreview: true,
      standaloneSlidesExport: true,
      canvasPresets: true,
      codeCollapseReclaimsCanvas: true,
      adjustableWorkspacePanels: true,
      panelCollapseReclaimsCanvas: true,
      persistentLayoutPreferences: true,
      visualFragmentPackage: true,
      visualFragmentPreviewPng: true,
      visualFragmentCompatibilityReport: true,
      visualFragmentLinkedInstance: true,
      visualFragmentPropertyOverride: true,
      visualFragmentSlotInsertion: true,
      visualFragmentDefinitionSync: true,
      buildStateEditing: true,
      buildAllAndGroupViews: true,
      buildOrchestration: true,
      buildUndoRedoContext: true,
      buildFirstPreviewAndExport: true,
      hotCarbonBuildPages: 14,
      hotCarbonBuildElements: 94,
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
