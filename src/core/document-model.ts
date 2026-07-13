import { applyEditorCommand, buildStructureSummary, summarizeElement } from "./commands";
import { assignFreshIds, allEditableElements, ensureStableIds, getElementByEditorId, isEditableElement } from "./ids";
import { sanitizeDocument } from "./sanitizer";
import { refreshClonedFragmentInstances } from "./fragments/component";
import { decodeEditableHtml } from "./editable-html";
import { refreshDeterministicTypography } from "./typography";
import {
  deriveBuildSequence,
  mergeBuildGroups,
  moveBuildGroup,
  normalizeBuildSteps,
  readBuildStep,
  setElementBuild,
  splitBuildGroup,
} from "./builds";
import type {
  Bounds,
  BuildViewMode,
  CanvasSize,
  CommandResult,
  DocumentKind,
  DocumentPage,
  DocumentSnapshot,
  EditorCommand,
  ElementSummary,
  ElementTreeNode,
  PageBuildSequence,
  StructureSummary,
} from "./types";

const DEFAULT_CANVAS: CanvasSize = { width: 1280, height: 720 };

function positiveNumber(value: string | null, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function detectDocumentKind(source: string, fileName = ""): DocumentKind {
  if (fileName.toLowerCase().endsWith(".svg")) return "svg";
  const normalized = source.replace(/^\s*(?:<\?xml[^>]*>\s*)?/i, "");
  return /^<svg(?:\s|>)/i.test(normalized) ? "svg" : "html";
}

export function detectCanvas(document: Document, kind: DocumentKind): CanvasSize {
  if (kind === "svg") {
    const svg = document.documentElement;
    const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    const viewWidth = viewBox?.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2]! : DEFAULT_CANVAS.width;
    const viewHeight = viewBox?.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3]! : DEFAULT_CANVAS.height;
    return {
      width: positiveNumber(svg.getAttribute("width"), viewWidth),
      height: positiveNumber(svg.getAttribute("height"), viewHeight),
    };
  }

  const body = document.body;
  if (!body) return { ...DEFAULT_CANVAS };
  const style = (body as HTMLElement).style;
  const deck = body.querySelector("deck-stage[width][height], [data-editor-deck][width][height]");
  const deckWidth = deck?.getAttribute("width") ?? null;
  const deckHeight = deck?.getAttribute("height") ?? null;
  return {
    width: positiveNumber(body.getAttribute("data-editor-canvas-width"), positiveNumber(deckWidth, positiveNumber(style.width, DEFAULT_CANVAS.width))),
    height: positiveNumber(body.getAttribute("data-editor-canvas-height"), positiveNumber(deckHeight, positiveNumber(style.height, DEFAULT_CANVAS.height))),
  };
}

function uniqueElements(elements: Element[]): Element[] {
  return elements.filter((element, index) => elements.indexOf(element) === index);
}

export function detectPageElements(document: Document, kind: DocumentKind): Element[] {
  if (kind !== "html" || !document.body) return [];
  const selectors = [
    "deck-stage > section",
    "[data-editor-deck] > section",
    ".slides > section",
    "[data-slides] > section",
  ];
  for (const selector of selectors) {
    const candidates = uniqueElements(Array.from(document.body.querySelectorAll(selector)));
    if (candidates.length > 0) return candidates;
  }

  const directCandidates = Array.from(document.body.children).filter((element) =>
    element.matches("section[data-slide], section[data-label], section.slide, [data-slide].slide"),
  );
  return directCandidates.length > 1 ? directCandidates : [];
}

function pageLabel(element: Element, index: number): string {
  const explicit = element.getAttribute("data-label") ?? element.getAttribute("aria-label") ?? element.getAttribute("data-editor-name");
  if (explicit?.trim()) return explicit.trim();
  const numbered = element.matches("[data-slide]") ? element : element.querySelector("[data-slide]");
  const number = numbered?.getAttribute("data-slide")?.trim();
  const heading = element.querySelector("h1, h2, h3, [role='heading']")?.textContent?.replace(/\s+/g, " ").trim();
  if (heading) return heading.slice(0, 72);
  return number ? `Slide ${number}` : `Slide ${index + 1}`;
}

export function serializeDocument(document: Document, kind: DocumentKind): string {
  if (kind === "html") return `<!doctype html>\n${document.documentElement.outerHTML}\n`;
  const serializerClass = document.defaultView?.XMLSerializer ?? globalThis.XMLSerializer;
  if (!serializerClass) throw new Error("XMLSerializer is not available in this runtime.");
  const serialized = new serializerClass().serializeToString(document.documentElement);
  return `${serialized.startsWith("<?xml") ? "" : '<?xml version="1.0" encoding="UTF-8"?>\n'}${serialized}\n`;
}

function treeLabel(element: Element): string {
  const explicit = element.getAttribute("data-editor-name") ?? element.getAttribute("aria-label") ?? element.getAttribute("data-label");
  if (explicit) return explicit;
  const text = element.children.length === 0 ? element.textContent?.replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, 36) : element.localName;
}

function toTree(element: Element, kind: DocumentKind): ElementTreeNode {
  return {
    id: element.getAttribute("data-editor-id") ?? "",
    tag: element.localName,
    name: treeLabel(element),
    text: element.children.length === 0 ? element.textContent?.trim().slice(0, 120) : undefined,
    locked: element.getAttribute("data-editor-locked") === "true",
    visible: element.getAttribute("data-editor-visible") !== "false" && !element.hasAttribute("hidden") && (element as HTMLElement | SVGElement).style.display !== "none",
    children: Array.from(element.children)
      .filter((child) => isEditableElement(child, kind) && child.hasAttribute("data-editor-id"))
      .map((child) => toTree(child, kind)),
  };
}

export class SourceDocument {
  readonly document: Document;
  readonly kind: DocumentKind;
  readonly warnings: string[];
  sourceName: string;
  canvas: CanvasSize;

  private constructor(document: Document, kind: DocumentKind, sourceName: string, warnings: string[], canvas?: CanvasSize) {
    this.document = document;
    this.kind = kind;
    this.sourceName = sourceName;
    this.warnings = warnings;
    this.canvas = canvas ?? detectCanvas(document, kind);
    this.writeCanvasMetadata();
  }

  static parse(source: string, sourceName = "untitled.html", forcedKind?: DocumentKind, canvas?: CanvasSize): SourceDocument {
    if (!source.trim()) throw new Error("Source is empty.");
    const editable = forcedKind === "svg" ? null : decodeEditableHtml(source, sourceName);
    if (editable) {
      source = editable.payload.source;
      sourceName = editable.payload.sourceName || sourceName;
      canvas = editable.payload.canvas;
    }
    const kind = forcedKind ?? detectDocumentKind(source, sourceName);
    const parser = new DOMParser();
    const document = parser.parseFromString(source, kind === "svg" ? "image/svg+xml" : "text/html");
    const model = SourceDocument.fromDocument(document, kind, sourceName, canvas);
    if (editable?.legacy) model.warnings.push("已从旧版 Last Mile Studio Slides 文件恢复可编辑源文档；再次导出会升级为可逆 HTML 格式。");
    return model;
  }

  static fromDocument(document: Document, kind: DocumentKind, sourceName = "untitled.html", canvas?: CanvasSize): SourceDocument {
    const parseError = document.querySelector("parsererror");
    if (parseError) throw new Error(`Source could not be parsed: ${parseError.textContent?.replace(/\s+/g, " ").trim()}`);
    if (kind === "svg" && document.documentElement.localName !== "svg") throw new Error("The SVG source has no <svg> root element.");
    if (kind === "html" && !document.body) throw new Error("The HTML source has no <body> element.");

    const assigned = ensureStableIds(document, kind);
    if (kind === "html") refreshDeterministicTypography(document);
    // Keep the canonical source lossless. DOMParser does not execute scripts;
    // executable content is removed from a disposable clone by the renderer.
    const safetyClone = document.cloneNode(true) as Document;
    const warnings = sanitizeDocument(safetyClone, kind);
    if (assigned > 0) warnings.push(`已为 ${assigned} 个可编辑节点添加稳定 data-editor-id。`);
    const pageCount = detectPageElements(document, kind).length;
    if (pageCount > 1) warnings.push(`已识别 ${pageCount} 页静态演示稿；可使用画布上方的页面选择器逐页编辑。`);
    return new SourceDocument(document, kind, sourceName, warnings, canvas);
  }

  private writeCanvasMetadata(): void {
    if (this.kind === "svg") {
      const svg = this.document.documentElement;
      svg.setAttribute("width", String(this.canvas.width));
      svg.setAttribute("height", String(this.canvas.height));
      if (!svg.hasAttribute("viewBox")) svg.setAttribute("viewBox", `0 0 ${this.canvas.width} ${this.canvas.height}`);
    } else if (this.document.body) {
      this.document.body.setAttribute("data-editor-canvas-width", String(this.canvas.width));
      this.document.body.setAttribute("data-editor-canvas-height", String(this.canvas.height));
      const deck = this.document.body.querySelector("deck-stage, [data-editor-deck]");
      if (deck) {
        deck.setAttribute("width", String(this.canvas.width));
        deck.setAttribute("height", String(this.canvas.height));
      }
    }
  }

  setCanvas(canvas: CanvasSize): void {
    this.canvas = {
      width: Math.max(1, Math.round(canvas.width)),
      height: Math.max(1, Math.round(canvas.height)),
    };
    this.writeCanvasMetadata();
  }

  serialize(): string {
    return serializeDocument(this.document, this.kind);
  }

  find(elementId: string): Element | null {
    return getElementByEditorId(this.document, elementId);
  }

  apply(command: EditorCommand): CommandResult {
    if (command.action === "setElementBuild") {
      setElementBuild(this.document, command.elementIds, command.step);
      return { action: command.action, elementId: command.elementIds[0] ?? "" };
    }
    if (command.action === "moveBuildGroup" || command.action === "mergeBuildGroups" || command.action === "splitBuildGroup") {
      const page = this.find(command.pageId);
      const pages = this.pages();
      const fallbackRootId = pages.length === 0 ? this.editingRoot(0)?.getAttribute("data-editor-id") : null;
      if (!page || !(pages.some(({ id }) => id === command.pageId) || fallbackRootId === command.pageId)) {
        throw new Error(`Presentation page not found: ${command.pageId}`);
      }
      if (command.action === "moveBuildGroup") moveBuildGroup(this.document, page, command.fromStep, command.toStep);
      else if (command.action === "mergeBuildGroups") mergeBuildGroups(this.document, page, command.sourceStep, command.targetStep);
      else splitBuildGroup(this.document, page, command.elementIds, command.targetPosition);
      return { action: command.action, elementId: command.pageId };
    }
    return applyEditorCommand(this.document, this.kind, command);
  }

  summary(boundsResolver?: (element: Element) => Bounds | null): StructureSummary {
    return buildStructureSummary(this.document, this.kind, this.canvas, boundsResolver);
  }

  elementSummary(elementId: string, boundsResolver?: (element: Element) => Bounds | null): ElementSummary | null {
    const element = this.find(elementId);
    return element ? summarizeElement(element, this.kind, boundsResolver) : null;
  }

  tree(): ElementTreeNode[] {
    const root = this.kind === "html" ? this.document.body : this.document.documentElement;
    if (!root) return [];
    return [toTree(root, this.kind)];
  }

  pages(): DocumentPage[] {
    return detectPageElements(this.document, this.kind).map((element, index) => ({
      id: element.getAttribute("data-editor-id") ?? "",
      label: pageLabel(element, index),
      index,
    })).filter((page) => Boolean(page.id));
  }

  pageElement(index: number): Element | null {
    return detectPageElements(this.document, this.kind)[index] ?? null;
  }

  buildSequence(index: number): PageBuildSequence {
    const page = this.pageElement(index) ?? this.editingRoot(index);
    if (!page) return { pageId: "", steps: [], groups: [], maxStep: 0, elementCount: 0, warnings: [] };
    return deriveBuildSequence(page);
  }

  buildStepForElement(elementId: string): number | null {
    const element = this.find(elementId);
    return element ? readBuildStep(element) : null;
  }

  setElementBuild(elementIds: string[], step: number | null): void {
    setElementBuild(this.document, elementIds, step);
  }

  normalizeBuildSteps(index: number): void {
    const page = this.pageElement(index) ?? this.editingRoot(index);
    if (page) normalizeBuildSteps(this.document, page);
  }

  duplicatePage(index: number): string {
    if (this.kind !== "html") throw new Error("Only HTML presentations support page duplication.");
    const page = this.pageElement(index);
    if (!page?.parentElement) throw new Error("The selected presentation page cannot be duplicated.");
    const clone = page.cloneNode(true) as Element;
    assignFreshIds(clone, this.document, this.kind);
    refreshClonedFragmentInstances(clone, this.document);
    const label = pageLabel(page, index);
    clone.setAttribute("data-label", `${label} Copy`);
    page.after(clone);
    const id = clone.getAttribute("data-editor-id");
    if (!id) throw new Error("Failed to assign a stable ID to the duplicated page.");
    return id;
  }

  deletePage(index: number): string {
    if (this.kind !== "html") throw new Error("Only HTML presentations support page deletion.");
    const pages = detectPageElements(this.document, this.kind);
    if (pages.length <= 1) throw new Error("A presentation must keep at least one page.");
    const page = pages[index];
    if (!page) throw new Error("The selected presentation page no longer exists.");
    const id = page.getAttribute("data-editor-id") ?? "";
    page.remove();
    return id;
  }

  movePage(fromIndex: number, toIndex: number): number {
    if (this.kind !== "html") throw new Error("Only HTML presentations support page sorting.");
    const pages = detectPageElements(this.document, this.kind);
    if (pages.length < 2) return 0;
    const from = Math.min(Math.max(0, Math.trunc(fromIndex)), pages.length - 1);
    const to = Math.min(Math.max(0, Math.trunc(toIndex)), pages.length - 1);
    if (from === to) return from;
    const page = pages[from]!;
    const target = pages[to]!;
    if (page.parentElement !== target.parentElement) throw new Error("Presentation pages must share one container before they can be sorted.");
    if (from < to) target.after(page);
    else target.before(page);
    return detectPageElements(this.document, this.kind).indexOf(page);
  }

  treeForPage(index: number): ElementTreeNode[] {
    const root = this.pageElement(index);
    return root ? [toTree(root, this.kind)] : this.tree();
  }

  editingRoot(index: number): Element | null {
    return this.pageElement(index) ?? (this.kind === "html" ? this.document.body : this.document.documentElement);
  }

  elementBelongsToPage(elementId: string, index: number): boolean {
    const page = this.pageElement(index);
    const element = this.find(elementId);
    return !page || Boolean(element && (element === page || page.contains(element)));
  }

  editableElements(): Element[] {
    return allEditableElements(this.document, this.kind);
  }

  snapshot(
    selectedIds: string[] = [],
    activePageId?: string,
    buildStepsByPage?: Record<string, number>,
    buildViewMode?: BuildViewMode,
  ): DocumentSnapshot {
    return {
      source: this.serialize(),
      kind: this.kind,
      canvas: { ...this.canvas },
      sourceName: this.sourceName,
      selectedIds: [...selectedIds],
      activePageId,
      buildStepsByPage: buildStepsByPage ? { ...buildStepsByPage } : undefined,
      buildViewMode,
    };
  }
}

export function snapshotsEqual(left: DocumentSnapshot, right: DocumentSnapshot): boolean {
  const assetsEqual = (left.assets ?? []).length === (right.assets ?? []).length &&
    (left.assets ?? []).every((asset, index) => {
      const candidate = right.assets?.[index];
      return Boolean(candidate && asset.path === candidate.path && asset.mimeType === candidate.mimeType &&
        (asset.bytes === candidate.bytes || asset.bytes.length === candidate.bytes.length && asset.bytes.every((value, byteIndex) => value === candidate.bytes[byteIndex])));
    });
  return left.source === right.source &&
    left.kind === right.kind &&
    left.canvas.width === right.canvas.width &&
    left.canvas.height === right.canvas.height &&
    left.sourceName === right.sourceName &&
    assetsEqual;
}
