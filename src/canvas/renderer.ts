import { getElementByEditorId } from "../core/ids";
import { resolveProjectPath, type ProjectAssets } from "../core/project";
import type { Bounds } from "../core/types";
import type { SourceDocument } from "../core/document-model";

export interface RendererCallbacks {
  onSelect: (elementId: string, options: { additive: boolean; parent: boolean }) => void;
  onInlineTextCommit: (elementId: string, text: string) => void;
  onWarning?: (message: string) => void;
}

const editorCss = `
  :host {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    color-scheme: light;
    background: white;
    contain: layout paint;
  }
  .editor-preview-shell {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .editor-preview-shell > body {
    display: block;
    box-sizing: border-box;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    margin: 0 !important;
    overflow: hidden;
  }
  [data-editor-id] {
    cursor: default;
  }
  [data-editor-id]:hover {
    outline: 1px dashed rgba(55, 116, 255, 0.7);
    outline-offset: 2px;
  }
  [data-editor-locked="true"] {
    cursor: not-allowed;
  }
  [data-editor-inline-editing="true"] {
    cursor: text;
    outline: 2px solid #3774ff !important;
    outline-offset: 2px;
  }
  .editor-inline-textarea {
    position: absolute;
    z-index: 2147483000;
    box-sizing: border-box;
    min-width: 48px;
    min-height: 30px;
    resize: none;
    padding: 2px 4px;
    border: 2px solid #3774ff;
    border-radius: 3px;
    outline: none;
    background: rgba(255, 255, 255, 0.97);
    box-shadow: 0 5px 22px rgba(17, 37, 78, 0.24);
    overflow: auto;
  }
`;

const staticPagesCss = `
  [data-editor-static-deck] {
    display: block !important;
    position: relative !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    overflow: hidden !important;
    visibility: visible !important;
    opacity: 1 !important;
  }
  [data-editor-preview-page-root] {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
  [data-editor-preview-page-root="active"] {
    display: block !important;
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
  }
`;

function styleElement(text: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = text;
  return style;
}

function rewriteHtmlSelectors(css: string): string {
  return css
    .replace(/:root\b/g, ":host")
    .replace(/(^|[},]\s*)html(?=\s|[.#:[>+~{])/gm, "$1:host");
}

function isTextEditable(element: Element): boolean {
  const text = element.textContent?.trim();
  if (!text) return false;
  if (["text", "tspan", "p", "span", "label", "button", "h1", "h2", "h3", "h4", "h5", "h6", "li"].includes(element.localName)) return true;
  if (element.children.length === 0) return true;
  const inlineTags = new Set(["a", "b", "br", "cite", "code", "em", "i", "mark", "small", "span", "strong", "sub", "sup", "tspan", "u"]);
  return Array.from(element.querySelectorAll("*")).every((child) => inlineTags.has(child.localName));
}

export class CanvasRenderer {
  readonly shadow: ShadowRoot;
  private model: SourceDocument | null = null;
  private assets: ProjectAssets | null = null;
  private sourcePath = "index.html";
  private callbacks: RendererCallbacks;
  private previewRoot: Element | null = null;
  private inlineFinish: ((commit: boolean) => void) | null = null;

  constructor(readonly host: HTMLElement, callbacks: RendererCallbacks) {
    this.callbacks = callbacks;
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    this.shadow.addEventListener("click", this.handleClick, { capture: true });
    this.shadow.addEventListener("dblclick", this.handleDoubleClick, { capture: true });
  }

  setCallbacks(callbacks: RendererCallbacks): void {
    this.callbacks = callbacks;
  }

  render(model: SourceDocument, assets: ProjectAssets, sourcePath: string, activePageId?: string): void {
    this.inlineFinish?.(false);
    this.model = model;
    this.assets = assets;
    this.sourcePath = sourcePath;
    this.shadow.replaceChildren();
    this.shadow.append(styleElement(editorCss));

    if (model.kind === "html") this.renderHtml(model, activePageId);
    else this.renderSvg(model);
  }

  private renderHtml(model: SourceDocument, activePageId?: string): void {
    for (const sourceStyle of Array.from(model.document.querySelectorAll("head style"))) {
      const css = rewriteHtmlSelectors(this.assets?.rewriteCssUrls(sourceStyle.textContent ?? "", this.sourcePath) ?? (sourceStyle.textContent ?? ""));
      this.shadow.append(styleElement(css));
    }

    for (const link of Array.from(model.document.querySelectorAll('head link[rel~="stylesheet"][href]'))) {
      const href = link.getAttribute("href") ?? "";
      const path = resolveProjectPath(href, this.sourcePath);
      const css = path ? this.assets?.text(path) : null;
      if (css !== null && css !== undefined) {
        this.shadow.append(styleElement(rewriteHtmlSelectors(this.assets?.rewriteCssUrls(css, path!) ?? css)));
      } else {
        this.callbacks.onWarning?.(`样式表未载入预览：${href}`);
      }
    }

    const pages = model.pages();
    if (pages.length > 1) this.shadow.append(styleElement(staticPagesCss));

    const shell = document.createElement("div");
    shell.className = "editor-preview-shell";
    const body = model.document.body.cloneNode(true) as HTMLBodyElement;
    if (pages.length > 1) {
      const resolvedActiveId = pages.some((page) => page.id === activePageId) ? activePageId : pages[0]!.id;
      for (const page of pages) {
        const pageRoot = getElementByEditorId(body, page.id);
        pageRoot?.setAttribute("data-editor-preview-page-root", page.id === resolvedActiveId ? "active" : "inactive");
      }
      const activeRoot = resolvedActiveId ? getElementByEditorId(body, resolvedActiveId) : null;
      let ancestor = activeRoot?.parentElement ?? null;
      while (ancestor && ancestor !== body) {
        ancestor.setAttribute("data-editor-static-deck", "");
        ancestor = ancestor.parentElement;
      }
    }
    this.rewriteResourceReferences(body);
    shell.append(body);
    this.shadow.append(shell);
    this.previewRoot = body;
  }

  private renderSvg(model: SourceDocument): void {
    const shell = document.createElement("div");
    shell.className = "editor-preview-shell";
    const svg = model.document.documentElement.cloneNode(true) as SVGSVGElement;
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.display = "block";
    this.rewriteResourceReferences(svg);
    shell.append(svg);
    this.shadow.append(shell);
    this.previewRoot = svg;
  }

  private rewriteResourceReferences(root: Element): void {
    if (!this.assets) return;
    for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
      for (const attributeName of ["src", "poster", "href", "xlink:href"]) {
        const value = element.getAttribute(attributeName);
        if (!value) continue;
        const resolved = this.assets.resolveUrl(value, this.sourcePath);
        if (resolved !== value) element.setAttribute(attributeName, resolved);
      }
      const style = element.getAttribute("style");
      if (style?.includes("url(")) element.setAttribute("style", this.assets.rewriteCssUrls(style, this.sourcePath));
    }
  }

  private elementFromEvent(event: Event): Element | null {
    for (const node of event.composedPath()) {
      if (node instanceof Element && node.hasAttribute("data-editor-id")) return node;
    }
    return null;
  }

  private handleClick = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    const element = this.elementFromEvent(event);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    let target = element;
    if (mouseEvent.altKey) {
      const parent = element.parentElement?.closest("[data-editor-id]");
      if (parent) target = parent;
    }
    const id = target.getAttribute("data-editor-id");
    if (id) this.callbacks.onSelect(id, { additive: mouseEvent.ctrlKey || mouseEvent.metaKey || mouseEvent.shiftKey, parent: mouseEvent.altKey });
  };

  private handleDoubleClick = (event: Event): void => {
    const element = this.elementFromEvent(event);
    if (!element || !isTextEditable(element) || element.getAttribute("data-editor-locked") === "true") return;
    event.preventDefault();
    event.stopPropagation();
    const id = element.getAttribute("data-editor-id");
    if (!id) return;
    this.callbacks.onSelect(id, { additive: false, parent: false });
    this.beginInlineTextEditing(element, id);
  };

  private beginInlineTextEditing(element: Element, id: string): void {
    this.inlineFinish?.(false);
    const shell = this.shadow.querySelector<HTMLElement>(".editor-preview-shell");
    const bounds = this.bounds(id);
    if (!shell || !bounds) return;

    const original = element.textContent ?? "";
    const computed = getComputedStyle(element);
    const editor = document.createElement("textarea");
    editor.className = "editor-inline-textarea";
    editor.value = original;
    editor.setAttribute("aria-label", `编辑文字：${id}`);
    editor.title = "Ctrl/Cmd + Enter 完成，Esc 取消";
    editor.spellcheck = false;
    editor.style.left = `${bounds.x}px`;
    editor.style.top = `${bounds.y}px`;
    editor.style.width = `${Math.max(48, bounds.width)}px`;
    editor.style.height = `${Math.max(30, bounds.height)}px`;
    editor.style.fontFamily = computed.fontFamily;
    editor.style.fontSize = computed.fontSize;
    editor.style.fontWeight = computed.fontWeight;
    editor.style.fontStyle = computed.fontStyle;
    editor.style.lineHeight = computed.lineHeight === "normal" ? "1.2" : computed.lineHeight;
    editor.style.letterSpacing = computed.letterSpacing;
    editor.style.textAlign = computed.textAlign;
    editor.style.color = element.namespaceURI === "http://www.w3.org/2000/svg" ? computed.fill : computed.color;
    element.setAttribute("data-editor-inline-editing", "true");
    shell.append(editor);

    let finished = false;
    const finish = (commit: boolean): void => {
      if (finished) return;
      finished = true;
      this.inlineFinish = null;
      editor.removeEventListener("blur", onBlur);
      editor.removeEventListener("keydown", onKeyDown);
      element.removeAttribute("data-editor-inline-editing");
      const next = editor.value;
      editor.remove();
      if (commit && next !== original) this.callbacks.onInlineTextCommit(id, next);
    };
    const onBlur = (): void => finish(true);
    const onKeyDown = (keyboardEvent: KeyboardEvent): void => {
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        finish(false);
      } else if (keyboardEvent.key === "Enter" && (keyboardEvent.ctrlKey || keyboardEvent.metaKey)) {
        keyboardEvent.preventDefault();
        finish(true);
      }
    };
    this.inlineFinish = finish;
    editor.addEventListener("blur", onBlur, { once: true });
    editor.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => {
      editor.focus();
      editor.select();
    });
  }

  element(elementId: string): Element | null {
    return this.previewRoot ? getElementByEditorId(this.previewRoot, elementId) : null;
  }

  modelElement(elementId: string): Element | null {
    return this.model?.find(elementId) ?? null;
  }

  bounds(elementId: string): Bounds | null {
    const element = this.element(elementId);
    if (!element) return null;
    const elementRect = element.getBoundingClientRect();
    const hostRect = this.host.getBoundingClientRect();
    const scaleX = hostRect.width / this.host.offsetWidth || 1;
    const scaleY = hostRect.height / this.host.offsetHeight || 1;
    return {
      x: (elementRect.left - hostRect.left) / scaleX,
      y: (elementRect.top - hostRect.top) / scaleY,
      width: elementRect.width / scaleX,
      height: elementRect.height / scaleY,
    };
  }

  selectedBounds(ids: string[]): Bounds[] {
    return ids.map((id) => this.bounds(id)).filter((bounds): bounds is Bounds => bounds !== null);
  }

  containsNode(node: Node): boolean {
    return this.shadow.contains(node);
  }
}
