import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { SourceDocument } from "../src/core/document-model";
import { duplicateElement } from "../src/core/commands";
import {
  componentPropertySchema,
  syncLinkedVisualFragmentInstances,
} from "../src/core/fragments/component";
import { extractVisualFragment } from "../src/core/fragments/extract";
import { createRasterVisualFragment, createSvgVisualFragment } from "../src/core/fragments/ingest";
import { insertVisualFragment, planVisualFragmentInsert } from "../src/core/fragments/import";
import {
  FileSystemVisualFragmentStorage,
  MemoryVisualFragmentStorage,
  VisualFragmentLibrary,
  type FragmentDirectoryHandleLike,
  type FragmentFileHandleLike,
  type FragmentWritableLike,
} from "../src/core/fragments/library";
import { decodeVisualFragmentPackage, encodeVisualFragmentPackage, inspectRasterImage } from "../src/core/fragments/package";
import { validateVisualFragmentManifest } from "../src/core/fragments/schema";
import type { StructuredVisualFragmentPackage } from "../src/core/fragments/types";
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

function sourceModel(): { model: SourceDocument; assets: ProjectAssets } {
  const model = SourceDocument.parse(`<!doctype html><html><head><style>
    :root { --accent: #315efb; }
    .card { position:absolute; width:240px; height:120px; color:#172033; background:var(--accent); }
    .card .title { font:700 24px/1.2 sans-serif; }
  </style></head><body data-editor-canvas-width="800" data-editor-canvas-height="600">
    <section id="card" class="card" data-editor-id="card-001">
      <h2 id="title" class="title" data-editor-id="title-001">Original title</h2>
      <div data-editor-id="slot-001"><span data-editor-id="default-001">Default</span></div>
      <img data-editor-id="image-001" src="assets/icon.svg">
      <svg data-editor-id="svg-001"><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient></defs><rect id="shape" fill="url(#paint)"/></svg>
    </section>
  </body></html>`, "components/card.html");
  const assets = new ProjectAssets([{
    path: "components/assets/icon.svg",
    mimeType: "image/svg+xml",
    bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'),
  }]);
  return { model, assets };
}

function extractComponent(version = "1.0.0", title = "Original title"): StructuredVisualFragmentPackage {
  const { model, assets } = sourceModel();
  model.find("title-001")!.textContent = title;
  return extractVisualFragment(model, assets, "components/card.html", [{
    element: model.find("card-001")!,
    bounds: { x: 100, y: 80, width: 240, height: 120 },
  }], {
    fragmentId: "contribution-card",
    name: "Contribution Card",
    description: "Reusable card with an editable title and content slot.",
    fragmentType: "component",
    saveMode: "self-contained",
    category: "Cards",
    tags: ["research", "card"],
    version,
    properties: [{
      name: "title",
      label: "Title",
      type: "text",
      target: "title-001",
      binding: { kind: "text" },
    }],
    slots: [{
      name: "content",
      label: "Content",
      target: "slot-001",
      allowedElementTypes: ["text"],
      required: false,
      multiple: false,
      defaultContent: "Default",
    }],
  });
}

function blankTarget(): { model: SourceDocument; assets: ProjectAssets; parentId: string } {
  const model = SourceDocument.parse(`<!doctype html><html><head></head><body data-editor-canvas-width="800" data-editor-canvas-height="600">
    <main data-editor-id="canvas-root"><svg><defs><linearGradient id="paint"><stop/></linearGradient></defs></svg></main>
  </body></html>`, "target/index.html");
  return { model, assets: new ProjectAssets(), parentId: "canvas-root" };
}

function tinyPng(): Uint8Array {
  return new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6D1sAAAAASUVORK5CYII=", "base64"));
}

function tinyJpeg(width = 3, height = 2): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

class FakeFileHandle implements FragmentFileHandleLike {
  readonly kind = "file" as const;
  bytes = new Uint8Array();
  lastModified = Date.now();

  constructor(readonly name: string) {}

  async getFile(): Promise<{ name: string; lastModified: number; arrayBuffer(): Promise<ArrayBuffer> }> {
    const copy = new Uint8Array(this.bytes);
    return { name: this.name, lastModified: this.lastModified, arrayBuffer: async () => copy.buffer as ArrayBuffer };
  }

  async createWritable(): Promise<FragmentWritableLike> {
    return {
      write: async (data) => {
        this.bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data);
        this.lastModified = Date.now();
      },
      close: async () => undefined,
    };
  }
}

class FakeDirectoryHandle implements FragmentDirectoryHandleLike {
  readonly kind = "directory" as const;
  readonly files = new Map<string, FakeFileHandle>();

  constructor(readonly name = "Fragments") {}

  async *values(): AsyncIterable<FragmentFileHandleLike> {
    yield* this.files.values();
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    let file = this.files.get(name);
    if (!file && options?.create) {
      file = new FakeFileHandle(name);
      this.files.set(name, file);
    }
    if (!file) throw new Error(`Missing file: ${name}`);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
  }
}

describe("Visual Fragment packages", () => {
  it("extracts a self-contained component and round-trips its schema-backed .vfrag package", async () => {
    const fragment = extractComponent();
    const validation = validateVisualFragmentManifest(fragment.manifest);
    expect(validation).toEqual({ valid: true, issues: [] });
    expect(fragment.manifest.coordinateSystem.originalBounds).toEqual({ x: 100, y: 80, width: 240, height: 120 });
    expect(fragment.manifest.properties[0]).toMatchObject({ name: "title", target: "title-001", defaultValue: "Original title" });
    expect(fragment.content).toContain('data-vfrag-slot="content"');
    expect(fragment.styles).toContain("Source selector: .card");
    expect(fragment.manifest.assets[0]).toMatchObject({ path: "assets/icon.svg", required: true });

    const bytes = await encodeVisualFragmentPackage(fragment);
    const restored = await decodeVisualFragmentPackage(bytes);
    expect(restored.manifest.fragmentId).toBe("contribution-card");
    expect(restored.assets).toHaveLength(1);
    expect(restored.previewSvg).toContain("<foreignObject");
  });

  it("keeps embedded font payloads in CSS without overflowing manifest font metadata", async () => {
    const embeddedFont = `data:font/woff2;base64,${"A".repeat(4096)}`;
    const model = SourceDocument.parse(`<!doctype html><html><head><style>
      @font-face { font-family: "Embedded Font"; src: url("${embeddedFont}") format("woff2"); }
      .label { position:absolute; width:240px; height:48px; font-family:"Embedded Font"; }
    </style></head><body data-editor-canvas-width="800" data-editor-canvas-height="600">
      <div class="label" data-editor-id="label-001">Embedded type</div>
    </body></html>`, "embedded-font.html");
    const fragment = extractVisualFragment(model, new ProjectAssets(), "embedded-font.html", [{
      element: model.find("label-001")!,
      bounds: { x: 20, y: 30, width: 240, height: 48 },
    }], {
      name: "Embedded Font Label",
      fragmentType: "element",
      saveMode: "self-contained",
    });

    expect(validateVisualFragmentManifest(fragment.manifest)).toEqual({ valid: true, issues: [] });
    expect(fragment.manifest.fonts).toContainEqual({ family: "Embedded Font", bundled: true });
    expect(fragment.manifest.fonts.find((font) => font.family === "Embedded Font")).not.toHaveProperty("source");
    expect(fragment.styles).toContain(embeddedFont);

    const restored = await decodeVisualFragmentPackage(await encodeVisualFragmentPackage(fragment));
    expect(restored.manifest.fonts).toContainEqual({ family: "Embedded Font", bundled: true });
    expect(restored.styles).toContain(embeddedFont);
  });

  it("does not recursively absorb unrelated saved-fragment styles and preserves nested layers", async () => {
    const primaryFont = `data:font/woff2;base64,${"A".repeat(4096)}`;
    const unrelatedFont = `data:font/woff2;base64,${"B".repeat(4096)}`;
    const model = SourceDocument.parse(`<!doctype html><html><head>
      <style>
        @font-face { font-family: "Primary"; src: url("${primaryFont}"); }
        .whole-component { position:absolute; width:360px; height:180px; font-family:"Primary"; }
        .whole-component .panel { color:#123456; }
      </style>
      <style data-vfrag-style="old-a@1.0.0#old-a-instance" data-editor-structural="true">
        @font-face { font-family: "Unrelated"; src: url("${unrelatedFont}"); }
        [data-vfrag-root="old-a"] { color:red; }
      </style>
      <style data-vfrag-style="old-b@1.0.0#old-b-instance" data-editor-structural="true">
        @font-face { font-family: "Unrelated"; src: url("${unrelatedFont}"); }
        [data-vfrag-root="old-b"] { color:blue; }
      </style>
    </head><body data-editor-canvas-width="800" data-editor-canvas-height="600">
      <div class="whole-component" data-editor-id="whole-component">
        <div class="panel" data-editor-id="panel-a"><strong data-editor-id="title-a">Title</strong></div>
        <div class="panel" data-editor-id="panel-b"><span data-editor-id="copy-b">Copy</span></div>
      </div>
    </body></html>`, "recursive-fragment-styles.html");
    const fragment = extractVisualFragment(model, new ProjectAssets(), "recursive-fragment-styles.html", [{
      element: model.find("whole-component")!,
      bounds: { x: 40, y: 50, width: 360, height: 180 },
    }], {
      name: "Whole Component",
      fragmentType: "component",
      saveMode: "self-contained",
    });

    expect(fragment.styles).toContain(primaryFont);
    expect(fragment.styles).not.toContain(unrelatedFont);
    expect(fragment.styles.match(/@font-face/gi)).toHaveLength(1);
    const content = new DOMParser().parseFromString(fragment.content, "text/html");
    expect(content.querySelector('[data-vfrag-node-key="panel-a"] [data-vfrag-node-key="title-a"]')).not.toBeNull();
    expect(content.querySelector('[data-vfrag-node-key="panel-b"] [data-vfrag-node-key="copy-b"]')).not.toBeNull();
    expect((await encodeVisualFragmentPackage(fragment)).byteLength).toBeLessThan(1024 * 1024);
  });

  it("separates source-page Build state from a portable component's stable visual style", () => {
    const model = SourceDocument.parse(`<!doctype html><html><head><style>
      .future-path { position:absolute; width:420px; height:90px; background:#f8f9fa; color:#53616c; }
      .build { opacity:0; transform:translateY(18px) scale(.985); filter:blur(3px); pointer-events:none; }
      .build.revealed { opacity:1; transform:none; filter:none; pointer-events:auto; }
    </style></head><body data-editor-canvas-width="800" data-editor-canvas-height="600">
      <div class="future-path build" data-build="3" aria-hidden="true" data-editor-id="future-path">
        <b data-editor-id="future-title">Future work</b>
      </div>
    </body></html>`, "build-source.html");
    const source = model.find("future-path")!;
    const renderedDocument = new JSDOM(`<!doctype html><html><head><style>
      .future-path { position:absolute; width:420px; height:90px; background:#f8f9fa; color:#53616c; }
      .build { opacity:0; transform:translateY(18px) scale(.985); filter:blur(3px); pointer-events:none; }
      .build.revealed { opacity:1; transform:none; filter:none; pointer-events:auto; }
    </style></head><body>${source.outerHTML}</body></html>`).window.document;
    const rendered = renderedDocument.querySelector('[data-editor-id="future-path"]')!;
    const fragment = extractVisualFragment(model, new ProjectAssets(), "build-source.html", [{
      element: source,
      renderedElement: rendered,
      bounds: { x: 100, y: 200, width: 420, height: 90 },
    }], {
      name: "Portable Future Path",
      fragmentType: "component",
      saveMode: "self-contained",
    });

    const parsed = new DOMParser().parseFromString(fragment.content, "text/html");
    const portableRoot = parsed.querySelector('[data-vfrag-node-key="future-path"]')!;
    expect(portableRoot.hasAttribute("data-build")).toBe(false);
    expect(portableRoot.classList.contains("build")).toBe(false);
    expect(portableRoot.getAttribute("aria-hidden")).toBeNull();
    expect(fragment.styles).not.toContain("Source selector: .build");
    expect(fragment.styles).toContain("opacity: 1");
    expect(fragment.styles).toContain("filter: none");

    // Extraction observes a temporary revealed state but restores canonical source.
    expect(source.getAttribute("data-build")).toBe("3");
    expect(source.classList.contains("build")).toBe(true);
    expect(source.classList.contains("revealed")).toBe(false);
    expect(source.getAttribute("aria-hidden")).toBe("true");
    expect(rendered.classList.contains("revealed")).toBe(false);
    expect(rendered.getAttribute("aria-hidden")).toBe("true");
  });

  it("repairs legacy top-level Build context during import while preserving nested component choreography", () => {
    const fragment = extractComponent();
    const parsed = new DOMParser().parseFromString(fragment.content, "text/html");
    const coordinateLayer = parsed.querySelector("[data-vfrag-coordinate-layer]")!;
    const topLevel = coordinateLayer.firstElementChild!;
    topLevel.classList.add("build");
    topLevel.setAttribute("data-build", "4");
    topLevel.setAttribute("aria-hidden", "true");
    topLevel.insertAdjacentHTML("beforeend", '<span class="build" data-build="2" data-editor-id="internal-step">Internal step</span>');
    fragment.content = `${parsed.body.firstElementChild!.outerHTML}\n`;

    const target = blankTarget();
    const plan = planVisualFragmentInsert(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "center" },
      linked: false,
      targetSourcePath: "target/index.html",
    });
    const planned = new DOMParser().parseFromString(plan.content, "text/html");
    const plannedTopLevel = planned.querySelector("[data-vfrag-coordinate-layer] > *")!;
    const plannedInternal = planned.querySelector('[data-vfrag-node-key="card-001"] [data-editor-id^="internal-step"]')!;

    expect(plannedTopLevel.hasAttribute("data-build")).toBe(false);
    expect(plannedTopLevel.classList.contains("build")).toBe(false);
    expect((plannedTopLevel as HTMLElement).style.opacity).toBe("1");
    expect(plannedInternal.getAttribute("data-build")).toBe("2");
    expect(plannedInternal.classList.contains("build")).toBe(true);
    expect(plan.report.warnings.join(" ")).toContain("源页面的顶层 Build");
  });

  it("rejects manifests outside the public JSON Schema", () => {
    const manifest = structuredClone(extractComponent().manifest) as unknown as Record<string, unknown>;
    manifest.unexpected = true;
    const result = validateVisualFragmentManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === "$.unexpected")).toBe(true);
  });

  it("exports an inline HTML SVG selection as a standalone SVG fragment with referenced defs", () => {
    const model = SourceDocument.parse(`<!doctype html><html><body><svg data-editor-id="inline-svg"><defs><linearGradient id="inline-paint"><stop offset="0" stop-color="red"/></linearGradient></defs><rect data-editor-id="inline-rect" width="80" height="40" fill="url(#inline-paint)"/></svg></body></html>`, "inline.html");
    const fragment = extractVisualFragment(model, new ProjectAssets(), "inline.html", [{
      element: model.find("inline-rect")!,
      bounds: { x: 0, y: 0, width: 80, height: 40 },
    }], {
      name: "Inline Rectangle",
      fragmentType: "element",
      saveMode: "source-preserving",
    });
    expect(fragment.manifest.contentType).toBe("svg");
    expect(fragment.manifest.entry).toBe("content.svg");
    expect(fragment.content).toContain("linearGradient");
    expect(fragment.content).toContain('fill="url(#inline-paint)"');
  });

  it("sanitizes untrusted preview SVG and rejects ZIP path traversal", async () => {
    const fragment = extractComponent();
    const { default: JSZip } = await import("jszip");
    const importedZip = await JSZip.loadAsync(await encodeVisualFragmentPackage(fragment));
    importedZip.file("preview.svg", '<svg xmlns="http://www.w3.org/2000/svg" onload="steal()"><script>steal()</script><image href="https://bad.example/x.png"/></svg>');
    const restored = await decodeVisualFragmentPackage(await importedZip.generateAsync({ type: "uint8array" }));
    expect(restored.previewSvg).not.toMatch(/script|onload|bad\.example/i);
    expect(restored.warnings.join(" ")).toContain("preview.svg");

    const zip = new JSZip();
    zip.file("../manifest.json", "{}");
    await expect(decodeVisualFragmentPackage(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/不安全路径|缺少 manifest/i);
  });

  it("round-trips PNG and JPEG as format 1.1 Raster packages with real dimensions", async () => {
    const png = createRasterVisualFragment(tinyPng(), "pixel.png");
    const jpg = createRasterVisualFragment(tinyJpeg(), "photo.jpeg");
    expect(png.manifest).toMatchObject({ formatVersion: "1.1", contentType: "raster", entry: "content.png", canvas: { width: 1, height: 1 } });
    expect(jpg.manifest).toMatchObject({ formatVersion: "1.1", contentType: "raster", entry: "content.jpg", canvas: { width: 3, height: 2 } });
    expect(inspectRasterImage(tinyPng()).mimeType).toBe("image/png");
    expect(inspectRasterImage(tinyJpeg()).mimeType).toBe("image/jpeg");
    const restoredPng = await decodeVisualFragmentPackage(await encodeVisualFragmentPackage(png));
    const restoredJpg = await decodeVisualFragmentPackage(await encodeVisualFragmentPackage(jpg));
    expect(restoredPng.content).toBeInstanceOf(Uint8Array);
    expect(restoredJpg.content).toBeInstanceOf(Uint8Array);
    await expect(encodeVisualFragmentPackage({ ...png, manifest: { ...png.manifest, entry: "content.jpg" } })).rejects.toThrow(/真实内容不是 JPEG/);
  });

  it("wraps raw SVG while preserving its editable node tree", () => {
    const fragment = createSvgVisualFragment('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><g id="layer"><rect width="40" height="20"/><text>Label</text></g></svg>', "mark.svg");
    expect(fragment.manifest.contentType).toBe("svg");
    const parsed = new DOMParser().parseFromString(fragment.content, "image/svg+xml");
    expect(parsed.querySelector("g > rect")).not.toBeNull();
    expect(parsed.querySelector("g > text")?.textContent).toBe("Label");
  });
});

describe("Visual Fragment import", () => {
  it("plans conflicts before mutation and imports two isolated instances with fixed references", () => {
    const fragment = extractComponent();
    const target = blankTarget();
    const firstPlan = planVisualFragmentInsert(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "center" },
      linked: true,
      targetSourcePath: "target/index.html",
    });
    expect(firstPlan.report.compatible).toBe(true);
    expect(firstPlan.report.idRemaps).toHaveProperty("paint");
    expect(target.model.document.querySelectorAll("[data-vfrag-instance-id]")).toHaveLength(0);

    const first = insertVisualFragment(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "center" },
      linked: true,
      targetSourcePath: "target/index.html",
    });
    const second = insertVisualFragment(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "point", x: 20, y: 30 },
      linked: false,
      targetSourcePath: "target/index.html",
    });

    expect(first.rootEditorIds[0]).not.toBe(second.rootEditorIds[0]);
    expect(first.instanceId).not.toBe(second.instanceId);
    const ids = Array.from(target.model.document.querySelectorAll("[id]"), (element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    const fills = Array.from(target.model.document.querySelectorAll("[fill]"), (element) => element.getAttribute("fill"));
    expect(fills.some((value) => value?.startsWith("url(#contribution-card-paint"))).toBe(true);
    expect(target.model.document.querySelectorAll('style[data-vfrag-style^="contribution-card@1.0.0#"]')).toHaveLength(2);
    expect(target.assets.get("target/fragments/contribution-card/1.0.0/icon.svg")).toBeDefined();
    const centeredRoot = target.model.find(first.rootEditorIds[0]!) as HTMLElement;
    expect(centeredRoot.style.left).toBe("280px");
    expect(centeredRoot.style.top).toBe("240px");
  });

  it("places an HTML fragment in an isolated, explicit stacking context when requested", () => {
    const fragment = extractComponent();
    const target = blankTarget();
    const inserted = insertVisualFragment(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "point", x: 40, y: 50 },
      linked: false,
      targetSourcePath: "target/index.html",
      rootZIndex: 701,
    });
    const root = target.model.find(inserted.rootEditorIds[0]!) as HTMLElement;

    expect(root.style.zIndex).toBe("701");
    expect(root.style.isolation).toBe("isolate");
    expect(root.parentElement?.lastElementChild).toBe(root);
    expect(root.querySelector('[data-vfrag-node-key="card-001"]')).not.toBeNull();
    expect(target.model.serialize()).toContain("isolation: isolate");
  });

  it("constrains original and explicit placement to the editable canvas", () => {
    const fragment = extractComponent();
    fragment.manifest.coordinateSystem.origin = { x: 4_000, y: -200 };
    const target = blankTarget();
    const original = insertVisualFragment(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "original" },
      linked: false,
      targetSourcePath: "target/index.html",
    });
    const explicit = insertVisualFragment(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "point", x: -500, y: 5_000 },
      linked: false,
      targetSourcePath: "target/index.html",
    });

    const originalRoot = target.model.find(original.rootEditorIds[0]!) as HTMLElement;
    const explicitRoot = target.model.find(explicit.rootEditorIds[0]!) as HTMLElement;
    expect({ left: originalRoot.style.left, top: originalRoot.style.top }).toEqual({ left: "560px", top: "0px" });
    expect({ left: explicitRoot.style.left, top: explicitRoot.style.top }).toEqual({ left: "0px", top: "480px" });
  });

  it("blocks undeclared network references before mutating the target", () => {
    const fragment = extractComponent();
    fragment.content = fragment.content.replace("</div>", '<img src="https://undeclared.example/pixel.png"></div>');
    const target = blankTarget();
    const plan = planVisualFragmentInsert(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "center" },
      linked: false,
      targetSourcePath: "target/index.html",
    });
    expect(plan.report.compatible).toBe(false);
    expect(plan.report.errors.join(" ")).toMatch(/permissions|网络来源/);
    expect(target.model.document.querySelector("[data-vfrag-instance-id]")).toBeNull();
  });

  it("rewrites CSS ID selectors and paint references without corrupting same-looking hex colors", () => {
    const fragment = extractComponent();
    fragment.content = fragment.content.replace("</section>", '<span id="fff">Color guard</span></section>');
    fragment.styles += '\n#fff, [id="fff"], [href="#fff"] { color: #fff; filter: url(#fff); }\n';
    const target = blankTarget();
    target.model.find(target.parentId)!.setAttribute("id", "fff");
    const plan = planVisualFragmentInsert(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "center" },
      linked: false,
      targetSourcePath: "target/index.html",
    });
    expect(plan.report.idRemaps.fff).toBeDefined();
    expect(plan.styles).toContain("color: #fff");
    expect(plan.styles).toContain(`#${plan.report.idRemaps.fff}, [id="${plan.report.idRemaps.fff}"], [href="#${plan.report.idRemaps.fff}"]`);
    expect(plan.styles).toContain(`url(#${plan.report.idRemaps.fff})`);
  });

  it("updates exposed properties and slots through the shared command layer", () => {
    const fragment = extractComponent();
    const target = blankTarget();
    const inserted = insertVisualFragment(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "original" },
      linked: true,
      targetSourcePath: "target/index.html",
    });
    const rootId = inserted.rootEditorIds[0]!;
    expect(componentPropertySchema(target.model.document, rootId).map((property) => property.name)).toEqual(["title"]);
    target.model.apply({ action: "updateComponentProperties", elementId: rootId, properties: { title: "Adaptive Sampling" } });
    expect(target.model.document.querySelector('[data-vfrag-node-key="title-001"]')?.textContent).toBe("Adaptive Sampling");

    const slotResult = target.model.apply({
      action: "insertIntoComponentSlot",
      elementId: rootId,
      slot: "content",
      element: { type: "text", id: "slot-copy", text: "Inserted", x: 0, y: 0 },
    });
    expect(slotResult.createdId).toBe("slot-copy");
    expect(target.model.find("slot-copy")?.textContent).toBe("Inserted");
    target.model.apply({ action: "unlinkComponentInstance", elementId: rootId });
    expect(target.model.find(rootId)?.getAttribute("data-vfrag-linked")).toBe("false");
  });

  it("duplicates an instance with fresh node, instance, regular-ID, and style identities", () => {
    const fragment = extractComponent();
    const target = blankTarget();
    const inserted = insertVisualFragment(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "center" },
      linked: true,
      targetSourcePath: "target/index.html",
    });
    const copyId = duplicateElement(target.model.document, target.model.kind, inserted.rootEditorIds[0]!);
    const roots = Array.from(target.model.document.querySelectorAll("[data-vfrag-instance-id]"));
    expect(copyId).not.toBe(inserted.rootEditorIds[0]);
    expect(new Set(roots.map((root) => root.getAttribute("data-vfrag-instance-id"))).size).toBe(2);
    expect(new Set(Array.from(target.model.document.querySelectorAll("[id]"), (element) => element.id)).size)
      .toBe(target.model.document.querySelectorAll("[id]").length);
    expect(target.model.document.querySelectorAll('style[data-vfrag-style^="contribution-card@1.0.0#"]')).toHaveLength(2);
  });

  it("re-saves an imported definition without nesting fragment wrappers or coordinate layers", () => {
    const fragment = extractComponent();
    const target = blankTarget();
    const inserted = insertVisualFragment(target.model, target.assets, fragment, {
      parentId: target.parentId,
      placement: { mode: "point", x: 30, y: 40 },
      linked: true,
      targetSourcePath: "target/index.html",
    });
    const root = target.model.find(inserted.rootEditorIds[0]!)!;
    const updated = extractVisualFragment(target.model, target.assets, "target/index.html", [{
      element: root,
      bounds: { x: 30, y: 40, width: 240, height: 120 },
    }], {
      fragmentId: fragment.manifest.fragmentId,
      name: fragment.manifest.name,
      fragmentType: "component",
      saveMode: "source-preserving",
      version: "1.0.1",
      properties: fragment.manifest.properties,
      slots: fragment.manifest.slots,
    });
    const parsed = new DOMParser().parseFromString(updated.content, "text/html");
    expect(parsed.querySelectorAll("[data-vfrag-root]")).toHaveLength(1);
    expect(parsed.querySelectorAll("[data-vfrag-coordinate-layer]")).toHaveLength(1);
    expect(updated.manifest.properties[0]?.target).toBe("title-001");
    expect(updated.styles).toContain("Source selector:");
  });

  it("syncs linked instances while preserving instance identity and property overrides", () => {
    const target = blankTarget();
    const original = extractComponent("1.0.0", "Original title");
    const inserted = insertVisualFragment(target.model, target.assets, original, {
      parentId: target.parentId,
      placement: { mode: "point", x: 15, y: 25 },
      linked: true,
      targetSourcePath: "target/index.html",
    });
    const rootId = inserted.rootEditorIds[0]!;
    const instanceId = inserted.instanceId;
    target.model.apply({ action: "updateComponentProperties", elementId: rootId, properties: { title: "Instance override" } });
    target.model.apply({
      action: "insertIntoComponentSlot",
      elementId: rootId,
      slot: "content",
      element: { type: "text", id: "instance-slot-content", text: "Preserved slot content", x: 0, y: 0 },
    });

    const result = syncLinkedVisualFragmentInstances(target.model, target.assets, extractComponent("1.1.0", "Definition update"), "target/index.html");
    expect(result).toMatchObject({ updated: 1, failed: 0 });
    const root = target.model.find(rootId)!;
    expect(root.getAttribute("data-vfrag-instance-id")).toBe(instanceId);
    expect(root.getAttribute("data-vfrag-definition-version")).toBe("1.1.0");
    expect(root.querySelector('[data-vfrag-node-key="title-001"]')?.textContent).toBe("Instance override");
    expect(root.querySelector('[data-vfrag-node-key="slot-001"]')?.textContent).toBe("Preserved slot content");
    expect(target.model.find("instance-slot-content")).not.toBeNull();
  });

  it("inserts Raster packages as one HTML or SVG image layer with materialized project bytes", () => {
    const raster = createRasterVisualFragment(tinyPng(), "pixel.png");
    const html = blankTarget();
    const htmlResult = insertVisualFragment(html.model, html.assets, raster, {
      parentId: html.parentId,
      placement: { mode: "point", x: 12, y: 18 },
      linked: false,
      targetSourcePath: "target/index.html",
    });
    const htmlRoot = html.model.find(htmlResult.rootEditorIds[0]!)!;
    expect(htmlRoot.localName).toBe("img");
    expect(htmlRoot.children).toHaveLength(0);
    expect(htmlRoot.getAttribute("src")).toContain("fragments/pixel/1.0.0/content.png");
    expect(html.assets.get("target/fragments/pixel/1.0.0/content.png")?.bytes).toEqual(tinyPng());

    const svgModel = SourceDocument.parse('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" data-editor-id="svg-root"></svg>', "target.svg");
    const svgAssets = new ProjectAssets();
    const svgResult = insertVisualFragment(svgModel, svgAssets, raster, {
      parentId: "svg-root",
      placement: { mode: "center" },
      linked: false,
      targetSourcePath: "target.svg",
    });
    const svgRoot = svgModel.find(svgResult.rootEditorIds[0]!)!;
    expect(svgRoot.localName).toBe("image");
    expect(svgRoot.children).toHaveLength(0);
    expect(svgRoot.getAttribute("href")).toContain("fragments/pixel/1.0.0/content.png");
  });
});

describe("local Visual Fragment library", () => {
  it("stores versions, search metadata, favorites, usage, and export bytes", async () => {
    const library = new VisualFragmentLibrary(new MemoryVisualFragmentStorage());
    await library.save(extractComponent("1.0.0"));
    await library.save(extractComponent("1.1.0", "Next"));
    expect((await library.list({ search: "research" }))).toHaveLength(2);
    expect((await library.get("contribution-card"))?.manifest.version).toBe("1.1.0");
    expect((await library.latestRecord())?.version).toBe("1.1.0");
    await library.setFavorite("contribution-card", "1.0.0", true);
    expect((await library.latestRecord())?.version).toBe("1.1.0");
    await library.setFavorite("contribution-card", "1.1.0", true);
    await library.markUsed("contribution-card", "1.1.0");
    const record = await library.getRecord("contribution-card", "1.1.0");
    expect(record).toMatchObject({ favorite: true, useCount: 1 });
    expect((await library.exportBytes("contribution-card", "1.1.0")).byteLength).toBeGreaterThan(100);
    expect(await library.delete("contribution-card")).toBe(2);
  });

  it("rebuilds a directory-backed library from vfrag files and copies browser records without deleting them", async () => {
    const browser = new VisualFragmentLibrary(new MemoryVisualFragmentStorage());
    await browser.save(extractComponent());
    await browser.save(createRasterVisualFragment(tinyJpeg(), "photo.jpg"));
    const directoryHandle = new FakeDirectoryHandle();
    const directory = new VisualFragmentLibrary(new FileSystemVisualFragmentStorage(directoryHandle));
    expect(await browser.copyTo(directory)).toBe(2);
    expect(Array.from(directoryHandle.files.keys()).filter((name) => name.endsWith(".vfrag"))).toHaveLength(2);
    expect(await directory.list()).toHaveLength(2);
    expect(await browser.list()).toHaveLength(2);
    await directory.setFavorite("photo", "1.0.0", true);
    await directory.markUsed("photo", "1.0.0");

    const rebuilt = new VisualFragmentLibrary(new FileSystemVisualFragmentStorage(directoryHandle));
    expect((await rebuilt.get("photo"))?.manifest.contentType).toBe("raster");
    expect(await rebuilt.getRecord("photo", "1.0.0")).toMatchObject({ favorite: true, useCount: 1 });
    expect(await rebuilt.delete("photo")).toBe(1);
    expect(await rebuilt.list()).toHaveLength(1);
  });
});
