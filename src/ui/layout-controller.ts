type LayoutRegion = "layers" | "inspector" | "pages" | "build";

interface LayoutState {
  layersWidth: number;
  inspectorWidth: number;
  pagesHeight: number;
  buildHeight: number;
  layersCollapsed: boolean;
  inspectorCollapsed: boolean;
  pagesCollapsed: boolean;
}

interface LayoutControllerOptions {
  onLayoutChange?: (canvasGeometryChanged: boolean) => void;
  localize?: (message: string) => string;
}

const STORAGE_KEY = "last-mile-studio:layout:v1";
const CHEVRON_ICON = `<svg class="ui-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.25 3.5 3.5 3.5-3.5"/></svg>`;
const COLLAPSED_RAIL = 32;
const MIN_CANVAS_WIDTH = 360;
const LIMITS = {
  layers: { min: 180, max: 480 },
  inspector: { min: 240, max: 560 },
  pages: { min: 92, max: 300 },
  build: { min: 140 },
  properties: { min: 120 },
} as const;

const DEFAULT_STATE: LayoutState = {
  layersWidth: 240,
  inspectorWidth: 288,
  pagesHeight: 124,
  buildHeight: 300,
  layersCollapsed: false,
  inspectorCollapsed: false,
  pagesCollapsed: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), Math.max(min, max));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export class EditorLayoutController {
  private state = this.restore();
  private frame = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: LayoutControllerOptions = {},
  ) {
    this.bindResizers();
    this.bindToggles();
    this.apply();
  }

  refreshLocale(): void {
    this.updateToggle("layers", this.state.layersCollapsed, this.state.layersCollapsed ? "right" : "left");
    this.updateToggle("inspector", this.state.inspectorCollapsed, this.state.inspectorCollapsed ? "left" : "right");
    this.updateToggle("pages", this.state.pagesCollapsed, this.state.pagesCollapsed ? "down" : "up");
  }

  private get<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Layout element not found: ${selector}`);
    return element;
  }

  private restore(): LayoutState {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<LayoutState> | null;
      if (!saved || typeof saved !== "object") return { ...DEFAULT_STATE };
      return {
        layersWidth: clamp(finite(saved.layersWidth, DEFAULT_STATE.layersWidth), LIMITS.layers.min, LIMITS.layers.max),
        inspectorWidth: clamp(finite(saved.inspectorWidth, DEFAULT_STATE.inspectorWidth), LIMITS.inspector.min, LIMITS.inspector.max),
        pagesHeight: clamp(finite(saved.pagesHeight, DEFAULT_STATE.pagesHeight), LIMITS.pages.min, LIMITS.pages.max),
        buildHeight: Math.max(LIMITS.build.min, Math.round(finite(saved.buildHeight, DEFAULT_STATE.buildHeight))),
        layersCollapsed: saved.layersCollapsed === true,
        inspectorCollapsed: saved.inspectorCollapsed === true,
        pagesCollapsed: saved.pagesCollapsed === true,
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // The editor remains fully usable when browser storage is unavailable.
    }
  }

  private bindToggles(): void {
    this.host.querySelectorAll<HTMLButtonElement>("[data-layout-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const region = button.dataset.layoutToggle as LayoutRegion;
        if (region === "layers") this.state.layersCollapsed = !this.state.layersCollapsed;
        else if (region === "inspector") this.state.inspectorCollapsed = !this.state.inspectorCollapsed;
        else if (region === "pages") this.state.pagesCollapsed = !this.state.pagesCollapsed;
        this.apply(region);
        this.persist();
      });
    });
  }

  private bindResizers(): void {
    this.host.querySelectorAll<HTMLElement>("[data-layout-resizer]").forEach((resizer) => {
      const region = resizer.dataset.layoutResizer as LayoutRegion;
      resizer.addEventListener("pointerdown", (event) => this.beginResize(event, region, resizer));
      resizer.addEventListener("keydown", (event) => this.resizeWithKeyboard(event, region));
    });
  }

  private beginResize(event: PointerEvent, region: LayoutRegion, resizer: HTMLElement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    document.documentElement.classList.add(region === "layers" || region === "inspector"
      ? "is-resizing-columns"
      : "is-resizing-rows");

    const startY = event.clientY;
    const initialPagesHeight = this.state.pagesHeight;
    const move = (moveEvent: PointerEvent): void => {
      if (region === "pages") {
        this.state.pagesCollapsed = false;
        this.state.pagesHeight = clamp(initialPagesHeight + moveEvent.clientY - startY, LIMITS.pages.min, LIMITS.pages.max);
      } else {
        this.resizeFromPointer(region, moveEvent.clientX, moveEvent.clientY);
      }
      this.apply(region);
    };
    const finish = (): void => {
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", finish);
      resizer.removeEventListener("pointercancel", finish);
      document.documentElement.classList.remove("is-resizing-columns", "is-resizing-rows");
      this.persist();
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", finish, { once: true });
    resizer.addEventListener("pointercancel", finish, { once: true });
  }

  private resizeFromPointer(region: LayoutRegion, clientX: number, clientY: number): void {
    const workspace = this.get<HTMLElement>(".workspace");
    const workspaceRect = workspace.getBoundingClientRect();
    const railWidth = this.get<HTMLElement>(".activity-rail").clientWidth;
    if (region === "layers") {
      this.state.layersCollapsed = false;
      const inspectorWidth = this.state.inspectorCollapsed ? COLLAPSED_RAIL : this.state.inspectorWidth;
      const max = Math.min(LIMITS.layers.max, workspaceRect.width - railWidth - inspectorWidth - MIN_CANVAS_WIDTH);
      this.state.layersWidth = clamp(clientX - workspaceRect.left - railWidth, LIMITS.layers.min, max);
    } else if (region === "inspector") {
      this.state.inspectorCollapsed = false;
      const layersWidth = this.state.layersCollapsed ? COLLAPSED_RAIL : this.state.layersWidth;
      const max = Math.min(LIMITS.inspector.max, workspaceRect.width - railWidth - layersWidth - MIN_CANVAS_WIDTH);
      this.state.inspectorWidth = clamp(workspaceRect.right - clientX, LIMITS.inspector.min, max);
    } else if (region === "pages") {
      this.state.pagesCollapsed = false;
      const canvasPanel = this.get<HTMLElement>(".canvas-panel");
      const toolbarBottom = this.get<HTMLElement>(".canvas-toolbar").getBoundingClientRect().bottom;
      const max = Math.min(LIMITS.pages.max, canvasPanel.clientHeight - 140);
      this.state.pagesHeight = clamp(clientY - toolbarBottom, LIMITS.pages.min, max);
    } else {
      const inspector = this.get<HTMLElement>(".inspector-panel");
      const headingBottom = inspector.querySelector<HTMLElement>(":scope > .panel-heading")!.getBoundingClientRect().bottom;
      const max = inspector.getBoundingClientRect().bottom - headingBottom - LIMITS.properties.min - 7;
      this.state.buildHeight = clamp(clientY - headingBottom, LIMITS.build.min, max);
    }
  }

  private resizeWithKeyboard(event: KeyboardEvent, region: LayoutRegion): void {
    const step = event.shiftKey ? 32 : 10;
    let delta = 0;
    if (event.key === "ArrowLeft") delta = -step;
    else if (event.key === "ArrowRight") delta = step;
    else if (event.key === "ArrowUp") delta = -step;
    else if (event.key === "ArrowDown") delta = step;
    else return;
    event.preventDefault();

    if (region === "layers" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      this.state.layersCollapsed = false;
      const workspaceWidth = this.get<HTMLElement>(".workspace").clientWidth;
      const railWidth = this.get<HTMLElement>(".activity-rail").clientWidth;
      const inspectorWidth = this.state.inspectorCollapsed ? COLLAPSED_RAIL : this.state.inspectorWidth;
      const max = Math.min(LIMITS.layers.max, workspaceWidth - railWidth - inspectorWidth - MIN_CANVAS_WIDTH);
      this.state.layersWidth = clamp(this.state.layersWidth + delta, LIMITS.layers.min, max);
    } else if (region === "inspector" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      this.state.inspectorCollapsed = false;
      const workspaceWidth = this.get<HTMLElement>(".workspace").clientWidth;
      const railWidth = this.get<HTMLElement>(".activity-rail").clientWidth;
      const layersWidth = this.state.layersCollapsed ? COLLAPSED_RAIL : this.state.layersWidth;
      const max = Math.min(LIMITS.inspector.max, workspaceWidth - railWidth - layersWidth - MIN_CANVAS_WIDTH);
      this.state.inspectorWidth = clamp(this.state.inspectorWidth - delta, LIMITS.inspector.min, max);
    } else if (region === "pages" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      this.state.pagesCollapsed = false;
      this.state.pagesHeight = clamp(this.state.pagesHeight + delta, LIMITS.pages.min, LIMITS.pages.max);
    } else if (region === "build" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const inspector = this.get<HTMLElement>(".inspector-panel");
      const headingHeight = inspector.querySelector<HTMLElement>(":scope > .panel-heading")!.clientHeight;
      const max = inspector.clientHeight - headingHeight - LIMITS.properties.min - 7;
      this.state.buildHeight = clamp(this.state.buildHeight + delta, LIMITS.build.min, max);
    } else {
      return;
    }
    this.apply(region);
    this.persist();
  }

  private apply(region?: LayoutRegion): void {
    const workspace = this.get<HTMLElement>(".workspace");
    const canvasPanel = this.get<HTMLElement>(".canvas-panel");
    const inspector = this.get<HTMLElement>(".inspector-panel");
    const pagesPanel = this.get<HTMLElement>("#page-filmstrip");
    const layersWidth = this.state.layersCollapsed ? COLLAPSED_RAIL : this.state.layersWidth;
    const inspectorWidth = this.state.inspectorCollapsed ? COLLAPSED_RAIL : this.state.inspectorWidth;
    const pagesHeight = this.state.pagesCollapsed ? COLLAPSED_RAIL : this.state.pagesHeight;

    workspace.style.setProperty("--layers-panel-width", `${layersWidth}px`);
    workspace.style.setProperty("--inspector-panel-width", `${inspectorWidth}px`);
    pagesPanel.style.setProperty("--pages-panel-height", `${pagesHeight}px`);
    inspector.style.setProperty("--build-panel-height", `${this.state.buildHeight}px`);
    workspace.classList.toggle("is-layers-collapsed", this.state.layersCollapsed);
    workspace.classList.toggle("is-inspector-collapsed", this.state.inspectorCollapsed);
    canvasPanel.classList.toggle("is-pages-collapsed", this.state.pagesCollapsed);
    pagesPanel.classList.toggle("is-collapsed", this.state.pagesCollapsed);

    this.updateToggle("layers", this.state.layersCollapsed, this.state.layersCollapsed ? "right" : "left");
    this.updateToggle("inspector", this.state.inspectorCollapsed, this.state.inspectorCollapsed ? "left" : "right");
    this.updateToggle("pages", this.state.pagesCollapsed, this.state.pagesCollapsed ? "down" : "up");
    this.updateSeparator("layers", layersWidth, LIMITS.layers.min, LIMITS.layers.max);
    this.updateSeparator("inspector", inspectorWidth, LIMITS.inspector.min, LIMITS.inspector.max);
    this.updateSeparator("pages", pagesHeight, LIMITS.pages.min, LIMITS.pages.max);
    this.updateSeparator("build", this.state.buildHeight, LIMITS.build.min, Math.max(LIMITS.build.min, inspector.clientHeight));
    this.notifyLayoutChange(region !== "build");
  }

  private updateToggle(region: LayoutRegion, collapsed: boolean, direction: "up" | "right" | "down" | "left"): void {
    const button = this.get<HTMLButtonElement>(`[data-layout-toggle="${region}"]`);
    button.innerHTML = CHEVRON_ICON;
    button.dataset.chevronDirection = direction;
    button.setAttribute("aria-expanded", String(!collapsed));
    button.title = this.options.localize?.(collapsed ? "展开面板" : "折叠面板") ?? (collapsed ? "展开面板" : "折叠面板");
  }

  private updateSeparator(region: LayoutRegion, value: number, min: number, max: number): void {
    const separator = this.get<HTMLElement>(`[data-layout-resizer="${region}"]`);
    separator.setAttribute("aria-valuenow", String(Math.round(value)));
    separator.setAttribute("aria-valuemin", String(min));
    separator.setAttribute("aria-valuemax", String(Math.round(max)));
  }

  private notifyLayoutChange(canvasGeometryChanged: boolean): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.options.onLayoutChange?.(canvasGeometryChanged));
  }
}
