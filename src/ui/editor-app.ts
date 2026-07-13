import defaultHtml from "../../examples/ai-slide.html?raw";
import defaultDeck from "../../examples/multi-page-deck.html?raw";
import defaultSvg from "../../examples/shapes.svg?raw";
import energyIllustration from "../../examples/assets/energy-illustration.svg?raw";
import { CanvasRenderer } from "../canvas/renderer";
import { TransformController } from "../canvas/transform-controller";
import {
  addElement,
  applyElementChanges,
  duplicateElement,
  getTransformValues,
  moveElementBy,
  readDeclaredBounds,
  setElementLocked,
  setElementVisible,
} from "../core/commands";
import { snapshotsEqual, SourceDocument } from "../core/document-model";
import { History } from "../core/history";
import { buildInteractiveHtml, buildStandaloneSlides } from "../core/presentation";
import {
  createSavedProject,
  downloadBlob,
  downloadText,
  exportProjectZip,
  importDirectory,
  parseSavedProject,
  ProjectAssets,
} from "../core/project";
import { sanitizeCss } from "../core/sanitizer";
import type { Bounds, BuildViewMode, DocumentKind, DocumentPage, DocumentSnapshot, ElementTreeNode, OperationLogEntry, PageBuildSequence } from "../core/types";
import { SourceCodeEditor } from "./code-editor";
import { FragmentWorkspace, type FragmentWorkspaceContext } from "./fragment-workspace";
import { EditorLayoutController } from "./layout-controller";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]!);
}

function numeric(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function colorValue(value: string): string {
  const match = value.trim().match(/^#(?:[\da-f]{6})$/i);
  return match ? match[0] : "#000000";
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.(?:html?|svg|json)$/i, "") || "document";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read the file."));
    reader.readAsDataURL(file);
  });
}

function kindForElement(element: Element, fallback: DocumentKind): DocumentKind {
  return element.namespaceURI === "http://www.w3.org/2000/svg" ? "svg" : fallback;
}

function exampleAssets(): ProjectAssets {
  return new ProjectAssets([{
    path: "examples/assets/energy-illustration.svg",
    mimeType: "image/svg+xml",
    bytes: new TextEncoder().encode(energyIllustration),
  }]);
}

const appTemplate = `
  <div class="studio-shell is-code-collapsed">
    <header class="topbar">
      <div class="brand" title="Source-first visual editing">
        <span class="brand-mark">LM</span>
        <span><strong>Last Mile</strong><small>Studio</small></span>
      </div>
      <div class="toolbar toolbar-primary">
        <label class="tool-select">示例
          <select id="example-select" aria-label="Load example">
            <option value="html">HTML Slide</option>
            <option value="deck">Multi-page deck</option>
            <option value="svg">SVG shapes</option>
          </select>
        </label>
        <button id="import-file" class="button">导入文件</button>
        <button id="import-directory" class="button">导入目录</button>
        <button id="paste-source" class="button">粘贴代码</button>
        <span class="toolbar-separator"></span>
        <button id="undo" class="icon-button" title="Undo (Ctrl/Cmd+Z)">↶</button>
        <button id="redo" class="icon-button" title="Redo (Ctrl/Cmd+Shift+Z)">↷</button>
      </div>
      <div class="toolbar toolbar-export">
        <button id="preview-presentation" class="button">演示预览</button>
        <button id="export-html" class="button primary">导出 HTML</button>
        <button id="export-project" class="button">保存项目</button>
        <button id="export-zip" class="button">导出 ZIP</button>
        <button id="export-summary" class="icon-button" title="Export AI-readable structure JSON">{ }</button>
      </div>
    </header>

    <div id="notice-bar" class="notice-bar" hidden></div>

    <main class="workspace">
      <aside id="layers-panel" class="panel layers-panel">
        <button class="panel-collapse-toggle" data-layout-toggle="layers" aria-controls="layers-panel" aria-label="折叠或展开图层与结构面板"></button>
        <div class="panel-heading">
          <div><span class="eyebrow">DOCUMENT</span><h2>图层与结构</h2></div>
          <div class="compact-actions">
            <button id="add-text" title="Add text">T+</button>
            <button id="add-shape" title="Add shape">▣+</button>
          </div>
        </div>
        <div class="layer-actions" aria-label="Layer actions">
          <button data-layer-action="parent" title="Select parent">父级</button>
          <button data-layer-action="duplicate" title="Duplicate">复制</button>
          <button data-layer-action="visibility" title="Show or hide">显隐</button>
          <button data-layer-action="lock" title="Lock or unlock">锁定</button>
          <button data-layer-action="down" title="Move backward">↓</button>
          <button data-layer-action="up" title="Move forward">↑</button>
          <button data-layer-action="delete" class="danger" title="Delete">删除</button>
        </div>
        <div id="layers-tree" class="layers-tree"></div>
        <div class="panel-footnote">Ctrl / Shift 点击可多选；Alt 点击画布元素选择父级。</div>
        <div class="layout-resizer column-resizer" data-layout-resizer="layers" role="separator" aria-orientation="vertical" aria-label="调整图层与结构面板宽度" tabindex="0"></div>
      </aside>

      <section class="canvas-panel">
        <div class="canvas-toolbar">
          <div class="toolbar">
            <span class="tool-label">对齐</span>
            <button data-align="left" title="Align left">左</button>
            <button data-align="center" title="Align horizontal center">中</button>
            <button data-align="right" title="Align right">右</button>
            <button data-align="top" title="Align top">上</button>
            <button data-align="middle" title="Align vertical center">中</button>
            <button data-align="bottom" title="Align bottom">下</button>
            <button data-align="distribute-x" title="Distribute horizontally">横分布</button>
            <button data-align="distribute-y" title="Distribute vertically">纵分布</button>
          </div>
          <div id="page-control" class="toolbar page-control" hidden>
            <button id="previous-page" title="上一页 (Page Up)" aria-label="上一页">‹</button>
            <select id="page-select" aria-label="选择要编辑的页面"></select>
            <span id="page-count">1 / 1</span>
            <button id="next-page" title="下一页 (Page Down)" aria-label="下一页">›</button>
          </div>
          <div id="build-control" class="toolbar build-control" hidden>
            <button id="previous-build" title="Previous Build (Alt + [)" aria-label="Previous Build">‹</button>
            <span id="build-status">Initial / 0</span>
            <button id="next-build" title="Next Build (Alt + ])" aria-label="Next Build">›</button>
            <select id="build-view-mode" aria-label="Build 视图">
              <option value="playback">Playback State</option>
              <option value="group">Current Group</option>
              <option value="all">All Builds</option>
            </select>
          </div>
          <div class="toolbar canvas-size-control">
            <select id="canvas-preset" aria-label="画布尺寸预设">
              <option value="custom">自定义</option>
              <option value="1920x1080">16:9 · 1920×1080</option>
              <option value="1024x768">4:3 · 1024×768</option>
            </select>
            <label>W <input id="canvas-width" type="number" min="1" step="1" /></label>
            <span>×</span>
            <label>H <input id="canvas-height" type="number" min="1" step="1" /></label>
          </div>
          <div class="toolbar zoom-control">
            <button id="zoom-out" title="Zoom out">−</button>
            <button id="zoom-display" title="Reset zoom">100%</button>
            <button id="zoom-in" title="Zoom in">＋</button>
            <button id="fit-canvas">适应窗口</button>
          </div>
        </div>
        <div id="page-filmstrip" class="page-filmstrip" hidden>
          <div class="page-filmstrip-actions">
            <span class="eyebrow">PAGES</span>
            <button class="page-collapse-toggle" data-layout-toggle="pages" aria-controls="page-filmstrip" aria-label="折叠或展开页面栏"></button>
            <button id="duplicate-page" title="复制当前页">复制页</button>
            <button id="move-page-earlier" title="向前移动当前页">← 前移</button>
            <button id="move-page-later" title="向后移动当前页">后移 →</button>
            <button id="delete-page" class="danger" title="删除当前页">删除页</button>
          </div>
          <div id="page-thumbnails" class="page-thumbnails" aria-label="页面缩略图"></div>
          <div class="layout-resizer row-resizer page-resizer" data-layout-resizer="pages" role="separator" aria-orientation="horizontal" aria-label="调整页面栏高度" tabindex="0"></div>
        </div>
        <div id="canvas-viewport" class="canvas-viewport" tabindex="0">
          <div class="canvas-grid"></div>
          <div id="canvas-transform" class="canvas-transform">
            <div id="canvas-host" class="canvas-host" aria-label="Editable visual canvas"></div>
          </div>
          <div class="canvas-hint">滚轮缩放 · Space/中键拖动画布 · 方向键微调</div>
        </div>
        <div class="canvas-status">
          <span id="document-status"></span>
          <span id="selection-status">未选择元素</span>
          <span id="sync-status" class="sync-ok">代码已同步</span>
        </div>
      </section>

      <aside id="inspector-panel" class="panel inspector-panel">
        <button class="panel-collapse-toggle" data-layout-toggle="inspector" aria-controls="inspector-panel" aria-label="折叠或展开编排与属性面板"></button>
        <div class="panel-heading"><div><span class="eyebrow">INSPECTOR</span><h2>编排与属性</h2></div></div>
        <section id="build-panel" class="build-panel" hidden>
          <div class="build-panel-heading"><span class="eyebrow">BUILD SEQUENCE</span><strong>放映顺序编排</strong></div>
          <div id="build-selection-controls" class="build-selection-controls"></div>
          <div id="build-groups" class="build-groups"></div>
          <div id="build-warnings" class="build-warnings" hidden></div>
        </section>
        <div class="layout-resizer row-resizer build-resizer" data-layout-resizer="build" role="separator" aria-orientation="horizontal" aria-label="调整 Build 编排与元素属性的高度" tabindex="0"></div>
        <section class="element-properties-panel">
          <div class="element-properties-heading"><span class="eyebrow">ELEMENT PROPERTIES</span><strong>元素属性</strong></div>
          <div id="inspector-content" class="inspector-content"></div>
        </section>
        <div class="layout-resizer column-resizer" data-layout-resizer="inspector" role="separator" aria-orientation="vertical" aria-label="调整编排与属性面板宽度" tabindex="0"></div>
      </aside>
    </main>

    <section id="code-drawer" class="code-drawer is-collapsed">
      <div class="code-toolbar">
        <div>
          <span class="eyebrow">SOURCE</span>
          <strong id="code-file-name">untitled.html</strong>
          <span id="code-error" class="code-error"></span>
        </div>
        <div class="toolbar">
          <button id="locate-code">定位选中元素</button>
          <button id="search-code">搜索</button>
          <button id="format-code">格式化</button>
          <button id="apply-code" class="button primary">应用代码</button>
          <button id="toggle-code">展开源码</button>
        </div>
      </div>
      <div id="code-editor" class="code-editor"></div>
    </section>

    <input id="file-input" type="file" accept=".html,.htm,.svg,.visual-project.json,.json" hidden />
    <input id="directory-input" type="file" webkitdirectory multiple hidden />
    <input id="image-input" type="file" accept="image/*" hidden />

    <dialog id="paste-dialog" class="paste-dialog">
      <form method="dialog">
        <div class="dialog-heading"><h2>粘贴 HTML 或 SVG</h2><button value="cancel" aria-label="Close">×</button></div>
        <textarea id="paste-editor" spellcheck="false" placeholder="Paste HTML or SVG source here..."></textarea>
        <div class="dialog-actions"><button value="cancel">取消</button><button id="apply-paste" value="default" class="button primary">载入画布</button></div>
      </form>
    </dialog>
    <dialog id="presentation-dialog" class="presentation-dialog">
      <div class="presentation-dialog-heading">
        <div><span class="eyebrow">PRESENTATION</span><strong>演示预览</strong></div>
        <button id="close-presentation" type="button" aria-label="关闭演示预览">×</button>
      </div>
      <iframe id="presentation-frame" title="演示预览" sandbox="allow-scripts allow-same-origin" allowfullscreen></iframe>
    </dialog>
    <dialog id="preview-choice-dialog" class="preview-choice-dialog">
      <form method="dialog">
        <div class="dialog-heading"><h2>选择预览起点</h2><button value="cancel" aria-label="关闭预览选择">×</button></div>
        <p>从第一页播放整套演示稿，或直接从正在编辑的页面开始。</p>
        <div class="preview-choice-actions">
          <button value="cancel">取消</button>
          <button id="preview-from-start" value="default" class="button">从头预览</button>
          <button id="preview-from-current" value="default" class="button primary">当前页面预览</button>
        </div>
      </form>
    </dialog>
    <div id="toast" class="toast" hidden></div>
  </div>
`;

export class EditorApp {
  private model: SourceDocument;
  private assets = exampleAssets();
  private sourcePath = "examples/ai-slide.html";
  private selectedIds: string[] = [];
  private readonly history: History<DocumentSnapshot>;
  private readonly renderer: CanvasRenderer;
  private readonly transform: TransformController;
  private readonly codeEditor: SourceCodeEditor;
  private readonly fragments: FragmentWorkspace;
  private readonly layout: EditorLayoutController;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private codeDirty = false;
  private activePageIndex = 0;
  private buildStepsByPage = new Map<string, number>();
  private buildViewMode: BuildViewMode = "playback";
  private operationLog: OperationLogEntry[] = [];
  private spacePressed = false;
  private toastTimer = 0;
  private noticeTimer = 0;
  private buildWarningTimer = 0;
  private modelWarningSignature = "";
  private buildWarningSignature = "";
  private fragmentCursor = { x: 640, y: 360 };

  constructor(private readonly host: HTMLElement) {
    host.innerHTML = appTemplate;
    this.model = SourceDocument.parse(defaultHtml, "ai-slide.html");
    this.history = new History(this.createSnapshot(), snapshotsEqual);

    this.renderer = new CanvasRenderer(this.get("#canvas-host"), {
      onSelect: (id, options) => this.selectElement(id, options.additive),
      onInlineTextCommit: (id, text) => this.commitMutation("Edit text", () => {
        this.model.apply({ action: "replaceText", elementId: id, text });
      }),
      onWarning: (message) => this.showNotice(message),
    });

    this.transform = new TransformController(this.get("#canvas-transform"), this.renderer, {
      onStart: () => undefined,
      onChange: () => this.updateLiveSelectionStatus(),
      onEnd: (label) => {
        if (this.history.commit(this.createSnapshot(), label)) this.recordOperation(label, "ui");
        this.renderDocument(true);
      },
    });

    this.layout = new EditorLayoutController(host, {
      onLayoutChange: (canvasGeometryChanged) => {
        if (canvasGeometryChanged) this.fitCanvas();
        else this.transform.update();
      },
    });

    this.codeEditor = new SourceCodeEditor(this.get("#code-editor"), () => {
      this.codeDirty = true;
      this.get("#sync-status").textContent = "代码有未应用修改";
      this.get("#sync-status").className = "sync-dirty";
    });

    this.fragments = new FragmentWorkspace(host, {
      getContext: () => this.fragmentWorkspaceContext(),
      commit: (label, mutate) => this.commitMutation(label, () => {
        const nextSelection = mutate();
        if (nextSelection) this.selectedIds = nextSelection;
      }),
      toast: (message, error) => this.toast(message, error),
      notice: (message) => this.showNotice(message),
    });

    this.bindEvents();
    this.renderDocument(true);
    requestAnimationFrame(() => this.fitCanvas());
  }

  private get<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`UI element not found: ${selector}`);
    return element;
  }

  private bindEvents(): void {
    this.get("#import-file").addEventListener("click", () => this.get<HTMLInputElement>("#file-input").click());
    this.get("#import-directory").addEventListener("click", () => this.get<HTMLInputElement>("#directory-input").click());
    this.get("#paste-source").addEventListener("click", () => this.get<HTMLDialogElement>("#paste-dialog").showModal());
    this.get("#file-input").addEventListener("change", (event) => void this.handleFileImport(event));
    this.get("#directory-input").addEventListener("change", (event) => void this.handleDirectoryImport(event));
    this.get("#example-select").addEventListener("change", (event) => this.loadExample((event.target as HTMLSelectElement).value));
    this.get("#apply-paste").addEventListener("click", (event) => {
      event.preventDefault();
      const source = this.get<HTMLTextAreaElement>("#paste-editor").value;
      if (!source.trim()) return;
      this.loadSource(source, "pasted-content.html", "pasted-content.html", new ProjectAssets());
      this.get<HTMLDialogElement>("#paste-dialog").close();
    });

    this.get("#undo").addEventListener("click", () => this.undo());
    this.get("#redo").addEventListener("click", () => this.redo());
    this.get("#preview-presentation").addEventListener("click", () => this.get<HTMLDialogElement>("#preview-choice-dialog").showModal());
    this.get("#preview-from-start").addEventListener("click", () => this.previewPresentation(0));
    this.get("#preview-from-current").addEventListener("click", () => this.previewPresentation(this.activePageIndex));
    this.get("#export-html").addEventListener("click", () => this.exportDocument());
    this.get("#export-project").addEventListener("click", () => this.exportProject());
    this.get("#export-zip").addEventListener("click", () => void this.exportZip());
    this.get("#export-summary").addEventListener("click", () => this.exportSummary());

    this.get("#zoom-out").addEventListener("click", () => this.setZoom(this.zoom / 1.2));
    this.get("#zoom-in").addEventListener("click", () => this.setZoom(this.zoom * 1.2));
    this.get("#zoom-display").addEventListener("click", () => this.setZoom(1));
    this.get("#fit-canvas").addEventListener("click", () => this.fitCanvas());
    this.get("#canvas-preset").addEventListener("change", (event) => this.applyCanvasPreset((event.target as HTMLSelectElement).value));
    this.get("#canvas-width").addEventListener("change", () => this.changeCanvasSize());
    this.get("#canvas-height").addEventListener("change", () => this.changeCanvasSize());
    this.get("#previous-page").addEventListener("click", () => this.changePage(this.activePageIndex - 1));
    this.get("#next-page").addEventListener("click", () => this.changePage(this.activePageIndex + 1));
    this.get("#page-select").addEventListener("change", (event) => this.changePage(Number((event.target as HTMLSelectElement).value)));
    this.get("#previous-build").addEventListener("click", () => this.changeBuild(-1));
    this.get("#next-build").addEventListener("click", () => this.changeBuild(1));
    this.get("#build-view-mode").addEventListener("change", (event) => {
      this.buildViewMode = (event.target as HTMLSelectElement).value as BuildViewMode;
      this.history.replaceCurrent(this.createSnapshot());
      this.renderDocument(false);
    });
    this.get("#duplicate-page").addEventListener("click", () => this.duplicateActivePage());
    this.get("#delete-page").addEventListener("click", () => this.deleteActivePage());
    this.get("#move-page-earlier").addEventListener("click", () => this.moveActivePage(-1));
    this.get("#move-page-later").addEventListener("click", () => this.moveActivePage(1));

    const thumbnails = this.get("#page-thumbnails");
    thumbnails.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-page-index]");
      if (button?.dataset.pageIndex) this.changePage(Number(button.dataset.pageIndex));
    });
    thumbnails.addEventListener("dragstart", (event) => {
      const drag = event as DragEvent;
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-page-id]");
      if (!button?.dataset.pageId || !drag.dataTransfer) return;
      drag.dataTransfer.effectAllowed = "move";
      drag.dataTransfer.setData("text/plain", button.dataset.pageId);
      button.classList.add("is-dragging");
    });
    thumbnails.addEventListener("dragover", (event) => {
      event.preventDefault();
      const drag = event as DragEvent;
      if (drag.dataTransfer) drag.dataTransfer.dropEffect = "move";
    });
    thumbnails.addEventListener("drop", (event) => {
      event.preventDefault();
      const drop = event as DragEvent;
      const target = (event.target as Element).closest<HTMLButtonElement>("[data-page-id]");
      const sourceId = drop.dataTransfer?.getData("text/plain") ?? "";
      if (sourceId && target?.dataset.pageId) this.movePageById(sourceId, target.dataset.pageId);
    });
    thumbnails.addEventListener("dragend", () => {
      thumbnails.querySelectorAll(".is-dragging").forEach((element) => element.classList.remove("is-dragging"));
    });

    const buildPanel = this.get("#build-panel");
    buildPanel.addEventListener("click", (event) => this.handleBuildPanelClick(event));
    buildPanel.addEventListener("dragstart", (event) => this.handleBuildDragStart(event as DragEvent));
    buildPanel.addEventListener("dragover", (event) => {
      event.preventDefault();
      if ((event as DragEvent).dataTransfer) (event as DragEvent).dataTransfer!.dropEffect = "move";
    });
    buildPanel.addEventListener("drop", (event) => this.handleBuildDrop(event as DragEvent));

    this.get("#layers-tree").addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-layer-id]");
      if (!button?.dataset.layerId) return;
      const mouse = event as MouseEvent;
      this.selectElement(button.dataset.layerId, mouse.ctrlKey || mouse.metaKey || mouse.shiftKey);
    });
    this.host.querySelectorAll<HTMLElement>("[data-layer-action]").forEach((button) => {
      button.addEventListener("click", () => this.layerAction(button.dataset.layerAction ?? ""));
    });
    this.get("#add-text").addEventListener("click", () => this.addNewElement("text"));
    this.get("#add-shape").addEventListener("click", () => this.addNewElement("shape"));

    this.get("#inspector-content").addEventListener("change", (event) => this.handleInspectorChange(event));
    this.get("#inspector-content").addEventListener("click", (event) => {
      const action = (event.target as Element).closest<HTMLElement>("[data-inspector-action]")?.dataset.inspectorAction;
      if (action === "replace-image") this.get<HTMLInputElement>("#image-input").click();
      else if (action === "select-parent") this.layerAction("parent");
      else if (action === "select-child") this.layerAction("child");
    });
    this.get("#image-input").addEventListener("change", (event) => void this.replaceImage(event));

    this.host.querySelectorAll<HTMLElement>("[data-align]").forEach((button) => {
      button.addEventListener("click", () => this.alignSelection(button.dataset.align ?? ""));
    });

    this.get("#apply-code").addEventListener("click", () => this.applyCode());
    this.get("#format-code").addEventListener("click", () => void this.formatCode());
    this.get("#search-code").addEventListener("click", () => this.codeEditor.openSearch());
    this.get("#locate-code").addEventListener("click", () => {
      const id = this.selectedIds[0];
      if (!id || !this.codeEditor.focusElement(id)) this.toast("未在代码中找到当前元素 ID");
    });
    this.get("#toggle-code").addEventListener("click", () => this.toggleCodeDrawer());
    this.get("#close-presentation").addEventListener("click", () => this.get<HTMLDialogElement>("#presentation-dialog").close());
    this.get("#presentation-dialog").addEventListener("close", () => {
      this.get<HTMLIFrameElement>("#presentation-frame").srcdoc = "";
    });

    const viewport = this.get("#canvas-viewport");
    viewport.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
    viewport.addEventListener("pointerdown", (event) => this.beginPan(event));
    viewport.addEventListener("pointermove", (event) => {
      const rect = viewport.getBoundingClientRect();
      this.fragmentCursor = {
        x: Math.min(this.model.canvas.width, Math.max(0, (event.clientX - rect.left - this.pan.x) / this.zoom)),
        y: Math.min(this.model.canvas.height, Math.max(0, (event.clientY - rect.top - this.pan.y) / this.zoom)),
      };
    });
    window.addEventListener("keydown", (event) => this.handleKeyDown(event));
    window.addEventListener("keyup", (event) => {
      if (event.code === "Space") this.spacePressed = false;
    });
    window.addEventListener("resize", () => this.transform.update());
  }

  private fragmentWorkspaceContext(): FragmentWorkspaceContext {
    const selectedElements = this.selectedIds.map((id) => this.model.find(id)).filter((element): element is Element => Boolean(element));
    const selectionItems = selectedElements.map((element) => {
      const id = element.getAttribute("data-editor-id") ?? "";
      return {
        element,
        bounds: this.renderer.bounds(id) ?? readDeclaredBounds(element, kindForElement(element, this.model.kind)),
        renderedElement: this.renderer.element(id),
      };
    });
    const containerTags = new Set(["body", "main", "section", "article", "div", "aside", "header", "footer", "svg", "g"]);
    let insertionParent: Element | null = null;
    if (selectedElements.length > 0) {
      const first = selectedElements[0]!;
      let current: Element | null = first;
      while (current) {
        if (current.hasAttribute("data-editor-id") &&
            current.getAttribute("data-editor-locked") !== "true" &&
            current.getAttribute("data-editor-structural") !== "true" &&
            containerTags.has(current.localName) &&
            selectedElements.every((element) => current === element || current!.contains(element))) {
          insertionParent = current;
          break;
        }
        current = current.parentElement?.closest("[data-editor-id]") ?? null;
      }
    }
    insertionParent ??= this.model.editingRoot(this.activePageIndex);
    return {
      model: this.model,
      assets: this.assets,
      sourcePath: this.sourcePath,
      selectedIds: [...this.selectedIds],
      selectionItems,
      insertionParentId: insertionParent?.getAttribute("data-editor-id") ?? null,
      cursor: {
        x: Math.min(this.model.canvas.width, Math.max(0, this.fragmentCursor.x)),
        y: Math.min(this.model.canvas.height, Math.max(0, this.fragmentCursor.y)),
      },
    };
  }

  private createSnapshot(): DocumentSnapshot {
    const activePageId = this.model.pages()[this.activePageIndex]?.id;
    return {
      ...this.model.snapshot(
        this.selectedIds,
        activePageId,
        Object.fromEntries(this.buildStepsByPage),
        this.buildViewMode,
      ),
      assets: this.assets.list(),
    };
  }

  private activePageKey(): string {
    return this.model.pages()[this.activePageIndex]?.id ?? "__document__";
  }

  private activeBuildStep(sequence = this.model.buildSequence(this.activePageIndex)): number {
    const requested = this.buildStepsByPage.get(this.activePageKey()) ?? 0;
    if (requested === 0 || sequence.steps.length === 0) return 0;
    return sequence.steps.includes(requested) ? requested : (sequence.steps.filter((step) => step <= requested).at(-1) ?? 0);
  }

  private renderDocument(syncCode: boolean): void {
    const pages = this.model.pages();
    this.activePageIndex = pages.length ? Math.min(Math.max(0, this.activePageIndex), pages.length - 1) : 0;
    this.selectedIds = this.selectedIds.filter((id) => Boolean(this.model.find(id)) && this.model.elementBelongsToPage(id, this.activePageIndex));
    this.transform.setSelection([]);
    const canvasHost = this.get("#canvas-host");
    canvasHost.style.width = `${this.model.canvas.width}px`;
    canvasHost.style.height = `${this.model.canvas.height}px`;
    const buildSequence = this.model.buildSequence(this.activePageIndex);
    const activeBuildStep = this.activeBuildStep(buildSequence);
    this.buildStepsByPage.set(this.activePageKey(), activeBuildStep);
    this.renderer.render(this.model, this.assets, this.sourcePath, pages[this.activePageIndex]?.id, {
      activeBuildStep,
      buildViewMode: this.buildViewMode,
      focusedBuildStep: activeBuildStep || buildSequence.steps[0],
    });
    this.transform.setDocumentKind(this.model.kind);
    this.updateCanvasTransform();
    this.transform.setSelection(this.selectedIds);
    if (syncCode) {
      this.codeEditor.setValue(this.model.serialize());
      this.codeDirty = false;
      this.get("#sync-status").textContent = "代码已同步";
      this.get("#sync-status").className = "sync-ok";
    }
    this.get<HTMLInputElement>("#canvas-width").value = String(this.model.canvas.width);
    this.get<HTMLInputElement>("#canvas-height").value = String(this.model.canvas.height);
    const preset = `${this.model.canvas.width}x${this.model.canvas.height}`;
    this.get<HTMLSelectElement>("#canvas-preset").value = ["1920x1080", "1024x768"].includes(preset) ? preset : "custom";
    this.get("#code-file-name").textContent = this.model.sourceName;
    const pageStatus = pages.length > 0 ? ` · page ${this.activePageIndex + 1}/${pages.length}` : "";
    this.get("#document-status").textContent = `${this.model.kind.toUpperCase()} · ${this.model.canvas.width} × ${this.model.canvas.height}${pageStatus} · ${this.model.editableElements().length} elements`;
    const htmlPresentationAvailable = this.model.kind === "html";
    this.get<HTMLButtonElement>("#preview-presentation").disabled = !htmlPresentationAvailable;
    this.get("#undo").toggleAttribute("disabled", !this.history.canUndo);
    this.get("#redo").toggleAttribute("disabled", !this.history.canRedo);
    this.renderPageControl(pages);
    this.renderBuildControl(buildSequence);
    this.renderBuildPanel(buildSequence);
    this.renderLayers();
    this.renderInspector();
    this.fragments.refreshSelection();
    this.renderWarnings();
    this.updateLiveSelectionStatus();
  }

  private renderPageControl(pages: DocumentPage[]): void {
    const control = this.get("#page-control");
    const filmstrip = this.get("#page-filmstrip");
    const thumbnails = this.get("#page-thumbnails");
    const hasPages = pages.length > 0;
    this.get(".canvas-panel").classList.toggle("has-page-filmstrip", hasPages);
    control.hidden = !hasPages;
    filmstrip.hidden = !hasPages;
    if (!hasPages) {
      thumbnails.replaceChildren();
      return;
    }
    const select = this.get<HTMLSelectElement>("#page-select");
    select.innerHTML = pages.map((page) =>
      `<option value="${page.index}">${page.index + 1}. ${escapeHtml(page.label)}</option>`,
    ).join("");
    select.value = String(this.activePageIndex);
    this.get("#page-count").textContent = `${this.activePageIndex + 1} / ${pages.length}`;
    this.get<HTMLButtonElement>("#previous-page").disabled = this.activePageIndex === 0;
    this.get<HTMLButtonElement>("#next-page").disabled = this.activePageIndex === pages.length - 1;
    this.get<HTMLButtonElement>("#move-page-earlier").disabled = this.activePageIndex === 0;
    this.get<HTMLButtonElement>("#move-page-later").disabled = this.activePageIndex === pages.length - 1;
    this.get<HTMLButtonElement>("#delete-page").disabled = pages.length <= 1;

    const scale = Math.min(142 / this.model.canvas.width, 82 / this.model.canvas.height);
    const previewWidth = Math.max(1, this.model.canvas.width * scale);
    const previewHeight = Math.max(1, this.model.canvas.height * scale);
    thumbnails.innerHTML = pages.map((page) => {
      const sequence = this.model.buildSequence(page.index);
      return `
      <button class="page-thumbnail${page.index === this.activePageIndex ? " is-active" : ""}" data-page-index="${page.index}" data-page-id="${escapeHtml(page.id)}" draggable="true" title="${escapeHtml(page.label)}">
        <span class="page-thumbnail-number">${page.index + 1}</span>
        ${sequence.groups.length ? `<span class="page-thumbnail-builds">+${sequence.groups.length} builds</span>` : ""}
        <span class="page-thumbnail-preview" style="width:${previewWidth.toFixed(2)}px;height:${previewHeight.toFixed(2)}px">
          <span class="page-thumbnail-canvas" data-thumbnail-host="${page.index}" style="width:${this.model.canvas.width}px;height:${this.model.canvas.height}px;transform:scale(${scale})"></span>
        </span>
        <span class="page-thumbnail-label">${escapeHtml(page.label)}</span>
      </button>
    `;
    }).join("");

    pages.forEach((page) => {
      const host = thumbnails.querySelector<HTMLElement>(`[data-thumbnail-host="${page.index}"]`);
      if (!host) return;
      const renderer = new CanvasRenderer(host, {
        onSelect: () => undefined,
        onInlineTextCommit: () => undefined,
      });
      const sequence = this.model.buildSequence(page.index);
      renderer.render(this.model, this.assets, this.sourcePath, page.id, {
        interactive: false,
        pruneInactivePages: true,
        activeBuildStep: sequence.maxStep,
        buildViewMode: "playback",
      });
    });
    requestAnimationFrame(() => {
      thumbnails.querySelector(".page-thumbnail.is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  private renderBuildControl(sequence: PageBuildSequence): void {
    const control = this.get("#build-control");
    const hasPresentationPage = this.model.kind === "html" && (this.model.pages().length > 0 || sequence.elementCount > 0);
    control.hidden = !hasPresentationPage;
    if (!hasPresentationPage) return;
    const activeStep = this.activeBuildStep(sequence);
    const position = activeStep === 0 ? 0 : Math.max(0, sequence.steps.indexOf(activeStep) + 1);
    this.get("#build-status").textContent = position === 0
      ? `Initial / ${sequence.groups.length}`
      : `Build ${position} / ${sequence.groups.length}`;
    this.get<HTMLButtonElement>("#previous-build").disabled = position === 0;
    this.get<HTMLButtonElement>("#next-build").disabled = position >= sequence.steps.length;
    this.get<HTMLSelectElement>("#build-view-mode").value = this.buildViewMode;
  }

  private buildElementLabel(id: string): string {
    const element = this.model.find(id);
    if (!element) return id;
    const explicit = element.getAttribute("data-editor-name") ?? element.getAttribute("aria-label");
    const text = element.textContent?.replace(/\s+/g, " ").trim();
    return explicit?.trim() || text?.slice(0, 42) || `${element.localName} · ${id}`;
  }

  private renderBuildPanel(sequence: PageBuildSequence): void {
    const panel = this.get("#build-panel");
    const hasPresentationPage = this.model.kind === "html" && (this.model.pages().length > 0 || sequence.elementCount > 0);
    panel.hidden = !hasPresentationPage;
    if (!hasPresentationPage) return;

    const selectedOnPage = this.selectedIds.filter((id) => this.model.elementBelongsToPage(id, this.activePageIndex));
    const currentSteps = Array.from(new Set(selectedOnPage.map((id) => this.model.buildStepForElement(id)).filter((step): step is number => step !== null)));
    const selectionSummary = selectedOnPage.length
      ? `${selectedOnPage.length} selected · ${currentSteps.length === 1 ? `Build ${currentSteps[0]}` : currentSteps.length ? "mixed Build groups" : "Always Visible"}`
      : "Select elements to assign a Build";
    this.get("#build-selection-controls").innerHTML = `
      <div class="build-selection-summary">${escapeHtml(selectionSummary)}</div>
      <div class="build-selection-row">
        <select id="selected-build-target" aria-label="Selected elements Build target" ${selectedOnPage.length ? "" : "disabled"}>
          <option value="always">Always Visible</option>
          ${sequence.groups.map((group, index) => `<option value="${group.step}">Build ${index + 1}</option>`).join("")}
          <option value="new">New Build at end</option>
        </select>
        <button data-build-action="apply-selected" ${selectedOnPage.length ? "" : "disabled"}>应用</button>
        <button data-build-action="split-selected" ${selectedOnPage.length ? "" : "disabled"}>拆为新组</button>
      </div>
    `;

    const editingRoot = this.model.editingRoot(this.activePageIndex);
    const alwaysCount = editingRoot
      ? [editingRoot, ...Array.from(editingRoot.querySelectorAll("[data-editor-id]"))]
        .filter((element) => element.hasAttribute("data-editor-id") && !element.hasAttribute("data-build")).length
      : 0;
    const groups = this.get("#build-groups");
    groups.innerHTML = `
      <div class="build-drop-zone" data-build-insert-position="0">Drop here to create Build 1</div>
      <section class="build-group always-visible-group">
        <header><strong>Always Visible</strong><span>${alwaysCount} elements</span></header>
      </section>
      ${sequence.groups.map((group, index) => `
        <section class="build-group${this.activeBuildStep(sequence) === group.step ? " is-active" : ""}" data-build-group="${group.step}">
          <header data-build-focus="${group.step}" data-build-group-drag="${group.step}" draggable="true">
            <strong>Build ${index + 1}</strong><span>${group.elementIds.length} elements · data-build=${group.step}</span>
            <span class="build-group-actions">
              <button data-build-action="move-up" data-build-step="${group.step}" ${index === 0 ? "disabled" : ""} title="Move group earlier">↑</button>
              <button data-build-action="move-down" data-build-step="${group.step}" ${index === sequence.groups.length - 1 ? "disabled" : ""} title="Move group later">↓</button>
              <button data-build-action="merge-previous" data-build-step="${group.step}" ${index === 0 ? "disabled" : ""} title="Merge into previous group">合并</button>
            </span>
          </header>
          <div class="build-group-elements">
            ${group.elementIds.map((id) => `<button class="build-element${this.selectedIds.includes(id) ? " is-selected" : ""}" data-build-element-id="${escapeHtml(id)}" draggable="true" title="${escapeHtml(id)}"><span>${escapeHtml(this.buildElementLabel(id))}</span><code>${escapeHtml(id)}</code></button>`).join("")}
          </div>
        </section>
        <div class="build-drop-zone" data-build-insert-position="${index + 1}">Drop elements here for a new Build</div>
      `).join("")}
    `;

    const warnings = this.get("#build-warnings");
    const signature = sequence.warnings.map((warning) => `${warning.code}:${warning.message}`).join("\n");
    if (!signature) {
      window.clearTimeout(this.buildWarningTimer);
      this.buildWarningSignature = "";
      warnings.hidden = true;
      warnings.innerHTML = "";
    } else if (signature !== this.buildWarningSignature) {
      window.clearTimeout(this.buildWarningTimer);
      this.buildWarningSignature = signature;
      warnings.hidden = false;
      warnings.innerHTML = sequence.warnings.map((warning) => `<p><strong>${escapeHtml(warning.code)}</strong> ${escapeHtml(warning.message)}</p>`).join("");
      this.buildWarningTimer = window.setTimeout(() => {
        if (this.buildWarningSignature === signature) warnings.hidden = true;
      }, 6000);
    }
  }

  private changeBuild(offset: -1 | 1): void {
    const sequence = this.model.buildSequence(this.activePageIndex);
    const active = this.activeBuildStep(sequence);
    const position = active === 0 ? 0 : sequence.steps.indexOf(active) + 1;
    const nextPosition = Math.min(Math.max(0, position + offset), sequence.steps.length);
    if (nextPosition === position) return;
    this.buildStepsByPage.set(this.activePageKey(), nextPosition === 0 ? 0 : sequence.steps[nextPosition - 1]!);
    this.history.replaceCurrent(this.createSnapshot());
    this.selectedIds = this.selectedIds.filter((id) => {
      const step = this.model.buildStepForElement(id);
      return this.buildViewMode !== "playback" || step === null || step <= (this.buildStepsByPage.get(this.activePageKey()) ?? 0);
    });
    this.renderDocument(false);
  }

  private handleBuildPanelClick(event: Event): void {
    const target = event.target as Element;
    const elementButton = target.closest<HTMLElement>("[data-build-element-id]");
    if (elementButton?.dataset.buildElementId) {
      const mouse = event as MouseEvent;
      this.selectElement(elementButton.dataset.buildElementId, mouse.ctrlKey || mouse.metaKey || mouse.shiftKey);
      return;
    }
    const focus = target.closest<HTMLElement>("[data-build-focus]");
    const action = target.closest<HTMLButtonElement>("[data-build-action]");
    if (!action && focus?.dataset.buildFocus) {
      this.buildStepsByPage.set(this.activePageKey(), Number(focus.dataset.buildFocus));
      this.buildViewMode = "group";
      this.history.replaceCurrent(this.createSnapshot());
      this.renderDocument(false);
      return;
    }
    if (!action?.dataset.buildAction) return;
    const sequence = this.model.buildSequence(this.activePageIndex);
    const pageId = sequence.pageId;
    const step = Number(action.dataset.buildStep);
    if (action.dataset.buildAction === "apply-selected") {
      const value = this.get<HTMLSelectElement>("#selected-build-target").value;
      this.commitMutation("Set element Build", () => {
        if (value === "new") this.model.apply({ action: "splitBuildGroup", pageId, elementIds: this.selectedIds, targetPosition: sequence.groups.length });
        else this.model.apply({ action: "setElementBuild", elementIds: this.selectedIds, step: value === "always" ? null : Number(value) });
        this.model.normalizeBuildSteps(this.activePageIndex);
      });
    } else if (action.dataset.buildAction === "split-selected") {
      const selectedSteps = this.selectedIds.map((id) => this.model.buildStepForElement(id)).filter((value): value is number => value !== null);
      const sourceIndex = selectedSteps.length ? sequence.groups.findIndex((group) => group.step === selectedSteps[0]) : sequence.groups.length - 1;
      this.commitMutation("Split Build group", () => this.model.apply({
        action: "splitBuildGroup",
        pageId,
        elementIds: this.selectedIds,
        targetPosition: Math.max(0, sourceIndex + 1),
      }));
    } else if (action.dataset.buildAction === "move-up" || action.dataset.buildAction === "move-down") {
      const index = sequence.groups.findIndex((group) => group.step === step);
      const target = sequence.groups[index + (action.dataset.buildAction === "move-up" ? -1 : 1)];
      if (target) this.commitMutation("Move Build group", () => this.model.apply({ action: "moveBuildGroup", pageId, fromStep: step, toStep: target.step }));
    } else if (action.dataset.buildAction === "merge-previous") {
      const index = sequence.groups.findIndex((group) => group.step === step);
      const previous = sequence.groups[index - 1];
      if (previous) this.commitMutation("Merge Build groups", () => this.model.apply({ action: "mergeBuildGroups", pageId, sourceStep: step, targetStep: previous.step }));
    }
  }

  private handleBuildDragStart(event: DragEvent): void {
    if (!event.dataTransfer) return;
    const target = event.target as Element;
    const element = target.closest<HTMLElement>("[data-build-element-id]");
    if (element?.dataset.buildElementId) {
      const ids = this.selectedIds.includes(element.dataset.buildElementId) ? this.selectedIds : [element.dataset.buildElementId];
      event.dataTransfer.setData("application/x-lms-build-elements", JSON.stringify(ids));
      event.dataTransfer.setData("text/plain", ids.join(","));
      return;
    }
    const group = target.closest<HTMLElement>("[data-build-group-drag]");
    if (group?.dataset.buildGroupDrag) event.dataTransfer.setData("application/x-lms-build-group", group.dataset.buildGroupDrag);
  }

  private handleBuildDrop(event: DragEvent): void {
    event.preventDefault();
    const target = event.target as Element;
    const sequence = this.model.buildSequence(this.activePageIndex);
    const pageId = sequence.pageId;
    const elementPayload = event.dataTransfer?.getData("application/x-lms-build-elements") ?? "";
    const groupPayload = event.dataTransfer?.getData("application/x-lms-build-group") ?? "";
    const targetGroup = target.closest<HTMLElement>("[data-build-group]")?.dataset.buildGroup;
    const insertPosition = target.closest<HTMLElement>("[data-build-insert-position]")?.dataset.buildInsertPosition;
    if (elementPayload) {
      let ids: string[];
      try { ids = JSON.parse(elementPayload) as string[]; } catch { return; }
      if (insertPosition !== undefined) {
        this.commitMutation("Create Build group", () => this.model.apply({ action: "splitBuildGroup", pageId, elementIds: ids, targetPosition: Number(insertPosition) }), ids);
      } else if (targetGroup) {
        this.commitMutation("Move elements to Build group", () => {
          this.model.apply({ action: "setElementBuild", elementIds: ids, step: Number(targetGroup) });
          this.model.normalizeBuildSteps(this.activePageIndex);
        }, ids);
      }
    } else if (groupPayload && targetGroup && groupPayload !== targetGroup) {
      this.commitMutation("Move Build group", () => this.model.apply({
        action: "moveBuildGroup",
        pageId,
        fromStep: Number(groupPayload),
        toStep: Number(targetGroup),
      }));
    }
  }

  private changePage(index: number): void {
    const pages = this.model.pages();
    if (pages.length < 2) return;
    const next = Math.min(Math.max(0, Math.trunc(index)), pages.length - 1);
    if (next === this.activePageIndex) return;
    this.activePageIndex = next;
    this.selectedIds = [];
    this.history.replaceCurrent(this.createSnapshot());
    this.renderDocument(false);
    this.toast(`正在编辑第 ${next + 1} 页：${pages[next]!.label}`);
  }

  private duplicateActivePage(): void {
    let createdId = "";
    this.commitMutation("Duplicate page", () => {
      createdId = this.model.duplicatePage(this.activePageIndex);
      this.activePageIndex = this.model.pages().findIndex((page) => page.id === createdId);
      this.selectedIds = [];
    });
  }

  private deleteActivePage(): void {
    const pages = this.model.pages();
    const nextPageId = pages[this.activePageIndex + 1]?.id ?? pages[this.activePageIndex - 1]?.id;
    this.commitMutation("Delete page", () => {
      this.model.deletePage(this.activePageIndex);
      const remaining = this.model.pages();
      const nextIndex = nextPageId ? remaining.findIndex((page) => page.id === nextPageId) : -1;
      this.activePageIndex = nextIndex >= 0 ? nextIndex : Math.min(this.activePageIndex, remaining.length - 1);
      this.selectedIds = [];
    });
  }

  private moveActivePage(offset: -1 | 1): void {
    const pages = this.model.pages();
    const target = Math.min(Math.max(0, this.activePageIndex + offset), pages.length - 1);
    if (target === this.activePageIndex) return;
    this.commitMutation("Sort page", () => {
      this.activePageIndex = this.model.movePage(this.activePageIndex, target);
      this.selectedIds = [];
    });
  }

  private movePageById(sourceId: string, targetId: string): void {
    const pages = this.model.pages();
    const from = pages.findIndex((page) => page.id === sourceId);
    const to = pages.findIndex((page) => page.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    this.commitMutation("Sort page", () => {
      this.activePageIndex = this.model.movePage(from, to);
      this.selectedIds = [];
    });
  }

  private renderWarnings(): void {
    const signature = this.model.warnings.join("\n");
    if (!signature) {
      this.modelWarningSignature = "";
      return;
    }
    if (signature === this.modelWarningSignature) return;
    this.modelWarningSignature = signature;
    this.showNotice(this.model.warnings.join(" "));
  }

  private showNotice(message: string): void {
    const notice = this.get("#notice-bar");
    window.clearTimeout(this.noticeTimer);
    notice.hidden = false;
    notice.textContent = message;
    this.noticeTimer = window.setTimeout(() => {
      notice.hidden = true;
      notice.textContent = "";
    }, 4000);
  }

  private renderLayers(): void {
    const tree = this.model.treeForPage(this.activePageIndex);
    const renderNode = (node: ElementTreeNode, depth: number): string => {
      const selected = this.selectedIds.includes(node.id) ? " is-selected" : "";
      const icon = node.visible ? (node.locked ? "🔒" : "◇") : "◌";
      return `<li>
        <button class="layer-row${selected}" data-layer-id="${escapeHtml(node.id)}" style="--depth:${depth}" title="${escapeHtml(node.id)}">
          <span class="layer-icon">${icon}</span>
          <span class="layer-name">${escapeHtml(node.name)}</span>
          <span class="layer-tag">${escapeHtml(node.tag)}</span>
        </button>
        ${node.children.length ? `<ul>${node.children.map((child) => renderNode(child, depth + 1)).join("")}</ul>` : ""}
      </li>`;
    };
    this.get("#layers-tree").innerHTML = `<ul>${tree.map((node) => renderNode(node, 0)).join("")}</ul>`;
  }

  private renderInspector(): void {
    const host = this.get("#inspector-content");
    if (this.selectedIds.length === 0) {
      host.innerHTML = `<div class="empty-state"><span>◇</span><p>点击画布或图层选择元素</p><small>选择后可精确编辑布局、文本、图像与样式。</small></div>`;
      return;
    }
    if (this.selectedIds.length > 1) {
      host.innerHTML = `<div class="multi-selection"><strong>${this.selectedIds.length} 个元素</strong><p>${this.selectedIds.map(escapeHtml).join(" · ")}</p><small>可拖动整组，或使用画布上方的对齐与分布工具。</small></div>`;
      return;
    }
    const id = this.selectedIds[0]!;
    const modelElement = this.model.find(id);
    const previewElement = this.renderer.element(id);
    if (!modelElement || !previewElement) return;
    const bounds = this.renderer.bounds(id) ?? { x: 0, y: 0, width: 0, height: 0 };
    const computed = getComputedStyle(previewElement);
    const transform = getTransformValues(modelElement);
    const selectedKind = kindForElement(modelElement, this.model.kind);
    const isText = ["text", "tspan", "p", "span", "label", "button", "h1", "h2", "h3", "h4", "h5", "h6", "li"].includes(modelElement.localName) || modelElement.children.length === 0 && Boolean(modelElement.textContent?.trim());
    const isImage = ["img", "image"].includes(modelElement.localName);
    const fill = selectedKind === "svg" ? (modelElement.getAttribute("fill") ?? computed.fill) : computed.backgroundColor;
    const stroke = selectedKind === "svg" ? (modelElement.getAttribute("stroke") ?? "#000000") : computed.borderColor;
    const text = isText ? (modelElement.textContent ?? "") : "";
    const parentId = modelElement.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") ?? "";
    const childId = modelElement.querySelector("[data-editor-id]")?.getAttribute("data-editor-id") ?? "";
    host.innerHTML = `
      <section class="inspector-section identity-card">
        <div><span class="element-badge">${escapeHtml(modelElement.localName)}</span><strong>${escapeHtml(id)}</strong></div>
        <div class="identity-navigation">
          <button data-inspector-action="select-parent" title="选择最近的可编辑父级"${parentId ? "" : " disabled"}>选择父级</button>
          <button data-inspector-action="select-child" title="选择第一个可编辑子级"${childId ? "" : " disabled"}>选择子级</button>
        </div>
      </section>
      <section class="inspector-section">
        <h3>标识</h3>
        <label class="field"><span>显示名称</span><input data-prop="name" value="${escapeHtml(modelElement.getAttribute("data-editor-name") ?? "")}" placeholder="Layer name" /></label>
        <label class="field"><span>CSS class</span><input data-prop="className" value="${escapeHtml(modelElement.getAttribute("class") ?? "")}" /></label>
      </section>
      <section class="inspector-section">
        <div class="section-title-row"><h3>几何</h3><label class="checkbox"><input id="keep-ratio" type="checkbox" /> 锁定比例</label></div>
        <div class="field-grid four">
          <label class="field"><span>X</span><input data-prop="x" type="number" step="1" value="${bounds.x.toFixed(1)}" /></label>
          <label class="field"><span>Y</span><input data-prop="y" type="number" step="1" value="${bounds.y.toFixed(1)}" /></label>
          <label class="field"><span>W</span><input data-prop="width" type="number" min="1" step="1" value="${bounds.width.toFixed(1)}" /></label>
          <label class="field"><span>H</span><input data-prop="height" type="number" min="1" step="1" value="${bounds.height.toFixed(1)}" /></label>
        </div>
        <label class="field"><span>旋转角度</span><input data-prop="rotation" type="number" step="1" value="${transform.rotation.toFixed(1)}" /></label>
      </section>
      ${isText ? `<section class="inspector-section">
        <h3>文本</h3>
        <label class="field stack"><span>内容</span><textarea data-prop="text" rows="4">${escapeHtml(text)}</textarea></label>
        <div class="field-grid two">
          <label class="field"><span>字体</span><input data-prop="fontFamily" value="${escapeHtml(computed.fontFamily)}" /></label>
          <label class="field"><span>字号</span><input data-prop="fontSize" type="number" min="1" value="${numeric(computed.fontSize, 16)}" /></label>
          <label class="field"><span>字重</span><input data-prop="fontWeight" value="${escapeHtml(computed.fontWeight)}" /></label>
          <label class="field"><span>行高</span><input data-prop="lineHeight" value="${escapeHtml(computed.lineHeight)}" /></label>
          <label class="field"><span>字间距</span><input data-prop="letterSpacing" value="${escapeHtml(computed.letterSpacing)}" /></label>
          <label class="field"><span>对齐</span><select data-prop="textAlign"><option>left</option><option>center</option><option>right</option><option>justify</option></select></label>
        </div>
        <label class="field color-field"><span>文字颜色</span><input data-prop="color" type="color" value="${colorValue(computed.color)}" /><input data-prop="color" value="${escapeHtml(computed.color)}" /></label>
      </section>` : ""}
      ${isImage ? `<section class="inspector-section">
        <h3>图像</h3>
        <label class="field stack"><span>资源路径 / Data URL</span><input data-prop="src" value="${escapeHtml(modelElement.getAttribute(modelElement.localName === "image" ? "href" : "src") ?? "")}" /></label>
        <button class="wide-button" data-inspector-action="replace-image">选择图片替换</button>
        <label class="field"><span>Object fit</span><select data-prop="objectFit"><option>contain</option><option>cover</option><option>fill</option><option>none</option><option>scale-down</option></select></label>
      </section>` : ""}
      <section class="inspector-section">
        <h3>外观</h3>
        <label class="field color-field"><span>${selectedKind === "svg" ? "填充" : "背景"}</span><input data-prop="fill" type="color" value="${colorValue(fill)}" /><input data-prop="fill" value="${escapeHtml(fill)}" /></label>
        <label class="field color-field"><span>描边</span><input data-prop="stroke" type="color" value="${colorValue(stroke)}" /><input data-prop="stroke" value="${escapeHtml(stroke)}" /></label>
        <div class="field-grid two">
          <label class="field"><span>描边宽度</span><input data-prop="strokeWidth" type="number" min="0" step="1" value="${numeric(selectedKind === "svg" ? modelElement.getAttribute("stroke-width") ?? "0" : computed.borderWidth, 0)}" /></label>
          <label class="field"><span>透明度</span><input data-prop="opacity" type="number" min="0" max="1" step="0.05" value="${numeric(computed.opacity, 1)}" /></label>
          <label class="field"><span>圆角</span><input data-prop="borderRadius" value="${escapeHtml(computed.borderRadius)}" /></label>
          <label class="field"><span>滤镜</span><input data-prop="filter" value="${escapeHtml(computed.filter === "none" ? "" : computed.filter)}" /></label>
        </div>
        <label class="field stack"><span>阴影</span><input data-prop="boxShadow" value="${escapeHtml(computed.boxShadow === "none" ? "" : computed.boxShadow)}" /></label>
      </section>
      <section class="inspector-section">
        <h3>Inline style</h3>
        <label class="field stack"><textarea data-prop="inlineStyle" rows="4" spellcheck="false">${escapeHtml(modelElement.getAttribute("style") ?? "")}</textarea></label>
      </section>
    `;
    const ratio = host.querySelector<HTMLInputElement>("#keep-ratio");
    ratio?.addEventListener("change", () => this.transform.setKeepRatio(Boolean(ratio.checked)));
    const alignSelect = host.querySelector<HTMLSelectElement>('[data-prop="textAlign"]');
    if (alignSelect) alignSelect.value = computed.textAlign;
    const objectFit = host.querySelector<HTMLSelectElement>('[data-prop="objectFit"]');
    if (objectFit) objectFit.value = computed.objectFit || "contain";
  }

  private selectElement(id: string, additive: boolean): void {
    if (!this.model.find(id) || !this.model.elementBelongsToPage(id, this.activePageIndex)) return;
    if (additive) {
      this.selectedIds = this.selectedIds.includes(id) ? this.selectedIds.filter((selected) => selected !== id) : [...this.selectedIds, id];
    } else {
      this.selectedIds = [id];
    }
    this.history.replaceCurrent(this.createSnapshot());
    this.transform.setSelection(this.selectedIds);
    this.renderLayers();
    this.renderInspector();
    this.renderBuildPanel(this.model.buildSequence(this.activePageIndex));
    this.fragments.refreshSelection();
    this.updateLiveSelectionStatus();
  }

  private updateLiveSelectionStatus(): void {
    const status = this.get("#selection-status");
    if (this.selectedIds.length === 0) status.textContent = "未选择元素";
    else if (this.selectedIds.length > 1) status.textContent = `${this.selectedIds.length} elements selected`;
    else {
      const id = this.selectedIds[0]!;
      const bounds = this.renderer.bounds(id);
      status.textContent = bounds
        ? `${id} · x ${bounds.x.toFixed(0)} · y ${bounds.y.toFixed(0)} · ${bounds.width.toFixed(0)} × ${bounds.height.toFixed(0)}`
        : id;
    }
  }

  private commitMutation(label: string, mutate: () => void, nextSelection?: string[]): boolean {
    try {
      mutate();
      if (nextSelection) this.selectedIds = nextSelection;
      if (this.history.commit(this.createSnapshot(), label)) this.recordOperation(label, "ui");
      this.renderDocument(true);
      return true;
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  private restore(snapshot: DocumentSnapshot): void {
    this.model = SourceDocument.parse(snapshot.source, snapshot.sourceName, snapshot.kind, snapshot.canvas);
    if (snapshot.assets) {
      this.assets.dispose();
      this.assets = new ProjectAssets(snapshot.assets);
    }
    const pages = this.model.pages();
    const restoredPageIndex = snapshot.activePageId ? pages.findIndex((page) => page.id === snapshot.activePageId) : -1;
    this.activePageIndex = restoredPageIndex >= 0 ? restoredPageIndex : Math.min(this.activePageIndex, Math.max(0, pages.length - 1));
    this.buildStepsByPage = new Map(Object.entries(snapshot.buildStepsByPage ?? {}).map(([id, step]) => [id, Number(step)]));
    this.buildViewMode = snapshot.buildViewMode ?? "playback";
    this.selectedIds = snapshot.selectedIds.filter((id) => Boolean(this.model.find(id)));
    this.renderDocument(true);
  }

  private undo(): void {
    const snapshot = this.history.undo();
    if (snapshot) {
      this.recordOperation("Undo", "history");
      this.restore(snapshot);
    }
  }

  private redo(): void {
    const snapshot = this.history.redo();
    if (snapshot) {
      this.recordOperation("Redo", "history");
      this.restore(snapshot);
    }
  }

  private loadExample(kind: string): void {
    if (kind === "svg") this.loadSource(defaultSvg, "shapes.svg", "examples/shapes.svg", new ProjectAssets());
    else if (kind === "deck") this.loadSource(defaultDeck, "multi-page-deck.html", "examples/multi-page-deck.html", exampleAssets());
    else this.loadSource(defaultHtml, "ai-slide.html", "examples/ai-slide.html", exampleAssets());
  }

  private loadSource(source: string, sourceName: string, sourcePath: string, assets: ProjectAssets, canvas?: { width: number; height: number }, operations: OperationLogEntry[] = []): void {
    try {
      const model = SourceDocument.parse(source, sourceName, undefined, canvas);
      this.assets.dispose();
      this.assets = assets;
      this.model = model;
      this.sourcePath = sourcePath;
      this.operationLog = operations.map((entry) => ({ ...entry, elementIds: [...entry.elementIds] }));
      this.selectedIds = [];
      this.activePageIndex = 0;
      this.buildStepsByPage.clear();
      this.buildViewMode = "playback";
      this.history.reset(this.createSnapshot(), "Loaded document");
      this.renderDocument(true);
      requestAnimationFrame(() => this.fitCanvas());
      this.toast(`已载入 ${sourceName}`);
    } catch (error) {
      assets.dispose();
      this.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  private async handleFileImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const value = await file.text();
      if (/\.json$/i.test(file.name)) {
        const { project, assets } = parseSavedProject(value);
        this.loadSource(project.source, project.sourceName, project.sourcePath, assets, project.canvas, project.operations ?? []);
      } else {
        this.loadSource(value, file.name, file.name, new ProjectAssets());
      }
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  private async handleDirectoryImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    input.value = "";
    if (!files?.length) return;
    try {
      const loaded = await importDirectory(files);
      this.loadSource(loaded.source, loaded.sourceName, loaded.sourcePath, loaded.assets);
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  private layerAction(action: string): void {
    const id = this.selectedIds[0];
    if (!id) return;
    const element = this.model.find(id);
    if (!element) return;
    if (action === "parent") {
      const parent = element.parentElement?.closest("[data-editor-id]");
      const parentId = parent?.getAttribute("data-editor-id");
      if (parentId) this.selectElement(parentId, false);
      return;
    }
    if (action === "child") {
      const childId = element.querySelector("[data-editor-id]")?.getAttribute("data-editor-id");
      if (childId) this.selectElement(childId, false);
      return;
    }
    if (action === "duplicate") {
      if (element.getAttribute("data-editor-locked") === "true") {
        this.toast("元素已锁定，请先解锁再复制");
        return;
      }
      let newId = "";
      this.commitMutation("Duplicate element", () => {
        newId = duplicateElement(this.model.document, this.model.kind, id);
        this.selectedIds = [newId];
      });
      return;
    }
    if (action === "visibility") {
      if (element.getAttribute("data-editor-locked") === "true") {
        this.toast("元素已锁定，请先解锁再修改显隐");
        return;
      }
      const visible = element.getAttribute("data-editor-visible") !== "false" && !element.hasAttribute("hidden") && (element as HTMLElement | SVGElement).style.display !== "none";
      this.commitMutation(visible ? "Hide element" : "Show element", () => setElementVisible(element, kindForElement(element, this.model.kind), !visible));
      return;
    }
    if (action === "lock") {
      const locked = element.getAttribute("data-editor-locked") === "true";
      this.commitMutation(locked ? "Unlock element" : "Lock element", () => setElementLocked(element, !locked));
      return;
    }
    if (action === "delete") {
      this.commitMutation("Delete element", () => this.model.apply({ action: "deleteElement", elementId: id }), []);
      return;
    }
    if (action === "up" || action === "down") {
      this.commitMutation("Reorder element", () => this.model.apply({ action: "reorderElement", elementId: id, direction: action }));
    }
  }

  private addNewElement(type: "text" | "shape"): void {
    let parent = this.selectedIds[0] ? this.model.find(this.selectedIds[0]!) : null;
    if (parent && !["body", "div", "section", "main", "article", "svg", "g"].includes(parent.localName)) parent = parent.parentElement;
    parent ??= this.model.editingRoot(this.activePageIndex);
    const parentId = parent?.getAttribute("data-editor-id");
    if (!parent || !parentId) return;
    const parentKind = kindForElement(parent, this.model.kind);
    let createdId = "";
    this.commitMutation(`Add ${type}`, () => {
      createdId = addElement(this.model.document, parentKind, parentId, type === "text"
        ? { type: "text", text: "New annotation", x: 80, y: 80, width: 280, height: 64, fontSize: 28, color: this.model.kind === "html" ? "#172033" : "#172033" }
        : { type: this.model.kind === "svg" ? "rect" : "rect", x: 100, y: 100, width: 180, height: 110, fill: "#5b8cff", borderRadius: 12 });
      this.selectedIds = [createdId];
    });
  }

  private handleInspectorChange(event: Event): void {
    const input = (event.target as Element).closest<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-prop]");
    const id = this.selectedIds[0];
    if (!input?.dataset.prop || !id) return;
    const prop = input.dataset.prop;
    const value = input.value;
    const element = this.model.find(id);
    if (!element) return;
    if (element.getAttribute("data-editor-locked") === "true") {
      this.toast("元素已锁定，请先解锁再修改属性");
      this.renderInspector();
      return;
    }
    const bounds = this.renderer.bounds(id) ?? { x: 0, y: 0, width: 0, height: 0 };
    const targetKind = kindForElement(element, this.model.kind);
    this.commitMutation(`Update ${prop}`, () => {
      if (prop === "x") moveElementBy(element, targetKind, numeric(value) - bounds.x, 0);
      else if (prop === "y") moveElementBy(element, targetKind, 0, numeric(value) - bounds.y);
      else if (prop === "width" || prop === "height") this.model.apply({ action: "updateElement", elementId: id, changes: { [prop]: Math.max(1, numeric(value, 1)) } });
      else if (prop === "rotation") this.model.apply({ action: "rotateElement", elementId: id, angle: numeric(value) });
      else if (prop === "fontSize" || prop === "opacity" || prop === "strokeWidth") applyElementChanges(element, targetKind, { [prop]: numeric(value) });
      else if (prop === "inlineStyle") {
        const warnings: string[] = [];
        element.setAttribute("style", sanitizeCss(value, warnings));
        if (warnings.length) this.showNotice(warnings.join(" "));
      } else applyElementChanges(element, targetKind, { [prop]: value });
    });
  }

  private async replaceImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    const id = this.selectedIds[0];
    if (!file || !id) return;
    try {
      const source = await readFileAsDataUrl(file);
      this.commitMutation("Replace image", () => this.model.apply({ action: "updateElement", elementId: id, changes: { src: source } }));
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  private alignSelection(mode: string): void {
    if (this.selectedIds.length === 0) return;
    const items = this.selectedIds
      .map((id) => ({ id, element: this.model.find(id), bounds: this.renderer.bounds(id) }))
      .filter((item): item is { id: string; element: Element; bounds: Bounds } => Boolean(item.element && item.bounds))
      .filter((item) => item.element.getAttribute("data-editor-locked") !== "true");
    if (items.length === 0) return;
    if ((mode === "distribute-x" || mode === "distribute-y") && items.length < 3) {
      this.toast("分布操作至少需要选择 3 个元素");
      return;
    }
    this.commitMutation(`Align ${mode}`, () => {
      if (mode === "distribute-x") {
        const sorted = [...items].sort((left, right) => left.bounds.x - right.bounds.x);
        const start = sorted[0]!.bounds.x;
        const end = sorted.at(-1)!.bounds.x + sorted.at(-1)!.bounds.width;
        const total = sorted.reduce((sum, item) => sum + item.bounds.width, 0);
        const gap = (end - start - total) / (sorted.length - 1);
        let cursor = start;
        sorted.forEach((item) => {
          moveElementBy(item.element, kindForElement(item.element, this.model.kind), cursor - item.bounds.x, 0);
          cursor += item.bounds.width + gap;
        });
        return;
      }
      if (mode === "distribute-y") {
        const sorted = [...items].sort((left, right) => left.bounds.y - right.bounds.y);
        const start = sorted[0]!.bounds.y;
        const end = sorted.at(-1)!.bounds.y + sorted.at(-1)!.bounds.height;
        const total = sorted.reduce((sum, item) => sum + item.bounds.height, 0);
        const gap = (end - start - total) / (sorted.length - 1);
        let cursor = start;
        sorted.forEach((item) => {
          moveElementBy(item.element, kindForElement(item.element, this.model.kind), 0, cursor - item.bounds.y);
          cursor += item.bounds.height + gap;
        });
        return;
      }
      const minX = items.length === 1 ? 0 : Math.min(...items.map((item) => item.bounds.x));
      const maxX = items.length === 1 ? this.model.canvas.width : Math.max(...items.map((item) => item.bounds.x + item.bounds.width));
      const minY = items.length === 1 ? 0 : Math.min(...items.map((item) => item.bounds.y));
      const maxY = items.length === 1 ? this.model.canvas.height : Math.max(...items.map((item) => item.bounds.y + item.bounds.height));
      items.forEach((item) => {
        let dx = 0;
        let dy = 0;
        if (mode === "left") dx = minX - item.bounds.x;
        if (mode === "center") dx = (minX + maxX) / 2 - (item.bounds.x + item.bounds.width / 2);
        if (mode === "right") dx = maxX - (item.bounds.x + item.bounds.width);
        if (mode === "top") dy = minY - item.bounds.y;
        if (mode === "middle") dy = (minY + maxY) / 2 - (item.bounds.y + item.bounds.height / 2);
        if (mode === "bottom") dy = maxY - (item.bounds.y + item.bounds.height);
        moveElementBy(item.element, kindForElement(item.element, this.model.kind), dx, dy);
      });
    });
  }

  private changeCanvasSize(): void {
    const width = numeric(this.get<HTMLInputElement>("#canvas-width").value, this.model.canvas.width);
    const height = numeric(this.get<HTMLInputElement>("#canvas-height").value, this.model.canvas.height);
    this.commitMutation("Resize canvas", () => this.model.setCanvas({ width, height }));
    requestAnimationFrame(() => this.fitCanvas());
  }

  private applyCanvasPreset(value: string): void {
    if (value === "custom") return;
    const match = value.match(/^(\d+)x(\d+)$/);
    if (!match) return;
    const width = Number(match[1]);
    const height = Number(match[2]);
    this.commitMutation(`Apply ${width}:${height} canvas preset`, () => this.model.setCanvas({ width, height }));
    requestAnimationFrame(() => this.fitCanvas());
  }

  private setZoom(value: number, anchor?: { x: number; y: number }): void {
    const next = Math.min(4, Math.max(0.08, value));
    if (anchor) {
      const canvasX = (anchor.x - this.pan.x) / this.zoom;
      const canvasY = (anchor.y - this.pan.y) / this.zoom;
      this.pan.x = anchor.x - canvasX * next;
      this.pan.y = anchor.y - canvasY * next;
    }
    this.zoom = next;
    this.updateCanvasTransform();
  }

  private updateCanvasTransform(): void {
    const transform = this.get("#canvas-transform");
    transform.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    this.get("#zoom-display").textContent = `${Math.round(this.zoom * 100)}%`;
    this.transform.setZoom(this.zoom);
  }

  private fitCanvas(): void {
    const viewport = this.get("#canvas-viewport");
    const availableWidth = Math.max(100, viewport.clientWidth - 96);
    const availableHeight = Math.max(100, viewport.clientHeight - 96);
    this.zoom = Math.min(1, availableWidth / this.model.canvas.width, availableHeight / this.model.canvas.height);
    this.pan = {
      x: (viewport.clientWidth - this.model.canvas.width * this.zoom) / 2,
      y: (viewport.clientHeight - this.model.canvas.height * this.zoom) / 2,
    };
    this.updateCanvasTransform();
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const viewport = this.get("#canvas-viewport").getBoundingClientRect();
    const anchor = { x: event.clientX - viewport.left, y: event.clientY - viewport.top };
    this.setZoom(this.zoom * Math.exp(-event.deltaY * 0.0015), anchor);
  }

  private beginPan(event: PointerEvent): void {
    if (event.button !== 1 && !this.spacePressed) return;
    event.preventDefault();
    const viewport = this.get("#canvas-viewport");
    viewport.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, panX: this.pan.x, panY: this.pan.y };
    const move = (moveEvent: PointerEvent): void => {
      this.pan.x = start.panX + moveEvent.clientX - start.x;
      this.pan.y = start.panY + moveEvent.clientY - start.y;
      this.updateCanvasTransform();
    };
    const end = (): void => {
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", end);
      viewport.removeEventListener("pointercancel", end);
    };
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", end);
    viewport.addEventListener("pointercancel", end);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const editableTarget = event.composedPath().some((node) =>
      node instanceof Element && node.matches("input,textarea,select,[contenteditable],.cm-editor"),
    );
    if (editableTarget) return;
    if (event.altKey && (event.key === "[" || event.key === "]")) {
      event.preventDefault();
      this.changeBuild(event.key === "[" ? -1 : 1);
      return;
    }
    if (event.code === "Space") {
      this.spacePressed = true;
      event.preventDefault();
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      const pages = this.model.pages();
      if (pages.length > 1) {
        event.preventDefault();
        this.changePage(this.activePageIndex + (event.key === "PageUp" ? -1 : 1));
        return;
      }
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && this.selectedIds.length) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      this.commitMutation("Nudge element", () => {
        this.selectedIds.forEach((id) => {
          const element = this.model.find(id);
          if (element && element.getAttribute("data-editor-locked") !== "true") moveElementBy(element, kindForElement(element, this.model.kind), dx, dy);
        });
      });
    } else if ((event.key === "Delete" || event.key === "Backspace") && this.selectedIds.length === 1) {
      event.preventDefault();
      this.layerAction("delete");
    }
  }

  private applyCode(): void {
    try {
      const activePageId = this.model.pages()[this.activePageIndex]?.id;
      const next = SourceDocument.parse(this.codeEditor.value, this.model.sourceName);
      this.model = next;
      const nextPages = next.pages();
      const matchingPage = activePageId ? nextPages.findIndex((page) => page.id === activePageId) : -1;
      this.activePageIndex = matchingPage >= 0 ? matchingPage : Math.min(this.activePageIndex, Math.max(0, nextPages.length - 1));
      this.selectedIds = this.selectedIds.filter((id) => Boolean(next.find(id)));
      if (this.history.commit(this.createSnapshot(), "Apply source code")) this.recordOperation("Apply source code", "code");
      this.get("#code-error").textContent = "";
      this.renderDocument(true);
      this.toast("代码已应用到画布");
    } catch (error) {
      this.get("#code-error").textContent = error instanceof Error ? error.message : String(error);
      this.toast("代码解析失败；画布保留上一个有效版本", true);
    }
  }

  private async formatCode(): Promise<void> {
    try {
      const [prettier, prettierHtml] = await Promise.all([
        import("prettier/standalone"),
        import("prettier/plugins/html"),
      ]);
      const formatted = await prettier.format(this.codeEditor.value, {
        parser: "html",
        plugins: [prettierHtml],
        printWidth: 110,
        tabWidth: 2,
        htmlWhitespaceSensitivity: "ignore",
      });
      this.codeEditor.setValue(formatted);
      this.codeDirty = true;
      this.get("#sync-status").textContent = "格式化结果尚未应用";
      this.get("#sync-status").className = "sync-dirty";
    } catch (error) {
      this.get("#code-error").textContent = error instanceof Error ? error.message : String(error);
    }
  }

  private toggleCodeDrawer(): void {
    const drawer = this.get("#code-drawer");
    const collapsed = drawer.classList.toggle("is-collapsed");
    this.get(".studio-shell").classList.toggle("is-code-collapsed", collapsed);
    this.get("#toggle-code").textContent = collapsed ? "展开源码" : "收起源码";
    const updateCanvas = (): void => {
      this.fitCanvas();
      this.transform.update();
    };
    requestAnimationFrame(updateCanvas);
  }

  private previewPresentation(initialPageIndex: number): void {
    try {
      const presentation = buildStandaloneSlides(this.model, this.assets, this.sourcePath, { initialPageIndex });
      if (presentation.warnings.length) this.showNotice(presentation.warnings.join(" "));
      const frame = this.get<HTMLIFrameElement>("#presentation-frame");
      frame.srcdoc = presentation.html;
      this.get<HTMLDialogElement>("#presentation-dialog").showModal();
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  private exportDocument(): void {
    if (this.model.kind === "svg") {
      const name = this.model.sourceName.match(/\.svg$/i) ? this.model.sourceName : `${fileStem(this.model.sourceName)}.svg`;
      downloadText(this.model.serialize(), name, "image/svg+xml");
      this.toast(`已导出 ${name}`);
      return;
    }
    try {
      const presentation = buildInteractiveHtml(this.model, this.assets, this.sourcePath);
      const name = `${fileStem(this.model.sourceName)}.html`;
      downloadText(presentation.html, name, "text/html");
      if (presentation.warnings.length) this.showNotice(presentation.warnings.join(" "));
      this.toast(`已导出 ${name}`);
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  private exportProject(): void {
    const project = createSavedProject(this.model.serialize(), this.model.sourceName, this.sourcePath, this.model.kind, this.model.canvas, this.assets, this.operationLog);
    downloadText(`${JSON.stringify(project, null, 2)}\n`, `${fileStem(this.model.sourceName)}.visual-project.json`, "application/json");
  }

  private async exportZip(): Promise<void> {
    try {
      const zip = await exportProjectZip(this.model.serialize(), this.sourcePath, this.assets);
      downloadBlob(zip, `${fileStem(this.model.sourceName)}-project.zip`);
      this.toast("项目 ZIP 已生成");
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  private exportSummary(): void {
    const summary = this.model.summary((element) => {
      const id = element.getAttribute("data-editor-id");
      return id ? this.renderer.bounds(id) : null;
    });
    downloadText(`${JSON.stringify(summary, null, 2)}\n`, `${fileStem(this.model.sourceName)}-structure.json`, "application/json");
  }

  private toast(message: string, error = false): void {
    const toast = this.get("#toast");
    window.clearTimeout(this.toastTimer);
    toast.textContent = message;
    toast.className = `toast${error ? " is-error" : ""}`;
    toast.hidden = false;
    this.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
  }

  private recordOperation(label: string, source: OperationLogEntry["source"]): void {
    this.operationLog.push({ at: new Date().toISOString(), label, elementIds: [...this.selectedIds], source });
    if (this.operationLog.length > 500) this.operationLog.shift();
  }
}
