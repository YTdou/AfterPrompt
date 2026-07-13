import { deriveBuildSequence } from "./builds";
import type { DocumentKind, PageBuildSequence } from "./types";

export const PRESENTATION_PAGE_SELECTORS = [
  "deck-stage > section",
  "[data-editor-deck] > section",
  ".slides > section",
  "[data-slides] > section",
] as const;

export const PRESENTATION_PROJECTION_VERSION = 1;

export type PresentationProjectionMode = "deck" | "document-root" | "none";

export interface PresentationElementReference {
  tag: string;
  editorId: string | null;
  htmlId: string | null;
}

export interface PresentationBuildProjection {
  steps: number[];
  groups: Array<{ step: number; elementIds: string[] }>;
  warnings: Array<{ code: string; elementId: string; message: string }>;
}

export interface PresentationPageProjection extends PresentationElementReference {
  index: number;
  key: string | null;
  kind: string | null;
  build: PresentationBuildProjection;
}

export interface PresentationProjection {
  version: typeof PRESENTATION_PROJECTION_VERSION;
  documentKind: DocumentKind;
  mode: PresentationProjectionMode;
  strategy: string;
  container: PresentationElementReference | null;
  root: (PresentationElementReference & { build: PresentationBuildProjection }) | null;
  pages: PresentationPageProjection[];
}

export interface PresentationPageDetection {
  mode: PresentationProjectionMode;
  strategy: string;
  container: Element | null;
  pages: Element[];
  candidateParents: Element[];
}

function uniqueElements(elements: Element[]): Element[] {
  return elements.filter((element, index) => elements.indexOf(element) === index);
}

export function detectPresentationPages(document: Document, kind: DocumentKind): PresentationPageDetection {
  if (kind !== "html" || !document.body) {
    return { mode: "none", strategy: "none", container: null, pages: [], candidateParents: [] };
  }

  for (const selector of PRESENTATION_PAGE_SELECTORS) {
    const pages = uniqueElements(Array.from(document.body.querySelectorAll(selector)));
    if (pages.length === 0) continue;
    const candidateParents = uniqueElements(pages.map((page) => page.parentElement).filter((parent): parent is HTMLElement => Boolean(parent)));
    return {
      mode: "deck",
      strategy: selector,
      container: candidateParents.length === 1 ? candidateParents[0]! : null,
      pages,
      candidateParents,
    };
  }

  const directCandidates = Array.from(document.body.children).filter((element) =>
    element.matches("section[data-slide], section[data-label], section.slide, [data-slide].slide"),
  );
  if (directCandidates.length > 1) {
    return {
      mode: "deck",
      strategy: "body-direct-explicit-page",
      container: document.body,
      pages: directCandidates,
      candidateParents: [document.body],
    };
  }

  return {
    mode: "document-root",
    strategy: "document-body",
    container: document.body,
    pages: [],
    candidateParents: [document.body],
  };
}

function elementReference(element: Element): PresentationElementReference {
  return {
    tag: element.localName,
    editorId: element.getAttribute("data-editor-id"),
    htmlId: element.getAttribute("id"),
  };
}

function buildProjection(sequence: PageBuildSequence): PresentationBuildProjection {
  return {
    steps: [...sequence.steps],
    groups: sequence.groups.map((group) => ({ step: group.step, elementIds: [...group.elementIds] })),
    warnings: sequence.warnings.map((warning) => ({ ...warning })),
  };
}

export function projectPresentation(document: Document, kind: DocumentKind = "html"): PresentationProjection {
  const detection = detectPresentationPages(document, kind);
  const container = detection.container ? elementReference(detection.container) : null;
  const pages = detection.pages.map((page, index) => ({
    ...elementReference(page),
    index,
    key: page.getAttribute("data-key"),
    kind: page.getAttribute("data-kind"),
    build: buildProjection(deriveBuildSequence(page)),
  }));

  const root = detection.mode === "document-root" && document.body
    ? { ...elementReference(document.body), build: buildProjection(deriveBuildSequence(document.body)) }
    : null;

  return {
    version: PRESENTATION_PROJECTION_VERSION,
    documentKind: kind,
    mode: detection.mode,
    strategy: detection.strategy,
    container,
    root,
    pages,
  };
}

function digestValue(projection: PresentationProjection): string {
  return JSON.stringify({
    version: projection.version,
    documentKind: projection.documentKind,
    mode: projection.mode,
    container: projection.container,
    root: projection.root,
    pages: projection.pages,
  });
}

export function projectionDigest(projection: PresentationProjection): string {
  const bytes = new TextEncoder().encode(digestValue(projection));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export interface ProjectionDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

function comparableProjection(projection: PresentationProjection): unknown {
  return {
    version: projection.version,
    documentKind: projection.documentKind,
    mode: projection.mode,
    container: projection.container,
    root: projection.root,
    pages: projection.pages,
  };
}

export function comparePresentationProjections(
  expected: PresentationProjection,
  actual: PresentationProjection,
): ProjectionDifference[] {
  const left = comparableProjection(expected) as Record<string, unknown>;
  const right = comparableProjection(actual) as Record<string, unknown>;
  const differences: ProjectionDifference[] = [];

  for (const key of Object.keys(left)) {
    const expectedValue = JSON.stringify(left[key]);
    const actualValue = JSON.stringify(right[key]);
    if (expectedValue !== actualValue) {
      differences.push({ path: key, expected: left[key], actual: right[key] });
    }
  }
  return differences;
}
