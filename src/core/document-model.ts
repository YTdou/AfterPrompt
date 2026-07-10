import { applyEditorCommand, buildStructureSummary, summarizeElement } from "./commands";
import { allEditableElements, ensureStableIds, getElementByEditorId, isEditableElement } from "./ids";
import { sanitizeDocument } from "./sanitizer";
import type {
  Bounds,
  CanvasSize,
  CommandResult,
  DocumentKind,
  DocumentSnapshot,
  EditorCommand,
  ElementSummary,
  ElementTreeNode,
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
  return {
    width: positiveNumber(body.getAttribute("data-editor-canvas-width"), positiveNumber(style.width, DEFAULT_CANVAS.width)),
    height: positiveNumber(body.getAttribute("data-editor-canvas-height"), positiveNumber(style.height, DEFAULT_CANVAS.height)),
  };
}

export function serializeDocument(document: Document, kind: DocumentKind): string {
  if (kind === "html") return `<!doctype html>\n${document.documentElement.outerHTML}\n`;
  const serializerClass = document.defaultView?.XMLSerializer ?? globalThis.XMLSerializer;
  if (!serializerClass) throw new Error("XMLSerializer is not available in this runtime.");
  const serialized = new serializerClass().serializeToString(document.documentElement);
  return `${serialized.startsWith("<?xml") ? "" : '<?xml version="1.0" encoding="UTF-8"?>\n'}${serialized}\n`;
}

function treeLabel(element: Element): string {
  const explicit = element.getAttribute("data-editor-name") ?? element.getAttribute("aria-label");
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
    const kind = forcedKind ?? detectDocumentKind(source, sourceName);
    const parser = new DOMParser();
    const document = parser.parseFromString(source, kind === "svg" ? "image/svg+xml" : "text/html");
    return SourceDocument.fromDocument(document, kind, sourceName, canvas);
  }

  static fromDocument(document: Document, kind: DocumentKind, sourceName = "untitled.html", canvas?: CanvasSize): SourceDocument {
    const parseError = document.querySelector("parsererror");
    if (parseError) throw new Error(`Source could not be parsed: ${parseError.textContent?.replace(/\s+/g, " ").trim()}`);
    if (kind === "svg" && document.documentElement.localName !== "svg") throw new Error("The SVG source has no <svg> root element.");
    if (kind === "html" && !document.body) throw new Error("The HTML source has no <body> element.");

    const warnings = sanitizeDocument(document, kind);
    const assigned = ensureStableIds(document, kind);
    if (assigned > 0) warnings.push(`已为 ${assigned} 个可编辑节点添加稳定 data-editor-id。`);
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

  editableElements(): Element[] {
    return allEditableElements(this.document, this.kind);
  }

  snapshot(selectedIds: string[] = []): DocumentSnapshot {
    return {
      source: this.serialize(),
      kind: this.kind,
      canvas: { ...this.canvas },
      sourceName: this.sourceName,
      selectedIds: [...selectedIds],
    };
  }
}

export function snapshotsEqual(left: DocumentSnapshot, right: DocumentSnapshot): boolean {
  return left.source === right.source &&
    left.kind === right.kind &&
    left.canvas.width === right.canvas.width &&
    left.canvas.height === right.canvas.height &&
    left.sourceName === right.sourceName;
}
