import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import deckSource from "../examples/multi-page-deck.html?raw";
import { SourceDocument } from "../src/core/document-model";
import { buildInteractiveHtml, buildStandaloneSlides, preparePresentationSource } from "../src/core/presentation";
import { decodeEditableHtml } from "../src/core/editable-html";
import { ProjectAssets } from "../src/core/project";
import { enableDeterministicTypography } from "../src/core/typography";

beforeAll(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, {
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
  });
});

describe("standalone HTML Slides", () => {
  it("exports the edited canonical HTML with its native runtime intact", () => {
    const source = `<!doctype html><html><head><script>window.nativeControls = true</script></head><body>
      <button id="notesBtn" onclick="toggleNotes()">Notes</button><h1 id="title">Original</h1>
      <script>function toggleNotes(){ document.body.classList.toggle("notes") }</script></body></html>`;
    const model = SourceDocument.parse(source, "interactive.html");
    model.apply({ action: "replaceText", elementId: "title", text: "Edited" });

    const result = buildInteractiveHtml(model, new ProjectAssets(), "interactive.html");

    expect(result.html).toContain("window.nativeControls = true");
    expect(result.html).toContain("function toggleNotes()");
    expect(result.html).toContain('onclick="toggleNotes()"');
    expect(result.html).toContain(">Edited</h1>");
    expect(result.html).not.toContain('id="lms-controls"');
  });

  it("bridges data-build elements into a native revealed-based player without mutating canonical HTML", () => {
    const source = `<!doctype html><html><head><style>
      .build { opacity: 0 } .build.revealed { opacity: 1 }
    </style></head><body>
      <section data-editor-id="page">
        <div class="build" data-build="1" data-editor-id="legacy">Legacy</div>
        <div data-build="2" data-editor-id="edited">Edited build</div>
      </section>
      <script>
        document.querySelectorAll('[data-build]').forEach((element) => {
          element.classList.toggle('revealed', Number(element.dataset.build) <= 1);
        });
      </script>
    </body></html>`;
    const model = SourceDocument.parse(source, "native-builds.html");
    const canonicalBefore = model.serialize();

    const result = buildInteractiveHtml(model, new ProjectAssets(), "native-builds.html");
    const output = new JSDOM(result.html).window.document;
    const compatibilityStyle = output.querySelector<HTMLStyleElement>("#lms-native-build-compat");

    expect(compatibilityStyle?.textContent).toContain("[data-build]:not(.build):not(.revealed)");
    expect(output.querySelector("[data-editor-id='edited']")?.classList.contains("build")).toBe(false);
    expect(model.serialize()).toBe(canonicalBefore);
  });

  it("does not inject revealed compatibility into decks with an unrelated Build runtime", () => {
    const source = `<!doctype html><html><body>
      <section data-editor-id="page"><div data-build="1">Build</div></section>
      <script>document.body.dataset.ready = 'true'</script>
    </body></html>`;
    const model = SourceDocument.parse(source, "custom-builds.html");
    const result = buildInteractiveHtml(model, new ProjectAssets(), "custom-builds.html");

    expect(new JSDOM(result.html).window.document.querySelector("#lms-native-build-compat")).toBeNull();
  });

  it("embeds the deterministic presentation font in interactive export", () => {
    const model = SourceDocument.parse('<!doctype html><html><head></head><body><h1 data-editor-id="title">Stable typography</h1></body></html>', "font.html");
    enableDeterministicTypography(model.document);
    const result = buildInteractiveHtml(model, new ProjectAssets(), "font.html");
    expect(result.html).toContain('data-lms-deterministic-font="inter"');
    expect(result.html).toContain('font-family: "LMS Inter"');
    expect(result.html).toContain("data:font/woff2;base64,");
  });

  it("embeds local assets without changing the canonical document", () => {
    const model = SourceDocument.parse(deckSource, "multi-page-deck.html");
    const canonicalBefore = model.serialize();
    const assets = new ProjectAssets([{
      path: "examples/assets/energy-illustration.svg",
      mimeType: "image/svg+xml",
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>'),
    }]);

    const prepared = preparePresentationSource(model, assets, "examples/multi-page-deck.html");

    expect(prepared.pageIds).toEqual(["demo-page-1", "demo-page-2", "demo-page-3"]);
    expect(prepared.buildSteps).toEqual([[1, 2], [1, 2], [1]]);
    expect(prepared.source).toContain("data:image/svg+xml;base64,");
    expect(prepared.source).not.toContain("customElements.define");
    expect(model.serialize()).toBe(canonicalBefore);
  });

  it("builds one playable HTML file with a scriptless inner sandbox", () => {
    const model = SourceDocument.parse(deckSource, "multi-page-deck.html");
    const result = buildStandaloneSlides(model, new ProjectAssets(), "examples/multi-page-deck.html");
    const output = new JSDOM(result.html).window.document;

    expect(result.pageCount).toBe(3);
    expect(output.querySelector("meta[name='generator']")?.getAttribute("content")).toBe("AfterPrompt 0.4.0");
    expect(output.querySelector("#lms-slides")?.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(output.querySelector("#lms-controls")).not.toBeNull();
    expect(output.querySelector("meta[name='lms-format']")?.getAttribute("content")).toBe("editable-html-presentation");
    expect(output.querySelector<HTMLTemplateElement>("template#lms-document-payload")?.content.textContent).toBeTruthy();
    expect(output.querySelector("script")?.textContent).toContain("demo-page-3");
    expect(output.querySelector("script")?.textContent).toContain("frame.srcdoc = decodeSource()");
    expect(output.querySelector("script")?.textContent).toContain("const forward = () =>");
    expect(output.querySelector("script")?.textContent).toContain("data-lms-build-visible");
    expect(output.querySelector("script")?.textContent).toContain("const initialPageIndex = 0");
  });

  it("can initialize presentation playback from the currently edited page", () => {
    const model = SourceDocument.parse(deckSource, "multi-page-deck.html");
    const result = buildStandaloneSlides(model, new ProjectAssets(), "examples/multi-page-deck.html", { initialPageIndex: 1 });
    expect(new JSDOM(result.html).window.document.querySelector("script")?.textContent).toContain("const initialPageIndex = 1");
  });

  it("inlines a local stylesheet and resolves its assets relative to the CSS file", () => {
    const model = SourceDocument.parse(`<!doctype html><html><head><link rel="stylesheet" href="styles/deck.css"></head><body>
      <deck-stage><section data-editor-id="page-one"><div class="hero">Hello</div></section></deck-stage>
    </body></html>`, "index.html");
    const assets = new ProjectAssets([
      {
        path: "examples/styles/deck.css",
        mimeType: "text/css",
        bytes: new TextEncoder().encode('.hero { background-image: url("../assets/background.svg"); }'),
      },
      {
        path: "examples/assets/background.svg",
        mimeType: "image/svg+xml",
        bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" />'),
      },
    ]);

    const prepared = preparePresentationSource(model, assets, "examples/index.html");

    expect(prepared.source).not.toContain('rel="stylesheet"');
    expect(prepared.source).toContain('data-lms-embedded-from="examples/styles/deck.css"');
    expect(prepared.source).toContain("data:image/svg+xml;base64,");
    expect(prepared.warnings.some((warning) => warning.includes("未能内嵌"))).toBe(false);
  });

  it("keeps Build-first playback metadata for a one-page HTML document", () => {
    const model = SourceDocument.parse(`<!doctype html><html><body><h1>Title</h1><p data-build="4">Later</p></body></html>`, "single.html");
    const prepared = preparePresentationSource(model, new ProjectAssets(), "single.html");
    const result = buildStandaloneSlides(model, new ProjectAssets(), "single.html");
    expect(prepared.pageIds).toEqual([]);
    expect(prepared.buildSteps).toEqual([[4]]);
    expect(result.html).toContain("[[4]]");
  });

  it("round-trips playable HTML back into the editable document", () => {
    const original = SourceDocument.parse(deckSource, "multi-page-deck.html");
    const exported = buildStandaloneSlides(original, new ProjectAssets(), "examples/multi-page-deck.html");
    const decoded = decodeEditableHtml(exported.html, "multi-page-deck.html");
    const restored = SourceDocument.parse(exported.html, "multi-page-deck.html");

    expect(decoded?.legacy).toBe(false);
    expect(decoded?.payload.checksum).toMatch(/^fnv1a32:/);
    expect(restored.sourceName).toBe("multi-page-deck.html");
    expect(restored.canvas).toEqual(original.canvas);
    expect(restored.pages().map(({ id }) => id)).toEqual(original.pages().map(({ id }) => id));
    expect(restored.pages().map(({ index }) => restored.buildSequence(index).steps))
      .toEqual(original.pages().map(({ index }) => original.buildSequence(index).steps));
    expect(restored.document.querySelector("#lms-stage")).toBeNull();
  });

  it("upgrades a legacy 0.3.0 Slides wrapper instead of importing its player shell", () => {
    const inner = '<!doctype html><html><body><div class="slides"><section data-editor-id="one">One</section><section data-editor-id="two">Two</section></div></body></html>';
    const encoded = Buffer.from(inner, "utf8").toString("base64");
    const legacy = `<!doctype html><html><head><meta name="generator" content="Last Mile Studio 0.3.0"></head><body><iframe id="lms-slides"></iframe><script>const sourceBase64 = ${JSON.stringify(encoded)}; const canvas = {"width":1920,"height":1080}; frame.srcdoc = decodeSource();</script></body></html>`;
    const restored = SourceDocument.parse(legacy, "old-slides.html");

    expect(restored.pages()).toHaveLength(2);
    expect(restored.canvas).toEqual({ width: 1920, height: 1080 });
    expect(restored.warnings.some((warning) => warning.includes("旧版"))).toBe(true);
  });
});
