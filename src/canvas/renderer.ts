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
  if (["text", "tspan", "p", "span", "label", "button", "h1", "h2", "h3", "h4", "h5", "h6", "li"].includes(element.localName)) return true;
  return element.children.length === 0 && Boolean(element.textContent?.trim());
}

export class CanvasRenderer {
  readonly shadow: ShadowRoot;
  private model: SourceDocument | null = null;
  private assets: ProjectAssets | null = null;
  private sourcePath = "index.html";
  private callbacks: RendererCallbacks;
  private previewRoot: Element | null = null;

  constructor(readonly host: HTMLElement, callbacks: RendererCallbacks) {
    this.callbacks = callbacks;
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    this.shadow.addEventListener("click", this.handleClick, { capture: true });
    this.shadow.addEventListener("dblclick", this.handleDoubleClick, { capture: true });
  }

  setCallbacks(callbacks: RendererCallbacks): void {
    this.callbacks = callbacks;
  }

  render(model: SourceDocument, assets: ProjectAssets, sourcePath: string): void {
    this.model = model;
    this.assets = assets;
    this.sourcePath = sourcePath;
    this.shadow.replaceChildren();
    this.shadow.append(styleElement(editorCss));

    if (model.kind === "html") this.renderHtml(model);
    else this.renderSvg(model);
  }

  private renderHtml(model: SourceDocument): void {
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

    const shell = document.createElement("div");
    shell.className = "editor-preview-shell";
    const body = model.document.body.cloneNode(true) as HTMLBodyElement;
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
    this.beginInlineTextEditing(element, id);
  };

  private beginInlineTextEditing(element: Element, id: string): void {
    const htmlElement = element as HTMLElement;
    const original = htmlElement.textContent ?? "";
    htmlElement.setAttribute("contenteditable", "plaintext-only");
    htmlElement.setAttribute("data-editor-inline-editing", "true");
    htmlElement.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(htmlElement);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const finish = (commit: boolean): void => {
      htmlElement.removeAttribute("contenteditable");
      htmlElement.removeAttribute("data-editor-inline-editing");
      if (!commit) htmlElement.textContent = original;
      else this.callbacks.onInlineTextCommit(id, htmlElement.textContent ?? "");
      htmlElement.removeEventListener("blur", onBlur);
      htmlElement.removeEventListener("keydown", onKeyDown);
    };
    const onBlur = (): void => finish(true);
    const onKeyDown = (keyboardEvent: KeyboardEvent): void => {
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        finish(false);
      } else if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey && element.localName !== "text") {
        keyboardEvent.preventDefault();
        finish(true);
      }
    };
    htmlElement.addEventListener("blur", onBlur, { once: true });
    htmlElement.addEventListener("keydown", onKeyDown);
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
