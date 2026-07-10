import type { DocumentKind } from "./types";

const EDITOR_ID = "data-editor-id";

const ignoredHtmlTags = new Set([
  "html",
  "head",
  "meta",
  "title",
  "link",
  "style",
  "script",
  "noscript",
  "template",
]);

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function isEditableElement(element: Element, kind: DocumentKind): boolean {
  const isSvgNode = kind === "svg" || element.namespaceURI === "http://www.w3.org/2000/svg";
  if (isSvgNode) return !["defs", "style", "script", "title", "desc"].includes(element.localName);
  return !ignoredHtmlTags.has(element.localName);
}

export function getElementByEditorId(root: Document | Element, id: string): Element | null {
  for (const element of root.querySelectorAll(`[${EDITOR_ID}]`)) {
    if (element.getAttribute(EDITOR_ID) === id) return element;
  }
  if (root instanceof Element && root.getAttribute(EDITOR_ID) === id) return root;
  return null;
}

export function allEditableElements(document: Document, kind: DocumentKind): Element[] {
  const candidates = kind === "html"
    ? Array.from(document.body?.querySelectorAll("*") ?? [])
    : Array.from(document.documentElement?.querySelectorAll("*") ?? []);
  const root = kind === "html" ? document.body : document.documentElement;
  if (root) candidates.unshift(root);
  return candidates.filter((element, index) => candidates.indexOf(element) === index && isEditableElement(element, kind));
}

export function ensureStableIds(document: Document, kind: DocumentKind): number {
  const elements = allEditableElements(document, kind);
  const used = new Set<string>();
  const counters = new Map<string, number>();
  let assigned = 0;

  for (const element of elements) {
    const existing = element.getAttribute(EDITOR_ID)?.trim();
    if (existing && !used.has(existing)) {
      used.add(existing);
      continue;
    }

    const sourceId = slugify(element.getAttribute("id") ?? "");
    let base = sourceId || slugify(element.localName) || "element";
    if (element === document.body) base = "document-root";
    if (kind === "svg" && element === document.documentElement) base = "svg-root";

    let id = base;
    if (used.has(id) || (!sourceId && !base.endsWith("-root"))) {
      let counter = (counters.get(base) ?? 0) + 1;
      while (used.has(`${base}-${String(counter).padStart(3, "0")}`)) counter += 1;
      counters.set(base, counter);
      id = `${base}-${String(counter).padStart(3, "0")}`;
    }

    element.setAttribute(EDITOR_ID, id);
    used.add(id);
    assigned += 1;
  }

  return assigned;
}

export function assignFreshIds(root: Element, document: Document, kind: DocumentKind): void {
  const used = new Set(allEditableElements(document, kind).map((element) => element.getAttribute(EDITOR_ID)).filter(Boolean));
  const elements = [root, ...Array.from(root.querySelectorAll("*"))].filter((element) => isEditableElement(element, kind));

  for (const element of elements) {
    const original = slugify(element.getAttribute(EDITOR_ID) ?? element.localName) || "element";
    let counter = 2;
    let candidate = `${original}-copy`;
    while (used.has(candidate)) {
      candidate = `${original}-copy-${counter}`;
      counter += 1;
    }
    element.setAttribute(EDITOR_ID, candidate);
    used.add(candidate);
  }
}

export function createUniqueEditorId(document: Document, preferred: string): string {
  const base = slugify(preferred) || "element";
  if (!getElementByEditorId(document, base)) return base;
  let counter = 2;
  while (getElementByEditorId(document, `${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}
