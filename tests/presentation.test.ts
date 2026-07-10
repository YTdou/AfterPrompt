import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import deckSource from "../examples/multi-page-deck.html?raw";
import { SourceDocument } from "../src/core/document-model";
import { buildStandaloneSlides, preparePresentationSource } from "../src/core/presentation";
import { ProjectAssets } from "../src/core/project";

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
    expect(prepared.source).toContain("data:image/svg+xml;base64,");
    expect(prepared.source).not.toContain("customElements.define");
    expect(model.serialize()).toBe(canonicalBefore);
  });

  it("builds one playable HTML file with a scriptless inner sandbox", () => {
    const model = SourceDocument.parse(deckSource, "multi-page-deck.html");
    const result = buildStandaloneSlides(model, new ProjectAssets(), "examples/multi-page-deck.html");
    const output = new JSDOM(result.html).window.document;

    expect(result.pageCount).toBe(3);
    expect(output.querySelector("meta[name='generator']")?.getAttribute("content")).toBe("Last Mile Studio 0.2.0");
    expect(output.querySelector("#lms-slides")?.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(output.querySelector("#lms-controls")).not.toBeNull();
    expect(output.querySelector("script")?.textContent).toContain("demo-page-3");
    expect(output.querySelector("script")?.textContent).toContain("frame.srcdoc = decodeSource()");
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
});
