import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { applyElementChanges } from "../src/core/commands";
import { SourceDocument } from "../src/core/document-model";
import {
  ensureManagedFontFace,
  fontEntryById,
  fontEntryForFamily,
  managedFontAssetPath,
  managedFontFaceCss,
} from "../src/core/font-catalog";
import { buildStandaloneSvg } from "../src/core/presentation";
import { ProjectAssets } from "../src/core/project";
import { parseBoxShadow, serializeBoxShadow } from "../src/core/shadow";

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

describe("style controls", () => {
  it("makes a positive HTML stroke visible while preserving an authored border style", () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="plain"></div><div id="dashed" style="border-style:dashed"></div></body></html>');
    const plain = dom.window.document.querySelector("#plain")!;
    const dashed = dom.window.document.querySelector("#dashed")!;

    applyElementChanges(plain, "html", { strokeWidth: 3, stroke: "#123456" });
    applyElementChanges(dashed, "html", { strokeWidth: 2 });

    expect((plain as HTMLElement).style.borderWidth).toBe("3px");
    expect((plain as HTMLElement).style.borderStyle).toBe("solid");
    expect((plain as HTMLElement).style.borderColor).toBe("rgb(18, 52, 86)");
    expect((dashed as HTMLElement).style.borderStyle).toBe("dashed");
  });

  it("keeps SVG stroke width as an SVG attribute", () => {
    const dom = new JSDOM('<svg xmlns="http://www.w3.org/2000/svg"><rect id="shape" /></svg>', { contentType: "image/svg+xml" });
    const shape = dom.window.document.querySelector("#shape")!;
    applyElementChanges(shape, "svg", { strokeWidth: 4 });
    expect(shape.getAttribute("stroke-width")).toBe("4");
  });

  it("parses and serializes one visual shadow layer", () => {
    const parsed = parseBoxShadow("rgba(17, 34, 51, 0.4) 2px 6px 18px -3px");
    expect(parsed).toEqual({ x: 2, y: 6, blur: 18, spread: -3, color: "#112233", opacity: 0.4 });
    expect(serializeBoxShadow(parsed)).toBe("2px 6px 18px -3px rgba(17, 34, 51, 0.4)");
    expect(parseBoxShadow("0 1px 2px #000, 0 4px 8px #000")).toBeNull();
    expect(serializeBoxShadow(null)).toBe("none");
  });

  it("maps proprietary choices to managed local-first font faces with bundled fallbacks", () => {
    const yahei = fontEntryById("microsoft-yahei")!;
    const css = managedFontFaceCss(yahei);
    expect(css).toContain('local("Microsoft YaHei")');
    expect(css).toContain('url(".lms/fonts/SourceHanSansSC-VF.woff2"');
    expect(managedFontAssetPath(yahei, "slides/index.html")).toBe("slides/.lms/fonts/SourceHanSansSC-VF.woff2");
    expect(fontEntryForFamily(yahei.cssFamily)?.id).toBe("microsoft-yahei");

    const model = SourceDocument.parse('<!doctype html><html><head></head><body><p data-editor-id="text">字体</p></body></html>', "index.html");
    ensureManagedFontFace(model, yahei);
    expect(model.document.querySelector('style[data-lms-managed-font="microsoft-yahei"]')?.textContent).toContain("SourceHanSansSC-VF.woff2");
  });

  it("inlines managed font assets in standalone SVG export", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
      <style>@font-face{font-family:"Demo";src:url(".lms/fonts/demo.woff2")}</style>
      <text data-editor-id="label" style="font-family:Demo">Demo</text>
    </svg>`;
    const model = SourceDocument.parse(source, "art.svg");
    const assets = new ProjectAssets([{ path: ".lms/fonts/demo.woff2", mimeType: "font/woff2", bytes: new Uint8Array([1, 2, 3]) }]);
    const result = buildStandaloneSvg(model, assets, "art.svg");
    expect(result.svg).toContain("data:font/woff2;base64,AQID");
    expect(result.warnings).toEqual([]);
  });
});
