import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { SourceDocument } from "../src/core/document-model";
import {
  comparePresentationProjections,
  projectPresentation,
} from "../src/core/presentation-projection";

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

const source = `<!doctype html><html><body><deck-stage data-editor-id="deck">
  <section data-editor-id="page-one"><h1 data-editor-id="title" data-build="1">One</h1></section>
  <section data-editor-id="page-two"><p data-editor-id="copy">Two</p></section>
</deck-stage></body></html>`;

describe("presentation projection parity", () => {
  it("ignores allowed runtime view state changes", () => {
    const document = new JSDOM(source).window.document;
    const expected = projectPresentation(document, "html");
    const page = document.querySelector("section");
    page?.classList.add("is-active");
    page?.setAttribute("aria-hidden", "false");
    page?.querySelector("[data-build]")?.classList.add("revealed");
    page?.querySelector("[data-build]")?.setAttribute("data-lms-build-visible", "true");

    expect(comparePresentationProjections(expected, projectPresentation(document, "html"))).toEqual([]);
  });

  it("detects runtime page reorder as a projection mismatch", () => {
    const document = new JSDOM(source).window.document;
    const expected = projectPresentation(document, "html");
    const pages = document.querySelectorAll("deck-stage > section");
    pages[0]?.before(pages[1]!);
    const differences = comparePresentationProjections(expected, projectPresentation(document, "html"));

    expect(differences.some(({ path }) => path === "pages")).toBe(true);
  });

  it("matches the editor projection after canonical import", () => {
    const canonical = new JSDOM(source).window.document;
    const expected = projectPresentation(canonical, "html");
    const model = SourceDocument.parse(source, "parity.html");

    expect(comparePresentationProjections(expected, projectPresentation(model.document, "html"))).toEqual([]);
  });
});
