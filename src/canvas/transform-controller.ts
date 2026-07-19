import Moveable from "moveable";
import type { OnDrag, OnDragGroup, OnResize, OnRotate } from "moveable";
import {
  getTransformValues,
  setElementRotation,
  setElementScale,
  setElementScaleOrigin,
  setElementSize,
  setElementTranslation,
} from "../core/commands";
import type { DocumentKind, TransformValues } from "../core/types";
import type { CanvasRenderer } from "./renderer";

export interface TransformCallbacks {
  onStart: (label: string) => void;
  onChange: () => void;
  onEnd: (label: string) => void;
  canStartDrag?: () => boolean;
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
  private dragGesture: { startX: number; startY: number; activated: boolean } | null = null;
  private readonly dragThresholdPx = 4;
  private resizeStart = new Map<string, {
    bounds: { width: number; height: number };
    transform: TransformValues;
    scaleOrigin?: { x: number; y: number };
  }>();

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: CanvasRenderer,
    private readonly callbacks: TransformCallbacks,
  ) {
    this.moveable = new Moveable(this.container, {
      target: null,
      draggable: true,
      edgeDraggable: true,
      dragArea: false,
      passDragArea: false,
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
    this.container.addEventListener("mousedown", this.beginMoveableTargetDrag, { capture: true });
    this.container.addEventListener("pointerdown", this.beginGenericSvgResize, { capture: true });
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
    if (targets.length === 0) {
      this.moveable.setState({ target: null }, () => this.moveable.updateRect());
      return;
    }
    const singleTarget = targets.length === 1 ? targets[0]! : null;
    this.moveable.setState({
      target: singleTarget ?? targets,
      resizable: Boolean(singleTarget),
      scalable: false,
      rotatable: Boolean(singleTarget),
      // A fragment root usually contains editable descendants that otherwise
      // win hit testing before Moveable can start a drag. While the root is
      // selected, give it an explicit drag surface; descendants remain
      // reachable through the layer tree and child-navigation controls.
      dragArea: Boolean(singleTarget?.hasAttribute("data-vfrag-root")),
      passDragArea: false,
    }, () => this.moveable.updateRect());
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
    this.container.removeEventListener("mousedown", this.beginMoveableTargetDrag, { capture: true });
    this.container.removeEventListener("pointerdown", this.beginGenericSvgResize, { capture: true });
    this.moveable.destroy();
  }

  private beginMoveableTargetDrag = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const editableTarget = event.composedPath().find((node) => node instanceof Element && node.hasAttribute("data-editor-id"));
    if (editableTarget instanceof Element) this.moveable.dragStart(event, editableTarget);
  };

  private bothTargets(preview: Element): Element[] {
    const id = idOf(preview);
    const model = id ? this.renderer.modelElement(id) : null;
    return model ? [preview, model] : [preview];
  }

  private kindOf(element: Element): DocumentKind {
    return element.namespaceURI === "http://www.w3.org/2000/svg" ? "svg" : this.kind;
  }

  private beginGenericSvgResize = (event: PointerEvent): void => {
    if (this.selectedIds.length !== 1 || event.button !== 0) return;
    const handle = (event.target as Element | null)?.closest<HTMLElement>(".moveable-control.moveable-direction");
    if (!handle) return;
    const directionName = Array.from(handle.classList)
      .map((className) => className.match(/^moveable-(n|ne|e|se|s|sw|w|nw)$/)?.[1])
      .find(Boolean);
    if (!directionName) return;
    const id = this.selectedIds[0]!;
    const preview = this.renderer.element(id);
    if (!preview || this.kindOf(preview) !== "svg" || canUseNativeSize(preview, "svg") || !("getBBox" in preview)) return;
    const bounds = this.renderer.bounds(id);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const directionX = directionName.includes("e") ? 1 : directionName.includes("w") ? -1 : 0;
    const directionY = directionName.includes("s") ? 1 : directionName.includes("n") ? -1 : 0;
    const box = (preview as SVGGraphicsElement).getBBox();
    const scaleOrigin = {
      x: directionX > 0 ? box.x : directionX < 0 ? box.x + box.width : box.x + box.width / 2,
      y: directionY > 0 ? box.y : directionY < 0 ? box.y + box.height : box.y + box.height / 2,
    };
    const transform = getTransformValues(preview);
    const hostRect = this.renderer.host.getBoundingClientRect();
    const screenScaleX = hostRect.width / Math.max(1, this.renderer.host.offsetWidth);
    const screenScaleY = hostRect.height / Math.max(1, this.renderer.host.offsetHeight);
    const start = { x: event.clientX, y: event.clientY };
    const ratio = bounds.width / bounds.height;
    const keepRatio = Boolean(this.moveable.keepRatio);
    this.callbacks.onStart("Scale element");

    const onMove = (moveEvent: PointerEvent): void => {
      moveEvent.preventDefault();
      let width = directionX === 0
        ? bounds.width
        : Math.max(1, bounds.width + (moveEvent.clientX - start.x) / Math.max(screenScaleX, 0.001) * directionX);
      let height = directionY === 0
        ? bounds.height
        : Math.max(1, bounds.height + (moveEvent.clientY - start.y) / Math.max(screenScaleY, 0.001) * directionY);
      if (keepRatio) {
        const widthChange = Math.abs(width / bounds.width - 1);
        const heightChange = Math.abs(height / bounds.height - 1);
        if (directionY === 0 || widthChange >= heightChange) height = width / ratio;
        else width = height * ratio;
      }
      for (const target of this.bothTargets(preview)) {
        setElementScaleOrigin(target, scaleOrigin.x, scaleOrigin.y);
        setElementScale(
          target,
          this.kindOf(target),
          transform.scaleX * width / bounds.width,
          transform.scaleY * height / bounds.height,
        );
      }
      this.moveable.updateRect();
      this.callbacks.onChange();
    };
    const finish = (): void => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      this.callbacks.onEnd("Scale element");
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", finish, { once: true });
    handle.addEventListener("pointercancel", finish, { once: true });
    handle.setPointerCapture(event.pointerId);
  };

  private installEvents(): void {
    this.moveable.on("dragStart", (event) => {
      if (this.callbacks.canStartDrag && !this.callbacks.canStartDrag()) {
        this.dragGesture = null;
        event.stopDrag();
        return;
      }
      this.dragGesture = { startX: event.clientX, startY: event.clientY, activated: false };
      const transform = getTransformValues(event.target);
      event.set([transform.x, transform.y]);
    });
    this.moveable.on("drag", (event: OnDrag) => {
      if (!this.activateDragGesture(event.clientX, event.clientY, "Move element")) return;
      for (const target of this.bothTargets(event.target)) {
        setElementTranslation(target, this.kindOf(target), event.beforeTranslate[0] ?? 0, event.beforeTranslate[1] ?? 0);
      }
      this.callbacks.onChange();
    });
    this.moveable.on("dragEnd", () => this.finishDragGesture("Move element"));

    this.moveable.on("dragGroupStart", (event) => {
      if (this.callbacks.canStartDrag && !this.callbacks.canStartDrag()) {
        this.dragGesture = null;
        event.stopDrag();
        return;
      }
      this.dragGesture = { startX: event.clientX, startY: event.clientY, activated: false };
      event.events.forEach((child) => {
        const transform = getTransformValues(child.target);
        child.set([transform.x, transform.y]);
      });
    });
    this.moveable.on("dragGroup", (event: OnDragGroup) => {
      if (!this.activateDragGesture(event.clientX, event.clientY, "Move elements")) return;
      event.events.forEach((child) => {
        for (const target of this.bothTargets(child.target)) {
          setElementTranslation(target, this.kindOf(target), child.beforeTranslate[0] ?? 0, child.beforeTranslate[1] ?? 0);
        }
      });
      this.callbacks.onChange();
    });
    this.moveable.on("dragGroupEnd", () => this.finishDragGesture("Move elements"));

    this.moveable.on("resizeStart", (event) => {
      const id = idOf(event.target);
      if (id) {
        const bounds = this.renderer.bounds(id) ?? { width: event.target.clientWidth, height: event.target.clientHeight, x: 0, y: 0 };
        let scaleOrigin: { x: number; y: number } | undefined;
        if (!canUseNativeSize(event.target, this.kindOf(event.target)) && "getBBox" in event.target) {
          const box = (event.target as SVGGraphicsElement).getBBox();
          const direction = event.direction;
          const directionX = direction[0] ?? 0;
          const directionY = direction[1] ?? 0;
          scaleOrigin = {
            x: directionX > 0 ? box.x : directionX < 0 ? box.x + box.width : box.x + box.width / 2,
            y: directionY > 0 ? box.y : directionY < 0 ? box.y + box.height : box.y + box.height / 2,
          };
        }
        this.resizeStart.set(id, { bounds, transform: getTransformValues(event.target), scaleOrigin });
      }
      const transform = getTransformValues(event.target);
      if (canUseNativeSize(event.target, this.kindOf(event.target)) && event.dragStart) event.dragStart.set([transform.x, transform.y]);
      this.callbacks.onStart("Resize element");
    });
    this.moveable.on("resize", (event: OnResize) => {
      const id = idOf(event.target);
      const start = id ? this.resizeStart.get(id) : undefined;
      for (const target of this.bothTargets(event.target)) {
        const targetKind = this.kindOf(target);
        if (canUseNativeSize(target, targetKind)) {
          setElementSize(target, targetKind, event.width, event.height);
        } else if (start) {
          if (start.scaleOrigin) setElementScaleOrigin(target, start.scaleOrigin.x, start.scaleOrigin.y);
          const scaleX = start.transform.scaleX * event.width / Math.max(1, start.bounds.width);
          const scaleY = start.transform.scaleY * event.height / Math.max(1, start.bounds.height);
          setElementScale(target, targetKind, scaleX, scaleY);
        }
        if (canUseNativeSize(event.target, this.kindOf(event.target))) {
          setElementTranslation(target, targetKind, event.drag.beforeTranslate[0] ?? 0, event.drag.beforeTranslate[1] ?? 0);
        }
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
        const targetKind = this.kindOf(target);
        setElementRotation(target, targetKind, event.beforeRotate);
        if (event.drag) setElementTranslation(target, targetKind, event.drag.beforeTranslate[0] ?? 0, event.drag.beforeTranslate[1] ?? 0);
      }
      this.callbacks.onChange();
    });
    this.moveable.on("rotateEnd", () => this.callbacks.onEnd("Rotate element"));
  }

  private activateDragGesture(clientX: number, clientY: number, label: string): boolean {
    const gesture = this.dragGesture;
    if (!gesture) return false;
    if (!gesture.activated) {
      if (Math.hypot(clientX - gesture.startX, clientY - gesture.startY) < this.dragThresholdPx) return false;
      gesture.activated = true;
      this.callbacks.onStart(label);
    }
    return true;
  }

  private finishDragGesture(label: string): void {
    const changed = Boolean(this.dragGesture?.activated);
    this.dragGesture = null;
    if (changed) this.callbacks.onEnd(label);
  }
}
