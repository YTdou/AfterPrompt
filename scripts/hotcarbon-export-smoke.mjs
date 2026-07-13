import { readFile, writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

function assert(condition, message) { if (!condition) throw new Error(message); }

const exportedPath = "/tmp/last-mile-studio-hotcarbon-interactive.html";

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
  const source = await readFile("problem/HotCarbon_Oral_Slides_SelfContained.html", "utf8");
  const model = SourceDocument.parse(source, "HotCarbon_Oral_Slides_SelfContained.html");
  model.apply({ action: "replaceText", elementId: "hudcount", text: "export-check" });
  const result = buildInteractiveHtml(model, new ProjectAssets(), "problem/HotCarbon_Oral_Slides_SelfContained.html");
  assert(result.html.includes('aria-label="Presentation controls"'), "Native Presentation controls were removed.");
  assert(result.html.includes("function toggleNotes()"), "Native controls runtime was removed.");
  assert(result.html.includes(">export-check</div>"), "An editor-model change did not reach the interactive export.");
  assert(!result.html.includes('id="lms-controls"'), "The native runtime was replaced by the LMS player shell.");

  await writeFile(exportedPath, result.html);
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
      window.HTMLElement.prototype.requestFullscreen = async function requestFullscreen() {};
      window.document.exitFullscreen = async () => {};
    },
  });
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
  document.querySelector("#notesBtn").click();
  runtime.window.dispatchEvent(new runtime.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert(document.querySelector('[data-build="1"]').classList.contains("revealed"), "Keyboard Build navigation is not functional.");
  runtime.window.close();
  process.stdout.write(`${JSON.stringify({ ok: true, nativeControls: true, help: true, notes: true, fullscreen: true, keyboardBuild: true })}\n`);
}

const action = process.argv[2];
const task = action === "generate" ? generate() : action === "verify" ? verify() : Promise.reject(new Error("Expected generate or verify."));
task.catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
