import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { SourceDocument } from "../src/core/document-model";
import {
  auditPresentationDocument,
  auditPresentationSource,
} from "../src/core/presentation-audit";
import { upsertPresentationContract } from "../src/core/presentation-contract";
import { projectPresentation } from "../src/core/presentation-projection";
import { buildStandaloneSlides } from "../src/core/presentation";
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

function parse(source: string): Document {
  return new DOMParser().parseFromString(source, "text/html");
}

const validSource = `<!doctype html><html><head></head><body><deck-stage data-editor-id="deck">
  <section data-editor-id="page-one"><h1 data-editor-id="title" data-build="1">One</h1></section>
  <section data-editor-id="page-two"><p data-editor-id="copy">Two</p></section>
</deck-stage></body></html>`;

describe("presentation static audit", () => {
  it("accepts a generated contract and reports a canonical projection", () => {
    const document = parse(validSource);
    upsertPresentationContract(document, projectPresentation(document, "html"));
    const report = auditPresentationDocument(document, "html");

    expect(report.valid).toBe(true);
    expect(report.legacy).toBe(false);
    expect(report.projection.pages.map(({ editorId }) => editorId)).toEqual(["page-one", "page-two"]);
    expect(report.issues.some(({ code }) => code === "projection-digest-mismatch")).toBe(false);
  });

  it("uses legacy compatibility mode when a contract is absent", () => {
    const report = auditPresentationSource(validSource, "legacy.html");
    expect(report.valid).toBe(true);
    expect(report.legacy).toBe(true);
    expect(report.issues.some(({ code, severity }) => code === "contract-absent" && severity === "WARNING")).toBe(true);
  });

  it("reports duplicate stable IDs before an importer could auto-heal them", () => {
    const document = parse(`<!doctype html><html><body><deck-stage>
      <section data-editor-id="page"><h1 data-editor-id="same">One</h1><p data-editor-id="same">Two</p></section>
    </deck-stage></body></html>`);
    const report = auditPresentationDocument(document, "html");
    expect(report.valid).toBe(false);
    expect(report.issues.some(({ code, severity }) => code === "duplicate-editor-id" && severity === "ERROR")).toBe(true);

    const imported = SourceDocument.parse(document.documentElement.outerHTML, "duplicate.html");
    expect(imported.warnings.some((warning) => warning.includes("duplicate-editor-id"))).toBe(true);
  });

  it("blocks malformed Build values and stale projection digests", () => {
    const document = parse(`<!doctype html><html><body><deck-stage data-editor-id="deck">
      <section data-editor-id="page"><h1 data-editor-id="title" data-build="later">One</h1></section>
    </deck-stage></body></html>`);
    const malformed = auditPresentationDocument(document, "html");
    expect(malformed.valid).toBe(false);
    expect(malformed.issues.some(({ code }) => code === "invalid-build-step")).toBe(true);

    const validDocument = parse(validSource);
    upsertPresentationContract(validDocument, projectPresentation(validDocument, "html"));
    validDocument.querySelector("section")?.setAttribute("data-build", "2");
    const stale = auditPresentationDocument(validDocument, "html");
    expect(stale.valid).toBe(false);
    expect(stale.issues.some(({ code }) => code === "projection-digest-mismatch")).toBe(true);
  });

  it("keeps runtime API scanning heuristic instead of treating it as proof", () => {
    const document = parse(`<!doctype html><html><body><deck-stage>
      <section data-editor-id="page">One</section>
    </deck-stage><script>stage.insertBefore(node, stage.firstChild);</script></body></html>`);
    const report = auditPresentationDocument(document, "html");
    expect(report.valid).toBe(true);
    expect(report.issues.some(({ code, severity }) => code === "runtime-structure-heuristic" && severity === "WARNING")).toBe(true);
  });

  it("reports malformed reversible payloads as blocking errors", () => {
    const report = auditPresentationSource(`<!doctype html><html><head>
      <meta name="lms-format" content="editable-html-presentation">
    </head><body><template id="lms-document-payload" data-encoding="base64-json">not-base64</template></body></html>`, "broken.html");
    expect(report.valid).toBe(false);
    expect(report.payloadChecksum).toBe("invalid");
    expect(report.issues[0]?.code).toBe("payload-invalid");
  });

  it("blocks an outer runtime that patches the embedded payload source", () => {
    const model = SourceDocument.parse(validSource, "wrapper.html");
    const exported = buildStandaloneSlides(model, new ProjectAssets(), "wrapper.html");
    const patched = exported.html.replace(
      "return payload.source;",
      `return payload.source.replace("</head>", "<style></style></head>");`,
    );
    const report = auditPresentationSource(patched, "patched-wrapper.html");

    expect(report.valid).toBe(false);
    expect(report.issues.some(({ code, severity }) => code === "outer-payload-patch" && severity === "ERROR")).toBe(true);

    const imported = SourceDocument.parse(patched, "patched-wrapper.html");
    expect(imported.warnings.some((warning) => warning.includes("outer-payload-patch"))).toBe(true);
  });
});
