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
  setElementScale,
  setElementScaleOrigin,
  setElementTranslation,
  setElementLocked,
  setElementVisible,
  validateReparentElement,
} from "../core/commands";
import { snapshotsEqual, SourceDocument } from "../core/document-model";
import { History } from "../core/history";
import { buildInteractiveHtml, buildStandaloneSlides, buildStandaloneSvg } from "../core/presentation";
import {
  FONT_CATALOG,
  ensureManagedFontFace,
  fontEntryById,
  fontEntryForFamily,
  loadManagedFontAsset,
  resolveFontAvailability,
  type FontCatalogEntry,
} from "../core/font-catalog";
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
import {
  DEFAULT_SHADOW,
  SHADOW_PRESETS,
  matchingShadowPreset,
  parseBoxShadow,
  serializeBoxShadow,
  type ShadowValue,
} from "../core/shadow";
import type { Bounds, BuildViewMode, DocumentKind, DocumentPage, DocumentSnapshot, ElementTreeNode, OperationLogEntry, PageBuildSequence } from "../core/types";
import { SourceCodeEditor } from "./code-editor";
import { FragmentWorkspace, type FragmentWorkspaceContext } from "./fragment-workspace";
import { UiLocalizer, type UiLocale } from "./i18n";
import { EditorLayoutController } from "./layout-controller";

type InspectorGroup = "design" | "build" | "advanced";
type CanvasScrollAxis = "x" | "y";

const INSPECTOR_GROUP_STORAGE_KEY = "last-mile-studio:inspector-group:v1";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]!);
}

const chevronIcon = `<svg class="ui-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.25 3.5 3.5 3.5-3.5"/></svg>`;
const layerGripIcon = `<svg class="layer-grip-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="4" r="1"/><circle cx="11" cy="4" r="1"/><circle cx="5" cy="8" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="11" cy="12" r="1"/></svg>`;

function layerStateIcon(visible: boolean, locked: boolean): string {
  if (!visible) {
    return `<svg class="layer-state-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.25 8s2-3.5 5.75-3.5S13.75 8 13.75 8s-2 3.5-5.75 3.5S2.25 8 2.25 8Z"/><path d="m3 3 10 10"/></svg>`;
  }
  if (locked) {
    return `<svg class="layer-state-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7"/></svg>`;
  }
  return `<svg class="layer-state-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.25 8s2-3.5 5.75-3.5S13.75 8 13.75 8s-2 3.5-5.75 3.5S2.25 8 2.25 8Z"/><circle cx="8" cy="8" r="1.75"/></svg>`;
}

function numeric(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function geometryValue(value: number): number {
  return Math.round(value * 10) / 10;
}

function geometryText(value: number): string {
  return String(geometryValue(value));
}

export function colorValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^#[\da-f]{6}$/.test(normalized)) return normalized;
  const shortHex = normalized.match(/^#([\da-f])([\da-f])([\da-f])$/);
  if (shortHex) return `#${shortHex.slice(1).map((channel) => channel.repeat(2)).join("")}`;

  const functional = normalized.match(/^rgba?\((.*)\)$/);
  if (!functional) return "#000000";
  const channels = functional[1]!.split(/[,\s/]+/).filter(Boolean).slice(0, 3);
  if (channels.length !== 3) return "#000000";
  const bytes = channels.map((channel) => {
    const numericChannel = Number.parseFloat(channel);
    if (!Number.isFinite(numericChannel)) return null;
    const byte = channel.endsWith("%") ? (numericChannel / 100) * 255 : numericChannel;
    return Math.round(Math.min(255, Math.max(0, byte)));
  });
  if (bytes.some((channel) => channel === null)) return "#000000";
  return `#${bytes.map((channel) => channel!.toString(16).padStart(2, "0")).join("")}`;
}

const LETTER_SPACING_OPTIONS = [-2, -1, 0, 0.5, 1, 2, 4, 8] as const;

function fontCatalogMarkup(currentFamily: string): { html: string; selectedId: string | null } {
  const selected = fontEntryForFamily(currentFamily);
  const groups = Array.from(new Set(FONT_CATALOG.map((entry) => entry.group)));
  const custom = selected ? "" : `<option value="__current__" selected>当前：${escapeHtml(currentFamily)}</option>`;
  const html = groups.map((group) => `<optgroup label="${escapeHtml(group)}">${FONT_CATALOG
    .filter((entry) => entry.group === group)
    .map((entry) => `<option value="${escapeHtml(entry.id)}"${entry.id === selected?.id ? " selected" : ""}>${escapeHtml(entry.label)}</option>`)
    .join("")}</optgroup>`).join("");
  return { html: `${custom}${html}`, selectedId: selected?.id ?? null };
}

function letterSpacingMarkup(value: string): string {
  const spacing = value === "normal" ? 0 : numeric(value, 0);
  const known = LETTER_SPACING_OPTIONS.some((option) => option === spacing);
  const current = known ? "" : `<option value="${spacing}" selected>当前：${spacing} px</option>`;
  return `${current}${LETTER_SPACING_OPTIONS.map((option) =>
    `<option value="${option}"${option === spacing ? " selected" : ""}>${option} px</option>`).join("")}`;
}

function shadowEditorMarkup(computedShadow: string): string {
  const none = computedShadow === "none" || !computedShadow.trim();
  const parsed = parseBoxShadow(computedShadow);
  const complex = !none && !parsed;
  const value = parsed ?? DEFAULT_SHADOW;
  const activePreset = none ? "none" : matchingShadowPreset(parsed);
  const presets = SHADOW_PRESETS.map((preset) => {
    const preview = serializeBoxShadow(preset.value);
    return `<button type="button" class="shadow-preset${preset.id === activePreset ? " is-active" : ""}" data-shadow-preset="${preset.id}" style="--shadow-sample:${escapeHtml(preview)}"><span></span><small>${escapeHtml(preset.label)}</small></button>`;
  }).join("");
  const control = (part: keyof Pick<ShadowValue, "x" | "y" | "blur" | "spread">, label: string, min: number, max: number) =>
    `<label class="shadow-control"><span>${label}</span><input type="range" min="${min}" max="${max}" step="1" value="${value[part]}" data-shadow-part="${part}" /><output data-shadow-output="${part}">${value[part]} px</output></label>`;
  return `<div class="shadow-editor" data-shadow-editor>
    <div class="shadow-presets">${presets}</div>
    ${complex ? `<p class="shadow-notice">当前为多层或 inset 阴影；在选择预设前保持原值。</p>` : ""}
    <details class="shadow-details" data-shadow-details>
      <summary><span>阴影精细调节</span><small>位置、模糊与颜色</small></summary>
      <div class="shadow-controls">
        ${control("x", "水平", -32, 32)}
        ${control("y", "垂直", -32, 32)}
        ${control("blur", "模糊", 0, 64)}
        ${control("spread", "扩散", -32, 32)}
        <label class="shadow-color"><span>颜色</span><input type="color" value="${value.color}" data-shadow-part="color" /><output>${value.color}</output></label>
        <label class="shadow-control"><span>透明度</span><input type="range" min="0" max="1" step="0.05" value="${value.opacity}" data-shadow-part="opacity" /><output data-shadow-output="opacity">${Math.round(value.opacity * 100)}%</output></label>
      </div>
    </details>
  </div>`;
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

type LayerDropPlacement = "before" | "inside" | "after";
type NavigationView = "layers" | "pages" | "fragments";

interface LayerDragState {
  pointerId: number;
  sourceId: string;
  handle: HTMLElement;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  active: boolean;
  targetId?: string;
  placement?: LayerDropPlacement;
  valid: boolean;
  reason?: string;
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
      <div class="brand" title="AfterPrompt — Visually refine what AI generates.">
        <span class="brand-mark">AP</span>
        <span><strong>AfterPrompt</strong><small>Visually refine what AI generates.</small></span>
      </div>
      <div class="toolbar toolbar-primary">
        <details id="import-menu" class="io-menu" data-io-menu>
          <summary class="button primary">导入 ${chevronIcon}</summary>
          <div class="io-menu-panel" role="menu" aria-label="导入选项">
            <div class="io-menu-key-hint" aria-hidden="true">↑↓ 浏览 · Home / End 跳转 · Esc 关闭</div>
            <section>
              <span class="io-menu-heading">打开</span>
              <button id="import-document-action" type="button" role="menuitem"><strong>文档文件</strong><small>HTML、SVG 或可编辑项目</small></button>
              <button id="import-directory-action" type="button" role="menuitem"><strong>项目目录</strong><small>载入入口文件及本地资源</small></button>
              <button id="paste-source-action" type="button" role="menuitem"><strong>粘贴 HTML / SVG</strong><small>用源码替换当前文档</small></button>
            </section>
            <section>
              <span class="io-menu-heading">插入当前页面</span>
              <button id="insert-fragment-action" type="button" role="menuitem"><strong>片段或图片</strong><small>.vfrag、SVG、PNG、JPG</small></button>
              <button id="open-temporary-clipboard-action" type="button" role="menuitem"><strong>临时片段剪贴板</strong><small>Ctrl/Cmd+V 粘贴最新片段</small></button>
              <button id="open-local-library-action" type="button" role="menuitem"><strong>本地片段库</strong><small>连接或管理 .vfrag 目录</small></button>
            </section>
            <section>
              <span class="io-menu-heading">示例</span>
              <button type="button" role="menuitem" data-load-example="html"><strong>HTML Slide</strong></button>
              <button type="button" role="menuitem" data-load-example="deck"><strong>Multi-page deck</strong></button>
              <button type="button" role="menuitem" data-load-example="svg"><strong>SVG shapes</strong></button>
            </section>
          </div>
        </details>
        <span class="toolbar-separator"></span>
        <button id="undo" class="icon-button" title="Undo (Ctrl/Cmd+Z)" aria-label="撤销">↶</button>
        <button id="redo" class="icon-button" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="重做">↷</button>
      </div>
      <div class="toolbar toolbar-export">
        <div class="language-switcher" role="group" aria-label="语言">
          <button type="button" data-locale-switch="zh-CN" aria-pressed="false" data-l10n-skip>中文</button>
          <button type="button" data-locale-switch="en" aria-pressed="false" data-l10n-skip>EN</button>
        </div>
        <button id="preview-presentation" class="button">演示预览</button>
        <details id="export-menu" class="io-menu io-menu-end" data-io-menu>
          <summary class="button primary">导出 ${chevronIcon}</summary>
          <div class="io-menu-panel" role="menu" aria-label="导出选项">
            <div class="io-menu-key-hint" aria-hidden="true">↑↓ 浏览 · Home / End 跳转 · Esc 关闭</div>
            <section>
              <span class="io-menu-heading">当前内容</span>
              <button id="export-document-action" type="button" role="menuitem"><strong id="export-document-label">导出 HTML</strong><small>可直接打开并重新导入</small></button>
              <button id="export-selection-action" type="button" role="menuitem"><strong>导出选区为片段</strong><small>.vfrag 文件或本地目录</small></button>
            </section>
            <section>
              <span class="io-menu-heading">项目与自动化</span>
              <button id="export-project-action" type="button" role="menuitem"><strong>保存可编辑项目</strong><small>.visual-project.json</small></button>
              <button id="export-zip-action" type="button" role="menuitem"><strong>源码与资源包</strong><small>导出项目 ZIP</small></button>
              <button id="export-summary-action" type="button" role="menuitem"><strong>AI 结构数据</strong><small>导出结构 JSON</small></button>
            </section>
          </div>
        </details>
      </div>
    </header>

    <div id="notice-bar" class="notice-bar" hidden></div>

    <main class="workspace">
      <nav class="activity-rail" aria-label="工作区导航">
        <div role="tablist" aria-orientation="vertical" aria-label="左侧面板">
          <button id="activity-layers" type="button" role="tab" tabindex="0" data-activity-view="layers" aria-controls="layers-context" aria-selected="true" title="图层与结构">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 6.5 7-3.5 7 3.5-7 3.5-7-3.5Z"/><path d="m3 10 7 3.5 7-3.5M3 13.5l7 3.5 7-3.5"/></svg>
            <span class="visually-hidden">图层</span>
          </button>
          <button id="activity-pages" type="button" role="tab" tabindex="-1" data-activity-view="pages" aria-controls="pages-context" aria-selected="false" title="页面">
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="3" width="12" height="14" rx="1"/><path d="M7 7h6M7 10h6M7 13h4"/></svg>
            <span class="visually-hidden">页面</span>
          </button>
          <button id="activity-fragments" type="button" role="tab" tabindex="-1" data-activity-view="fragments" aria-controls="fragments-context" aria-selected="false" title="片段与资源">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z"/></svg>
            <span class="visually-hidden">片段与资源</span>
          </button>
        </div>
      </nav>
      <aside id="layers-panel" class="panel layers-panel">
        <button class="panel-collapse-toggle" data-layout-toggle="layers" aria-controls="layers-panel" aria-label="折叠或展开左侧面板"></button>
        <section id="layers-context" class="panel-context layers-context" role="tabpanel" aria-labelledby="activity-layers">
          <div class="panel-heading">
            <div><span class="eyebrow">DOCUMENT</span><h2>图层与结构</h2></div>
            <div class="compact-actions">
              <button id="add-text" title="Add text" aria-label="添加文本">T+</button>
              <button id="add-shape" title="Add shape" aria-label="添加形状">▣+</button>
            </div>
          </div>
          <div class="layer-actions" aria-label="Layer actions">
            <button data-layer-action="visibility" title="Show or hide">显隐</button>
            <button data-layer-action="lock" title="Lock or unlock">锁定</button>
            <button data-layer-action="down" title="Move backward" aria-label="下移图层">↓</button>
            <button data-layer-action="up" title="Move forward" aria-label="上移图层">↑</button>
          </div>
          <div id="layers-tree" class="layers-tree"></div>
          <div class="panel-footnote">方向键浏览 · Enter 选择 · F2 重命名 · Alt + 方向键调整层级。</div>
        </section>
        <section id="pages-context" class="panel-context pages-context" role="tabpanel" aria-labelledby="activity-pages" hidden>
          <div id="page-filmstrip" class="page-filmstrip" hidden>
            <div class="page-filmstrip-actions">
              <div><span class="eyebrow">PAGES</span><h2>页面</h2></div>
              <button class="page-collapse-toggle" data-layout-toggle="pages" aria-controls="page-thumbnails" aria-label="折叠或展开页面列表"></button>
              <div class="page-action-group">
                <button id="duplicate-page" title="复制当前页">复制</button>
                <button id="move-page-earlier" title="向前移动当前页">前移</button>
                <button id="move-page-later" title="向后移动当前页">后移</button>
              </div>
              <button id="delete-page" class="danger" title="删除当前页">删除</button>
            </div>
            <div id="page-thumbnails" class="page-thumbnails" aria-label="页面缩略图"></div>
            <div class="layout-resizer row-resizer page-resizer" data-layout-resizer="pages" role="separator" aria-orientation="horizontal" aria-label="调整页面缩略图高度" tabindex="0"></div>
          </div>
        </section>
        <section id="fragments-context" class="panel-context fragments-context" role="tabpanel" aria-labelledby="activity-fragments" hidden>
          <div class="panel-heading"><div><span class="eyebrow">REUSABLE CONTENT</span><h2>片段与资源</h2></div></div>
          <div class="fragment-context-actions">
            <button type="button" data-fragment-context-action="insert"><strong>插入片段或图片</strong><span>.vfrag、SVG、PNG、JPG</span></button>
            <button type="button" data-fragment-context-action="clipboard"><strong>临时片段剪贴板</strong><span>查看最近复制的可复用内容</span></button>
            <button type="button" data-fragment-context-action="library"><strong>本地片段库</strong><span>连接并管理用户拥有的目录</span></button>
          </div>
          <p class="panel-footnote">片段操作继续使用现有安全导入、兼容性检查和本地存储流程。</p>
        </section>
        <div class="layout-resizer column-resizer" data-layout-resizer="layers" role="separator" aria-orientation="vertical" aria-label="调整图层与结构面板宽度" tabindex="0"></div>
      </aside>

      <section class="canvas-panel">
        <div class="canvas-toolbar">
          <div class="canvas-mode-row">
            <div class="canvas-playback-controls">
              <div id="page-control" class="toolbar page-control" hidden>
                <span class="tool-label">页面</span>
                <button id="previous-page" title="上一页 (Page Up)" aria-label="上一页">‹</button>
                <select id="page-select" aria-label="选择要编辑的页面"></select>
                <span id="page-count">1 / 1</span>
                <button id="next-page" title="下一页 (Page Down)" aria-label="下一页">›</button>
              </div>
              <div id="build-control" class="toolbar build-control" hidden>
                <span class="tool-label">Build</span>
                <button id="previous-build" title="Previous Build (Alt + [)" aria-label="Previous Build">‹</button>
                <span id="build-status">Initial / 0</span>
                <button id="next-build" title="Next Build (Alt + ])" aria-label="Next Build">›</button>
                <select id="build-view-mode" aria-label="Build 视图">
                  <option value="playback">Playback State</option>
                  <option value="group">Current Group</option>
                  <option value="all">All Builds</option>
                </select>
              </div>
            </div>
            <div class="canvas-view-controls">
              <div class="toolbar canvas-size-control">
                <select id="canvas-preset" aria-label="画布尺寸预设">
                  <option value="custom">自定义</option>
                  <option value="1920x1080">16:9 · 1920×1080</option>
                  <option value="1024x768">4:3 · 1024×768</option>
                </select>
                <label>W <input id="canvas-width" type="number" min="1" step="1" aria-label="画布宽度" /></label>
                <span>×</span>
                <label>H <input id="canvas-height" type="number" min="1" step="1" aria-label="画布高度" /></label>
              </div>
              <div class="toolbar zoom-control">
                <button id="zoom-out" title="Zoom out" aria-label="缩小画布">−</button>
                <button id="zoom-display" title="Reset zoom">100%</button>
                <button id="zoom-in" title="Zoom in" aria-label="放大画布">＋</button>
                <button id="fit-canvas">适应窗口</button>
              </div>
            </div>
          </div>
          <div class="toolbar selection-toolbar" hidden aria-label="选区操作">
            <span class="selection-context-label">选区</span>
            <span class="tool-label">对齐</span>
            <button data-align="left" title="Align left">左</button>
            <button data-align="center" title="Align horizontal center">水平居中</button>
            <button data-align="right" title="Align right">右</button>
            <button data-align="top" title="Align top">上</button>
            <button data-align="middle" title="Align vertical center">垂直居中</button>
            <button data-align="bottom" title="Align bottom">下</button>
            <span class="selection-distribute-controls">
              <button data-align="distribute-x" title="Distribute horizontally">横向分布</button>
              <button data-align="distribute-y" title="Distribute vertically">纵向分布</button>
            </span>
          </div>
        </div>
        <div id="canvas-viewport" class="canvas-viewport" tabindex="0">
          <div class="canvas-grid"></div>
          <div id="canvas-transform" class="canvas-transform">
            <div id="canvas-host" class="canvas-host" aria-label="Editable visual canvas"></div>
          </div>
          <div class="canvas-scrollbar canvas-scrollbar-horizontal" data-canvas-scrollbar="x" role="scrollbar" aria-label="水平移动画布视图" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" tabindex="0">
            <div class="canvas-scrollbar-thumb"></div>
          </div>
          <div class="canvas-scrollbar canvas-scrollbar-vertical" data-canvas-scrollbar="y" role="scrollbar" aria-label="垂直移动画布视图" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" tabindex="0">
            <div class="canvas-scrollbar-thumb"></div>
          </div>
          <div class="canvas-hint">拖动滑块或双指/滚轮平移 · Ctrl/Cmd+滚轮缩放 · Space/中键拖动</div>
        </div>
        <div class="canvas-status" aria-label="文档与同步状态">
          <span id="document-status" data-label="文档"></span>
          <span id="selection-status" data-label="选区">未选择元素</span>
          <span id="sync-status" data-label="同步" class="sync-ok" role="status" aria-live="polite">代码已同步</span>
        </div>
      </section>

      <aside id="inspector-panel" class="panel inspector-panel">
        <button class="panel-collapse-toggle" data-layout-toggle="inspector" aria-controls="inspector-panel" aria-label="折叠或展开编排与属性面板"></button>
        <div class="panel-heading"><div><h2>检查器</h2></div></div>
        <div class="inspector-tabs" role="group" aria-label="检查器分组">
          <button type="button" data-inspector-group="design" aria-controls="inspector-content">Design</button>
          <button type="button" data-inspector-group="build" aria-controls="build-panel">Build</button>
          <button type="button" data-inspector-group="advanced" aria-controls="inspector-content">Advanced</button>
        </div>
        <section id="build-panel" class="build-panel" hidden>
          <div class="build-panel-heading"><strong>放映顺序编排</strong></div>
          <div id="build-selection-controls" class="build-selection-controls"></div>
          <div id="build-groups" class="build-groups"></div>
          <div id="build-warnings" class="build-warnings" hidden></div>
        </section>
        <div class="layout-resizer row-resizer build-resizer" data-layout-resizer="build" role="separator" aria-orientation="horizontal" aria-label="调整 Build 编排与元素属性的高度" tabindex="0"></div>
        <section class="element-properties-panel">
          <div id="inspector-content" class="inspector-content"></div>
        </section>
        <div class="layout-resizer column-resizer" data-layout-resizer="inspector" role="separator" aria-orientation="vertical" aria-label="调整编排与属性面板宽度" tabindex="0"></div>
      </aside>
    </main>

    <section id="code-drawer" class="code-drawer is-collapsed">
      <div class="code-toolbar">
        <div>
          <span class="source-identity"><span class="eyebrow">SOURCE</span><strong id="code-file-name" data-l10n-skip>untitled.html</strong></span>
          <span class="source-draft-note">草稿 · 仅“应用代码”后更新画布</span>
          <span id="code-error" class="code-error" role="alert"></span>
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

    <dialog id="paste-dialog" class="paste-dialog studio-dialog" aria-labelledby="paste-dialog-title">
      <form method="dialog">
        <div class="dialog-heading"><div><span class="eyebrow">REPLACE DOCUMENT</span><h2 id="paste-dialog-title">粘贴 HTML 或 SVG</h2></div><button value="cancel" aria-label="关闭粘贴源码对话框">×</button></div>
        <p id="paste-dialog-note" class="dialog-purpose-note">载入成功后替换当前文档；解析失败时保留上一个有效画布。</p>
        <textarea id="paste-editor" name="source" autocomplete="off" aria-describedby="paste-dialog-note" aria-label="HTML 或 SVG 源码" spellcheck="false" placeholder="在此粘贴 HTML 或 SVG 源码"></textarea>
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
    <dialog id="preview-choice-dialog" class="preview-choice-dialog studio-dialog" aria-labelledby="preview-choice-title">
      <form method="dialog">
        <div class="dialog-heading"><div><span class="eyebrow">PRESENTATION</span><h2 id="preview-choice-title">选择预览起点</h2></div><button value="cancel" aria-label="关闭预览选择">×</button></div>
        <p>从第一页播放整套演示稿，或直接从正在编辑的页面开始。</p>
        <div class="preview-choice-actions">
          <button value="cancel">取消</button>
          <button id="preview-from-start" value="default" class="button">从头预览</button>
          <button id="preview-from-current" value="default" class="button primary">当前页面预览</button>
        </div>
      </form>
    </dialog>
    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
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
  private fontRenderToken = 0;
  private readonly fontChangeTokens = new Map<string, number>();
  private readonly collapsedLayerIds = new Set<string>();
  private activeNavigationView: NavigationView = "layers";
  private layerFocusId: string | null = null;
  private pendingLayerRevealId: string | null = null;
  private layerDrag: LayerDragState | null = null;
  private layerAutoScrollFrame = 0;
  private layerAutoScrollSpeed = 0;
  private thumbnailObserver: IntersectionObserver | null = null;
  private readonly thumbnailRenderers = new Map<number, CanvasRenderer>();
  private readonly inspectorGroups = this.restoreInspectorGroups();
  private readonly localizer: UiLocalizer;
  private keepRatio = false;

  constructor(private readonly host: HTMLElement) {
    this.localizer = new UiLocalizer();
    host.innerHTML = appTemplate;
    this.localizer.bind(host);
    this.updateLanguageSwitcher();
    this.model = SourceDocument.parse(defaultHtml, "ai-slide.html");
    this.setAllBuildsComplete();
    this.history = new History(
      this.createSnapshot(),
      snapshotsEqual,
      100,
      192 * 1024 * 1024,
      (snapshot) => snapshot.source.length * 2 + (snapshot.assets ?? []).reduce((sum, asset) => sum + asset.bytes.byteLength, 0),
    );

    this.renderer = new CanvasRenderer(this.get("#canvas-host"), {
      onSelect: (id, options) => this.selectCanvasElement(id, options),
      onInlineTextCommit: (id, text) => this.commitMutation("Edit text", () => {
        this.model.apply({ action: "replaceText", elementId: id, text });
      }),
      onWarning: (message) => this.showNotice(message),
      localize: (message) => this.t(message),
    });

    this.transform = new TransformController(this.get("#canvas-transform"), this.renderer, {
      onStart: () => undefined,
      onChange: () => this.updateLiveSelectionStatus(),
      onEnd: (label) => {
        if (this.history.commit(this.createSnapshot(), label)) this.recordOperation(label, "ui");
        this.renderDocument(true);
      },
      canStartDrag: () => !this.spacePressed,
    });

    this.layout = new EditorLayoutController(host, {
      onLayoutChange: (canvasGeometryChanged) => {
        if (canvasGeometryChanged) this.fitCanvas();
        else this.transform.update();
      },
      localize: (message) => this.t(message),
    });

    this.codeEditor = new SourceCodeEditor(this.get("#code-editor"), () => {
      this.codeDirty = true;
      this.get("#sync-status").textContent = this.t("代码有未应用修改");
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
    }, this.localizer);

    this.bindEvents();
    this.renderDocument(true);
    requestAnimationFrame(() => this.fitCanvas());
  }

  private get<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`UI element not found: ${selector}`);
    return element;
  }

  private t(value: string): string {
    return this.localizer.t(value);
  }

  private updateLanguageSwitcher(): void {
    this.host.querySelectorAll<HTMLButtonElement>("[data-locale-switch]").forEach((button) => {
      const locale = button.dataset.localeSwitch as UiLocale;
      button.setAttribute("aria-pressed", String(locale === this.localizer.locale));
    });
  }

  private setLocale(locale: UiLocale): void {
    if (locale === this.localizer.locale) return;
    this.localizer.setLocale(locale);
    this.updateLanguageSwitcher();
    this.layout.refreshLocale();
    this.fragments.refreshLocale();
    this.renderer.refreshLocale();
    this.refreshLocalizedUi();
    this.get("#sync-status").textContent = this.t(this.codeDirty ? "代码有未应用修改" : "代码已同步");
    const collapsed = this.get("#code-drawer").classList.contains("is-collapsed");
    this.get("#toggle-code").textContent = this.t(collapsed ? "展开源码" : "收起源码");
  }

  private bindEvents(): void {
    this.host.querySelectorAll<HTMLButtonElement>("[data-locale-switch]").forEach((button) => {
      button.addEventListener("click", () => this.setLocale(button.dataset.localeSwitch as UiLocale));
    });
    const activityButtons = Array.from(this.host.querySelectorAll<HTMLButtonElement>("[data-activity-view]"));
    activityButtons.forEach((button) => {
      button.addEventListener("click", () => this.switchNavigationView(button.dataset.activityView as NavigationView));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const enabled = activityButtons.filter((candidate) => !candidate.disabled);
        const current = enabled.indexOf(button);
        const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
        enabled[next]?.focus();
      });
    });
    this.host.querySelectorAll<HTMLButtonElement>("[data-fragment-context-action]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.fragmentContextAction === "insert") this.fragments.chooseInsertFile();
        else void this.fragments.openLibrary(button.dataset.fragmentContextAction === "clipboard" ? "clipboard" : "directory");
      });
    });
    this.host.querySelectorAll<HTMLButtonElement>(".inspector-tabs [data-inspector-group]").forEach((button) => {
      button.addEventListener("click", () => this.setInspectorGroup(button.dataset.inspectorGroup as InspectorGroup));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = Array.from(this.host.querySelectorAll<HTMLButtonElement>(".inspector-tabs [data-inspector-group]:not([hidden])"));
        const current = tabs.indexOf(button);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        const target = tabs[next];
        if (target) {
          target.focus();
        }
      });
    });
    this.get("#import-document-action").addEventListener("click", () => {
      this.closeIoMenus();
      this.get<HTMLInputElement>("#file-input").click();
    });
    this.get("#import-directory-action").addEventListener("click", () => {
      this.closeIoMenus();
      this.get<HTMLInputElement>("#directory-input").click();
    });
    this.get("#paste-source-action").addEventListener("click", () => {
      this.closeIoMenus();
      this.get<HTMLDialogElement>("#paste-dialog").showModal();
    });
    this.get("#insert-fragment-action").addEventListener("click", () => {
      this.closeIoMenus();
      this.fragments.chooseInsertFile();
    });
    this.get("#open-temporary-clipboard-action").addEventListener("click", () => {
      this.closeIoMenus();
      void this.fragments.openLibrary("clipboard");
    });
    this.get("#open-local-library-action").addEventListener("click", () => {
      this.closeIoMenus();
      void this.fragments.openLibrary("directory");
    });
    this.get("#file-input").addEventListener("change", (event) => void this.handleFileImport(event));
    this.get("#directory-input").addEventListener("change", (event) => void this.handleDirectoryImport(event));
    this.host.querySelectorAll<HTMLButtonElement>("[data-load-example]").forEach((button) => {
      button.addEventListener("click", () => {
        this.closeIoMenus();
        this.loadExample(button.dataset.loadExample ?? "html");
      });
    });
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
    this.get("#export-document-action").addEventListener("click", () => {
      this.closeIoMenus();
      this.exportDocument();
    });
    this.get("#export-selection-action").addEventListener("click", () => {
      this.closeIoMenus();
      this.fragments.openSelectionExport();
    });
    this.get("#export-project-action").addEventListener("click", () => {
      this.closeIoMenus();
      this.exportProject();
    });
    this.get("#export-zip-action").addEventListener("click", () => {
      this.closeIoMenus();
      void this.exportZip();
    });
    this.get("#export-summary-action").addEventListener("click", () => {
      this.closeIoMenus();
      this.exportSummary();
    });
    this.host.querySelectorAll<HTMLDetailsElement>("[data-io-menu]").forEach((menu) => {
      menu.addEventListener("toggle", () => {
        if (!menu.open) return;
        this.host.querySelectorAll<HTMLDetailsElement>("[data-io-menu]").forEach((candidate) => {
          if (candidate !== menu) candidate.open = false;
        });
      });
      const summary = menu.querySelector<HTMLElement>(":scope > summary");
      const panel = menu.querySelector<HTMLElement>(":scope > .io-menu-panel");
      const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      summary?.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        menu.open = true;
        const available = items();
        (event.key === "ArrowDown" ? available[0] : available.at(-1))?.focus();
      });
      panel?.addEventListener("keydown", (event) => {
        const available = items();
        const current = available.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") {
          event.preventDefault();
          menu.open = false;
          summary?.focus();
          return;
        }
        const next = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1
          : event.key === "ArrowDown" ? (current + 1) % available.length
            : event.key === "ArrowUp" ? (current - 1 + available.length) % available.length : -1;
        if (next < 0) return;
        event.preventDefault();
        available[next]?.focus();
      });
    });
    this.host.addEventListener("pointerdown", (event) => {
      if (!(event.target as Element).closest("[data-io-menu]")) this.closeIoMenus();
    });

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

    const layersTree = this.get("#layers-tree");
    layersTree.addEventListener("click", (event) => {
      const toggle = (event.target as Element).closest<HTMLElement>("[data-layer-toggle]");
      if (toggle?.dataset.layerToggle) {
        event.preventDefault();
        event.stopPropagation();
        const id = toggle.dataset.layerToggle;
        if (this.collapsedLayerIds.has(id)) this.collapsedLayerIds.delete(id);
        else this.collapsedLayerIds.add(id);
        this.renderLayers();
        return;
      }
      const row = (event.target as Element).closest<HTMLElement>("[data-layer-id]");
      if (!row?.dataset.layerId) return;
      this.layerFocusId = row.dataset.layerId;
      const mouse = event as MouseEvent;
      this.selectElement(row.dataset.layerId, mouse.ctrlKey || mouse.metaKey || mouse.shiftKey, false);
    });
    layersTree.addEventListener("focusin", (event) => {
      const row = (event.target as Element).closest<HTMLElement>("[data-layer-id]");
      if (row?.dataset.layerId) this.layerFocusId = row.dataset.layerId;
    });
    layersTree.addEventListener("keydown", (event) => this.handleLayerTreeKeyDown(event));
    layersTree.addEventListener("dblclick", (event) => {
      const name = (event.target as Element).closest<HTMLElement>("[data-layer-name]");
      if (!name?.dataset.layerName) return;
      event.preventDefault();
      event.stopPropagation();
      this.startLayerRename(name.dataset.layerName);
    });
    layersTree.addEventListener("pointerdown", (event) => this.beginLayerDrag(event as PointerEvent));
    this.host.querySelector<HTMLElement>('[data-layout-toggle="layers"]')?.addEventListener("click", () => {
      requestAnimationFrame(() => this.revealLayer(this.pendingLayerRevealId ?? this.selectedIds.at(-1) ?? null, "auto"));
    });
    this.host.querySelectorAll<HTMLElement>("[data-layer-action]").forEach((button) => {
      button.addEventListener("click", () => this.layerAction(button.dataset.layerAction ?? ""));
    });
    this.get("#add-text").addEventListener("click", () => this.addNewElement("text"));
    this.get("#add-shape").addEventListener("click", () => this.addNewElement("shape"));

    this.get("#inspector-content").addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement;
      if (target.matches('[data-prop="x"], [data-prop="y"], [data-prop="width"], [data-prop="height"], [data-prop="rotation"]')) {
        target.setCustomValidity("");
      }
      if ((event.target as Element).closest("[data-shadow-part]")) this.previewShadowFromInspector();
    });
    this.get("#inspector-content").addEventListener("change", (event) => {
      if ((event.target as Element).closest("[data-shadow-part]")) this.commitShadowFromInspector();
      else this.handleInspectorChange(event);
    });
    this.get("#inspector-content").addEventListener("click", (event) => {
      const action = (event.target as Element).closest<HTMLElement>("[data-inspector-action]")?.dataset.inspectorAction;
      if (action === "replace-image") this.get<HTMLInputElement>("#image-input").click();
      else if (action === "select-parent") this.layerAction("parent");
      else if (action === "select-child") this.layerAction("child");
      const shadowPreset = (event.target as Element).closest<HTMLElement>("[data-shadow-preset]")?.dataset.shadowPreset;
      if (shadowPreset) this.applyShadowPreset(shadowPreset);
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
    this.host.querySelectorAll<HTMLElement>("[data-canvas-scrollbar]").forEach((scrollbar) => {
      const axis = scrollbar.dataset.canvasScrollbar as CanvasScrollAxis;
      scrollbar.addEventListener("pointerdown", (event) => this.beginCanvasScrollbarDrag(event, axis));
      scrollbar.addEventListener("keydown", (event) => this.handleCanvasScrollbarKeyDown(event, axis));
    });
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
    window.addEventListener("resize", () => this.updateCanvasTransform());
  }

  private closeIoMenus(): void {
    this.host.querySelectorAll<HTMLDetailsElement>("[data-io-menu]").forEach((menu) => { menu.open = false; });
  }

  private switchNavigationView(view: NavigationView, focusPanel = true): void {
    const button = this.host.querySelector<HTMLButtonElement>(`[data-activity-view="${view}"]`);
    if (!button || button.disabled) return;
    this.activeNavigationView = view;
    for (const candidate of ["layers", "pages", "fragments"] as const) {
      const active = candidate === view;
      const tab = this.get<HTMLButtonElement>(`[data-activity-view="${candidate}"]`);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      this.get(`#${candidate}-context`).hidden = !active;
    }
    this.get("#layers-panel").dataset.activeContext = view;
    if (focusPanel) {
      const target = view === "layers" ? this.get("#layers-tree") : this.get(`#${view}-context`);
      requestAnimationFrame(() => target.querySelector<HTMLElement>("button:not(:disabled),[tabindex='0']")?.focus());
    }
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
    // Library insertion is a page-level action. Basing its parent on the
    // current selection silently changes the coordinate space: a canvas point
    // then becomes a child-local point and can place the new instance outside
    // the active slice. Component slots have their own explicit insertion path.
    const insertionParent = this.model.editingRoot(this.activePageIndex);
    return {
      model: this.model,
      assets: this.assets,
      sourcePath: this.sourcePath,
      selectedIds: [...this.selectedIds],
      selectionItems,
      insertionParentId: insertionParent?.getAttribute("data-editor-id") ?? null,
      insertionZIndex: this.model.kind === "html" && insertionParent
        ? this.renderer.nextTopZIndex(insertionParent.getAttribute("data-editor-id") ?? "")
        : undefined,
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

  private setAllBuildsComplete(): void {
    const pages = this.model.pages();
    if (!pages.length) {
      this.buildStepsByPage.set("__document__", this.model.buildSequence(0).maxStep);
      return;
    }
    pages.forEach(({ id, index }) => {
      this.buildStepsByPage.set(id, this.model.buildSequence(index).maxStep);
    });
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
      this.get("#sync-status").textContent = this.t("代码已同步");
      this.get("#sync-status").className = "sync-ok";
    }
    this.get<HTMLInputElement>("#canvas-width").value = String(this.model.canvas.width);
    this.get<HTMLInputElement>("#canvas-height").value = String(this.model.canvas.height);
    const preset = `${this.model.canvas.width}x${this.model.canvas.height}`;
    this.get<HTMLSelectElement>("#canvas-preset").value = ["1920x1080", "1024x768"].includes(preset) ? preset : "custom";
    this.get("#code-file-name").textContent = this.model.sourceName;
    this.renderDocumentStatus(pages);
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
    this.updateIoMenuState();
    this.renderWarnings();
    this.updateLiveSelectionStatus();
    this.localizer.bind(this.host);
  }

  private renderDocumentStatus(pages = this.model.pages()): void {
    const pageStatus = pages.length > 0 ? ` · ${this.t("页")} ${this.activePageIndex + 1}/${pages.length}` : "";
    this.get("#document-status").textContent = `${this.model.kind.toUpperCase()} · ${this.model.canvas.width} × ${this.model.canvas.height}${pageStatus} · ${this.model.editableElements().length} ${this.t("elements")}`;
  }

  private refreshLocalizedUi(): void {
    const pages = this.model.pages();
    const sequence = this.model.buildSequence(this.activePageIndex);
    this.renderDocumentStatus(pages);
    this.renderPageControl(pages);
    this.renderBuildControl(sequence);
    this.renderBuildPanel(sequence);
    this.renderLayers();
    this.renderInspector();
    this.fragments.refreshSelection();
    this.updateIoMenuState();
    this.updateLiveSelectionStatus();
    this.localizer.bind(this.host);
  }

  private renderPageControl(pages: DocumentPage[]): void {
    const control = this.get("#page-control");
    const filmstrip = this.get("#page-filmstrip");
    const thumbnails = this.get("#page-thumbnails");
    const hasPages = pages.length > 0;
    const pagesTab = this.get<HTMLButtonElement>('[data-activity-view="pages"]');
    pagesTab.disabled = !hasPages;
    pagesTab.title = this.t(hasPages ? "页面" : "当前文档没有多页结构");
    if (!hasPages && this.activeNavigationView === "pages") this.switchNavigationView("layers", false);
    control.hidden = !hasPages;
    filmstrip.hidden = !hasPages;
    this.clearThumbnailRenderers();
    if (!hasPages) {
      thumbnails.replaceChildren();
      return;
    }
    const select = this.get<HTMLSelectElement>("#page-select");
    select.innerHTML = pages.map((page) =>
      `<option value="${page.index}" data-l10n-skip>${page.index + 1}. ${escapeHtml(page.label)}</option>`,
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
      <button class="page-thumbnail${page.index === this.activePageIndex ? " is-active" : ""}" data-page-index="${page.index}" data-page-id="${escapeHtml(page.id)}" data-l10n-skip draggable="true" title="${escapeHtml(page.label)}"${page.index === this.activePageIndex ? ' aria-current="page"' : ""}>
        <span class="page-thumbnail-number">${page.index + 1}</span>
        ${sequence.groups.length ? `<span class="page-thumbnail-builds">+${sequence.groups.length} ${this.t("Build")}</span>` : ""}
        <span class="page-thumbnail-preview" style="width:${previewWidth.toFixed(2)}px;height:${previewHeight.toFixed(2)}px">
          <span class="page-thumbnail-canvas" data-thumbnail-host="${page.index}" style="width:${this.model.canvas.width}px;height:${this.model.canvas.height}px;transform:scale(${scale})"></span>
        </span>
        <span class="page-thumbnail-label" data-l10n-skip>${escapeHtml(page.label)}</span>
      </button>
    `;
    }).join("");

    const renderThumbnail = (page: DocumentPage): void => {
      if (this.thumbnailRenderers.has(page.index)) return;
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
      this.thumbnailRenderers.set(page.index, renderer);
    };
    const releaseThumbnail = (pageIndex: number): void => {
      if (Math.abs(pageIndex - this.activePageIndex) <= 2) return;
      this.thumbnailRenderers.get(pageIndex)?.dispose();
      this.thumbnailRenderers.delete(pageIndex);
    };
    pages.filter((page) => Math.abs(page.index - this.activePageIndex) <= 2).forEach(renderThumbnail);
    if (typeof IntersectionObserver !== "undefined") {
      this.thumbnailObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const button = entry.target as HTMLElement;
          const pageIndex = Number(button.dataset.pageIndex);
          const page = pages[pageIndex];
          if (!page) continue;
          if (entry.isIntersecting) renderThumbnail(page);
          else releaseThumbnail(pageIndex);
        }
      }, { root: thumbnails, rootMargin: "80px" });
      thumbnails.querySelectorAll<HTMLElement>(".page-thumbnail").forEach((thumbnail) => this.thumbnailObserver?.observe(thumbnail));
    }
    requestAnimationFrame(() => {
      thumbnails.querySelector(".page-thumbnail.is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  private clearThumbnailRenderers(): void {
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = null;
    this.thumbnailRenderers.forEach((renderer) => renderer.dispose());
    this.thumbnailRenderers.clear();
  }

  private renderBuildControl(sequence: PageBuildSequence): void {
    const control = this.get("#build-control");
    const hasPresentationPage = this.model.kind === "html" && (this.model.pages().length > 0 || sequence.elementCount > 0);
    control.hidden = !hasPresentationPage;
    if (!hasPresentationPage) return;
    const activeStep = this.activeBuildStep(sequence);
    const position = activeStep === 0 ? 0 : Math.max(0, sequence.steps.indexOf(activeStep) + 1);
    this.get("#build-status").textContent = position === 0
      ? `${this.t("Initial")} / ${sequence.groups.length}`
      : `${this.t("Build")} ${position} / ${sequence.groups.length}`;
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
    this.updateInspectorHierarchy(hasPresentationPage);
    if (!hasPresentationPage) return;

    const selectedOnPage = this.selectedIds.filter((id) => this.model.elementBelongsToPage(id, this.activePageIndex));
    const currentSteps = Array.from(new Set(selectedOnPage.map((id) => this.model.buildStepForElement(id)).filter((step): step is number => step !== null)));
    const selectionSummary = selectedOnPage.length
      ? `${selectedOnPage.length} ${this.t("selected")} · ${currentSteps.length === 1 ? `${this.t("Build")} ${currentSteps[0]}` : currentSteps.length ? this.t("mixed Build groups") : this.t("Always Visible")}`
      : this.t("Select elements to assign a Build");
    this.get("#build-selection-controls").innerHTML = `
      <div class="build-selection-summary">${escapeHtml(selectionSummary)}</div>
      <div class="build-selection-row">
        <select id="selected-build-target" aria-label="${this.t("Selected elements Build target")}" ${selectedOnPage.length ? "" : "disabled"}>
          <option value="always">${this.t("Always Visible")}</option>
          ${sequence.groups.map((group, index) => `<option value="${group.step}">${this.t("Build")} ${index + 1}</option>`).join("")}
          <option value="new">${this.t("New Build at end")}</option>
        </select>
        <button data-build-action="apply-selected" ${selectedOnPage.length ? "" : "disabled"}>${this.t("Apply")}</button>
        <button data-build-action="split-selected" ${selectedOnPage.length ? "" : "disabled"}>${this.t("Split to new group")}</button>
      </div>
    `;

    const editingRoot = this.model.editingRoot(this.activePageIndex);
    const alwaysCount = editingRoot
      ? [editingRoot, ...Array.from(editingRoot.querySelectorAll("[data-editor-id]"))]
        .filter((element) => element.hasAttribute("data-editor-id") && !element.hasAttribute("data-build")).length
      : 0;
    const groups = this.get("#build-groups");
    groups.innerHTML = `
      <div class="build-drop-zone" data-build-insert-position="0">${this.t("Drop here to create Build 1")}</div>
      <section class="build-group always-visible-group">
        <header><strong>${this.t("Always Visible")}</strong><span>${alwaysCount} ${this.t("elements")}</span></header>
      </section>
      ${sequence.groups.map((group, index) => `
        <section class="build-group${this.activeBuildStep(sequence) === group.step ? " is-active" : ""}" data-build-group="${group.step}">
          <header data-build-focus="${group.step}" data-build-group-drag="${group.step}" draggable="true">
            <strong>${this.t("Build")} ${index + 1}</strong><span>${group.elementIds.length} ${this.t("elements")} · data-build=${group.step}</span>
            <span class="build-group-actions">
              <button data-build-action="move-up" data-build-step="${group.step}" ${index === 0 ? "disabled" : ""} title="${this.t("Move group earlier")}" aria-label="${this.t("Move Build group earlier")}">↑</button>
              <button data-build-action="move-down" data-build-step="${group.step}" ${index === sequence.groups.length - 1 ? "disabled" : ""} title="${this.t("Move group later")}" aria-label="${this.t("Move Build group later")}">↓</button>
              <button data-build-action="merge-previous" data-build-step="${group.step}" ${index === 0 ? "disabled" : ""} title="${this.t("Merge into previous group")}">${this.t("Merge")}</button>
            </span>
          </header>
          <div class="build-group-elements">
            ${group.elementIds.map((id) => `<button class="build-element${this.selectedIds.includes(id) ? " is-selected" : ""}" data-build-element-id="${escapeHtml(id)}" draggable="true" title="${escapeHtml(id)}"><span data-l10n-skip>${escapeHtml(this.buildElementLabel(id))}</span><code data-l10n-skip>${escapeHtml(id)}</code></button>`).join("")}
          </div>
        </section>
        <div class="build-drop-zone" data-build-insert-position="${index + 1}">${this.t("Drop elements here for a new Build")}</div>
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
      warnings.innerHTML = sequence.warnings.map((warning) => `<p><strong>${escapeHtml(warning.code)}</strong> ${escapeHtml(this.t(warning.message))}</p>`).join("");
      this.buildWarningTimer = window.setTimeout(() => {
        if (this.buildWarningSignature === signature) warnings.hidden = true;
      }, 6000);
    }
    this.localizer.bind(this.get("#build-selection-controls"));
    this.localizer.bind(groups);
    this.localizer.bind(warnings);
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
    this.toast(this.localizer.locale === "en"
      ? `Editing page ${next + 1}: ${pages[next]!.label}`
      : `正在编辑第 ${next + 1} 页：${pages[next]!.label}`);
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
    notice.textContent = this.t(message);
    this.noticeTimer = window.setTimeout(() => {
      notice.hidden = true;
      notice.textContent = "";
    }, 4000);
  }

  private renderLayers(revealId?: string, revealBehavior: ScrollBehavior = "smooth"): void {
    if (revealId) {
      let ancestor = this.model.find(revealId)?.parentElement?.closest("[data-editor-id]") ?? null;
      while (ancestor) {
        const ancestorId = ancestor.getAttribute("data-editor-id");
        if (ancestorId) this.collapsedLayerIds.delete(ancestorId);
        ancestor = ancestor.parentElement?.closest("[data-editor-id]") ?? null;
      }
      this.pendingLayerRevealId = revealId;
    }
    for (const id of [...this.collapsedLayerIds]) {
      if (!this.model.find(id)) this.collapsedLayerIds.delete(id);
    }
    const tree = this.model.treeForPage(this.activePageIndex);
    const fallbackFocusId = this.layerFocusId && this.model.find(this.layerFocusId)
      ? this.layerFocusId
      : this.selectedIds.at(-1) ?? tree[0]?.id ?? null;
    this.layerFocusId = fallbackFocusId;
    const renderNode = (node: ElementTreeNode, depth: number): string => {
      const selected = this.selectedIds.includes(node.id) ? " is-selected" : "";
      const icon = layerStateIcon(node.visible, node.locked);
      const collapsed = node.children.length > 0 && this.collapsedLayerIds.has(node.id);
      return `<li role="none" data-layer-node="${escapeHtml(node.id)}">
        <div class="layer-row${selected}" data-layer-id="${escapeHtml(node.id)}" style="--depth:${depth}" title="${escapeHtml(node.id)}" role="treeitem" tabindex="${node.id === fallbackFocusId ? "0" : "-1"}" aria-selected="${selected ? "true" : "false"}"${node.children.length ? ` aria-expanded="${collapsed ? "false" : "true"}"` : ""}>
          <button type="button" tabindex="-1" class="layer-disclosure${collapsed ? " is-collapsed" : ""}" data-layer-toggle="${escapeHtml(node.id)}" aria-label="${this.t(collapsed ? "展开" : "折叠")} ${escapeHtml(node.name)}"${node.children.length ? "" : " disabled"}>${chevronIcon}</button>
          <span class="layer-icon">${icon}</span>
          <span class="layer-name" data-layer-name="${escapeHtml(node.id)}" data-l10n-skip>${escapeHtml(node.name)}</span>
          <span class="layer-tag" data-l10n-skip>${escapeHtml(node.tag)}</span>
          <button type="button" tabindex="-1" class="layer-drag-handle" data-layer-drag-handle="${escapeHtml(node.id)}" aria-label="${this.t("拖动 ")}${escapeHtml(node.name)}" title="${this.t("拖动以排序、缩进或提升一级")}"${depth === 0 ? " disabled" : ""}>${layerGripIcon}</button>
        </div>
        ${node.children.length && !collapsed ? `<ul role="group">${node.children.map((child) => renderNode(child, depth + 1)).join("")}</ul>` : ""}
      </li>`;
    };
    const layersTree = this.get("#layers-tree");
    layersTree.innerHTML = `<ul role="tree">${tree.map((node) => renderNode(node, 0)).join("")}</ul>`;
    this.localizer.bind(layersTree);
    if (revealId) requestAnimationFrame(() => this.centerLayerRow(revealId, revealBehavior));
  }

  private handleLayerTreeKeyDown(event: KeyboardEvent): void {
    const row = (event.target as Element).closest<HTMLElement>("[data-layer-id]");
    const id = row?.dataset.layerId;
    if (!row || !id) return;
    const rows = Array.from(this.get("#layers-tree").querySelectorAll<HTMLElement>("[data-layer-id]"));
    const index = rows.indexOf(row);
    const focusRow = (target?: HTMLElement | null): void => {
      if (!target?.dataset.layerId) return;
      event.preventDefault();
      this.layerFocusId = target.dataset.layerId;
      rows.forEach((candidate) => { candidate.tabIndex = candidate === target ? 0 : -1; });
      target.focus();
      target.scrollIntoView({ block: "nearest" });
    };
    if (event.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      this.layerFocusId = id;
      if (this.selectedIds.length !== 1 || this.selectedIds[0] !== id) this.selectElement(id, false, false);
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        this.layerAction(event.key === "ArrowUp" ? "down" : "up");
        this.toast(event.key === "ArrowUp" ? "已通过键盘向前移动图层" : "已通过键盘向后移动图层");
      } else if (event.key === "ArrowLeft") {
        const parentRow = row.closest("li")?.parentElement?.closest("li")?.querySelector<HTMLElement>(":scope > [data-layer-id]");
        if (parentRow?.dataset.layerId && this.moveLayerPreservingPosition(id, parentRow.dataset.layerId, "after")) this.toast("已提升图层一级");
        else this.toast("当前图层已在最高可提升层级");
      } else {
        const previousRow = row.closest("li")?.previousElementSibling?.querySelector<HTMLElement>(":scope > [data-layer-id]");
        if (previousRow?.dataset.layerId && this.moveLayerPreservingPosition(id, previousRow.dataset.layerId, "inside")) this.toast("已将图层缩进一级");
        else this.toast("需要一个前置同级图层作为新父级");
      }
      requestAnimationFrame(() => this.get("#layers-tree").querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`)?.focus());
      return;
    }
    if (event.key === "ArrowUp") focusRow(rows[index - 1]);
    else if (event.key === "ArrowDown") focusRow(rows[index + 1]);
    else if (event.key === "Home") focusRow(rows[0]);
    else if (event.key === "End") focusRow(rows.at(-1));
    else if (event.key === "ArrowLeft") {
      if (row.getAttribute("aria-expanded") === "true") {
        event.preventDefault();
        this.collapsedLayerIds.add(id);
        this.renderLayers();
        requestAnimationFrame(() => this.get("#layers-tree").querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`)?.focus());
      } else {
        focusRow(row.closest("li")?.parentElement?.closest("li")?.querySelector<HTMLElement>(":scope > [data-layer-id]"));
      }
    } else if (event.key === "ArrowRight") {
      if (row.getAttribute("aria-expanded") === "false") {
        event.preventDefault();
        this.collapsedLayerIds.delete(id);
        this.renderLayers();
        requestAnimationFrame(() => this.get("#layers-tree").querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`)?.focus());
      } else {
        focusRow(row.closest("li")?.querySelector<HTMLElement>(":scope > ul > li > [data-layer-id]"));
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.selectElement(id, event.ctrlKey || event.metaKey || event.shiftKey, false);
      requestAnimationFrame(() => this.get("#layers-tree").querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`)?.focus());
    } else if (event.key === "F2") {
      event.preventDefault();
      this.startLayerRename(id);
    }
  }

  private centerLayerRow(id: string, behavior: ScrollBehavior): void {
    const tree = this.get("#layers-tree");
    if (tree.clientHeight <= 0) return;
    const row = Array.from(tree.querySelectorAll<HTMLElement>("[data-layer-id]"))
      .find((candidate) => candidate.dataset.layerId === id);
    if (!row) return;
    const treeRect = tree.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const top = tree.scrollTop + rowRect.top - treeRect.top - (tree.clientHeight - rowRect.height) / 2;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    tree.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? "auto" : behavior });
    this.pendingLayerRevealId = null;
  }

  private revealLayer(id: string | null, behavior: ScrollBehavior = "smooth"): void {
    if (!id || !this.model.find(id)) return;
    this.renderLayers(id, behavior);
  }

  private startLayerRename(id: string): void {
    const element = this.model.find(id);
    if (!element) return;
    if (element.getAttribute("data-editor-locked") === "true") {
      this.toast("元素已锁定，请先解锁再重命名");
      return;
    }
    if (this.selectedIds.length !== 1 || this.selectedIds[0] !== id) this.selectElement(id, false, false);
    const name = Array.from(this.get("#layers-tree").querySelectorAll<HTMLElement>("[data-layer-name]"))
      .find((candidate) => candidate.dataset.layerName === id);
    if (!name || name.querySelector("input")) return;
    const explicitName = element.getAttribute("data-editor-name") ?? "";
    const initialValue = explicitName || name.textContent || "";
    const input = document.createElement("input");
    input.className = "layer-name-input";
    input.value = initialValue;
    input.setAttribute("aria-label", `重命名 ${id}`);
    name.replaceChildren(input);
    let finished = false;
    let cancelled = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      const next = input.value.trim();
      if (cancelled || next === initialValue.trim()) {
        this.renderLayers(id, "auto");
        return;
      }
      const committed = this.commitMutation("Rename layer", () => this.model.apply({ action: "updateElement", elementId: id, changes: { name: next } }), [id]);
      if (committed) this.revealLayer(id, "auto");
    };
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("dblclick", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelled = true;
        input.blur();
      }
    });
    input.addEventListener("blur", finish, { once: true });
    input.focus();
    input.select();
  }

  private beginLayerDrag(event: PointerEvent): void {
    const handle = (event.target as Element).closest<HTMLElement>("[data-layer-drag-handle]");
    const sourceId = handle?.dataset.layerDragHandle;
    if (!handle || !sourceId || handle.matches(":disabled") || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    this.layerDrag = {
      pointerId: event.pointerId,
      sourceId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      active: false,
      valid: false,
    };
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent): void => {
      const drag = this.layerDrag;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      drag.clientX = moveEvent.clientX;
      drag.clientY = moveEvent.clientY;
      if (!drag.active && Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY) >= 5) {
        drag.active = true;
        this.get("#layers-tree").classList.add("is-layer-dragging");
      }
      if (drag.active) this.updateLayerDrop(moveEvent.clientX, moveEvent.clientY);
    };
    const end = (endEvent: PointerEvent): void => {
      const drag = this.layerDrag;
      if (!drag || endEvent.pointerId !== drag.pointerId) return;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", cancel);
      if (handle.hasPointerCapture(endEvent.pointerId)) handle.releasePointerCapture(endEvent.pointerId);
      this.stopLayerAutoScroll();
      this.clearLayerDropFeedback();
      this.layerDrag = null;
      if (!drag.active) return;
      if (!drag.valid || !drag.targetId || !drag.placement) {
        this.toast(drag.reason ?? "该位置不允许执行图层移动");
        return;
      }
      this.moveLayerPreservingPosition(drag.sourceId, drag.targetId, drag.placement);
    };
    const cancel = (cancelEvent: PointerEvent): void => {
      if (cancelEvent.pointerId !== this.layerDrag?.pointerId) return;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", cancel);
      this.stopLayerAutoScroll();
      this.clearLayerDropFeedback();
      this.layerDrag = null;
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", cancel);
  }

  private updateLayerDrop(clientX: number, clientY: number, updateAutoScroll = true): void {
    const drag = this.layerDrag;
    const tree = this.get("#layers-tree");
    if (!drag?.active) return;
    if (updateAutoScroll) this.updateLayerAutoScroll(clientY);
    this.clearLayerDropFeedback(false);
    const row = document.elementsFromPoint(clientX, clientY)
      .map((element) => element.closest<HTMLElement>("[data-layer-id]"))
      .find((candidate): candidate is HTMLElement => Boolean(candidate && tree.contains(candidate)));
    if (!row?.dataset.layerId) {
      drag.valid = false;
      drag.targetId = undefined;
      drag.placement = undefined;
      drag.reason = this.t("请拖到明确的图层行落点");
      return;
    }
    const rect = row.getBoundingClientRect();
    const ratio = rect.height ? (clientY - rect.top) / rect.height : 0.5;
    const placement: LayerDropPlacement = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
    drag.targetId = row.dataset.layerId;
    drag.placement = placement;
    try {
      validateReparentElement(this.model.document, this.model.kind, drag.sourceId, drag.targetId, placement);
      drag.valid = true;
      drag.reason = undefined;
      row.classList.add(`is-drop-${placement}`);
      row.dataset.layerDropLabel = this.t(placement === "inside" ? "作为子级" : placement === "before" ? "插入到前面" : "插入到后面");
    } catch (error) {
      drag.valid = false;
      drag.reason = error instanceof Error ? error.message : String(error);
      row.classList.add("is-drop-invalid");
      row.dataset.layerDropLabel = this.t("不可放置");
    }
  }

  private clearLayerDropFeedback(removeDragging = true): void {
    const tree = this.get("#layers-tree");
    tree.querySelectorAll<HTMLElement>(".is-drop-before,.is-drop-inside,.is-drop-after,.is-drop-invalid").forEach((row) => {
      row.classList.remove("is-drop-before", "is-drop-inside", "is-drop-after", "is-drop-invalid");
      delete row.dataset.layerDropLabel;
    });
    if (removeDragging) tree.classList.remove("is-layer-dragging");
  }

  private updateLayerAutoScroll(clientY: number): void {
    const tree = this.get("#layers-tree");
    const rect = tree.getBoundingClientRect();
    const edge = 38;
    this.layerAutoScrollSpeed = clientY < rect.top + edge
      ? -Math.max(3, (rect.top + edge - clientY) / 3)
      : clientY > rect.bottom - edge
        ? Math.max(3, (clientY - (rect.bottom - edge)) / 3)
        : 0;
    if (this.layerAutoScrollSpeed && !this.layerAutoScrollFrame) {
      const tick = (): void => {
        const drag = this.layerDrag;
        if (!drag?.active || !this.layerAutoScrollSpeed) {
          this.layerAutoScrollFrame = 0;
          return;
        }
        tree.scrollTop += this.layerAutoScrollSpeed;
        this.updateLayerDrop(drag.clientX, drag.clientY, false);
        this.layerAutoScrollFrame = requestAnimationFrame(tick);
      };
      this.layerAutoScrollFrame = requestAnimationFrame(tick);
    }
  }

  private stopLayerAutoScroll(): void {
    this.layerAutoScrollSpeed = 0;
    if (this.layerAutoScrollFrame) cancelAnimationFrame(this.layerAutoScrollFrame);
    this.layerAutoScrollFrame = 0;
  }

  private layerTranslationBasis(id: string): { xx: number; xy: number; yx: number; yy: number } | null {
    const preview = this.renderer.element(id);
    const base = this.renderer.bounds(id);
    if (!preview || !base) return null;
    const kind = kindForElement(preview, this.model.kind);
    const transform = getTransformValues(preview);
    const styled = preview as HTMLElement | SVGElement;
    const transition = styled.style.transition;
    styled.style.transition = "none";
    try {
      setElementTranslation(preview, kind, transform.x + 1, transform.y);
      const x = this.renderer.bounds(id);
      setElementTranslation(preview, kind, transform.x, transform.y + 1);
      const y = this.renderer.bounds(id);
      setElementTranslation(preview, kind, transform.x, transform.y);
      if (!x || !y) return null;
      return { xx: x.x - base.x, xy: x.y - base.y, yx: y.x - base.x, yy: y.y - base.y };
    } finally {
      setElementTranslation(preview, kind, transform.x, transform.y);
      styled.style.transition = transition;
    }
  }

  private moveLayerPreservingPosition(sourceId: string, targetId: string, placement: LayerDropPlacement): boolean {
    const beforeSnapshot = this.createSnapshot();
    const beforeBounds = this.renderer.bounds(sourceId);
    if (!beforeBounds) {
      this.toast("无法测量当前图层位置，未执行移动");
      return false;
    }
    try {
      this.model.apply({ action: "reparentElement", elementId: sourceId, targetId, placement });
      this.selectedIds = [sourceId];
      this.renderDocument(false);
      const movedBounds = this.renderer.bounds(sourceId);
      if (!movedBounds) throw new Error("换层级后无法测量图层，已回滚");
      const tolerance = 1;
      if (Math.abs(movedBounds.width - beforeBounds.width) > tolerance || Math.abs(movedBounds.height - beforeBounds.height) > tolerance) {
        throw new Error("新父级改变了图层尺寸，无法可靠保持画布外观，已回滚");
      }
      const desiredX = beforeBounds.x - movedBounds.x;
      const desiredY = beforeBounds.y - movedBounds.y;
      if (Math.abs(desiredX) > tolerance || Math.abs(desiredY) > tolerance) {
        const basis = this.layerTranslationBasis(sourceId);
        if (!basis) throw new Error("无法解析新父级坐标系，已回滚");
        const determinant = basis.xx * basis.yy - basis.yx * basis.xy;
        if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-6) throw new Error("新父级坐标系不可逆，已回滚");
        const dx = (desiredX * basis.yy - basis.yx * desiredY) / determinant;
        const dy = (basis.xx * desiredY - desiredX * basis.xy) / determinant;
        if (![dx, dy].every(Number.isFinite) || Math.max(Math.abs(dx), Math.abs(dy)) > 1_000_000) {
          throw new Error("位置补偿超出安全范围，已回滚");
        }
        const element = this.model.find(sourceId);
        if (!element) throw new Error("移动的图层已不存在，已回滚");
        moveElementBy(element, kindForElement(element, this.model.kind), dx, dy);
        this.renderDocument(false);
      }
      const finalBounds = this.renderer.bounds(sourceId);
      if (!finalBounds || Math.abs(finalBounds.x - beforeBounds.x) > tolerance || Math.abs(finalBounds.y - beforeBounds.y) > tolerance ||
          Math.abs(finalBounds.width - beforeBounds.width) > tolerance || Math.abs(finalBounds.height - beforeBounds.height) > tolerance) {
        throw new Error("位置补偿未通过 1 px 画布复验，已回滚");
      }
      if (this.history.commit(this.createSnapshot(), "Move layer")) this.recordOperation("Move layer", "ui");
      this.renderDocument(true);
      this.revealLayer(sourceId);
      return true;
    } catch (error) {
      this.restore(beforeSnapshot);
      this.toast(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  private renderInspector(): void {
    const host = this.get("#inspector-content");
    this.updateCanvasContext();
    if (this.selectedIds.length === 0) {
      host.innerHTML = `<div class="empty-state" data-inspector-pane="design advanced"><span>◇</span><p>尚未选择元素</p><small>从画布或图层中选择元素，设计与高级属性会在这里出现。</small></div>`;
      this.localizer.bind(host);
      return;
    }
    if (this.selectedIds.length > 1) {
      host.innerHTML = `<div class="multi-selection" data-inspector-pane="design advanced"><span class="element-badge">MULTI</span><strong>${this.selectedIds.length} 个元素</strong><p data-l10n-skip>${this.selectedIds.map(escapeHtml).join(" · ")}</p><small>拖动选区可整体移动；画布上方已显示对齐与分布命令。单击一个图层可返回单选属性。</small></div>`;
      this.localizer.bind(host);
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
    const fontCatalog = fontCatalogMarkup(computed.fontFamily);
    const parentId = modelElement.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") ?? "";
    const childId = modelElement.querySelector("[data-editor-id]")?.getAttribute("data-editor-id") ?? "";
    host.innerHTML = `
      <section class="inspector-section identity-card" data-inspector-pane="design">
        <div><span class="element-badge" data-l10n-skip>${escapeHtml(modelElement.localName)}</span><strong data-l10n-skip>${escapeHtml(id)}</strong></div>
        <div class="identity-navigation">
          <button data-inspector-action="select-parent" title="选择最近的可编辑父级"${parentId ? "" : " disabled"}>选择父级</button>
          <button data-inspector-action="select-child" title="选择第一个可编辑子级"${childId ? "" : " disabled"}>选择子级</button>
        </div>
      </section>
      <section class="inspector-section" data-inspector-pane="advanced">
        <h3>标识</h3>
        <label class="field"><span>显示名称</span><input data-prop="name" value="${escapeHtml(modelElement.getAttribute("data-editor-name") ?? "")}" placeholder="Layer name" /></label>
        <label class="field"><span>CSS class</span><input data-prop="className" value="${escapeHtml(modelElement.getAttribute("class") ?? "")}" /></label>
      </section>
      <section class="inspector-section" data-inspector-pane="design">
        <div class="section-title-row"><h3>几何</h3><label class="checkbox"><input id="keep-ratio" type="checkbox"${this.keepRatio ? " checked" : ""} /> 锁定比例</label></div>
        <div class="field-grid four">
          <label class="field"><span>X</span><input data-prop="x" type="number" step="0.1" value="${geometryText(bounds.x)}" /></label>
          <label class="field"><span>Y</span><input data-prop="y" type="number" step="0.1" value="${geometryText(bounds.y)}" /></label>
          <label class="field"><span>W</span><input data-prop="width" type="number" min="1" step="0.1" value="${geometryText(bounds.width)}" /></label>
          <label class="field"><span>H</span><input data-prop="height" type="number" min="1" step="0.1" value="${geometryText(bounds.height)}" /></label>
        </div>
        <label class="field"><span>旋转角度</span><input data-prop="rotation" type="number" step="0.1" value="${geometryText(transform.rotation)}" /></label>
      </section>
      ${isText ? `<section class="inspector-section" data-inspector-pane="design">
        <h3>文本</h3>
        <label class="field stack"><span>内容</span><textarea data-prop="text" rows="4" data-l10n-skip>${escapeHtml(text)}</textarea></label>
        <div class="field-grid two">
          <label class="field"><span>字体</span><select data-prop="fontCatalog">${fontCatalog.html}</select></label>
          <label class="field"><span>字号</span><input data-prop="fontSize" type="number" min="1" value="${numeric(computed.fontSize, 16)}" /></label>
          <label class="field"><span>字重</span><input data-prop="fontWeight" value="${escapeHtml(computed.fontWeight)}" /></label>
          <label class="field"><span>行高</span><input data-prop="lineHeight" value="${escapeHtml(computed.lineHeight)}" /></label>
          <label class="field"><span>字间距</span><select data-prop="letterSpacing">${letterSpacingMarkup(computed.letterSpacing)}</select></label>
          <label class="field"><span>对齐</span><select data-prop="textAlign"><option>left</option><option>center</option><option>right</option><option>justify</option></select></label>
        </div>
        <p class="font-status${fontCatalog.selectedId ? "" : " is-warning"}" data-font-status>${fontCatalog.selectedId ? "正在确认本机字体…" : "自定义字体栈 · 可用性未验证"}</p>
        <label class="field color-field"><span>文字颜色</span><input data-prop="color" type="color" value="${colorValue(computed.color)}" aria-label="选择文字颜色" /><input data-prop="color" value="${escapeHtml(computed.color)}" aria-label="文字颜色值" /></label>
      </section>` : ""}
      ${isImage ? `<section class="inspector-section" data-inspector-pane="design">
        <h3>图像</h3>
        <label class="field stack"><span>资源路径 / Data URL</span><input data-prop="src" value="${escapeHtml(modelElement.getAttribute(modelElement.localName === "image" ? "href" : "src") ?? "")}" /></label>
        <button class="wide-button" data-inspector-action="replace-image">选择图片替换</button>
        <label class="field"><span>Object fit</span><select data-prop="objectFit"><option>contain</option><option>cover</option><option>fill</option><option>none</option><option>scale-down</option></select></label>
      </section>` : ""}
      <section class="inspector-section" data-inspector-pane="design">
        <h3>外观</h3>
        <label class="field color-field"><span>${selectedKind === "svg" ? "填充" : "背景"}</span><input data-prop="fill" type="color" value="${colorValue(fill)}" aria-label="选择填充或背景颜色" /><input data-prop="fill" value="${escapeHtml(fill)}" aria-label="填充或背景颜色值" /></label>
        <label class="field color-field"><span>描边</span><input data-prop="stroke" type="color" value="${colorValue(stroke)}" aria-label="选择描边颜色" /><input data-prop="stroke" value="${escapeHtml(stroke)}" aria-label="描边颜色值" /></label>
        <div class="field-grid two">
          <label class="field"><span>描边宽度</span><input data-prop="strokeWidth" type="number" min="0" step="1" value="${numeric(selectedKind === "svg" ? modelElement.getAttribute("stroke-width") ?? "0" : computed.borderWidth, 0)}" /></label>
          <label class="field"><span>透明度</span><input data-prop="opacity" type="number" min="0" max="1" step="0.05" value="${numeric(computed.opacity, 1)}" /></label>
          <label class="field"><span>圆角</span><input data-prop="borderRadius" value="${escapeHtml(computed.borderRadius)}" /></label>
          <label class="field"><span>滤镜</span><input data-prop="filter" value="${escapeHtml(computed.filter === "none" ? "" : computed.filter)}" /></label>
        </div>
        <div class="field stack"><span>阴影</span>${shadowEditorMarkup(computed.boxShadow)}</div>
      </section>
      <section class="inspector-section" data-inspector-pane="advanced">
        <h3>Inline style</h3>
        <label class="field stack"><textarea data-prop="inlineStyle" rows="4" spellcheck="false" aria-label="Inline style">${escapeHtml(modelElement.getAttribute("style") ?? "")}</textarea></label>
      </section>
    `;
    const ratio = host.querySelector<HTMLInputElement>("#keep-ratio");
    ratio?.addEventListener("change", () => {
      this.keepRatio = Boolean(ratio.checked);
      this.transform.setKeepRatio(this.keepRatio);
    });
    const alignSelect = host.querySelector<HTMLSelectElement>('[data-prop="textAlign"]');
    if (alignSelect) alignSelect.value = computed.textAlign;
    const objectFit = host.querySelector<HTMLSelectElement>('[data-prop="objectFit"]');
    if (objectFit) objectFit.value = computed.objectFit || "contain";
    if (fontCatalog.selectedId) {
      const entry = fontEntryById(fontCatalog.selectedId);
      if (entry) void this.refreshFontStatus(id, entry);
    }
    this.localizer.bind(host);
  }

  private restoreInspectorGroups(): Set<InspectorGroup> {
    try {
      const saved = JSON.parse(localStorage.getItem(INSPECTOR_GROUP_STORAGE_KEY) ?? "null") as unknown;
      const groups = Array.isArray(saved)
        ? saved.filter((value): value is InspectorGroup => value === "design" || value === "build" || value === "advanced")
        : [];
      return new Set(groups.length ? groups : ["design", "build"]);
    } catch {
      return new Set(["design", "build"]);
    }
  }

  private setInspectorGroup(group: InspectorGroup): void {
    if (this.inspectorGroups.has(group)) this.inspectorGroups.delete(group);
    else this.inspectorGroups.add(group);
    try {
      localStorage.setItem(INSPECTOR_GROUP_STORAGE_KEY, JSON.stringify(Array.from(this.inspectorGroups)));
    } catch {
      // Disclosure remains usable when browser storage is unavailable.
    }
    const buildButton = this.host.querySelector<HTMLButtonElement>('[data-inspector-group="build"]');
    this.updateInspectorHierarchy(!buildButton?.hidden);
  }

  private updateInspectorHierarchy(buildAvailable: boolean): void {
    this.get("#inspector-panel").dataset.inspectorGroups = Array.from(this.inspectorGroups).join(" ");
    this.host.querySelectorAll<HTMLButtonElement>(".inspector-tabs [data-inspector-group]").forEach((button) => {
      const group = button.dataset.inspectorGroup as InspectorGroup;
      button.hidden = group === "build" && !buildAvailable;
      button.setAttribute("aria-expanded", String(this.inspectorGroups.has(group)));
    });
    const buildExpanded = buildAvailable && this.inspectorGroups.has("build");
    const propertiesExpanded = this.inspectorGroups.has("design") || this.inspectorGroups.has("advanced");
    this.get("#build-panel").hidden = !buildExpanded;
    this.host.querySelector<HTMLElement>(".build-resizer")!.hidden = !buildExpanded || !propertiesExpanded;
    this.host.querySelector<HTMLElement>(".element-properties-panel")!.hidden = !propertiesExpanded;
  }

  private updateCanvasContext(): void {
    const selectionToolbar = this.host.querySelector<HTMLElement>(".selection-toolbar")!;
    selectionToolbar.hidden = this.selectedIds.length === 0;
    selectionToolbar.dataset.selectionMode = this.selectedIds.length > 1 ? "multiple" : "single";
    selectionToolbar.querySelector<HTMLElement>(".selection-context-label")!.textContent = this.selectedIds.length > 1
      ? `${this.selectedIds.length} ${this.t("elements selected")}`
      : this.t("单个元素");
    selectionToolbar.querySelector<HTMLElement>(".selection-distribute-controls")!.hidden = this.selectedIds.length < 2;
  }

  private selectElement(id: string, additive: boolean, revealInTree = true): void {
    if (!this.model.find(id) || !this.model.elementBelongsToPage(id, this.activePageIndex)) return;
    if (additive) {
      this.selectedIds = this.selectedIds.includes(id) ? this.selectedIds.filter((selected) => selected !== id) : [...this.selectedIds, id];
    } else {
      this.selectedIds = [id];
    }
    this.history.replaceCurrent(this.createSnapshot());
    this.transform.setSelection(this.selectedIds);
    this.renderLayers(revealInTree && this.selectedIds.includes(id) ? id : undefined);
    this.renderInspector();
    this.renderBuildPanel(this.model.buildSequence(this.activePageIndex));
    this.fragments.refreshSelection();
    this.updateIoMenuState();
    this.updateLiveSelectionStatus();
  }

  private updateIoMenuState(): void {
    const extension = this.model.kind === "svg" ? "SVG" : "HTML";
    this.get("#export-document-label").textContent = `${this.t("导出")} ${extension}`;
    this.get<HTMLButtonElement>("#export-selection-action").disabled = this.selectedIds.length === 0;
  }

  private selectCanvasElement(id: string, options: { additive: boolean; parent: boolean }): void {
    if (this.spacePressed) return;
    let targetId = id;
    if (options.parent) {
      const hit = this.model.find(id);
      const selectedId = this.selectedIds.length === 1 ? this.selectedIds[0] : undefined;
      const selected = selectedId ? this.model.find(selectedId) : null;
      if (hit && selectedId && selected && selected !== hit && selected.contains(hit)) {
        targetId = selectedId;
      } else {
        targetId = hit?.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") ?? id;
      }
    }
    if (!options.additive && this.selectedIds.length === 1 && this.selectedIds[0] === targetId) {
      this.revealLayer(targetId);
      return;
    }
    this.selectElement(targetId, options.additive);
  }

  private updateLiveSelectionStatus(): void {
    const status = this.get("#selection-status");
    if (this.selectedIds.length === 0) status.textContent = this.t("未选择元素");
    else if (this.selectedIds.length > 1) status.textContent = `${this.selectedIds.length} ${this.t("elements selected")}`;
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
    this.revealLayer(this.selectedIds.at(-1) ?? null, "auto");
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
    else this.loadSource(defaultHtml, "ai-slide.html", "examples/ai-slide.html", exampleAssets(), undefined, [], true);
  }

  private loadSource(source: string, sourceName: string, sourcePath: string, assets: ProjectAssets, canvas?: { width: number; height: number }, operations: OperationLogEntry[] = [], initialBuildsCompleted = false): void {
    try {
      const model = SourceDocument.parse(source, sourceName, undefined, canvas);
      this.assets.dispose();
      this.assets = assets;
      this.model = model;
      this.sourcePath = sourcePath;
      this.operationLog = operations.map((entry) => ({ ...entry, elementIds: [...entry.elementIds] }));
      this.selectedIds = [];
      this.collapsedLayerIds.clear();
      this.pendingLayerRevealId = null;
      this.activePageIndex = 0;
      this.buildStepsByPage.clear();
      if (initialBuildsCompleted) this.setAllBuildsComplete();
      this.buildViewMode = "playback";
      this.history.reset(this.createSnapshot(), "Loaded document");
      this.renderDocument(true);
      this.renderAfterFontsSettle(model);
      requestAnimationFrame(() => this.fitCanvas());
      this.toast(`已载入 ${sourceName}`);
    } catch (error) {
      assets.dispose();
      this.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  private renderAfterFontsSettle(model: SourceDocument): void {
    if (!document.fonts) return;
    const token = ++this.fontRenderToken;
    void Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => window.setTimeout(resolve, 2_000)),
    ]).then(() => {
      if (token !== this.fontRenderToken || model !== this.model) return;
      this.renderDocument(false);
      requestAnimationFrame(() => {
        this.fitCanvas();
        this.transform.update();
      });
    });
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

  private async refreshFontStatus(elementId: string, entry: FontCatalogEntry): Promise<void> {
    const availability = await resolveFontAvailability(entry);
    if (this.selectedIds.length !== 1 || this.selectedIds[0] !== elementId) return;
    const select = this.host.querySelector<HTMLSelectElement>('[data-prop="fontCatalog"]');
    const status = this.host.querySelector<HTMLElement>("[data-font-status]");
    if (!select || select.value !== entry.id || !status) return;
    const option = Array.from(select.options).find((candidate) => candidate.value === entry.id);
    const fellBack = availability.kind === "bundled" && Boolean(entry.localNames?.length);
    if (option) option.textContent = fellBack
      ? `${availability.actualLabel} (${this.t("替代 ")}${entry.label})`
      : availability.kind === "local" ? `${entry.label} (${this.t("本机")})` : entry.label;
    status.classList.toggle("is-warning", fellBack);
    status.textContent = fellBack
      ? this.t(`本机未安装 ${entry.label}，实际使用已内嵌的 ${availability.actualLabel}。`)
      : availability.kind === "local"
        ? `${this.t("实际使用：")}${availability.actualLabel} (${this.t("本机字体")})`
        : `${this.t("实际使用：")}${availability.actualLabel}`;
  }

  private async applyFontCatalogEntry(elementId: string, entry: FontCatalogEntry): Promise<void> {
    const requestToken = (this.fontChangeTokens.get(elementId) ?? 0) + 1;
    this.fontChangeTokens.set(elementId, requestToken);
    const model = this.model;
    const sourcePath = this.sourcePath;
    const status = this.host.querySelector<HTMLElement>("[data-font-status]");
    if (status) status.textContent = this.t(`正在载入 ${entry.label}…`);
    try {
      const asset = await loadManagedFontAsset(entry, sourcePath);
      if (this.fontChangeTokens.get(elementId) !== requestToken || this.model !== model) return;
      const element = this.model.find(elementId);
      if (!element) return;
      if (element.getAttribute("data-editor-locked") === "true") {
        this.toast("元素已锁定，请先解锁再修改属性");
        this.renderInspector();
        return;
      }
      const committed = this.commitMutation(`Update font ${entry.label}`, () => {
        if (asset) this.assets.set(asset);
        ensureManagedFontFace(this.model, entry);
        applyElementChanges(element, kindForElement(element, this.model.kind), { fontFamily: entry.cssFamily });
      });
      if (committed) this.renderAfterFontsSettle(this.model);
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error), true);
      this.renderInspector();
    }
  }

  private shadowValueFromInspector(): ShadowValue | null {
    const editor = this.host.querySelector<HTMLElement>("[data-shadow-editor]");
    if (!editor) return null;
    const number = (part: string, fallback: number) => numeric(editor.querySelector<HTMLInputElement>(`[data-shadow-part="${part}"]`)?.value ?? "", fallback);
    return {
      x: number("x", DEFAULT_SHADOW.x),
      y: number("y", DEFAULT_SHADOW.y),
      blur: number("blur", DEFAULT_SHADOW.blur),
      spread: number("spread", DEFAULT_SHADOW.spread),
      color: editor.querySelector<HTMLInputElement>('[data-shadow-part="color"]')?.value ?? DEFAULT_SHADOW.color,
      opacity: number("opacity", DEFAULT_SHADOW.opacity),
    };
  }

  private updateShadowOutputs(value: ShadowValue): void {
    const editor = this.host.querySelector<HTMLElement>("[data-shadow-editor]");
    if (!editor) return;
    for (const part of ["x", "y", "blur", "spread"] as const) {
      const output = editor.querySelector<HTMLOutputElement>(`[data-shadow-output="${part}"]`);
      if (output) output.value = `${value[part]} px`;
    }
    const opacity = editor.querySelector<HTMLOutputElement>('[data-shadow-output="opacity"]');
    if (opacity) opacity.value = `${Math.round(value.opacity * 100)}%`;
    const color = editor.querySelector<HTMLOutputElement>(".shadow-color output");
    if (color) color.value = value.color;
  }

  private previewShadowFromInspector(): void {
    const id = this.selectedIds[0];
    const value = this.shadowValueFromInspector();
    const preview = id ? this.renderer.element(id) : null;
    if (!value || !preview) return;
    (preview as HTMLElement | SVGElement).style.boxShadow = serializeBoxShadow(value);
    this.updateShadowOutputs(value);
    this.host.querySelectorAll("[data-shadow-preset]").forEach((button) => button.classList.remove("is-active"));
  }

  private commitShadowFromInspector(): void {
    const id = this.selectedIds[0];
    const value = this.shadowValueFromInspector();
    const element = id ? this.model.find(id) : null;
    if (!id || !value || !element) return;
    if (element.getAttribute("data-editor-locked") === "true") {
      this.toast("元素已锁定，请先解锁再修改属性");
      this.renderInspector();
      return;
    }
    this.commitMutation("Update shadow", () => applyElementChanges(element, kindForElement(element, this.model.kind), { boxShadow: serializeBoxShadow(value) }));
  }

  private applyShadowPreset(presetId: string): void {
    const id = this.selectedIds[0];
    const element = id ? this.model.find(id) : null;
    const preset = SHADOW_PRESETS.find((candidate) => candidate.id === presetId);
    if (!element || !preset) return;
    if (element.getAttribute("data-editor-locked") === "true") {
      this.toast("元素已锁定，请先解锁再修改属性");
      return;
    }
    this.commitMutation(`Set shadow ${preset.label}`, () => applyElementChanges(element, kindForElement(element, this.model.kind), { boxShadow: serializeBoxShadow(preset.value) }));
  }

  private handleInspectorChange(event: Event): void {
    const input = (event.target as Element).closest<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-prop]");
    const id = this.selectedIds[0];
    if (!input?.dataset.prop || !id) return;
    const prop = input.dataset.prop;
    const value = input.value;
    if (prop === "fontCatalog") {
      const entry = fontEntryById(value);
      if (entry) void this.applyFontCatalogEntry(id, entry);
      return;
    }
    const element = this.model.find(id);
    if (!element) return;
    if (element.getAttribute("data-editor-locked") === "true") {
      this.toast("元素已锁定，请先解锁再修改属性");
      this.renderInspector();
      return;
    }
    const bounds = this.renderer.bounds(id) ?? { x: 0, y: 0, width: 0, height: 0 };
    const targetKind = kindForElement(element, this.model.kind);
    const renderedBorderStyle = targetKind === "html" ? getComputedStyle(this.renderer.element(id)!).borderStyle : "";
    const geometryProps = new Set(["x", "y", "width", "height", "rotation"]);
    const geometryNumber = input instanceof HTMLInputElement ? input.valueAsNumber : Number.NaN;
    if (geometryProps.has(prop) && (!Number.isFinite(geometryNumber) || (["width", "height"].includes(prop) && geometryNumber < 1))) {
      input.setCustomValidity(this.t(prop === "width" || prop === "height" ? "请输入不小于 1 的有效数字。" : "请输入有效数字。"));
      input.reportValidity();
      const previous = prop === "x" ? bounds.x
        : prop === "y" ? bounds.y
          : prop === "width" ? bounds.width
            : prop === "height" ? bounds.height
              : getTransformValues(element).rotation;
      input.value = geometryText(previous);
      return;
    }
    input.setCustomValidity("");
    this.commitMutation(`Update ${prop}`, () => {
      if (prop === "x") moveElementBy(element, targetKind, geometryNumber - bounds.x, 0);
      else if (prop === "y") moveElementBy(element, targetKind, 0, geometryNumber - bounds.y);
      else if (prop === "width" || prop === "height") {
        const next = geometryValue(Math.max(1, geometryNumber));
        const ratio = bounds.height > 0 ? bounds.width / bounds.height : 1;
        let width = prop === "width" ? next : geometryValue(bounds.width);
        let height = prop === "height" ? next : geometryValue(bounds.height);
        if (element.localName === "circle") width = height = next;
        else if (this.keepRatio && ratio > 0) {
          if (prop === "width") height = geometryValue(width / ratio);
          else width = geometryValue(height * ratio);
        }
        const preview = this.renderer.element(id);
        const nativeSize = targetKind === "html" || ["rect", "image", "svg", "circle", "ellipse"].includes(element.localName);
        if (nativeSize || !preview || !("getBBox" in preview) || bounds.width <= 0 || bounds.height <= 0) {
          this.model.apply({ action: "updateElement", elementId: id, changes: { width, height } });
        } else {
          const box = (preview as SVGGraphicsElement).getBBox();
          const transform = getTransformValues(element);
          const originX = numeric(element.getAttribute("data-editor-scale-origin-x") ?? "", box.x);
          const originY = numeric(element.getAttribute("data-editor-scale-origin-y") ?? "", box.y);
          setElementScaleOrigin(element, originX, originY);
          setElementScale(element, targetKind, transform.scaleX * width / bounds.width, transform.scaleY * height / bounds.height);
        }
      }
      else if (prop === "rotation") this.model.apply({ action: "rotateElement", elementId: id, angle: geometryNumber });
      else if (prop === "fontSize" || prop === "opacity" || prop === "strokeWidth" || prop === "letterSpacing") {
        if (prop === "strokeWidth" && targetKind === "html" && !["none", "hidden", ""].includes(renderedBorderStyle)) {
          (element as HTMLElement).style.borderStyle = renderedBorderStyle;
        }
        applyElementChanges(element, targetKind, { [prop]: numeric(value) });
      }
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

  private canvasPanBounds(axis: CanvasScrollAxis): { min: number; max: number } {
    const viewport = this.get("#canvas-viewport");
    const viewportSize = axis === "x" ? viewport.clientWidth : viewport.clientHeight;
    const canvasSize = (axis === "x" ? this.model.canvas.width : this.model.canvas.height) * this.zoom;
    const visibleEdge = Math.min(48, viewportSize / 4);
    return {
      min: visibleEdge - canvasSize,
      max: viewportSize - visibleEdge,
    };
  }

  private constrainCanvasPan(): void {
    const x = this.canvasPanBounds("x");
    const y = this.canvasPanBounds("y");
    this.pan.x = Math.min(x.max, Math.max(x.min, this.pan.x));
    this.pan.y = Math.min(y.max, Math.max(y.min, this.pan.y));
  }

  private updateCanvasScrollbar(axis: CanvasScrollAxis): void {
    const scrollbar = this.get<HTMLElement>(`[data-canvas-scrollbar="${axis}"]`);
    const thumb = scrollbar.querySelector<HTMLElement>(".canvas-scrollbar-thumb")!;
    const viewport = this.get("#canvas-viewport");
    const viewportSize = axis === "x" ? viewport.clientWidth : viewport.clientHeight;
    const trackSize = axis === "x" ? scrollbar.clientWidth : scrollbar.clientHeight;
    const bounds = this.canvasPanBounds(axis);
    const range = Math.max(0, bounds.max - bounds.min);
    const thumbSize = Math.min(trackSize, Math.max(28, trackSize * viewportSize / Math.max(1, viewportSize + range)));
    const travel = Math.max(0, trackSize - thumbSize);
    const ratio = range > 0 ? (bounds.max - this.pan[axis]) / range : 0;
    const position = travel * Math.min(1, Math.max(0, ratio));

    if (axis === "x") {
      thumb.style.width = `${thumbSize}px`;
      thumb.style.transform = `translateX(${position}px)`;
    } else {
      thumb.style.height = `${thumbSize}px`;
      thumb.style.transform = `translateY(${position}px)`;
    }
    scrollbar.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }

  private updateCanvasTransform(): void {
    this.constrainCanvasPan();
    const transform = this.get("#canvas-transform");
    transform.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    this.get("#zoom-display").textContent = `${Math.round(this.zoom * 100)}%`;
    this.updateCanvasScrollbar("x");
    this.updateCanvasScrollbar("y");
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
    const viewport = this.get("#canvas-viewport");
    if (event.ctrlKey || event.metaKey) {
      const bounds = viewport.getBoundingClientRect();
      const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      this.setZoom(this.zoom * Math.exp(-event.deltaY * 0.0015), anchor);
      return;
    }

    const linePixels = 16;
    const deltaX = event.deltaX * (event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? linePixels
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientWidth : 1);
    const deltaY = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? linePixels
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : 1);
    const shiftHorizontal = event.shiftKey && Math.abs(deltaX) < 0.01;
    this.pan.x -= shiftHorizontal ? deltaY : deltaX;
    this.pan.y -= shiftHorizontal ? 0 : deltaY;
    this.updateCanvasTransform();
  }

  private beginCanvasScrollbarDrag(event: PointerEvent, axis: CanvasScrollAxis): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const scrollbar = event.currentTarget as HTMLElement;
    const thumb = scrollbar.querySelector<HTMLElement>(".canvas-scrollbar-thumb")!;
    const trackRect = scrollbar.getBoundingClientRect();
    const thumbSize = axis === "x" ? thumb.offsetWidth : thumb.offsetHeight;
    const trackSize = axis === "x" ? trackRect.width : trackRect.height;
    const travel = Math.max(0, trackSize - thumbSize);
    if (travel <= 0) return;

    const bounds = this.canvasPanBounds(axis);
    const range = bounds.max - bounds.min;
    const coordinate = axis === "x" ? event.clientX : event.clientY;
    const trackStart = axis === "x" ? trackRect.left : trackRect.top;
    const onThumb = event.target instanceof Element && Boolean(event.target.closest(".canvas-scrollbar-thumb"));
    if (!onThumb) {
      const offset = Math.min(travel, Math.max(0, coordinate - trackStart - thumbSize / 2));
      this.pan[axis] = bounds.max - offset / travel * range;
      this.updateCanvasTransform();
    }

    const startCoordinate = coordinate;
    const startPan = this.pan[axis];
    const move = (moveEvent: PointerEvent): void => {
      moveEvent.preventDefault();
      const nextCoordinate = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
      this.pan[axis] = startPan - (nextCoordinate - startCoordinate) / travel * range;
      this.updateCanvasTransform();
    };
    const end = (): void => {
      scrollbar.removeEventListener("pointermove", move);
      scrollbar.removeEventListener("pointerup", end);
      scrollbar.removeEventListener("pointercancel", end);
      if (scrollbar.hasPointerCapture(event.pointerId)) scrollbar.releasePointerCapture(event.pointerId);
    };
    scrollbar.addEventListener("pointermove", move);
    scrollbar.addEventListener("pointerup", end);
    scrollbar.addEventListener("pointercancel", end);
    scrollbar.setPointerCapture(event.pointerId);
  }

  private handleCanvasScrollbarKeyDown(event: KeyboardEvent, axis: CanvasScrollAxis): void {
    const bounds = this.canvasPanBounds(axis);
    const viewport = this.get("#canvas-viewport");
    const pageStep = (axis === "x" ? viewport.clientWidth : viewport.clientHeight) * 0.8;
    const arrowBackward = axis === "x" ? "ArrowLeft" : "ArrowUp";
    const arrowForward = axis === "x" ? "ArrowRight" : "ArrowDown";
    let next: number | null = null;

    if (event.key === "Home") next = bounds.max;
    else if (event.key === "End") next = bounds.min;
    else if (event.key === arrowBackward) next = this.pan[axis] + (event.shiftKey ? 80 : 24);
    else if (event.key === arrowForward) next = this.pan[axis] - (event.shiftKey ? 80 : 24);
    else if (event.key === "PageUp") next = this.pan[axis] + pageStep;
    else if (event.key === "PageDown") next = this.pan[axis] - pageStep;
    if (next === null) return;

    event.preventDefault();
    event.stopPropagation();
    this.pan[axis] = next;
    this.updateCanvasTransform();
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
    if (event.key === "Escape" && this.host.querySelector<HTMLDetailsElement>("[data-io-menu][open]")) {
      event.preventDefault();
      this.closeIoMenus();
      return;
    }
    if (event.key === "F2" && this.selectedIds.length === 1) {
      event.preventDefault();
      this.startLayerRename(this.selectedIds[0]!);
      return;
    }
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
    if (modifier && event.key.toLowerCase() === "c" && this.selectedIds.length) {
      event.preventDefault();
      void this.fragments.copySelectionToClipboard();
      return;
    }
    if (modifier && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void this.fragments.pasteLatestClipboard();
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
      this.get("#code-error").textContent = this.t(error instanceof Error ? error.message : String(error));
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
      this.get("#sync-status").textContent = this.t("格式化结果尚未应用");
      this.get("#sync-status").className = "sync-dirty";
    } catch (error) {
      this.get("#code-error").textContent = this.t(error instanceof Error ? error.message : String(error));
    }
  }

  private toggleCodeDrawer(): void {
    const drawer = this.get("#code-drawer");
    const collapsed = drawer.classList.toggle("is-collapsed");
    this.get(".studio-shell").classList.toggle("is-code-collapsed", collapsed);
    this.get("#toggle-code").textContent = this.t(collapsed ? "展开源码" : "收起源码");
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
      try {
        const result = buildStandaloneSvg(this.model, this.assets, this.sourcePath);
        const name = this.model.sourceName.match(/\.svg$/i) ? this.model.sourceName : `${fileStem(this.model.sourceName)}.svg`;
        downloadText(result.svg, name, "image/svg+xml");
        if (result.warnings.length) this.showNotice(result.warnings.join(" "));
        this.toast(`已导出 ${name}`);
      } catch (error) {
        this.toast(error instanceof Error ? error.message : String(error), true);
      }
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
    toast.textContent = this.t(message);
    toast.className = `toast${error ? " is-error" : ""}`;
    toast.hidden = false;
    this.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
  }

  private recordOperation(label: string, source: OperationLogEntry["source"]): void {
    this.operationLog.push({ at: new Date().toISOString(), label, elementIds: [...this.selectedIds], source });
    if (this.operationLog.length > 500) this.operationLog.shift();
  }
}
