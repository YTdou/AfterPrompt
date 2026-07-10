import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import slideSource from "../examples/ai-slide.html?raw";
import svgSource from "../examples/shapes.svg?raw";
import { SourceDocument } from "../src/core/document-model";
import { getTransformValues } from "../src/core/commands";

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

describe("SourceDocument", () => {
  it("sanitizes executable HTML and assigns deterministic stable IDs", () => {
    const source = `<!doctype html><html><head><style>@import "https://bad.example/x.css"; .x{color:red}</style></head>
      <body data-editor-canvas-width="900" data-editor-canvas-height="500" onload="steal()">
        <!-- keep this comment -->
        <script>steal()</script>
        <h1 id="title" onclick="steal()">Hello</h1>
        <a href="javascript:steal()">bad link</a>
        <svg><foreignObject><div>unsafe embedded HTML</div></foreignObject></svg>
      </body></html>`;
    const model = SourceDocument.parse(source, "unsafe.html");

    expect(model.document.querySelector("script")).toBeNull();
    expect(model.document.body.hasAttribute("onload")).toBe(false);
    expect(model.document.querySelector("h1")?.hasAttribute("onclick")).toBe(false);
    expect(model.document.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(model.document.querySelector("foreignObject")).toBeNull();
    expect(model.document.querySelector("h1")?.getAttribute("data-editor-id")).toBe("title");
    expect(model.document.querySelector("a")?.getAttribute("data-editor-id")).toBe("a-001");
    expect(model.canvas).toEqual({ width: 900, height: 500 });
    expect(model.serialize()).toContain("keep this comment");
    expect(model.warnings.join(" ")).toContain("已移除");
  });

  it("applies local HTML commands by stable element ID", () => {
    const model = SourceDocument.parse(slideSource, "ai-slide.html");
    model.apply({ action: "replaceText", elementId: "title-001", text: "Energy-Aware Serving" });
    model.apply({ action: "moveElementBy", elementId: "hero-image-001", dx: 100, dy: 5 });
    model.apply({ action: "updateElement", elementId: "accent-block-001", changes: { backgroundColor: "#244a86", borderRadius: 30 } });
    model.apply({ action: "deleteElement", elementId: "icon-001" });

    expect(model.find("title-001")?.textContent).toBe("Energy-Aware Serving");
    expect(getTransformValues(model.find("hero-image-001")!).x).toBe(100);
    expect(getTransformValues(model.find("hero-image-001")!).y).toBe(5);
    expect((model.find("accent-block-001") as HTMLElement).style.backgroundColor).toBe("rgb(36, 74, 134)");
    expect(model.find("icon-001")).toBeNull();
    expect(model.serialize()).toContain("data-editor-id=\"title-001\"");
  });

  it("enforces the same lock boundary for structured commands", () => {
    const model = SourceDocument.parse(slideSource, "ai-slide.html");
    model.apply({ action: "setLocked", elementId: "title-001", locked: true });
    expect(() => model.apply({ action: "replaceText", elementId: "title-001", text: "Blocked" })).toThrow(/locked/i);
    model.apply({ action: "setLocked", elementId: "title-001", locked: false });
    model.apply({ action: "replaceText", elementId: "title-001", text: "Allowed" });
    expect(model.find("title-001")?.textContent).toBe("Allowed");
  });

  it("edits and serializes native SVG nodes", () => {
    const model = SourceDocument.parse(svgSource, "shapes.svg");
    model.apply({ action: "replaceText", elementId: "svg-title", text: "A revised curve" });
    model.apply({ action: "moveElementBy", elementId: "curve-point", dx: 20, dy: -10 });
    model.apply({ action: "updateElement", elementId: "card-rect", changes: { fill: "#fef3df", width: 760 } });
    model.apply({ action: "reorderElement", elementId: "curve-point", direction: "front" });

    expect(model.kind).toBe("svg");
    expect(model.find("svg-title")?.textContent).toBe("A revised curve");
    expect(model.find("curve-point")?.getAttribute("transform")).toContain("translate(20 -10)");
    expect(model.find("card-rect")?.getAttribute("width")).toBe("760");
    expect(model.find("card-rect")?.getAttribute("fill")).toBe("#fef3df");
    expect(model.serialize()).toContain("<?xml version=\"1.0\"");
  });

  it("adds an element and exposes an AI-readable structure summary", () => {
    const model = SourceDocument.parse(slideSource, "ai-slide.html");
    const result = model.apply({
      action: "addElement",
      parentId: "slide-001",
      element: { type: "text", id: "annotation-001", text: "New annotation", x: 120, y: 650 },
    });
    const summary = model.summary();

    expect(result.createdId).toBe("annotation-001");
    expect(summary.documentType).toBe("html-slide");
    expect(summary.elements.find((element) => element.id === "annotation-001")).toMatchObject({
      type: "text",
      text: "New annotation",
      parentId: "slide-001",
    });
  });

  it("keeps the last valid document when a caller rejects malformed SVG", () => {
    const valid = SourceDocument.parse(svgSource, "shapes.svg");
    expect(() => SourceDocument.parse("<svg><g></svg>", "broken.svg")).toThrow(/could not be parsed/i);
    expect(valid.find("svg-title")).not.toBeNull();
  });
});
