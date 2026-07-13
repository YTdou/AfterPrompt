import { getElementByEditorId } from "../core/ids";
import { resolveProjectPath, type ProjectAssets } from "../core/project";
import type { Bounds, BuildViewMode } from "../core/types";
import type { SourceDocument } from "../core/document-model";
import { sanitizeCss, sanitizeDocument } from "../core/sanitizer";

export interface RendererCallbacks {
  onSelect: (elementId: string, options: { additive: boolean; parent: boolean }) => void;
  onInlineTextCommit: (elementId: string, text: string) => void;
  onWarning?: (message: string) => void;
}

export interface RenderOptions {
  interactive?: boolean;
  pruneInactivePages?: boolean;
  activeBuildStep?: number;
  buildViewMode?: BuildViewMode;
  focusedBuildStep?: number;
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
  .editor-inline-editor {
    position: absolute;
    z-index: 2147483000;
    display: grid;
    grid-template-rows: minmax(30px, 1fr) 30px;
    box-sizing: border-box;
    min-width: 120px;
    min-height: 60px;
    margin: 0;
    border: 2px solid #3774ff;
    border-radius: 3px;
    outline: none;
    background: rgba(255, 255, 255, 0.97);
    box-shadow: 0 5px 22px rgba(17, 37, 78, 0.24);
    overflow: hidden;
  }
  .editor-inline-textarea {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 30px;
    resize: none;
    padding: 2px 4px;
    border: 0;
    border-radius: 0;
    outline: none;
    background: transparent;
    overflow: auto;
  }
  .editor-inline-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding: 3px 5px;
    border-top: 1px solid rgba(55, 116, 255, 0.24);
    background: #eef3ff;
    font: 11px/1.2 ui-sans-serif, system-ui, sans-serif;
  }
  .editor-inline-actions span {
    min-width: 0;
    margin-right: auto;
    overflow: hidden;
    color: #53627d;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor-inline-actions button {
    min-height: 22px;
    padding: 2px 8px;
    border: 1px solid #b8c6e5;
    border-radius: 4px;
    background: white;
    color: #283b62;
    cursor: pointer;
    font: inherit;
  }
  .editor-inline-actions button[type="submit"] {
    border-color: #3774ff;
    background: #3774ff;
    color: white;
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

const nonInteractiveCss = `
  .editor-preview-shell,
  .editor-preview-shell * {
    pointer-events: none !important;
    cursor: default !important;
  }
  [data-editor-id]:hover {
    outline: none !important;
  }
`;

const buildPreviewCss = `
  [data-editor-build-visibility="hidden"] {
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
  [data-editor-build-view="all"] [data-build],
  [data-editor-build-view="group"] [data-build] {
    visibility: visible !important;
    pointer-events: auto !important;
    filter: none !important;
    outline: 2px dashed rgba(91, 140, 255, .72);
    outline-offset: 2px;
  }
  [data-editor-build-view="all"] [data-editor-build-relation="past"] { opacity: .68 !important; }
  [data-editor-build-view="all"] [data-editor-build-relation="current"] { opacity: 1 !important; outline-style: solid; }
  [data-editor-build-view="all"] [data-editor-build-relation="future"] { opacity: .32 !important; }
  [data-editor-build-view="group"] [data-editor-build-relation="past"] { opacity: .5 !important; }
  [data-editor-build-view="group"] [data-editor-build-relation="current"] { opacity: 1 !important; outline: 3px solid #5b8cff; }
  [data-editor-build-view="group"] [data-editor-build-relation="future"] { opacity: .18 !important; }
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

function cloneBodyWithPageBranch(sourceBody: HTMLElement, sourcePage: Element): HTMLElement {
  const body = sourceBody.cloneNode(false) as HTMLElement;
  let branch = sourcePage.cloneNode(true) as Element;
  let ancestor = sourcePage.parentElement;
  while (ancestor && ancestor !== sourceBody) {
    const ancestorClone = ancestor.cloneNode(false) as Element;
    ancestorClone.append(branch);
    branch = ancestorClone;
    ancestor = ancestor.parentElement;
  }
  body.append(branch);
  return body;
}

export class CanvasRenderer {
  readonly shadow: ShadowRoot;
  private model: SourceDocument | null = null;
  private assets: ProjectAssets | null = null;
  private sourcePath = "index.html";
  private callbacks: RendererCallbacks;
  private previewRoot: Element | null = null;
  private inlineFinish: ((commit: boolean) => void) | null = null;
  private interactive = true;

  constructor(readonly host: HTMLElement, callbacks: RendererCallbacks) {
    this.callbacks = callbacks;
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    this.shadow.addEventListener("click", this.handleClick, { capture: true });
    this.shadow.addEventListener("dblclick", this.handleDoubleClick, { capture: true });
  }

  setCallbacks(callbacks: RendererCallbacks): void {
    this.callbacks = callbacks;
  }

  render(model: SourceDocument, assets: ProjectAssets, sourcePath: string, activePageId?: string, options: RenderOptions = {}): void {
    this.inlineFinish?.(false);
    this.model = model;
    this.assets = assets;
    this.sourcePath = sourcePath;
    this.interactive = options.interactive !== false;
    this.shadow.replaceChildren();
    this.shadow.append(styleElement(editorCss));
    this.shadow.append(styleElement(buildPreviewCss));

    if (model.kind === "html") this.renderHtml(model, activePageId, options);
    else this.renderSvg(model);
    // Append this last so imported/static-page styles cannot re-enable pointer handling.
    if (!this.interactive) this.shadow.append(styleElement(nonInteractiveCss));
  }

  private renderHtml(model: SourceDocument, activePageId: string | undefined, options: RenderOptions): void {
    for (const sourceStyle of Array.from(model.document.querySelectorAll("head style"))) {
      const warnings: string[] = [];
      const safeCss = sanitizeCss(sourceStyle.textContent ?? "", warnings);
      const css = rewriteHtmlSelectors(this.assets?.rewriteCssUrls(safeCss, this.sourcePath) ?? safeCss);
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
    if (pages.length > 0) this.shadow.append(styleElement(staticPagesCss));

    const shell = document.createElement("div");
    shell.className = "editor-preview-shell";
    const resolvedActiveId = pages.some((page) => page.id === activePageId) ? activePageId : pages[0]?.id;
    const sourcePage = resolvedActiveId ? model.find(resolvedActiveId) : null;
    const pruneInactivePages = options.pruneInactivePages ?? false;
    const body = pruneInactivePages && sourcePage
      ? cloneBodyWithPageBranch(model.document.body, sourcePage)
      : model.document.body.cloneNode(true) as HTMLElement;
    const safeDocument = document.implementation.createHTMLDocument();
    safeDocument.body.replaceWith(body);
    sanitizeDocument(safeDocument, "html");
    if (pages.length > 0) {
      for (const page of pages) {
        const pageRoot = getElementByEditorId(body, page.id);
        if (pruneInactivePages && page.id !== resolvedActiveId) pageRoot?.remove();
        else pageRoot?.setAttribute("data-editor-preview-page-root", page.id === resolvedActiveId ? "active" : "inactive");
      }
      const activeRoot = resolvedActiveId ? getElementByEditorId(body, resolvedActiveId) : null;
      let ancestor = activeRoot?.parentElement ?? null;
      while (ancestor && ancestor !== body) {
        ancestor.setAttribute("data-editor-static-deck", "");
        ancestor = ancestor.parentElement;
      }
    }
    const activeClone = (resolvedActiveId ? getElementByEditorId(body, resolvedActiveId) : null) ?? body;
    this.applyBuildState(
      activeClone,
      options.activeBuildStep ?? 0,
      options.buildViewMode ?? "playback",
      options.focusedBuildStep,
    );
    this.rewriteResourceReferences(body);
    shell.append(body);
    this.shadow.append(shell);
    this.previewRoot = body;
  }

  private applyBuildState(root: Element, activeStep: number, viewMode: BuildViewMode, focusedStep?: number): void {
    root.setAttribute("data-editor-build-view", viewMode);
    const focus = focusedStep ?? activeStep;
    for (const element of Array.from(root.querySelectorAll("[data-build]"))) {
      const raw = element.getAttribute("data-build") ?? "";
      const step = Number(raw.trim());
      const valid = Number.isInteger(step) && step > 0;
      if (!valid) {
        element.setAttribute("data-editor-build-warning", "invalid-step");
        continue;
      }
      const visible = viewMode === "playback" ? step <= activeStep : true;
      element.setAttribute("data-editor-build-visibility", visible ? "shown" : "hidden");
      element.setAttribute("data-editor-build-relation", step < focus ? "past" : step === focus ? "current" : "future");
      element.setAttribute("data-editor-build-label", `B${step}`);
      element.classList.toggle("revealed", visible);
      element.setAttribute("aria-hidden", visible ? "false" : "true");
    }
  }

  private renderSvg(model: SourceDocument): void {
    const shell = document.createElement("div");
    shell.className = "editor-preview-shell";
    const safeDocument = model.document.cloneNode(true) as Document;
    sanitizeDocument(safeDocument, "svg");
    const svg = safeDocument.documentElement.cloneNode(true) as SVGSVGElement;
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
      if (element.localName === "style" && element.textContent?.includes("url(")) {
        element.textContent = this.assets.rewriteCssUrls(element.textContent, this.sourcePath);
      }
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

  private nativeEditableElementFromEvent(event: Event): Element | null {
    for (const node of event.composedPath()) {
      if (node instanceof Element && node.hasAttribute("data-editor-id")) return node;
    }
    return null;
  }

  private elementFromEvent(event: Event): Element | null {
    const nativeTarget = this.nativeEditableElementFromEvent(event);
    if (!nativeTarget || !(event instanceof MouseEvent)) return nativeTarget;
    const { clientX, clientY } = event;
    const hitStack = this.shadow.elementsFromPoint(clientX, clientY);
    const stackRanks = new Map<Element, number>();
    hitStack.forEach((hit, index) => {
      const editable = hit.closest("[data-editor-id]");
      if (editable && !stackRanks.has(editable)) stackRanks.set(editable, index);
    });
    const candidates = Array.from(this.shadow.querySelectorAll("[data-editor-id]"))
      .filter((candidate) => nativeTarget.contains(candidate) || candidate.contains(nativeTarget))
      .filter((candidate) => {
        const bounds = candidate.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0 || clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return false;
        const style = getComputedStyle(candidate);
        return style.display !== "none" && style.visibility !== "hidden" && candidate.getAttribute("data-editor-build-visibility") !== "hidden";
      });
    candidates.sort((left, right) => {
      if (left.contains(right)) return 1;
      if (right.contains(left)) return -1;
      const leftRank = stackRanks.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = stackRanks.get(right) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return 0;
    });
    return candidates[0] ?? nativeTarget;
  }

  private handleClick = (event: Event): void => {
    if (!this.interactive) return;
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
    if (!this.interactive) return;
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
    const editor = document.createElement("form");
    editor.className = "editor-inline-editor";
    editor.setAttribute("aria-label", `编辑文字：${id}`);
    const textHeight = Math.max(30, bounds.height);
    const editorWidth = Math.max(160, bounds.width);
    const editorHeight = textHeight + 30;
    const maxLeft = Math.max(0, this.host.offsetWidth - editorWidth);
    const maxTop = Math.max(0, this.host.offsetHeight - editorHeight);
    editor.style.left = `${Math.min(Math.max(0, bounds.x), maxLeft)}px`;
    editor.style.top = `${Math.min(Math.max(0, bounds.y), maxTop)}px`;
    editor.style.width = `${editorWidth}px`;
    editor.style.height = `${editorHeight}px`;

    const textarea = document.createElement("textarea");
    textarea.className = "editor-inline-textarea";
    textarea.value = original;
    textarea.setAttribute("aria-label", `文字内容：${id}`);
    textarea.title = "Enter 应用，Shift + Enter 换行，Esc 取消";
    textarea.spellcheck = false;
    textarea.style.fontFamily = computed.fontFamily;
    textarea.style.fontSize = computed.fontSize;
    textarea.style.fontWeight = computed.fontWeight;
    textarea.style.fontStyle = computed.fontStyle;
    textarea.style.lineHeight = computed.lineHeight === "normal" ? "1.2" : computed.lineHeight;
    textarea.style.letterSpacing = computed.letterSpacing;
    textarea.style.textAlign = computed.textAlign;
    textarea.style.color = element.namespaceURI === "http://www.w3.org/2000/svg" ? computed.fill : computed.color;

    const actions = document.createElement("div");
    actions.className = "editor-inline-actions";
    const hint = document.createElement("span");
    hint.textContent = "Enter 应用 · Shift+Enter 换行";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    const apply = document.createElement("button");
    apply.type = "submit";
    apply.textContent = "应用";
    actions.append(hint, cancel, apply);
    editor.append(textarea, actions);
    element.setAttribute("data-editor-inline-editing", "true");
    shell.append(editor);

    let finished = false;
    const finish = (commit: boolean): void => {
      if (finished) return;
      finished = true;
      this.inlineFinish = null;
      editor.removeEventListener("submit", onSubmit);
      editor.removeEventListener("focusout", onFocusOut);
      cancel.removeEventListener("click", onCancel);
      textarea.removeEventListener("keydown", onKeyDown);
      element.removeAttribute("data-editor-inline-editing");
      const next = textarea.value;
      editor.remove();
      if (commit && next !== original) this.callbacks.onInlineTextCommit(id, next);
    };
    const onSubmit = (submitEvent: SubmitEvent): void => {
      submitEvent.preventDefault();
      submitEvent.stopPropagation();
      finish(true);
    };
    const onCancel = (mouseEvent: MouseEvent): void => {
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      finish(false);
    };
    const onFocusOut = (focusEvent: FocusEvent): void => {
      const next = focusEvent.relatedTarget;
      if (next instanceof Node && editor.contains(next)) return;
      finish(true);
    };
    const onKeyDown = (keyboardEvent: KeyboardEvent): void => {
      // Keyboard events are composed across Shadow DOM. Keep editor input from
      // reaching canvas shortcuts such as Delete, Arrow keys, PageUp, or Undo.
      keyboardEvent.stopPropagation();
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        finish(false);
      } else if (keyboardEvent.key === "Enter" && !keyboardEvent.isComposing &&
        (!keyboardEvent.shiftKey || keyboardEvent.ctrlKey || keyboardEvent.metaKey)) {
        keyboardEvent.preventDefault();
        finish(true);
      }
    };
    this.inlineFinish = finish;
    editor.addEventListener("submit", onSubmit);
    editor.addEventListener("focusout", onFocusOut);
    cancel.addEventListener("click", onCancel);
    textarea.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.select();
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
