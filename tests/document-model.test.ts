import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
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
  it("preserves executable HTML inertly and reports the safe-projection warnings", () => {
    const source = `<!doctype html><html><head><style>@import "https://bad.example/x.css"; .x{color:red}</style></head>
      <body data-editor-canvas-width="900" data-editor-canvas-height="500" onload="steal()">
        <!-- keep this comment -->
        <script>steal()</script>
        <h1 id="title" onclick="steal()">Hello</h1>
        <a href="javascript:steal()">bad link</a>
        <svg><foreignObject><div>unsafe embedded HTML</div></foreignObject></svg>
      </body></html>`;
    const model = SourceDocument.parse(source, "unsafe.html");

    expect(model.document.querySelector("script")?.textContent).toContain("steal()");
    expect(model.document.body.getAttribute("onload")).toBe("steal()");
    expect(model.document.querySelector("h1")?.getAttribute("onclick")).toBe("steal()");
    expect(model.document.querySelector("a")?.getAttribute("href")).toBe("javascript:steal()");
    expect(model.document.querySelector("foreignObject")).not.toBeNull();
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

  it("reserves authored IDs before filling earlier gaps and repairs explicit duplicates deterministically", () => {
    const model = SourceDocument.parse(`<!doctype html><html><body>
      <div class="generated-first"><span data-editor-id="span-001">First</span></div>
      <div data-editor-id="div-001">Authored owner</div>
      <div data-editor-id="div-001">Duplicate owner</div>
    </body></html>`, "stable-ids.html");
    const divs = Array.from(model.document.body.querySelectorAll(":scope > div"));
    const ids = divs.map((element) => element.getAttribute("data-editor-id"));

    expect(ids[0]).toBe("div-002");
    expect(ids[1]).toBe("div-001");
    expect(ids[2]).toBe("div-003");
    expect(new Set(Array.from(model.document.querySelectorAll("[data-editor-id]"), (element) => element.getAttribute("data-editor-id"))).size)
      .toBe(model.document.querySelectorAll("[data-editor-id]").length);
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

  it("recognizes a script-driven deck as static editable pages", () => {
    const source = `<!doctype html><html><head>
      <style>deck-stage:not(:defined){visibility:hidden}.slide{position:absolute;inset:0}</style>
      <script>customElements.define("deck-stage", class extends HTMLElement {})</script>
      </head><body><deck-stage width="1920" height="1080">
        <section data-label="Opening"><div class="slide"><h1>First</h1></div></section>
        <section data-label="Results"><div class="slide"><h1>Second</h1></div></section>
      </deck-stage></body></html>`;
    const model = SourceDocument.parse(source, "deck.html");

    expect(model.canvas).toEqual({ width: 1920, height: 1080 });
    expect(model.pages().map(({ label }) => label)).toEqual(["Opening", "Results"]);
    expect(model.document.querySelector("script")?.textContent).toContain("customElements.define");
    expect(model.treeForPage(1)[0]?.name).toBe("Results");
    expect(model.treeForPage(1)[0]?.children[0]?.children[0]?.text).toBe("Second");
    expect(model.warnings.join(" ")).toContain("2 页静态演示稿");
  });

  it("keeps author-excluded backup nodes in source without exposing black editor pages", () => {
    const source = `<!doctype html><html><body><deck-stage>
      <section data-editor-id="b1" data-label="B1">B1</section>
      <section data-editor-id="removed-backup" data-label="Removed" data-backup-remove="true">Removed source material</section>
      <section data-editor-id="b2" data-label="B2">B2</section>
    </deck-stage></body></html>`;
    const model = SourceDocument.parse(source, "excluded-backup.html");

    expect(model.pages().map(({ id }) => id)).toEqual(["b1", "b2"]);
    expect(model.pageElement(1)?.getAttribute("data-label")).toBe("B2");
    expect(model.find("removed-backup")?.textContent).toBe("Removed source material");
    expect(model.serialize()).toContain('data-backup-remove="true"');
  });

  it("exposes fragment descendants through structural wrappers and repairs legacy page-level Build state", () => {
    const model = SourceDocument.parse(`<!doctype html><html><head><style>
      .build { opacity: 0; filter: blur(3px); pointer-events: none; }
      .build.revealed { opacity: 1; filter: none; pointer-events: auto; }
    </style></head><body><deck-stage><section data-editor-id="page-one">
      <div data-vfrag-root="legacy-card" data-editor-id="legacy-card-instance">
        <div data-editor-structural="true" data-vfrag-coordinate-layer="">
          <div class="card build revealed" data-build="3" aria-hidden="false" data-editor-id="card-content">
            <b data-editor-id="card-title">Visible title</b>
          </div>
        </div>
      </div>
    </section></deck-stage></body></html>`, "legacy-fragment.html");

    const pageTree = model.treeForPage(0)[0]!;
    expect(pageTree.children[0]?.id).toBe("legacy-card-instance");
    expect(pageTree.children[0]?.children[0]?.id).toBe("card-content");
    expect(pageTree.children[0]?.children[0]?.children[0]?.id).toBe("card-title");
    expect(pageTree.children[0]?.children.some(({ id }) => id === "div-001")).toBe(false);

    const content = model.find("card-content") as HTMLElement;
    expect(content.hasAttribute("data-build")).toBe(false);
    expect(content.classList.contains("build")).toBe(false);
    expect(content.classList.contains("revealed")).toBe(false);
    expect(content.style.opacity).toBe("1");
    expect(content.style.filter).toBe("none");
    expect(model.buildSequence(0).elementCount).toBe(0);
    expect(model.warnings.join(" ")).toContain("旧片段");

    model.apply({ action: "splitBuildGroup", pageId: "page-one", elementIds: ["legacy-card-instance"], targetPosition: 0 });
    expect(model.buildSequence(0).groups.map(({ elementIds }) => elementIds)).toEqual([["legacy-card-instance"]]);
  });

  it("duplicates, deletes, and sorts presentation pages with fresh stable IDs", () => {
    const source = `<!doctype html><html><body><deck-stage width="1280" height="720">
      <section data-editor-id="page-one" data-label="One"><h1 data-editor-id="title-one">One</h1></section>
      <section data-editor-id="page-two" data-label="Two"><h1 data-editor-id="title-two">Two</h1></section>
    </deck-stage></body></html>`;
    const model = SourceDocument.parse(source, "deck.html");

    const copyId = model.duplicatePage(0);
    expect(model.pages().map(({ label }) => label)).toEqual(["One", "One Copy", "Two"]);
    expect(copyId).toBe("page-one-copy");
    expect(model.find("title-one-copy")?.textContent).toBe("One");

    const movedIndex = model.movePage(1, 2);
    expect(movedIndex).toBe(2);
    expect(model.pages().map(({ id }) => id)).toEqual(["page-one", "page-two", "page-one-copy"]);

    model.deletePage(1);
    expect(model.pages().map(({ id }) => id)).toEqual(["page-one", "page-one-copy"]);
    model.deletePage(1);
    expect(model.pages().map(({ id }) => id)).toEqual(["page-one"]);
    expect(() => model.deletePage(0)).toThrow(/at least one page/i);
  });

  it("keeps a one-page explicit deck editable and updates its declared size", () => {
    const model = SourceDocument.parse(
      `<!doctype html><html><body><deck-stage width="1280" height="720"><section data-editor-id="only-page"><h1>Only</h1></section></deck-stage></body></html>`,
      "one-page-deck.html",
    );

    expect(model.pages()).toHaveLength(1);
    model.setCanvas({ width: 1024, height: 768 });
    expect(model.document.querySelector("deck-stage")?.getAttribute("width")).toBe("1024");
    expect(model.document.querySelector("deck-stage")?.getAttribute("height")).toBe("768");
  });

  it("derives non-contiguous Build groups and reports invalid and nested steps", () => {
    const model = SourceDocument.parse(`<!doctype html><html><body><deck-stage>
      <section data-editor-id="page-one">
        <div data-editor-id="late-a" data-build="10"></div>
        <div data-editor-id="late-b" data-build="10"></div>
        <div data-editor-id="last" data-build="20"></div>
        <div data-editor-id="parent" data-build="3"><span data-editor-id="child" data-build="1">nested</span></div>
        <div data-editor-id="invalid" data-build="soon"></div>
      </section>
    </deck-stage></body></html>`, "builds.html");

    const sequence = model.buildSequence(0);
    expect(sequence.steps).toEqual([1, 3, 10, 20]);
    expect(sequence.groups.find(({ step }) => step === 10)?.elementIds).toEqual(["late-a", "late-b"]);
    expect(sequence.elementCount).toBe(5);
    expect(sequence.warnings.map(({ code }) => code)).toEqual(expect.arrayContaining(["invalid-step", "nested-conflict"]));
    expect(model.buildStepForElement("invalid")).toBeNull();
  });

  it("edits, sorts, splits, and merges Build groups without runtime source pollution", () => {
    const model = SourceDocument.parse(`<!doctype html><html><body><deck-stage><section data-editor-id="page-one">
      <p data-editor-id="a" data-build="1">A</p><p data-editor-id="b" data-build="1">B</p>
      <p data-editor-id="c" data-build="2">C</p><p data-editor-id="d" data-build="3">D</p>
    </section></deck-stage></body></html>`, "builds.html");

    model.apply({ action: "moveBuildGroup", pageId: "page-one", fromStep: 3, toStep: 1 });
    expect(model.buildSequence(0).groups.map(({ elementIds }) => elementIds)).toEqual([["d"], ["a", "b"], ["c"]]);
    model.apply({ action: "splitBuildGroup", pageId: "page-one", elementIds: ["b"], targetPosition: 2 });
    expect(model.buildSequence(0).groups.map(({ elementIds }) => elementIds)).toEqual([["d"], ["a"], ["b"], ["c"]]);
    model.apply({ action: "mergeBuildGroups", pageId: "page-one", sourceStep: 3, targetStep: 2 });
    expect(model.buildSequence(0).groups.map(({ elementIds }) => elementIds)).toEqual([["d"], ["a", "b"], ["c"]]);
    model.apply({ action: "setElementBuild", elementIds: ["c"], step: null });
    model.normalizeBuildSteps(0);
    expect(model.buildStepForElement("c")).toBeNull();
    expect(model.serialize()).not.toContain("revealed");
    expect(model.serialize()).not.toContain("data-editor-build-");
  });

  it("recognizes the real HotCarbon Build regression baseline", () => {
    const source = readFileSync(new URL("../reference/artifacts/HotCarbon_Oral_Slides_SelfContained.html", import.meta.url), "utf8");
    const model = SourceDocument.parse(source, "HotCarbon_Oral_Slides_SelfContained.html");
    const sequences = model.pages().map(({ index }) => model.buildSequence(index));

    expect(model.pages()).toHaveLength(23);
    expect(sequences.filter(({ elementCount }) => elementCount > 0)).toHaveLength(14);
    expect(sequences.reduce((sum, sequence) => sum + sequence.elementCount, 0)).toBe(94);
    expect(sequences[0]?.maxStep).toBe(2);
  });

  it("supports Build orchestration on a single HTML page without a deck container", () => {
    const model = SourceDocument.parse(`<!doctype html><html><body data-editor-id="single-page">
      <h1 data-editor-id="single-title">Title</h1><p data-editor-id="single-build" data-build="5">Later</p>
    </body></html>`, "single.html");
    expect(model.pages()).toHaveLength(0);
    expect(model.buildSequence(0).steps).toEqual([5]);
    model.apply({ action: "splitBuildGroup", pageId: "single-page", elementIds: ["single-title"], targetPosition: 0 });
    expect(model.buildSequence(0).groups.map(({ elementIds }) => elementIds)).toEqual([["single-title"], ["single-build"]]);
  });
});
