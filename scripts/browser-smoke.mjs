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
  "/home/ldaphome/zkm/bin/google-chrome",
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
  server = spawn("npm", ["run", "dev", "--", "--host", parsedBaseUrl.hostname, "--port", port, "--strictPort", "--force"], {
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

async function dragBy(page, locator, deltaX, deltaY) {
  const box = await locator.boundingBox();
  assert(box, "Layout resizer has no browser bounds.");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + deltaX, start.y + deltaY, { steps: 6 });
  await page.mouse.up();
}

async function dragLayerTo(page, sourceId, targetId, placement) {
  const source = page.locator(`[data-layer-drag-handle="${sourceId}"]`);
  const target = page.locator(`[data-layer-id="${targetId}"]`);
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  assert(sourceBox && targetBox, `Layer drag bounds are missing for ${sourceId} -> ${targetId}.`);
  const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const ratio = placement === "before" ? 0.12 : placement === "after" ? 0.88 : 0.5;
  const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height * ratio };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 2, { steps: 2 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.waitForTimeout(80);
  const feedbackClass = await target.getAttribute("class");
  await page.mouse.up();
  return feedbackClass ?? "";
}

async function openFragmentMore(card) {
  const details = card.locator(".fragment-card-actions details");
  if (!(await details.getAttribute("open"))) await details.locator("summary").click();
}

async function chooseIoAction(page, menuId, actionSelector) {
  const menu = page.locator(menuId);
  if (!(await menu.getAttribute("open"))) await menu.locator(":scope > summary").click();
  await page.locator(actionSelector).click();
}

async function loadExample(page, kind) {
  await chooseIoAction(page, "#import-menu", `[data-load-example="${kind}"]`);
}

async function exportDocument(page) {
  await chooseIoAction(page, "#export-menu", "#export-document-action");
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
    await page.addInitScript(() => {
      const files = new Map();
      globalThis.__fragmentDirectoryFiles = files;
      globalThis.showDirectoryPicker = async () => ({
        kind: "directory",
        name: "Browser Smoke Fragments",
        queryPermission: async () => "granted",
        requestPermission: async () => "granted",
        async *values() { yield* files.values(); },
        async getFileHandle(name, options = {}) {
          let handle = files.get(name);
          if (!handle && options.create) {
            let bytes = new Uint8Array();
            handle = {
              kind: "file",
              name,
              getFile: async () => ({ name, lastModified: Date.now(), arrayBuffer: async () => bytes.slice().buffer }),
              createWritable: async () => ({
                write: async (value) => { bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : new Uint8Array(value); },
                close: async () => undefined,
              }),
            };
            files.set(name, handle);
          }
          if (!handle) throw new Error(`Missing file: ${name}`);
          return handle;
        },
        removeEntry: async (name) => { files.delete(name); },
      });
    });
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
    assert((await page.locator("#export-document-label").textContent()) === "导出 HTML", "The export menu did not reflect the active HTML document type.");
    assert(await page.locator("#export-selection-action").isDisabled(), "Selection export is enabled without a selection.");
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

    progress("checking bidirectional layer reveal, rename, collapse, and one-level structure drag");
    const fillerLayersBefore = Array.from({ length: 14 }, (_, index) => `<div data-editor-id="filler-${index}" style="display:none">Filler ${index}</div>`).join("");
    const fillerLayersAfter = Array.from({ length: 16 }, (_, index) => `<div data-editor-id="filler-${index + 14}" style="display:none">Filler ${index + 14}</div>`).join("");
    const layerSource = `<!doctype html><html><body data-editor-canvas-width="1280" data-editor-canvas-height="720" style="position:relative;margin:0">
      <section data-editor-id="stage" style="position:relative;width:1280px;height:720px">
        <div data-editor-id="group-a" style="position:absolute;left:80px;top:80px;width:300px;height:220px;background:#eef3ff">
          <div data-editor-id="move-me" style="position:absolute;left:20px;top:30px;width:100px;height:60px;background:#315efb;color:white">Move me</div>
        </div>
        <div data-editor-id="group-b" style="position:absolute;left:500px;top:80px;width:300px;height:220px;background:#f4f0ff"></div>
        <div data-editor-id="loose" style="position:absolute;left:700px;top:500px;width:120px;height:70px;background:#ffb85c">Loose</div>
        ${fillerLayersBefore}
        <div data-editor-id="group-c" style="position:absolute;left:900px;top:80px;width:260px;height:180px;background:#eefbf4">
          <div data-editor-id="center-me" style="position:absolute;left:20px;top:20px;width:110px;height:55px;background:#36a269;color:white">Center me</div>
        </div>
        ${fillerLayersAfter}
      </section>
    </body></html>`;
    await page.locator(".cm-content").fill(layerSource);
    await page.locator("#apply-code").click();
    await page.locator('[data-layer-id="filler-29"]').waitFor();
    assert(await page.locator('[data-layer-action="parent"],[data-layer-action="duplicate"],[data-layer-action="delete"]').count() === 0, "Redundant parent, duplicate, or delete layer buttons remain visible.");

    await page.locator('[data-layer-toggle="group-c"]').click();
    assert((await page.locator('[data-layer-id="group-c"]').getAttribute("aria-expanded")) === "false", "Layer branch did not collapse.");
    await page.locator("#layers-tree").evaluate((tree) => { tree.scrollTop = tree.scrollHeight; });
    await page.locator('#canvas-host [data-editor-id="center-me"]').click();
    await page.waitForFunction(() => document.querySelector("#selection-status")?.textContent?.startsWith("center-me"));
    await page.waitForTimeout(800);
    const revealState = await page.evaluate(() => {
      const tree = document.querySelector("#layers-tree");
      const row = document.querySelector('[data-layer-id="center-me"]');
      const parent = document.querySelector('[data-layer-id="group-c"]');
      if (!(tree instanceof HTMLElement) || !(row instanceof HTMLElement) || !(parent instanceof HTMLElement)) return null;
      const treeRect = tree.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return {
        expanded: parent.getAttribute("aria-expanded"),
        selected: row.classList.contains("is-selected"),
        centerDelta: Math.abs((rowRect.top + rowRect.bottom) / 2 - (treeRect.top + treeRect.bottom) / 2),
        scrollTop: tree.scrollTop,
      };
    });
    assert(revealState?.expanded === "true" && revealState.selected && revealState.centerDelta < 36,
      `Canvas selection did not expand and center its layer row (${JSON.stringify(revealState)}).`);

    await page.keyboard.press("F2");
    const layerNameInput = page.locator('[data-layer-name="center-me"] .layer-name-input');
    await layerNameInput.waitFor();
    await layerNameInput.fill("Renamed layer");
    await layerNameInput.press("Enter");
    await page.waitForFunction(() => document.querySelector('[data-layer-name="center-me"]')?.textContent === "Renamed layer");
    await page.locator("#undo").click();
    await page.waitForFunction(() => document.querySelector('[data-layer-name="center-me"]')?.textContent === "Center me");
    await page.locator("#redo").click();
    await page.waitForFunction(() => document.querySelector('[data-layer-name="center-me"]')?.textContent === "Renamed layer");

    const moveBefore = await page.locator('#canvas-host [data-editor-id="move-me"]').boundingBox();
    assert(moveBefore, "Layer move source has no visual bounds.");
    const outdentFeedback = await dragLayerTo(page, "move-me", "group-a", "after");
    assert(outdentFeedback.includes("is-drop-after"), `Outdent did not show the after insertion line (${outdentFeedback}).`);
    await page.waitForFunction(() => {
      const moved = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="move-me"]');
      return moved?.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") === "stage";
    });
    const moveAfter = await page.locator('#canvas-host [data-editor-id="move-me"]').boundingBox();
    assert(moveAfter && Math.abs(moveAfter.x - moveBefore.x) <= 2 && Math.abs(moveAfter.y - moveBefore.y) <= 2 &&
      Math.abs(moveAfter.width - moveBefore.width) <= 2 && Math.abs(moveAfter.height - moveBefore.height) <= 2,
    `One-level outdent changed visual geometry (${JSON.stringify(moveBefore)} -> ${JSON.stringify(moveAfter)}).`);
    await page.locator("#undo").click();
    await page.waitForFunction(() => {
      const moved = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="move-me"]');
      return moved?.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") === "group-a";
    });

    const looseBefore = await page.locator('#canvas-host [data-editor-id="loose"]').boundingBox();
    assert(looseBefore, "Indent source has no visual bounds.");
    const indentFeedback = await dragLayerTo(page, "loose", "group-b", "inside");
    assert(indentFeedback.includes("is-drop-inside"), `Indent did not show the container highlight (${indentFeedback}).`);
    await page.waitForFunction(() => {
      const moved = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="loose"]');
      return moved?.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") === "group-b";
    });
    const looseAfter = await page.locator('#canvas-host [data-editor-id="loose"]').boundingBox();
    assert(looseAfter && Math.abs(looseAfter.x - looseBefore.x) <= 2 && Math.abs(looseAfter.y - looseBefore.y) <= 2 &&
      Math.abs(looseAfter.width - looseBefore.width) <= 2 && Math.abs(looseAfter.height - looseBefore.height) <= 2,
    `One-level indent changed visual geometry (${JSON.stringify(looseBefore)} -> ${JSON.stringify(looseAfter)}).`);
    await page.locator("#undo").click();
    await page.waitForFunction(() => {
      const moved = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="loose"]');
      return moved?.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") === "stage";
    });
    await page.locator("#redo").click();
    await page.waitForFunction(() => {
      const moved = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="loose"]');
      return moved?.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") === "group-b";
    });

    const invalidFeedback = await dragLayerTo(page, "move-me", "group-b", "inside");
    assert(invalidFeedback.includes("is-drop-invalid"), `A cross-branch move did not show invalid feedback (${invalidFeedback}).`);
    await page.waitForFunction(() => {
      const moved = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="move-me"]');
      return moved?.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") === "group-a";
    });

    await loadExample(page, "html");
    await page.locator('[data-layer-id="title-001"]').waitFor();

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
    assert(await page.locator("#export-selection-action").isEnabled(), "Selection export did not enable after selecting an element.");
    await page.locator('[data-prop="text"]').waitFor();
    assert((await shadowText(page, "title-001")) === "Energy-Proportional LLM Inference", "HTML title selection did not map to the Shadow DOM node.");
    assert(await page.locator('#inspector-content input[type="color"][data-prop="color"]').inputValue() === "#15213b", "The text-color swatch does not reflect the selected element's computed color.");

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

    progress("checking friendly typography, stroke, and shadow controls");
    const fontSelect = page.locator('[data-prop="fontCatalog"]');
    const fontChoices = await fontSelect.locator("option").allTextContents();
    for (const requiredFont of ["Times New Roman", "微软雅黑", "宋体", "楷体"]) {
      assert(fontChoices.some((choice) => choice.includes(requiredFont)), `Font catalog is missing ${requiredFont}: ${JSON.stringify(fontChoices)}`);
    }
    assert(await page.locator('input[data-prop="fontFamily"], input[data-prop="letterSpacing"]').count() === 0, "Font family or letter spacing is still a free-text field.");
    const letterSpacing = page.locator('select[data-prop="letterSpacing"]');
    assert((await letterSpacing.locator('option[value="0"]').textContent()) === "0 px", "CSS normal letter spacing was not normalized to a numeric 0 px option.");
    await letterSpacing.selectOption("1");
    await page.waitForFunction(() => {
      const title = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="title-001"]');
      return title && getComputedStyle(title).letterSpacing === "1px";
    });

    await fontSelect.selectOption("times-new-roman");
    await page.waitForFunction(() => {
      const status = document.querySelector("[data-font-status]")?.textContent ?? "";
      return status.includes("实际使用") || status.includes("本机未安装");
    });
    const fontStatus = await page.locator("[data-font-status]").textContent();
    assert(fontStatus?.includes("实际使用") || fontStatus?.includes("本机未安装"), `Font availability status is not explicit: ${fontStatus}`);
    assert(await page.locator('[data-prop="fontCatalog"] option:checked').evaluate((option) => option.textContent?.includes("本机") || option.textContent?.includes("替代")), "Selected font option does not expose the actual local or fallback font.");

    const strokeWidth = page.locator('[data-prop="strokeWidth"]');
    await strokeWidth.fill("3");
    await strokeWidth.press("Tab");
    await page.waitForFunction(() => {
      const title = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="title-001"]');
      if (!title) return false;
      const style = getComputedStyle(title);
      return style.borderTopWidth === "3px" && style.borderTopStyle === "solid";
    });

    await page.locator('[data-shadow-preset="floating"]').click();
    await page.waitForFunction(() => {
      const title = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="title-001"]');
      return title && getComputedStyle(title).boxShadow !== "none";
    });
    const shadowX = page.locator('[data-shadow-part="x"]');
    await shadowX.fill("6");
    await shadowX.press("Tab");
    await page.waitForFunction(() => {
      const title = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="title-001"]');
      return title && getComputedStyle(title).boxShadow.includes("6px");
    });
    assert((await page.locator('[data-shadow-output="x"]').textContent()) === "6 px", "Shadow slider does not expose its numeric value.");

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

    progress("checking parent-to-child click and drag gesture arbitration");
    await page.evaluate(() => {
      const child = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="takeaway-001"]');
      if (child instanceof HTMLElement) child.style.pointerEvents = "";
    });
    await page.locator('[data-layer-id="accent-block-001"]').click();
    const childTransformBeforeJitter = await page.locator('#canvas-host [data-editor-id="takeaway-001"]').getAttribute("data-editor-translate-x");
    await page.mouse.move(childHitPoint.x, childHitPoint.y);
    await page.mouse.down();
    await page.mouse.move(childHitPoint.x + 2, childHitPoint.y + 1);
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector("#selection-status")?.textContent?.startsWith("takeaway-001"));
    assert(
      await page.locator('#canvas-host [data-editor-id="takeaway-001"]').getAttribute("data-editor-translate-x") === childTransformBeforeJitter,
      "Sub-threshold pointer jitter moved the child instead of acting as a click.",
    );

    const childTransformBeforeDrag = Number(await page.locator('#canvas-host [data-editor-id="takeaway-001"]').getAttribute("data-editor-translate-x") ?? 0);
    await page.mouse.move(childHitPoint.x, childHitPoint.y);
    await page.mouse.down();
    await page.mouse.move(childHitPoint.x + 18, childHitPoint.y + 10, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction((before) => {
      const child = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="takeaway-001"]');
      return Math.abs(Number(child?.getAttribute("data-editor-translate-x") ?? 0) - before) >= 4;
    }, childTransformBeforeDrag);
    assert((await page.locator("#selection-status").textContent())?.startsWith("takeaway-001"), "Direct child drag did not keep the child selected.");
    await page.locator("#undo").click();
    await page.waitForFunction((before) => {
      const child = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="takeaway-001"]');
      return Math.abs(Number(child?.getAttribute("data-editor-translate-x") ?? 0) - before) < 0.01;
    }, childTransformBeforeDrag);

    await page.locator('[data-layer-id="accent-block-001"]').click();
    const parentBoxBeforeDrag = await page.locator('#canvas-host [data-editor-id="accent-block-001"]').boundingBox();
    assert(parentBoxBeforeDrag, "Selected parent has no browser bounds before Alt-drag.");
    const refreshedChildBox = await page.locator('#canvas-host [data-editor-id="takeaway-001"]').boundingBox();
    assert(refreshedChildBox, "Nested child has no browser bounds before Alt-drag.");
    const altDragPoint = { x: refreshedChildBox.x + refreshedChildBox.width / 2, y: refreshedChildBox.y + refreshedChildBox.height / 2 };
    await page.keyboard.down("Alt");
    await page.mouse.move(altDragPoint.x, altDragPoint.y);
    await page.mouse.down();
    assert((await page.locator("#selection-status").textContent())?.startsWith("accent-block-001"), "Alt pointerdown did not preserve the selected parent target.");
    await page.mouse.move(altDragPoint.x + 18, altDragPoint.y + 10, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.waitForFunction((beforeLeft) => {
      const parent = document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="accent-block-001"]');
      return parent ? Math.abs(parent.getBoundingClientRect().left - beforeLeft) >= 4 : false;
    }, parentBoxBeforeDrag.x);
    await page.waitForFunction(() => document.querySelector("#selection-status")?.textContent?.startsWith("accent-block-001"));
    await page.locator("#undo").click();

    const parentTransformBeforePan = await page.locator('#canvas-host [data-editor-id="accent-block-001"]').getAttribute("data-editor-translate-x");
    const canvasTransformBeforePan = await page.locator("#canvas-transform").getAttribute("style");
    const panStartBox = await page.locator('#canvas-host [data-editor-id="takeaway-001"]').boundingBox();
    assert(panStartBox, "Nested child has no browser bounds before Space-pan.");
    await page.keyboard.down("Space");
    await page.mouse.move(panStartBox.x + panStartBox.width / 2, panStartBox.y + panStartBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(panStartBox.x + panStartBox.width / 2 + 24, panStartBox.y + panStartBox.height / 2 + 12, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    assert(
      await page.locator('#canvas-host [data-editor-id="accent-block-001"]').getAttribute("data-editor-translate-x") === parentTransformBeforePan,
      "Space-pan moved the selected parent element.",
    );
    assert(await page.locator("#canvas-transform").getAttribute("style") !== canvasTransformBeforePan, "Space-pan did not move the canvas.");
    await page.locator("#fit-canvas").click();

    progress("checking consolidated import/export menus and the temporary fragment clipboard");
    assert(await page.locator("#import-menu > summary").count() === 1, "The top bar does not expose exactly one import entry.");
    assert(await page.locator("#export-menu > summary").count() === 1, "The top bar does not expose exactly one export entry.");
    assert(await page.locator("#save-fragment, #import-local-fragment, #open-fragment-library, #fragment-toolbar-storage, #export-html").count() === 0, "Legacy top-level import/export or IndexedDB controls are still mounted.");
    await page.locator("#import-menu > summary").click();
    assert(await page.locator("#import-menu .io-menu-panel button").count() === 9, "The import menu lost one or more grouped actions.");
    await page.keyboard.press("Escape");
    assert(!(await page.locator("#import-menu").getAttribute("open")), "Escape did not close the import menu.");

    await page.locator('[data-layer-id="title-001"]').click();
    await page.keyboard.press("Control+C");
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent?.includes("临时片段剪贴板"));
    await chooseIoAction(page, "#import-menu", "#open-temporary-clipboard-action");
    await page.locator("#fragment-library-dialog").waitFor({ state: "visible" });
    const clipboardCard = page.locator('.fragment-card[data-fragment-id^="clipboard-"]').first();
    await clipboardCard.waitFor();
    assert((await page.locator("#fragment-storage-status").textContent())?.includes("临时片段剪贴板"), "The clipboard manager did not open in temporary mode.");
    assert(await page.locator('#fragment-save-target option[value="clipboard"]').count() === 0, "The explicit IndexedDB save target is still present.");
    assert(await page.locator("#fragment-import").isHidden() && await page.locator("#fragment-library-save-selection").isHidden(), "Temporary clipboard mode still exposes explicit write controls.");
    const libraryPreview = clipboardCard.locator(".fragment-preview img");
    await libraryPreview.evaluate((image) => image.decode());
    const libraryPreviewState = await libraryPreview.evaluate((image) => ({
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      width: image.getBoundingClientRect().width,
      height: image.getBoundingClientRect().height,
      opacity: getComputedStyle(image).opacity,
    }));
    assert(libraryPreviewState.naturalWidth > 0 && libraryPreviewState.naturalHeight > 0 && libraryPreviewState.height >= 20 && libraryPreviewState.opacity === "1", `Fragment clipboard preview is effectively empty: ${JSON.stringify(libraryPreviewState)}`);
    await page.locator("#fragment-library-close").click();

    await page.keyboard.press("Control+V");
    await page.waitForFunction(() => document.querySelector("#selection-status")?.textContent?.includes("clipboard-"));
    const firstPasteId = (await page.locator("#selection-status").textContent())?.split(/\s+/)[0];
    assert(firstPasteId, "First clipboard paste did not select the inserted fragment.");
    const firstPastePosition = await page.locator(`#canvas-host [data-editor-id="${firstPasteId}"]`).evaluate((element) => ({
      left: Number.parseFloat(element.style.left),
      top: Number.parseFloat(element.style.top),
    }));
    await page.keyboard.press("Control+V");
    await page.waitForFunction((firstId) => {
      const selection = document.querySelector("#selection-status")?.textContent?.split(/\s+/)[0];
      return Boolean(selection?.includes("clipboard-") && selection !== firstId);
    }, firstPasteId);
    const secondPasteId = (await page.locator("#selection-status").textContent())?.split(/\s+/)[0];
    assert(secondPasteId, "Second clipboard paste did not select the inserted fragment.");
    const secondPastePosition = await page.locator(`#canvas-host [data-editor-id="${secondPasteId}"]`).evaluate((element) => ({
      left: Number.parseFloat(element.style.left),
      top: Number.parseFloat(element.style.top),
    }));
    assert(Math.abs(secondPastePosition.left - firstPastePosition.left - 16) < 0.1 && Math.abs(secondPastePosition.top - firstPastePosition.top - 16) < 0.1, `Repeated paste did not advance by 16px: ${JSON.stringify({ firstPastePosition, secondPastePosition })}`);
    await page.locator("#undo").click();
    assert(await page.locator(`#canvas-host [data-editor-id="${secondPasteId}"]`).count() === 0, "Undo did not remove the latest clipboard paste.");
    await page.locator("#redo").click();
    assert(await page.locator(`#canvas-host [data-editor-id="${secondPasteId}"]`).count() === 1, "Redo did not restore the latest clipboard paste.");

    progress("checking local directory migration and Visual Fragment export metadata");
    await chooseIoAction(page, "#import-menu", "#open-temporary-clipboard-action");
    await page.locator("#fragment-connect-directory").click();
    await page.locator("#fragment-migrate-cache").click();
    assert((await page.locator("#fragment-storage-status").textContent())?.includes("本地目录"), "Fragment library did not switch to the user-owned directory source.");
    await page.waitForFunction(() => (globalThis.__fragmentDirectoryFiles?.size ?? 0) >= 1);
    assert(await page.evaluate(() => globalThis.__fragmentDirectoryFiles?.size ?? 0) >= 1, "Browser fragment migration did not create a .vfrag file in the selected directory.");
    await page.locator("#fragment-library-close").click();

    await page.locator('[data-layer-id="title-001"]').click();
    await chooseIoAction(page, "#export-menu", "#export-selection-action");
    await page.locator("#fragment-save-dialog").waitFor({ state: "visible" });
    assert((await page.locator("#fragment-save-target").inputValue()) === "directory", "A connected local directory was not the default selection export target.");
    assert((await page.locator("#fragment-save-submit").textContent()) === "保存到本地目录", "Selection export did not identify its durable destination.");
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

    await chooseIoAction(page, "#import-menu", "#open-local-library-action");
    await page.locator("#fragment-library-dialog").waitFor({ state: "visible" });
    const fragmentCard = page.locator('.fragment-card:has-text("Browser Title Component")').first();
    await fragmentCard.waitFor();
    const fragmentId = await fragmentCard.getAttribute("data-fragment-id");
    assert(fragmentId, "Saved Visual Fragment has no definition ID.");
    await page.locator("#fragment-view-clipboard").click();
    assert((await page.locator("#fragment-storage-status").textContent())?.includes("临时片段剪贴板"), "Connected users could not switch back to the temporary clipboard.");
    await clipboardCard.waitFor();
    await page.locator("#fragment-view-directory").click();
    assert((await page.locator("#fragment-storage-status").textContent())?.includes("本地目录"), "Connected users could not return to the durable local directory.");
    await fragmentCard.waitFor();

    const fragmentDownloadPromise = page.waitForEvent("download", { timeout: 8_000 }).catch(() => null);
    await openFragmentMore(fragmentCard);
    await fragmentCard.locator('[data-fragment-action="export"]').click();
    const fragmentDownload = await fragmentDownloadPromise;
    if (!fragmentDownload) throw new Error(`Migrated .vfrag export failed: ${await page.locator("#toast").textContent()}`);
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

    await page.locator("#fragment-library-close").click();
    await page.locator('[data-layer-id="accent-block-001"]').click();
    await chooseIoAction(page, "#import-menu", "#open-local-library-action");
    await openFragmentMore(fragmentCard);
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
    const insertedGeometry = await page.evaluate((rootId) => {
      const host = document.querySelector("#canvas-host");
      const root = host?.shadowRoot?.querySelector(`[data-editor-id="${rootId}"]`);
      const pageRoot = host?.shadowRoot?.querySelector('[data-editor-preview-page-root="active"]') ?? host?.shadowRoot?.querySelector("body");
      if (!host || !root || !pageRoot) return null;
      const hostBounds = host.getBoundingClientRect();
      const rootBounds = root.getBoundingClientRect();
      return {
        parentId: root.parentElement?.getAttribute("data-editor-id"),
        pageId: pageRoot.getAttribute("data-editor-id"),
        inside: rootBounds.left >= hostBounds.left - 1 && rootBounds.top >= hostBounds.top - 1 && rootBounds.right <= hostBounds.right + 1 && rootBounds.bottom <= hostBounds.bottom + 1,
      };
    }, componentRootId);
    assert(insertedGeometry?.parentId === insertedGeometry?.pageId && insertedGeometry?.inside, `Fragment was not inserted into the active editable slice: ${JSON.stringify(insertedGeometry)}`);
    const fragmentDragArea = page.locator(".moveable-area");
    await fragmentDragArea.waitFor({ state: "visible" });
    const fragmentDragBox = await fragmentDragArea.boundingBox();
    assert(fragmentDragBox && fragmentDragBox.width > 5 && fragmentDragBox.height > 5, `Inserted fragment has no usable drag surface: ${JSON.stringify(fragmentDragBox)}`);
    await page.mouse.move(fragmentDragBox.x + fragmentDragBox.width / 2, fragmentDragBox.y + fragmentDragBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(fragmentDragBox.x + fragmentDragBox.width / 2 + 30, fragmentDragBox.y + fragmentDragBox.height / 2 + 18, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction((rootId) => {
      const root = document.querySelector("#canvas-host")?.shadowRoot?.querySelector(`[data-editor-id="${rootId}"]`);
      return Math.abs(Number(root?.getAttribute("data-editor-translate-x") ?? 0)) > 1;
    }, componentRootId);
    assert(await page.locator("#fragment-instance-inspector").count() === 0, "Component instance inspector should not be rendered.");

    await chooseIoAction(page, "#import-menu", "#open-local-library-action");
    const originalCard = page.locator(`.fragment-card[data-fragment-id="${fragmentId}"][data-fragment-version="1.0.0"]`);
    await openFragmentMore(originalCard);
    await originalCard.locator('[data-fragment-action="update"]').click();
    await page.locator("#fragment-save-dialog").waitFor({ state: "visible" });
    assert((await page.locator("#fragment-version").inputValue()) === "1.0.1", "Updating a definition did not advance the patch version.");
    await page.locator("#fragment-save-submit").click();
    await page.locator("#fragment-save-dialog").waitFor({ state: "hidden" });
    const updatedCard = page.locator(`.fragment-card[data-fragment-id="${fragmentId}"][data-fragment-version="1.0.1"]`);
    await updatedCard.waitFor();
    await openFragmentMore(updatedCard);
    await updatedCard.locator('[data-fragment-action="sync"]').click();
    await page.locator("#fragment-library-close").click();
    await page.waitForFunction((definitionId) => {
      const host = document.querySelector("#canvas-host");
      const root = Array.from(host?.shadowRoot?.querySelectorAll("[data-vfrag-definition-id]") ?? [])
        .find((element) => element.getAttribute("data-vfrag-definition-id") === definitionId);
      return root?.getAttribute("data-vfrag-definition-version") === "1.0.1";
    }, fragmentId);
    assert(await page.locator("#fragment-instance-inspector").count() === 0, "Component instance inspector reappeared after definition sync.");

    progress("checking direct SVG insertion and directory-backed PNG/JPEG imports");
    const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><g id="raw-layer"><rect width="40" height="20" fill="#315efb"/><text x="4" y="50">Raw SVG</text></g></svg>');
    const selectionBeforeRawSvg = await page.locator("#selection-status").textContent();
    const rawSvgChooserPromise = page.waitForEvent("filechooser");
    await chooseIoAction(page, "#import-menu", "#insert-fragment-action");
    const rawSvgChooser = await rawSvgChooserPromise;
    await rawSvgChooser.setFiles({ name: "raw-mark.svg", mimeType: "image/svg+xml", buffer: svgBytes });
    await page.locator("#fragment-report-dialog").waitFor({ state: "visible" });
    await page.locator("#fragment-report-confirm").click();
    await page.locator("#fragment-report-dialog").waitFor({ state: "hidden" });
    await page.waitForFunction((previous) => document.querySelector("#selection-status")?.textContent !== previous, selectionBeforeRawSvg);
    const rawSvgRootId = (await page.locator("#selection-status").textContent())?.split(/\s+/)[0];
    const rawSvgId = rawSvgRootId
      ? await page.locator(`#canvas-host [data-editor-id="${rawSvgRootId}"]`).getAttribute("data-vfrag-definition-id")
      : null;
    assert(rawSvgId?.startsWith("raw-mark-"), `Top-level SVG import did not insert directly into the current page: ${rawSvgId}`);

    await chooseIoAction(page, "#import-menu", "#open-local-library-action");

    const rasterData = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 3;
      canvas.height = 2;
      const context = canvas.getContext("2d");
      context.fillStyle = "#315efb";
      context.fillRect(0, 0, 3, 2);
      return {
        png: canvas.toDataURL("image/png").split(",")[1],
        jpg: canvas.toDataURL("image/jpeg", 0.9).split(",")[1],
      };
    });
    const pngChooserPromise = page.waitForEvent("filechooser");
    await page.locator("#fragment-import").click();
    const pngChooser = await pngChooserPromise;
    await pngChooser.setFiles({ name: "pixel.png", mimeType: "image/png", buffer: Buffer.from(rasterData.png, "base64") });
    const pngCard = page.locator('.fragment-card:has-text("pixel")').first();
    await pngCard.waitFor();
    const jpgChooserPromise = page.waitForEvent("filechooser");
    await page.locator("#fragment-import").click();
    const jpgChooser = await jpgChooserPromise;
    await jpgChooser.setFiles({ name: "photo.jpeg", mimeType: "image/jpeg", buffer: Buffer.from(rasterData.jpg, "base64") });
    const jpgCard = page.locator('.fragment-card:has-text("photo")').first();
    await jpgCard.waitFor();
    assert((await pngCard.textContent())?.includes("Raster") && (await jpgCard.textContent())?.includes("Raster"), "PNG/JPEG imports were not classified as Raster fragments.");

    const pngId = await pngCard.getAttribute("data-fragment-id");
    const jpgId = await jpgCard.getAttribute("data-fragment-id");
    for (const card of [pngCard, jpgCard]) {
      await card.locator('[data-fragment-action="insert-copy"]').click();
      await page.locator("#fragment-report-dialog").waitFor({ state: "visible" });
      await page.locator("#fragment-report-confirm").click();
      await page.locator("#fragment-report-dialog").waitFor({ state: "hidden" });
    }
    await page.locator("#fragment-library-close").click();
    const rawImportState = await page.evaluate(({ rawSvgId, pngId, jpgId }) => {
      const shadow = document.querySelector("#canvas-host")?.shadowRoot;
      const find = (id) => Array.from(shadow?.querySelectorAll("[data-vfrag-definition-id]") ?? []).find((node) => node.getAttribute("data-vfrag-definition-id") === id);
      const svg = find(rawSvgId);
      const png = find(pngId);
      const jpg = find(jpgId);
      return {
        svgKeepsTree: Boolean(svg?.querySelector("g rect") && svg.querySelector("g text")),
        png: png ? { tag: png.localName, children: png.children.length, src: png.getAttribute("src") } : null,
        jpg: jpg ? { tag: jpg.localName, children: jpg.children.length, src: jpg.getAttribute("src") } : null,
      };
    }, { rawSvgId, pngId, jpgId });
    assert(rawImportState.svgKeepsTree, "Raw SVG insertion flattened or lost its editable child tree.");
    assert(rawImportState.png?.tag === "img" && rawImportState.png.children === 0 && rawImportState.png.src?.startsWith("blob:"), `PNG was not inserted as one image layer with a local preview resource: ${JSON.stringify(rawImportState.png)}`);
    assert(rawImportState.jpg?.tag === "img" && rawImportState.jpg.children === 0 && rawImportState.jpg.src?.startsWith("blob:"), `JPEG was not inserted as one image layer with a local preview resource: ${JSON.stringify(rawImportState.jpg)}`);

    progress("checking SVG selection and polygon scaling");
    await loadExample(page, "svg");
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.startsWith("SVG"));
    assert((await page.locator("#export-document-label").textContent()) === "导出 SVG", "The export menu did not update for the active SVG document type.");
    assert(await page.locator('[data-layer-id="svg-title"]').count() === 1, "SVG layer tree did not load.");
    await page.locator('[data-layer-id="svg-title"]').click();
    assert((await shadowText(page, "svg-title")) === "Editable SVG energy curve", "SVG selection did not map to the native SVG node.");
    await page.locator('[data-prop="strokeWidth"]').fill("4");
    await page.locator('[data-prop="strokeWidth"]').press("Tab");
    await page.waitForFunction(() => document.querySelector("#canvas-host")?.shadowRoot?.querySelector('[data-editor-id="svg-title"]')?.getAttribute("stroke-width") === "4");

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
    await exportDocument(page);
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
    await loadExample(page, "deck");
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
    await loadExample(page, "deck");
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
    await exportDocument(page);
    const slidesDownload = await slidesDownloadPromise;
    const slidesDownloadPath = await slidesDownload.path();
    assert(slidesDownloadPath, "Interactive HTML export did not produce a local download path.");
    const exportedSlides = await readFile(slidesDownloadPath, "utf8");
    assert(!exportedSlides.includes('id="lms-controls"'), "Interactive export incorrectly replaced the native document with the LMS player shell.");
    assert(exportedSlides.includes("demo-page-2-copy"), "Interactive HTML export lost the duplicated page order.");

    const exportedHtmlPath = "/tmp/last-mile-studio-smoke-export.html";
    await copyFile(slidesDownloadPath, exportedHtmlPath);
    await page.locator("#file-input").setInputFiles(exportedHtmlPath);
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.includes("page 1/4"));
    assert((await page.locator(".page-thumbnail").count()) === 4, "Re-importing exported HTML did not restore all four editable pages.");
    assert(await page.locator("#canvas-host").evaluate((host) => !host.shadowRoot?.querySelector("#lms-stage")), "Re-importing exported HTML exposed the player shell instead of the canonical document.");
    await page.locator("#duplicate-page").click();
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.includes("page 2/5"));
    const secondRoundDownloadPromise = page.waitForEvent("download");
    await exportDocument(page);
    const secondRoundDownload = await secondRoundDownloadPromise;
    const secondRoundPath = await secondRoundDownload.path();
    assert(secondRoundPath, "Editing and re-exporting a re-imported HTML file did not produce a download.");
    const secondRoundHtml = await readFile(secondRoundPath, "utf8");
    assert(!secondRoundHtml.includes('id="lms-stage"'), "A second export nested the presentation player into canonical source.");
    await page.locator("#file-input").setInputFiles(secondRoundPath);
    await page.waitForFunction(() => document.querySelector("#document-status")?.textContent?.includes("page 1/5"));
    assert((await page.locator(".page-thumbnail").count()) === 5, "The second import did not preserve an edit made after the first round trip.");

    progress("checking document-root to group multiselection controls");
    if (await page.locator(".studio-shell").evaluate((element) => element.classList.contains("is-code-collapsed"))) {
      await page.locator("#toggle-code").click();
      await page.waitForFunction(() => !document.querySelector(".studio-shell")?.classList.contains("is-code-collapsed"));
    }
    await page.locator(".cm-content").fill('<!doctype html><html><body><div style="width: 160px; height: 80px;">Minimal</div></body></html>');
    await page.locator("#apply-code").click();
    await page.locator('[data-layer-id="document-root"]').waitFor();
    await page.locator('[data-layer-id="div-001"]').waitFor();
    await page.locator('[data-layer-id="document-root"]').click();
    await page.waitForTimeout(100);
    const singleControlBoxCounts = [await page.locator(".moveable-control-box:visible").count()];
    const multiselectErrorStart = errors.length;
    await page.locator('[data-layer-id="div-001"]').click({ modifiers: ["Control"] });
    await page.waitForTimeout(100);
    const groupControlBoxCounts = [await page.locator(".moveable-control-box:visible").count()];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.locator('[data-layer-id="div-001"]').click({ modifiers: ["Control"] });
      await page.waitForFunction(() => document.querySelector("#selection-status")?.textContent?.startsWith("document-root"));
      await page.waitForTimeout(100);
      singleControlBoxCounts.push(await page.locator(".moveable-control-box:visible").count());
      await page.locator('[data-layer-id="div-001"]').click({ modifiers: ["Control"] });
      await page.waitForFunction(() => document.querySelector("#selection-status")?.textContent === "2 elements selected");
      await page.waitForTimeout(100);
      groupControlBoxCounts.push(await page.locator(".moveable-control-box:visible").count());
    }
    const multiselectErrors = errors.slice(multiselectErrorStart);
    const selectedStatus = await page.locator("#selection-status").textContent();
    const groupDragAreaBox = await page.locator(".moveable-area:visible").boundingBox();
    assert(
      multiselectErrors.length === 0 && selectedStatus === "2 elements selected" &&
        groupControlBoxCounts[0] > 0 && groupControlBoxCounts.every((count) => count === groupControlBoxCounts[0]) &&
        singleControlBoxCounts[0] > 0 && singleControlBoxCounts.every((count) => count === singleControlBoxCounts[0]) &&
        Boolean(groupDragAreaBox?.width && groupDragAreaBox.height),
      `Document-root multiselection did not produce stable group controls (status=${selectedStatus}, single control boxes=${singleControlBoxCounts.join(" -> ")}, group control boxes=${groupControlBoxCounts.join(" -> ")}, drag area=${groupDragAreaBox ? `${groupDragAreaBox.width}x${groupDragAreaBox.height}` : "missing"}, errors=${multiselectErrors.join(" | ") || "none"}).`,
    );

    assert(errors.length === 0, `Browser runtime errors:\n${errors.join("\n")}`);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      htmlSelection: true,
      moveableDragToCode: true,
      moveableResizeToCode: true,
      inspectorToCanvas: true,
      canvasToCode: true,
      undo: true,
      layerCanvasReverseReveal: true,
      layerCollapseAndAutoExpand: true,
      layerInlineRename: true,
      layerOneLevelDrag: true,
      layerVisualPositionPreserved: true,
      layerCrossBranchRejected: true,
      svgSelection: true,
      inlineTextEditing: true,
      inlineTextKeyboardIsolation: true,
      inlineTextApplyCancel: true,
      fontCatalogAndFallbackStatus: true,
      numericLetterSpacing: true,
      visibleHtmlAndSvgStrokeWidth: true,
      visualShadowControls: true,
      inspectorChildNavigation: true,
      polygonScaling: true,
      staticDeckPages: 4,
      pageThumbnails: true,
      thumbnailCenterNavigation: true,
      pageDuplicateDeleteSort: true,
      presentationPreview: true,
      interactiveHtmlExport: true,
      canvasPresets: true,
      codeCollapseReclaimsCanvas: true,
      adjustableWorkspacePanels: true,
      panelCollapseReclaimsCanvas: true,
      persistentLayoutPreferences: true,
      consolidatedImportExportMenus: true,
      clipboardKeyboardPasteOffset: true,
      visualFragmentPackage: true,
      visualFragmentLibraryPreview: true,
      visualFragmentActiveSlicePlacement: true,
      visualFragmentRootDrag: true,
      visualFragmentPreviewPng: true,
      visualFragmentCompatibilityReport: true,
      visualFragmentLinkedInstance: true,
      visualFragmentInstanceInspectorHidden: true,
      visualFragmentDefinitionSync: true,
      visualFragmentLocalFirstUi: true,
      visualFragmentTemporaryClipboard: true,
      visualFragmentLocalDirectory: true,
      visualFragmentRawSvgImport: true,
      visualFragmentPngImport: true,
      visualFragmentJpegImport: true,
      buildStateEditing: true,
      buildAllAndGroupViews: true,
      buildOrchestration: true,
      buildUndoRedoContext: true,
      buildFirstPreviewAndExport: true,
      documentRootGroupMultiselection: true,
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
