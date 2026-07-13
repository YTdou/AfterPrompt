import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { SourceDocument } from "../src/core/document-model";
import { decodeEditableHtml } from "../src/core/editable-html";
import { buildInteractiveHtml, buildStandaloneSlides } from "../src/core/presentation";
import { readPresentationContract, upsertPresentationContract } from "../src/core/presentation-contract";
import { projectPresentation, projectionDigest } from "../src/core/presentation-projection";
import { sanitizeDocument } from "../src/core/sanitizer";
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

const source = `<!doctype html><html><head></head><body><deck-stage data-editor-id="deck">
  <section data-editor-id="page-one" data-key="S1"><h1 data-editor-id="title" data-build="1">One</h1></section>
  <section data-editor-id="page-two" data-key="S2" data-kind="backup"><p data-editor-id="copy">Two</p></section>
</deck-stage></body></html>`;

describe("presentation editing contract", () => {
  it("generates a contract from the canonical projection and preserves it through sanitization", () => {
    const document = new JSDOM(source).window.document;
    const projection = projectPresentation(document, "html");
    const contract = upsertPresentationContract(document, projection);
    const parsed = readPresentationContract(document);

    expect(contract.sourceOfTruth).toBe("canonical-static-dom");
    expect(parsed.error).toBeNull();
    expect(parsed.contract?.integrity.projectionDigest).toBe(projectionDigest(projectPresentation(document, "html")));
    expect(document.querySelector("meta[name='lms-contract-version']")?.getAttribute("content")).toBe("1");

    const safeClone = document.cloneNode(true) as Document;
    const warnings = sanitizeDocument(safeClone, "html");
    expect(safeClone.querySelector("#lms-editing-contract")).not.toBeNull();
    expect(warnings.join(" ")).not.toContain("可执行或不安全节点");
  });

  it("puts the same contract in direct output and inside the reversible payload", () => {
    const model = SourceDocument.parse(source, "contract.html");
    const assets = new ProjectAssets();
    const interactive = buildInteractiveHtml(model, assets, "contract.html");
    const standalone = buildStandaloneSlides(model, assets, "contract.html");

    const interactiveDocument = new JSDOM(interactive.html).window.document;
    expect(readPresentationContract(interactiveDocument).contract?.version).toBe(1);

    const decoded = decodeEditableHtml(standalone.html, "contract.html");
    expect(decoded?.legacy).toBe(false);
    const payloadDocument = new JSDOM(decoded?.payload.source ?? "").window.document;
    expect(readPresentationContract(payloadDocument).contract?.version).toBe(1);
    expect(readPresentationContract(payloadDocument).contract?.integrity.projectionDigest)
      .toBe(readPresentationContract(interactiveDocument).contract?.integrity.projectionDigest);
  });
});
