import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function assert(condition, message) { if (!condition) throw new Error(message); }

const fixturePath = "tests/fixtures/presentation-runtime.html";
const exportedPath = join(tmpdir(), "afterprompt-presentation-export-smoke.html");

async function generate() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, {
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
  });
  const [{ SourceDocument }, { buildInteractiveHtml }, { ProjectAssets }] = await Promise.all([
    import("../src/core/document-model.ts"),
    import("../src/core/presentation.ts"),
    import("../src/core/project.ts"),
  ]);
  const source = await readFile(fixturePath, "utf8");
  const model = SourceDocument.parse(source, fixturePath);
  model.apply({ action: "replaceText", elementId: "runtime-counter", text: "export-check" });
  const result = buildInteractiveHtml(model, new ProjectAssets(), fixturePath);
  assert(result.html.includes('aria-label="Presentation controls"'), "Native presentation controls were removed.");
  assert(result.html.includes("function toggleNotes()"), "Native controls runtime was removed.");
  assert(result.html.includes(">export-check</p>"), "An editor-model change did not reach the interactive export.");
  assert(!result.html.includes('id="lms-controls"'), "The native runtime was replaced by the compatibility player.");

  await writeFile(exportedPath, result.html);
  dom.window.close();
  process.stdout.write(`${JSON.stringify({ generated: true, editedSource: true, nativeControls: true })}\n`);
}

async function verify() {
  const html = await readFile(exportedPath, "utf8");
  const runtime = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      window.HTMLElement.prototype.requestFullscreen = async function requestFullscreen() {
        window.__fullscreenToggleCount = (window.__fullscreenToggleCount ?? 0) + 1;
      };
      window.document.exitFullscreen = async () => {};
    },
  });
  try {
    await new Promise((resolve) => runtime.window.setTimeout(resolve, 20));
    const { document } = runtime.window;
    assert(document.querySelector('#deckHud[aria-label="Presentation controls"]'), "Native controls DOM is missing at runtime.");
    document.querySelector("#helpBtn").click();
    assert(document.querySelector("#helpPanel").classList.contains("open"), "Help control is not functional.");
    document.querySelector("#helpBtn").click();
    document.querySelector("#notesBtn").click();
    assert(document.querySelector("#notesPanel").classList.contains("open"), "Notes control is not functional.");
    document.querySelector("#fsBtn").click();
    await new Promise((resolve) => runtime.window.setTimeout(resolve, 0));
    assert(runtime.window.__fullscreenToggleCount === 1, "Fullscreen control is not bound.");
    document.dispatchEvent(new runtime.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    assert(document.querySelector('[data-build="1"]').classList.contains("revealed"), "Keyboard Build navigation is not functional.");
  } finally {
    runtime.window.close();
    await unlink(exportedPath).catch(() => undefined);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, nativeControls: true, help: true, notes: true, fullscreen: true, keyboardBuild: true })}\n`);
}

const action = process.argv[2];
const task = action === "generate" ? generate() : action === "verify" ? verify() : Promise.reject(new Error("Expected generate or verify."));
task.catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
