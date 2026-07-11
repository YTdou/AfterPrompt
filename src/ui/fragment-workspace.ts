import type { SourceDocument } from "../core/document-model";
import { syncLinkedVisualFragmentInstances } from "../core/fragments/component";
import { extractVisualFragment } from "../core/fragments/extract";
import { applyVisualFragmentInsertPlan, planVisualFragmentInsert } from "../core/fragments/import";
import { VisualFragmentLibrary } from "../core/fragments/library";
import { decodeVisualFragmentPackage, visualFragmentBlob } from "../core/fragments/package";
import type {
  VisualFragmentCompatibilityReport,
  VisualFragmentLibraryRecord,
  VisualFragmentPackage,
  VisualFragmentPlacement,
  VisualFragmentProperty,
  VisualFragmentSelectionItem,
  VisualFragmentSlot,
  VisualFragmentType,
} from "../core/fragments/types";
import { downloadBlob, downloadText, type ProjectAssets } from "../core/project";
import type { NewElementSpec } from "../core/types";

export interface FragmentWorkspaceContext {
  model: SourceDocument;
  assets: ProjectAssets;
  sourcePath: string;
  selectedIds: string[];
  selectionItems: VisualFragmentSelectionItem[];
  insertionParentId: string | null;
  cursor: { x: number; y: number };
}

export interface FragmentWorkspaceCallbacks {
  getContext(): FragmentWorkspaceContext;
  commit(label: string, mutate: () => string[] | void): boolean;
  toast(message: string, error?: boolean): void;
  notice(message: string): void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}

function fileStem(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "fragment";
}

function nextPatchVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : "1.0.0";
}

function bytesToDataUrl(mimeType: string, bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return `data:${mimeType || "application/octet-stream"};base64,${btoa(binary)}`;
}

function inlinePackageAssets(value: string, fragment: VisualFragmentPackage): string {
  return fragment.assets.reduce((result, asset) => result.replaceAll(asset.path, bytesToDataUrl(asset.mimeType, asset.bytes)), value);
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("浏览器拒绝剪贴板写入。");
  }
}

function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

const fragmentUi = `
  <input id="fragment-import-input" type="file" accept=".vfrag,application/zip" hidden />
  <dialog id="fragment-save-dialog" class="fragment-dialog fragment-save-dialog">
    <form id="fragment-save-form" method="dialog">
      <header class="fragment-dialog-heading">
        <div><span class="eyebrow">VISUAL FRAGMENT</span><h2>保存视觉片段</h2></div>
        <button value="cancel" aria-label="关闭">×</button>
      </header>
      <div class="fragment-form-grid">
        <label class="field"><span>名称</span><input id="fragment-name" required maxlength="160" /></label>
        <label class="field"><span>版本</span><input id="fragment-version" value="1.0.0" required /></label>
        <label class="field"><span>类型</span><select id="fragment-type"><option value="element">Element</option><option value="group">Group</option><option value="component">Component</option><option value="template">Template</option></select></label>
        <label class="field"><span>保存模式</span><select id="fragment-mode"><option value="source-preserving">Source-preserving</option><option value="self-contained" selected>Self-contained</option></select></label>
        <label class="field"><span>分类</span><input id="fragment-category" value="Uncategorized" /></label>
        <label class="field"><span>标签（逗号分隔）</span><input id="fragment-tags" /></label>
      </div>
      <label class="field stack"><span>描述</span><textarea id="fragment-description" rows="3" maxlength="2000"></textarea></label>
      <section id="fragment-component-schema" class="fragment-schema-editor" hidden>
        <div class="fragment-schema-heading"><div><h3>组件属性</h3><p>将内部节点的文字、属性或样式暴露给用户和 Codex。</p></div><button id="fragment-add-property" type="button">＋ 属性</button></div>
        <div id="fragment-property-rows" class="fragment-schema-rows"></div>
        <div class="fragment-schema-heading"><div><h3>内容插槽</h3><p>定义允许用户或 Codex 插入内容的位置与约束。</p></div><button id="fragment-add-slot" type="button">＋ 插槽</button></div>
        <div id="fragment-slot-rows" class="fragment-schema-rows"></div>
      </section>
      <footer class="fragment-dialog-actions"><span id="fragment-save-selection"></span><button value="cancel">取消</button><button id="fragment-save-submit" type="submit" value="default" class="button primary">保存到本地库</button></footer>
    </form>
  </dialog>

  <dialog id="fragment-library-dialog" class="fragment-dialog fragment-library-dialog">
    <div class="fragment-dialog-heading">
      <div><span class="eyebrow">LOCAL LIBRARY</span><h2>视觉片段库</h2><small id="fragment-storage-status"></small></div>
      <button id="fragment-library-close" type="button" aria-label="关闭">×</button>
    </div>
    <div class="fragment-library-toolbar">
      <input id="fragment-search" type="search" placeholder="搜索名称、描述、标签或 ID" />
      <select id="fragment-category-filter"><option value="">全部分类</option></select>
      <label class="checkbox"><input id="fragment-favorite-filter" type="checkbox" /> 仅收藏</label>
      <label class="checkbox"><input id="fragment-recent-filter" type="checkbox" /> 最近使用优先</label>
      <select id="fragment-placement">
        <option value="center">画布中心</option>
        <option value="original">原始位置</option>
        <option value="cursor">最近鼠标位置</option>
        <option value="point">指定坐标</option>
      </select>
      <label class="fragment-coordinate">X <input id="fragment-place-x" type="number" value="0" /></label>
      <label class="fragment-coordinate">Y <input id="fragment-place-y" type="number" value="0" /></label>
      <button id="fragment-import" type="button">导入 .vfrag</button>
      <button id="fragment-library-save-selection" type="button" class="button primary">保存当前选区</button>
    </div>
    <div id="fragment-library-results" class="fragment-library-results"></div>
  </dialog>

  <dialog id="fragment-report-dialog" class="fragment-dialog fragment-report-dialog">
    <form method="dialog">
      <header class="fragment-dialog-heading"><div><span class="eyebrow">COMPATIBILITY</span><h2 id="fragment-report-title">导入兼容性报告</h2></div><button value="cancel" aria-label="关闭">×</button></header>
      <div id="fragment-report-content" class="fragment-report-content"></div>
      <footer class="fragment-dialog-actions"><button value="cancel">取消</button><button id="fragment-report-confirm" value="confirm" class="button primary">确认插入</button></footer>
    </form>
  </dialog>
`;

export class FragmentWorkspace {
  private readonly library = new VisualFragmentLibrary();
  private readonly previewUrls = new Set<string>();
  private renderToken = 0;

  constructor(private readonly host: HTMLElement, private readonly callbacks: FragmentWorkspaceCallbacks) {
    const toolbar = host.querySelector(".toolbar-primary");
    const separator = toolbar?.querySelector(".toolbar-separator");
    if (!toolbar || !separator) throw new Error("Fragment toolbar mount point was not found.");
    const save = document.createElement("button");
    save.id = "save-fragment";
    save.className = "button";
    save.textContent = "保存片段";
    const library = document.createElement("button");
    library.id = "open-fragment-library";
    library.className = "button";
    library.textContent = "片段库";
    separator.before(save, library);
    host.insertAdjacentHTML("beforeend", fragmentUi);
    this.bindEvents();
    this.refreshSelection();
  }

  private get<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Fragment UI element not found: ${selector}`);
    return element;
  }

  private bindEvents(): void {
    this.get("#save-fragment").addEventListener("click", () => this.openSaveDialog());
    this.get("#open-fragment-library").addEventListener("click", () => void this.openLibrary());
    this.get("#fragment-library-close").addEventListener("click", () => this.get<HTMLDialogElement>("#fragment-library-dialog").close());
    this.get("#fragment-library-dialog").addEventListener("close", () => this.clearPreviewUrls());
    this.get("#fragment-library-save-selection").addEventListener("click", () => this.openSaveDialog());
    this.get("#fragment-import").addEventListener("click", () => this.get<HTMLInputElement>("#fragment-import-input").click());
    this.get("#fragment-import-input").addEventListener("change", (event) => void this.importPackage(event));
    this.get("#fragment-save-form").addEventListener("submit", (event) => void this.saveSelection(event));
    this.get("#fragment-type").addEventListener("change", () => this.toggleComponentSchema());
    this.get("#fragment-add-property").addEventListener("click", () => this.addPropertyRow());
    this.get("#fragment-add-slot").addEventListener("click", () => this.addSlotRow());
    this.get("#fragment-property-rows").addEventListener("click", (event) => {
      (event.target as Element).closest("[data-remove-schema-row]")?.closest(".fragment-schema-row")?.remove();
    });
    this.get("#fragment-slot-rows").addEventListener("click", (event) => {
      (event.target as Element).closest("[data-remove-schema-row]")?.closest(".fragment-schema-row")?.remove();
    });
    for (const selector of ["#fragment-search", "#fragment-category-filter", "#fragment-favorite-filter", "#fragment-recent-filter"]) {
      this.get(selector).addEventListener(selector === "#fragment-search" ? "input" : "change", () => void this.renderLibrary());
    }
    this.get("#fragment-library-results").addEventListener("click", (event) => void this.handleLibraryAction(event));
    this.host.addEventListener("change", (event) => this.handleInstancePropertyChange(event));
    this.host.addEventListener("click", (event) => void this.handleInstanceAction(event));
  }

  refreshSelection(): void {
    const context = this.callbacks.getContext();
    this.get<HTMLButtonElement>("#save-fragment").disabled = context.selectedIds.length === 0;
    this.get<HTMLButtonElement>("#fragment-library-save-selection").disabled = context.selectedIds.length === 0;
    this.renderInstanceInspector();
  }

  private selectionCandidates(): Array<{ value: string; label: string }> {
    const context = this.callbacks.getContext();
    const candidates: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    for (const item of context.selectionItems) {
      for (const element of allElements(item.element)) {
        const editorId = element.getAttribute("data-editor-id");
        if (!editorId) continue;
        const value = element.getAttribute("data-vfrag-node-key") ?? editorId;
        if (seen.has(value)) continue;
        seen.add(value);
        const name = element.getAttribute("data-editor-name") ?? element.textContent?.replace(/\s+/g, " ").trim().slice(0, 28) ?? element.localName;
        candidates.push({ value, label: `${name || element.localName} · ${value}` });
      }
    }
    return candidates;
  }

  private candidateOptions(selected = ""): string {
    return this.selectionCandidates().map((candidate) => `<option value="${escapeHtml(candidate.value)}"${candidate.value === selected ? " selected" : ""}>${escapeHtml(candidate.label)}</option>`).join("");
  }

  private addPropertyRow(property?: VisualFragmentProperty): void {
    const row = document.createElement("div");
    row.className = "fragment-schema-row property-row";
    const bindingName = property?.binding.kind === "text" ? "" : property?.binding.name ?? "";
    row.innerHTML = `
      <input data-schema-field="name" placeholder="propertyName" value="${escapeHtml(property?.name ?? "")}" />
      <input data-schema-field="label" placeholder="显示名称" value="${escapeHtml(property?.label ?? "")}" />
      <select data-schema-field="type">${["text", "number", "color", "image", "icon", "boolean", "enum", "size", "url"].map((type) => `<option${property?.type === type ? " selected" : ""}>${type}</option>`).join("")}</select>
      <select data-schema-field="target">${this.candidateOptions(property?.target)}</select>
      <select data-schema-field="binding">${["text", "attribute", "style", "css-variable"].map((kind) => `<option${property?.binding.kind === kind ? " selected" : ""}>${kind}</option>`).join("")}</select>
      <input data-schema-field="bindingName" placeholder="属性/样式名" value="${escapeHtml(bindingName)}" />
      <input data-schema-field="options" placeholder="枚举选项，逗号分隔" value="${escapeHtml(property?.options?.join(", ") ?? "")}" />
      <label class="checkbox"><input data-schema-field="required" type="checkbox"${property?.required ? " checked" : ""} />必填</label>
      <button type="button" data-remove-schema-row title="删除属性">×</button>`;
    this.get("#fragment-property-rows").append(row);
  }

  private addSlotRow(slot?: VisualFragmentSlot): void {
    const row = document.createElement("div");
    row.className = "fragment-schema-row slot-row";
    row.innerHTML = `
      <input data-schema-field="name" placeholder="slotName" value="${escapeHtml(slot?.name ?? "")}" />
      <input data-schema-field="label" placeholder="显示名称" value="${escapeHtml(slot?.label ?? "")}" />
      <select data-schema-field="target">${this.candidateOptions(slot?.target)}</select>
      <input data-schema-field="allowed" placeholder="text,image,rect" value="${escapeHtml(slot?.allowedElementTypes.join(", ") ?? "")}" />
      <input data-schema-field="default" placeholder="默认内容说明" value="${escapeHtml(slot?.defaultContent ?? "")}" />
      <input data-schema-field="minWidth" type="number" min="0" placeholder="最小宽" value="${slot?.size?.minWidth ?? ""}" />
      <input data-schema-field="minHeight" type="number" min="0" placeholder="最小高" value="${slot?.size?.minHeight ?? ""}" />
      <input data-schema-field="maxWidth" type="number" min="0" placeholder="最大宽" value="${slot?.size?.maxWidth ?? ""}" />
      <input data-schema-field="maxHeight" type="number" min="0" placeholder="最大高" value="${slot?.size?.maxHeight ?? ""}" />
      <label class="checkbox"><input data-schema-field="required" type="checkbox"${slot?.required ? " checked" : ""} />必填</label>
      <label class="checkbox"><input data-schema-field="multiple" type="checkbox"${slot?.multiple ? " checked" : ""} />多个</label>
      <button type="button" data-remove-schema-row title="删除插槽">×</button>`;
    this.get("#fragment-slot-rows").append(row);
  }

  private openSaveDialog(record?: VisualFragmentLibraryRecord): void {
    const context = this.callbacks.getContext();
    if (!context.selectedIds.length) {
      this.callbacks.toast("请先选择要保存的元素或元素组", true);
      return;
    }
    const dialog = this.get<HTMLDialogElement>("#fragment-save-dialog");
    dialog.dataset.fragmentId = record?.fragmentId ?? "";
    this.get<HTMLInputElement>("#fragment-name").value = record?.manifest.name ?? (context.selectedIds.length === 1 ? context.selectedIds[0]! : `${context.selectedIds.length} elements`);
    this.get<HTMLInputElement>("#fragment-version").value = record ? nextPatchVersion(record.version) : "1.0.0";
    this.get<HTMLSelectElement>("#fragment-type").value = record?.manifest.fragmentType ?? (context.selectedIds.length === 1 ? "element" : "group");
    this.get<HTMLSelectElement>("#fragment-mode").value = record?.manifest.saveMode ?? "self-contained";
    this.get<HTMLInputElement>("#fragment-category").value = record?.manifest.category ?? "Uncategorized";
    this.get<HTMLInputElement>("#fragment-tags").value = record?.manifest.tags.join(", ") ?? "";
    this.get<HTMLTextAreaElement>("#fragment-description").value = record?.manifest.description ?? "";
    this.get("#fragment-property-rows").replaceChildren();
    this.get("#fragment-slot-rows").replaceChildren();
    record?.manifest.properties.forEach((property) => this.addPropertyRow(property));
    record?.manifest.slots.forEach((slot) => this.addSlotRow(slot));
    const selectionType = context.selectionItems.length > 0 && context.selectionItems.every((item) => item.element.namespaceURI === "http://www.w3.org/2000/svg") ? "SVG" : context.model.kind.toUpperCase();
    this.get("#fragment-save-selection").textContent = `${context.selectedIds.length} 个顶层选择 · ${selectionType}`;
    this.toggleComponentSchema();
    dialog.showModal();
  }

  private toggleComponentSchema(): void {
    const type = this.get<HTMLSelectElement>("#fragment-type").value;
    this.get("#fragment-component-schema").hidden = !["component", "template"].includes(type);
  }

  private field(row: Element, name: string): HTMLInputElement | HTMLSelectElement {
    const field = row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-schema-field="${name}"]`);
    if (!field) throw new Error(`组件 Schema 字段缺失：${name}`);
    return field;
  }

  private readProperties(): VisualFragmentProperty[] {
    return Array.from(this.get("#fragment-property-rows").querySelectorAll(".fragment-schema-row")).map((row) => {
      const kind = this.field(row, "binding").value as VisualFragmentProperty["binding"]["kind"];
      const name = this.field(row, "name").value.trim();
      const label = this.field(row, "label").value.trim() || name;
      const bindingName = this.field(row, "bindingName").value.trim();
      if (!name) throw new Error("组件属性必须填写程序化名称。");
      if (kind !== "text" && !bindingName) throw new Error(`属性 ${name} 必须填写绑定的属性或样式名。`);
      const binding: VisualFragmentProperty["binding"] = kind === "text" ? { kind: "text" }
        : kind === "css-variable" ? { kind, name: bindingName as `--${string}` }
          : { kind, name: bindingName };
      const options = this.field(row, "options").value.split(",").map((value) => value.trim()).filter(Boolean);
      return {
        name,
        label,
        type: this.field(row, "type").value as VisualFragmentProperty["type"],
        target: this.field(row, "target").value,
        binding,
        required: (this.field(row, "required") as HTMLInputElement).checked,
        ...(options.length ? { options } : {}),
      };
    });
  }

  private readSlots(): VisualFragmentSlot[] {
    return Array.from(this.get("#fragment-slot-rows").querySelectorAll(".fragment-schema-row")).map((row) => {
      const number = (name: string): number | undefined => {
        const value = this.field(row, name).value;
        return value === "" ? undefined : Number(value);
      };
      const name = this.field(row, "name").value.trim();
      if (!name) throw new Error("组件插槽必须填写程序化名称。");
      const maxWidth = number("maxWidth");
      const maxHeight = number("maxHeight");
      const minWidth = number("minWidth");
      const minHeight = number("minHeight");
      const defaultContent = this.field(row, "default").value;
      const size = {
        ...(minWidth !== undefined ? { minWidth } : {}),
        ...(minHeight !== undefined ? { minHeight } : {}),
        ...(maxWidth !== undefined ? { maxWidth } : {}),
        ...(maxHeight !== undefined ? { maxHeight } : {}),
      };
      return {
        name,
        label: this.field(row, "label").value.trim() || name,
        target: this.field(row, "target").value,
        allowedElementTypes: this.field(row, "allowed").value.split(",").map((value) => value.trim()).filter(Boolean),
        ...(defaultContent ? { defaultContent } : {}),
        required: (this.field(row, "required") as HTMLInputElement).checked,
        multiple: (this.field(row, "multiple") as HTMLInputElement).checked,
        ...(minWidth !== undefined || minHeight !== undefined || maxWidth !== undefined || maxHeight !== undefined ? { size } : {}),
      };
    });
  }

  private async saveSelection(event: Event): Promise<void> {
    event.preventDefault();
    if ((event as SubmitEvent).submitter?.getAttribute("value") !== "default") {
      this.get<HTMLDialogElement>("#fragment-save-dialog").close();
      return;
    }
    const context = this.callbacks.getContext();
    try {
      const type = this.get<HTMLSelectElement>("#fragment-type").value as VisualFragmentType;
      const dialog = this.get<HTMLDialogElement>("#fragment-save-dialog");
      const fragment = extractVisualFragment(context.model, context.assets, context.sourcePath, context.selectionItems, {
        fragmentId: dialog.dataset.fragmentId || undefined,
        name: this.get<HTMLInputElement>("#fragment-name").value,
        description: this.get<HTMLTextAreaElement>("#fragment-description").value,
        fragmentType: type,
        saveMode: this.get<HTMLSelectElement>("#fragment-mode").value as "source-preserving" | "self-contained",
        category: this.get<HTMLInputElement>("#fragment-category").value,
        tags: this.get<HTMLInputElement>("#fragment-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
        version: this.get<HTMLInputElement>("#fragment-version").value,
        sourceProject: context.sourcePath,
        properties: ["component", "template"].includes(type) ? this.readProperties() : [],
        slots: ["component", "template"].includes(type) ? this.readSlots() : [],
      });
      await this.library.save(fragment);
      dialog.close();
      if (fragment.warnings.length) this.callbacks.notice(fragment.warnings.join(" "));
      this.callbacks.toast(`已保存 ${fragment.manifest.name} @ ${fragment.manifest.version}`);
      if (this.get<HTMLDialogElement>("#fragment-library-dialog").open) await this.renderLibrary();
    } catch (error) {
      this.callbacks.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  private async openLibrary(): Promise<void> {
    this.get<HTMLDialogElement>("#fragment-library-dialog").showModal();
    await this.renderLibrary();
  }

  private clearPreviewUrls(): void {
    this.previewUrls.forEach((url) => URL.revokeObjectURL(url));
    this.previewUrls.clear();
  }

  private async renderLibrary(): Promise<void> {
    const token = ++this.renderToken;
    const allRecords = await this.library.list();
    const categorySelect = this.get<HTMLSelectElement>("#fragment-category-filter");
    const selectedCategory = categorySelect.value;
    const categories = Array.from(new Set(allRecords.map((record) => record.manifest.category).filter(Boolean))).sort();
    categorySelect.innerHTML = `<option value="">全部分类</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
    categorySelect.value = categories.includes(selectedCategory) ? selectedCategory : "";
    const records = await this.library.list({
      search: this.get<HTMLInputElement>("#fragment-search").value,
      category: categorySelect.value || undefined,
      favoritesOnly: this.get<HTMLInputElement>("#fragment-favorite-filter").checked,
      recentFirst: this.get<HTMLInputElement>("#fragment-recent-filter").checked,
    });
    const packages = await Promise.all(records.map(async (record) => {
      try { return await decodeVisualFragmentPackage(record.packageBytes); } catch { return null; }
    }));
    if (token !== this.renderToken) return;
    this.clearPreviewUrls();
    this.get("#fragment-storage-status").textContent = this.library.persistent ? "IndexedDB 持久化存储" : "浏览器存储不可用：当前为会话内存库";
    const results = this.get("#fragment-library-results");
    if (!records.length) {
      results.innerHTML = `<div class="fragment-empty"><span>◇</span><strong>本地库为空</strong><p>选择画布元素并保存，或导入一个经过验证的 .vfrag 包。</p></div>`;
      return;
    }
    results.innerHTML = records.map((record, index) => `
      <article class="fragment-card" data-fragment-id="${escapeHtml(record.fragmentId)}" data-fragment-version="${escapeHtml(record.version)}">
        <div class="fragment-preview"><img data-fragment-preview="${index}" alt="${escapeHtml(record.manifest.name)} 预览" /></div>
        <div class="fragment-card-body">
          <div class="fragment-card-title"><div><strong>${escapeHtml(record.manifest.name)}</strong><span>${escapeHtml(record.manifest.fragmentType)} · ${escapeHtml(record.manifest.contentType)}</span></div><button data-fragment-action="favorite" title="收藏">${record.favorite ? "★" : "☆"}</button></div>
          <p>${escapeHtml(record.manifest.description || "无描述")}</p>
          <div class="fragment-card-meta"><span>${escapeHtml(record.manifest.category)}</span><span>v${escapeHtml(record.version)}</span><span>使用 ${record.useCount}</span><span title="${escapeHtml(record.manifest.provenance.sourceProject)}">来源 ${escapeHtml(record.manifest.provenance.sourceProject)}</span></div>
          <div class="fragment-tags">${record.manifest.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
          <div class="fragment-card-actions">
            <button data-fragment-action="insert-copy" class="button primary">插入副本</button>
            <button data-fragment-action="insert-linked">关联实例</button>
            <button data-fragment-action="inspect">检查</button>
            <button data-fragment-action="export">.vfrag</button>
            <button data-fragment-action="standard">标准格式</button>
            <button data-fragment-action="copy">复制源码</button>
            <button data-fragment-action="preview-svg">预览 SVG</button>
            <button data-fragment-action="preview-png">预览 PNG</button>
            <button data-fragment-action="update">从选区更新</button>
            <button data-fragment-action="sync">同步实例</button>
            <button data-fragment-action="delete" class="danger">删除版本</button>
          </div>
        </div>
      </article>`).join("");
    packages.forEach((fragment, index) => {
      if (!fragment) return;
      const url = URL.createObjectURL(new Blob([fragment.previewSvg], { type: "image/svg+xml" }));
      this.previewUrls.add(url);
      const image = results.querySelector<HTMLImageElement>(`[data-fragment-preview="${index}"]`);
      if (image) image.src = url;
    });
  }

  private selectedRecord(target: Element): { id: string; version: string } | null {
    const card = target.closest<HTMLElement>("[data-fragment-id][data-fragment-version]");
    return card?.dataset.fragmentId && card.dataset.fragmentVersion ? { id: card.dataset.fragmentId, version: card.dataset.fragmentVersion } : null;
  }

  private placement(): VisualFragmentPlacement {
    const mode = this.get<HTMLSelectElement>("#fragment-placement").value;
    if (mode === "original" || mode === "center") return { mode };
    if (mode === "cursor") return { mode: "point", ...this.callbacks.getContext().cursor };
    return {
      mode: "point",
      x: Number(this.get<HTMLInputElement>("#fragment-place-x").value),
      y: Number(this.get<HTMLInputElement>("#fragment-place-y").value),
    };
  }

  private async handleLibraryAction(event: Event): Promise<void> {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-fragment-action]");
    const identity = button ? this.selectedRecord(button) : null;
    if (!button || !identity) return;
    try {
      const record = await this.library.getRecord(identity.id, identity.version);
      const fragment = await this.library.get(identity.id, identity.version);
      if (!record || !fragment) throw new Error("视觉片段记录不存在或包已损坏。");
      switch (button.dataset.fragmentAction) {
        case "favorite":
          await this.library.setFavorite(identity.id, identity.version, !record.favorite);
          await this.renderLibrary();
          break;
        case "insert-copy":
        case "insert-linked":
          await this.insertFragment(fragment, button.dataset.fragmentAction === "insert-linked");
          await this.renderLibrary();
          break;
        case "inspect":
          await this.showInformation("Visual Fragment 检查", `<pre>${escapeHtml(JSON.stringify({ manifest: fragment.manifest, warnings: fragment.warnings }, null, 2))}</pre>`);
          break;
        case "export":
          downloadBlob(visualFragmentBlob(record.packageBytes), `${fileStem(fragment.manifest.name)}-${fragment.manifest.version}.vfrag`);
          break;
        case "standard":
          await this.exportStandard(fragment);
          break;
        case "copy":
          await copyText(this.standardSource(fragment));
          this.callbacks.toast(`已复制 ${fragment.manifest.contentType.toUpperCase()} 源码`);
          break;
        case "preview-svg":
          downloadText(fragment.previewSvg, `${fileStem(fragment.manifest.name)}-preview.svg`, "image/svg+xml");
          break;
        case "preview-png":
          await this.exportPreviewPng(fragment);
          break;
        case "update":
          this.openSaveDialog(record);
          break;
        case "sync":
          this.syncInstances(fragment);
          break;
        case "delete":
          if (window.confirm(`删除 ${fragment.manifest.name} @ ${fragment.manifest.version}？页面中的现有实例不会被删除。`)) {
            await this.library.delete(identity.id, identity.version);
            await this.renderLibrary();
          }
          break;
      }
    } catch (error) {
      this.callbacks.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  private async insertFragment(fragment: VisualFragmentPackage, linked: boolean): Promise<void> {
    const context = this.callbacks.getContext();
    if (!context.insertionParentId) throw new Error("当前页面没有可用的插入父元素。");
    const plan = planVisualFragmentInsert(context.model, context.assets, fragment, {
      parentId: context.insertionParentId,
      placement: this.placement(),
      linked,
      targetSourcePath: context.sourcePath,
    });
    const confirmed = await this.confirmCompatibility(plan.report);
    if (!confirmed) return;
    if (!plan.report.compatible) throw new Error(plan.report.errors.join("；"));
    const committed = this.callbacks.commit(`Insert fragment ${fragment.manifest.name}`, () => {
      const result = applyVisualFragmentInsertPlan(context.model, context.assets, plan);
      return result.rootEditorIds;
    });
    if (!committed) return;
    await this.library.markUsed(fragment.manifest.fragmentId, fragment.manifest.version);
    this.callbacks.toast(`已插入${linked ? "关联实例" : "独立副本"}：${fragment.manifest.name}`);
  }

  private async confirmCompatibility(report: VisualFragmentCompatibilityReport): Promise<boolean> {
    const sections: Array<[string, string]> = [
      ["结论", report.compatible ? "兼容，可插入" : "不兼容，已阻止插入"],
      ["ID 重映射", Object.entries(report.idRemaps).map(([from, to]) => `${from} → ${to}`).join("\n") || "无"],
      ["编辑器 ID 重映射", Object.entries(report.editorIdRemaps).map(([from, to]) => `${from} → ${to}`).join("\n") || "无"],
      ["CSS 冲突", report.cssConflicts.join("\n") || "无"],
      ["缺失字体", report.missingFonts.join("\n") || "无"],
      ["外部资源", report.externalResources.join("\n") || "无"],
      ["警告", report.warnings.join("\n") || "无"],
      ["错误", report.errors.join("\n") || "无"],
    ];
    const content = sections.map(([title, value]) => `<section><h3>${escapeHtml(title)}</h3><pre>${escapeHtml(value)}</pre></section>`).join("");
    const dialog = this.get<HTMLDialogElement>("#fragment-report-dialog");
    this.get("#fragment-report-title").textContent = "导入兼容性报告";
    this.get("#fragment-report-content").innerHTML = content;
    this.get<HTMLButtonElement>("#fragment-report-confirm").hidden = !report.compatible;
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true }));
  }

  private async showInformation(title: string, content: string): Promise<void> {
    const dialog = this.get<HTMLDialogElement>("#fragment-report-dialog");
    this.get("#fragment-report-title").textContent = title;
    this.get("#fragment-report-content").innerHTML = content;
    this.get<HTMLButtonElement>("#fragment-report-confirm").hidden = true;
    dialog.returnValue = "";
    dialog.showModal();
    await new Promise<void>((resolve) => dialog.addEventListener("close", () => resolve(), { once: true }));
  }

  private standardSource(fragment: VisualFragmentPackage): string {
    const content = inlinePackageAssets(fragment.content, fragment);
    const styles = inlinePackageAssets(fragment.styles, fragment);
    if (fragment.manifest.contentType === "html") return `<!doctype html>\n<html><head><meta charset="utf-8"><style>\n${styles}\n</style></head><body>\n${content}\n</body></html>\n`;
    return content.replace(/<svg([^>]*)>/i, `<svg$1><style><![CDATA[${styles.replaceAll("]]>", "]] >")}]]></style>`);
  }

  private async exportStandard(fragment: VisualFragmentPackage): Promise<void> {
    if (fragment.manifest.contentType === "svg") {
      downloadText(this.standardSource(fragment), `${fileStem(fragment.manifest.name)}.svg`, "image/svg+xml");
      return;
    }
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file("fragment.html", fragment.content);
    zip.file("styles.css", fragment.styles);
    for (const asset of fragment.assets) zip.file(asset.path, asset.bytes);
    downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), `${fileStem(fragment.manifest.name)}-html-css.zip`);
  }

  private async exportPreviewPng(fragment: VisualFragmentPackage): Promise<void> {
    const source = inlinePackageAssets(fragment.previewSvg, fragment);
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      const sourceWidth = Math.max(1, fragment.manifest.canvas.width);
      const sourceHeight = Math.max(1, fragment.manifest.canvas.height);
      const scale = Math.min(1, 4096 / sourceWidth, 4096 / sourceHeight, Math.sqrt(16_000_000 / (sourceWidth * sourceHeight)));
      canvas.width = Math.max(1, Math.ceil(sourceWidth * scale));
      canvas.height = Math.max(1, Math.ceil(sourceHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器不支持 Canvas 预览导出。");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const encode = (sourceCanvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
        try {
          sourceCanvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG 编码失败。")), "image/png");
        } catch (error) {
          reject(error);
        }
      });
      let blob: Blob;
      try {
        blob = await encode(canvas);
      } catch (error) {
        if (fragment.manifest.contentType !== "html" || !(error instanceof DOMException) || error.name !== "SecurityError") throw error;
        const fallback = document.createElement("canvas");
        fallback.width = canvas.width;
        fallback.height = canvas.height;
        this.drawHtmlPngFallback(fallback, fragment);
        blob = await encode(fallback);
        this.callbacks.notice("浏览器禁止把含 foreignObject 的 HTML 缩略图直接写入 PNG；本次 PNG 使用结构化文字与配色回退，SVG 预览仍保留完整视觉内容。");
      }
      downloadBlob(blob, `${fileStem(fragment.manifest.name)}-preview.png`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private drawHtmlPngFallback(canvas: HTMLCanvasElement, fragment: VisualFragmentPackage): void {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 Canvas 预览回退。");
    const scale = Math.max(0.5, Math.min(canvas.width, canvas.height) / 720);
    const padding = Math.max(18, Math.round(34 * scale));
    context.fillStyle = "#f7f9fc";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const colors = Array.from(new Set(Array.from(fragment.styles.matchAll(/#[0-9a-fA-F]{6}\b/g), (match) => match[0]))).slice(0, 6);
    const bandHeight = Math.max(8, Math.round(16 * scale));
    const bandWidth = canvas.width / Math.max(1, colors.length);
    (colors.length ? colors : ["#315efb"]).forEach((color, index) => {
      context.fillStyle = color;
      context.fillRect(index * bandWidth, 0, Math.ceil(bandWidth), bandHeight);
    });
    context.fillStyle = "#172033";
    context.font = `700 ${Math.max(16, Math.round(30 * scale))}px system-ui, sans-serif`;
    context.fillText(fragment.manifest.name, padding, padding + bandHeight + Math.round(20 * scale), canvas.width - padding * 2);
    context.fillStyle = "#667085";
    context.font = `600 ${Math.max(10, Math.round(14 * scale))}px system-ui, sans-serif`;
    context.fillText(`${fragment.manifest.fragmentType.toUpperCase()} · ${fragment.manifest.canvas.width.toFixed(0)} × ${fragment.manifest.canvas.height.toFixed(0)} · v${fragment.manifest.version}`, padding, padding + bandHeight + Math.round(48 * scale), canvas.width - padding * 2);
    const parsed = new DOMParser().parseFromString(fragment.content, "text/html");
    const text = (parsed.body.textContent ?? "").replace(/\s+/g, " ").trim();
    context.fillStyle = "#344054";
    context.font = `400 ${Math.max(11, Math.round(18 * scale))}px system-ui, sans-serif`;
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > canvas.width - padding * 2 && line) {
        lines.push(line);
        line = word;
        if (lines.length >= 6) break;
      } else line = candidate;
    }
    if (line && lines.length < 6) lines.push(line);
    const startY = padding + bandHeight + Math.round(84 * scale);
    const lineHeight = Math.max(16, Math.round(25 * scale));
    lines.forEach((value, index) => context.fillText(value, padding, startY + index * lineHeight, canvas.width - padding * 2));
    context.strokeStyle = "#d0d5dd";
    context.lineWidth = Math.max(1, scale);
    context.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  }

  private syncInstances(fragment: VisualFragmentPackage): void {
    const context = this.callbacks.getContext();
    let summary = { updated: 0, failed: 0, errors: [] as string[] };
    const committed = this.callbacks.commit(`Sync fragment ${fragment.manifest.name}`, () => {
      summary = syncLinkedVisualFragmentInstances(context.model, context.assets, fragment, context.sourcePath);
    });
    if (!committed) return;
    if (summary.errors.length) this.callbacks.notice(summary.errors.join(" "));
    this.callbacks.toast(`已同步 ${summary.updated} 个实例${summary.failed ? `，${summary.failed} 个失败` : ""}`, summary.failed > 0);
  }

  private async importPackage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const record = await this.library.importPackage(file);
      const fragment = await this.library.get(record.fragmentId, record.version);
      if (fragment?.warnings.length) this.callbacks.notice(fragment.warnings.join(" "));
      this.callbacks.toast(`已导入 ${record.manifest.name} @ ${record.version}`);
      await this.renderLibrary();
    } catch (error) {
      this.callbacks.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  private renderInstanceInspector(): void {
    this.host.querySelector("#fragment-instance-inspector")?.remove();
    const context = this.callbacks.getContext();
    if (context.selectedIds.length !== 1) return;
    const selected = context.model.find(context.selectedIds[0]!);
    const root = selected?.hasAttribute("data-vfrag-root") ? selected : selected?.closest("[data-vfrag-root]");
    const inspector = this.host.querySelector("#inspector-content");
    const rootId = root?.getAttribute("data-editor-id");
    if (!root || !rootId || !inspector) return;
    let properties: VisualFragmentProperty[] = [];
    let slots: VisualFragmentSlot[] = [];
    try { properties = JSON.parse(root.getAttribute("data-vfrag-property-schema") ?? "[]") as VisualFragmentProperty[]; } catch { /* shown as no properties */ }
    try { slots = JSON.parse(root.getAttribute("data-vfrag-slot-schema") ?? "[]") as VisualFragmentSlot[]; } catch { /* shown as no slots */ }
    const readValue = (property: VisualFragmentProperty): string | boolean => {
      const target = allElements(root).find((element) => element.getAttribute("data-vfrag-node-key") === property.target);
      if (!target) return "";
      if (property.binding.kind === "text") return target.textContent ?? "";
      if (property.binding.kind === "attribute") return property.type === "boolean" ? target.hasAttribute(property.binding.name) : target.getAttribute(property.binding.name) ?? "";
      return (target as HTMLElement | SVGElement).style.getPropertyValue(property.binding.name);
    };
    const fields = properties.map((property) => {
      const value = readValue(property);
      if (property.type === "boolean") return `<label class="checkbox"><input type="checkbox" data-fragment-property="${escapeHtml(property.name)}" data-fragment-root-id="${escapeHtml(rootId)}"${value ? " checked" : ""} />${escapeHtml(property.label)}</label>`;
      if (property.type === "enum") return `<label class="field"><span>${escapeHtml(property.label)}</span><select data-fragment-property="${escapeHtml(property.name)}" data-fragment-root-id="${escapeHtml(rootId)}">${property.options?.map((option) => `<option${option === value ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
      const type = property.type === "number" || property.type === "size" ? "number" : property.type === "color" ? "color" : "text";
      return `<label class="field"><span>${escapeHtml(property.label)}</span><input type="${type}" data-fragment-property="${escapeHtml(property.name)}" data-fragment-root-id="${escapeHtml(rootId)}" value="${escapeHtml(String(value))}" /></label>`;
    }).join("");
    const slotControls = slots.map((slot) => {
      const supported = slot.allowedElementTypes.length ? slot.allowedElementTypes : ["text", "image", "rect", "circle", "group", "container"];
      return `<div class="fragment-slot-control" data-fragment-slot-control>
        <strong>${escapeHtml(slot.label)}</strong>
        <select data-fragment-slot-type>${supported.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}</select>
        <input data-fragment-slot-value placeholder="文字、图片 URL 或颜色" />
        <button data-fragment-instance-action="insert-slot" data-fragment-slot="${escapeHtml(slot.name)}" data-fragment-root-id="${escapeHtml(rootId)}">插入</button>
      </div>`;
    }).join("");
    inspector.insertAdjacentHTML("afterbegin", `<section id="fragment-instance-inspector" class="inspector-section fragment-instance-inspector">
      <div class="section-title-row"><h3>组件实例</h3><span>${escapeHtml(root.getAttribute("data-vfrag-linked") === "true" ? "关联" : "独立")}</span></div>
      <small>${escapeHtml(root.getAttribute("data-vfrag-definition-id") ?? "")} @ ${escapeHtml(root.getAttribute("data-vfrag-definition-version") ?? "")}</small>
      ${fields || "<p>此片段没有暴露组件属性。</p>"}
      ${slotControls ? `<div class="fragment-slot-controls"><h4>内容插槽</h4>${slotControls}</div>` : ""}
      <div class="fragment-instance-actions"><button data-fragment-instance-action="sync" data-fragment-root-id="${escapeHtml(rootId)}">同步最新版</button><button data-fragment-instance-action="unlink" data-fragment-root-id="${escapeHtml(rootId)}"${root.getAttribute("data-vfrag-linked") === "true" ? "" : " disabled"}>解除关联</button></div>
    </section>`);
  }

  private handleInstancePropertyChange(event: Event): void {
    const input = (event.target as Element).closest<HTMLInputElement | HTMLSelectElement>("[data-fragment-property][data-fragment-root-id]");
    if (!input?.dataset.fragmentProperty || !input.dataset.fragmentRootId) return;
    const value = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked
      : input instanceof HTMLInputElement && input.type === "number" ? Number(input.value)
        : input.value;
    const context = this.callbacks.getContext();
    this.callbacks.commit(`Update component property ${input.dataset.fragmentProperty}`, () => {
      context.model.apply({ action: "updateComponentProperties", elementId: input.dataset.fragmentRootId!, properties: { [input.dataset.fragmentProperty!]: value } });
      return [input.dataset.fragmentRootId!];
    });
  }

  private async handleInstanceAction(event: Event): Promise<void> {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-fragment-instance-action][data-fragment-root-id]");
    if (!button?.dataset.fragmentRootId) return;
    const context = this.callbacks.getContext();
    const root = context.model.find(button.dataset.fragmentRootId);
    if (!root) return;
    if (button.dataset.fragmentInstanceAction === "insert-slot") {
      const control = button.closest<HTMLElement>("[data-fragment-slot-control]");
      const slot = button.dataset.fragmentSlot;
      const requestedType = control?.querySelector<HTMLSelectElement>("[data-fragment-slot-type]")?.value;
      const value = control?.querySelector<HTMLInputElement>("[data-fragment-slot-value]")?.value ?? "";
      if (!slot || !requestedType) return;
      const textTags = new Set(["text", "span", "p", "label", "button", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tspan"]);
      const type: NewElementSpec["type"] = textTags.has(requestedType) ? "text"
        : ["image", "img"].includes(requestedType) ? "image"
          : requestedType === "rect" ? "rect"
            : requestedType === "circle" ? "circle"
              : requestedType === "group" || requestedType === "g" ? "group" : "container";
      const element: NewElementSpec = {
        type,
        ...(requestedType !== type ? { tag: requestedType } : {}),
        ...(type === "text" ? { text: value || "New content" } : {}),
        ...(type === "image" ? { src: value, width: 160, height: 90 } : {}),
        ...(type === "rect" || type === "circle" ? { fill: value || "#5b8cff", width: 120, height: 80 } : {}),
        x: 0,
        y: 0,
      };
      this.callbacks.commit(`Insert into component slot ${slot}`, () => {
        const result = context.model.apply({ action: "insertIntoComponentSlot", elementId: button.dataset.fragmentRootId!, slot, element });
        return result.createdId ? [result.createdId] : [button.dataset.fragmentRootId!];
      });
      return;
    }
    if (button.dataset.fragmentInstanceAction === "unlink") {
      this.callbacks.commit("Unlink component instance", () => {
        context.model.apply({ action: "unlinkComponentInstance", elementId: button.dataset.fragmentRootId! });
        return [button.dataset.fragmentRootId!];
      });
      return;
    }
    const definitionId = root.getAttribute("data-vfrag-definition-id");
    if (!definitionId) return;
    try {
      const fragment = await this.library.get(definitionId);
      if (!fragment) throw new Error(`本地库中没有组件定义：${definitionId}`);
      this.syncInstances(fragment);
    } catch (error) {
      this.callbacks.toast(error instanceof Error ? error.message : String(error), true);
    }
  }
}
