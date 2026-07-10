import Moveable from "moveable";
import type { OnDrag, OnDragGroup, OnResize, OnRotate } from "moveable";
import {
  getTransformValues,
  renderEditorTransform,
  setElementRotation,
  setElementScale,
  setElementSize,
  setElementTranslation,
} from "../core/commands";
import type { DocumentKind, TransformValues } from "../core/types";
import type { CanvasRenderer } from "./renderer";

export interface TransformCallbacks {
  onStart: (label: string) => void;
  onChange: () => void;
  onEnd: (label: string) => void;
}

function idOf(element: Element): string | null {
  return element.getAttribute("data-editor-id");
}

function canUseNativeSize(element: Element, kind: DocumentKind): boolean {
  return kind === "html" || ["rect", "image", "svg", "circle", "ellipse"].includes(element.localName);
}

export class TransformController {
  readonly moveable: Moveable;
  private selectedIds: string[] = [];
  private kind: DocumentKind = "html";
  private resizeStart = new Map<string, { bounds: { width: number; height: number }; transform: TransformValues }>();

  constructor(
    container: HTMLElement,
    private readonly renderer: CanvasRenderer,
    private readonly callbacks: TransformCallbacks,
  ) {
    this.moveable = new Moveable(container, {
      target: null,
      draggable: true,
      resizable: true,
      rotatable: true,
      scalable: false,
      keepRatio: false,
      origin: false,
      snappable: true,
      snapDirections: true,
      elementSnapDirections: true,
      snapThreshold: 6,
      throttleDrag: 0,
      throttleResize: 0,
      throttleRotate: 0,
    });
    this.installEvents();
  }

  setDocumentKind(kind: DocumentKind): void {
    this.kind = kind;
  }

  setSelection(ids: string[]): void {
    this.selectedIds = ids;
    const targets = ids
      .map((id) => this.renderer.element(id))
      .filter((element): element is HTMLElement | SVGElement => Boolean(element))
      .filter((element) => element.getAttribute("data-editor-locked") !== "true");
    this.moveable.target = targets.length === 0 ? null : targets.length === 1 ? targets[0]! : targets;
    this.moveable.resizable = targets.length <= 1;
    this.moveable.rotatable = targets.length <= 1;
    this.moveable.updateRect();
  }

  setZoom(zoom: number): void {
    // The control layer lives inside the same transformed canvas as the target.
    // Counter-scale only the handles so they remain usable on a zoomed-out page.
    this.moveable.zoom = 1 / Math.max(zoom, 0.01);
    this.moveable.updateRect();
  }

  setKeepRatio(keepRatio: boolean): void {
    this.moveable.keepRatio = keepRatio;
  }

  update(): void {
    this.moveable.updateRect();
  }

  destroy(): void {
    this.moveable.destroy();
  }

  private bothTargets(preview: Element): Element[] {
    const id = idOf(preview);
    const model = id ? this.renderer.modelElement(id) : null;
    return model ? [preview, model] : [preview];
  }

  private installEvents(): void {
    this.moveable.on("dragStart", (event) => {
      const transform = getTransformValues(event.target);
      event.set([transform.x, transform.y]);
      this.callbacks.onStart("Move element");
    });
    this.moveable.on("drag", (event: OnDrag) => {
      for (const target of this.bothTargets(event.target)) {
        setElementTranslation(target, this.kind, event.beforeTranslate[0] ?? 0, event.beforeTranslate[1] ?? 0);
      }
      this.callbacks.onChange();
    });
    this.moveable.on("dragEnd", () => this.callbacks.onEnd("Move element"));

    this.moveable.on("dragGroupStart", (event) => {
      event.events.forEach((child) => {
        const transform = getTransformValues(child.target);
        child.set([transform.x, transform.y]);
      });
      this.callbacks.onStart("Move elements");
    });
    this.moveable.on("dragGroup", (event: OnDragGroup) => {
      event.events.forEach((child) => {
        for (const target of this.bothTargets(child.target)) {
          setElementTranslation(target, this.kind, child.beforeTranslate[0] ?? 0, child.beforeTranslate[1] ?? 0);
        }
      });
      this.callbacks.onChange();
    });
    this.moveable.on("dragGroupEnd", () => this.callbacks.onEnd("Move elements"));

    this.moveable.on("resizeStart", (event) => {
      const id = idOf(event.target);
      if (id) {
        const bounds = this.renderer.bounds(id) ?? { width: event.target.clientWidth, height: event.target.clientHeight, x: 0, y: 0 };
        this.resizeStart.set(id, { bounds, transform: getTransformValues(event.target) });
      }
      const transform = getTransformValues(event.target);
      if (event.dragStart) event.dragStart.set([transform.x, transform.y]);
      this.callbacks.onStart("Resize element");
    });
    this.moveable.on("resize", (event: OnResize) => {
      const id = idOf(event.target);
      const start = id ? this.resizeStart.get(id) : undefined;
      for (const target of this.bothTargets(event.target)) {
        if (canUseNativeSize(target, this.kind)) {
          setElementSize(target, this.kind, event.width, event.height);
        } else if (start) {
          const scaleX = start.transform.scaleX * event.width / Math.max(1, start.bounds.width);
          const scaleY = start.transform.scaleY * event.height / Math.max(1, start.bounds.height);
          setElementScale(target, this.kind, scaleX, scaleY);
        }
        setElementTranslation(target, this.kind, event.drag.beforeTranslate[0] ?? 0, event.drag.beforeTranslate[1] ?? 0);
      }
      this.callbacks.onChange();
    });
    this.moveable.on("resizeEnd", () => {
      this.resizeStart.clear();
      this.callbacks.onEnd("Resize element");
    });

    this.moveable.on("rotateStart", (event) => {
      const transform = getTransformValues(event.target);
      event.set(transform.rotation);
      if (event.dragStart) event.dragStart.set([transform.x, transform.y]);
      this.callbacks.onStart("Rotate element");
    });
    this.moveable.on("rotate", (event: OnRotate) => {
      for (const target of this.bothTargets(event.target)) {
        setElementRotation(target, this.kind, event.beforeRotate);
        if (event.drag) setElementTranslation(target, this.kind, event.drag.beforeTranslate[0] ?? 0, event.drag.beforeTranslate[1] ?? 0);
      }
      this.callbacks.onChange();
    });
    this.moveable.on("rotateEnd", () => this.callbacks.onEnd("Rotate element"));
  }
}
