import { assignFreshIds, createUniqueEditorId, getElementByEditorId, isEditableElement } from "./ids";
import type {
  Bounds,
  CanvasSize,
  CommandResult,
  DocumentKind,
  EditorCommand,
  ElementChanges,
  ElementSummary,
  NewElementSpec,
  StructureSummary,
  TransformValues,
} from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";
const transformData = {
  x: "data-editor-translate-x",
  y: "data-editor-translate-y",
  rotation: "data-editor-rotation",
  scaleX: "data-editor-scale-x",
  scaleY: "data-editor-scale-y",
  base: "data-editor-base-transform",
} as const;

function numberAttribute(element: Element, name: string, fallback: number): number {
  const parsed = Number.parseFloat(element.getAttribute(name) ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function elementStyle(element: Element): CSSStyleDeclaration {
  return (element as HTMLElement | SVGElement).style;
}

function cssPropertyName(name: string): string {
  return name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function cssValue(value: string | number, unit = ""): string {
  return typeof value === "number" ? `${value}${unit}` : value;
}

export function getTransformValues(element: Element): TransformValues {
  return {
    x: numberAttribute(element, transformData.x, 0),
    y: numberAttribute(element, transformData.y, 0),
    rotation: numberAttribute(element, transformData.rotation, 0),
    scaleX: numberAttribute(element, transformData.scaleX, 1),
    scaleY: numberAttribute(element, transformData.scaleY, 1),
  };
}

function rememberBaseTransform(element: Element, kind: DocumentKind): void {
  if (element.hasAttribute(transformData.base)) return;
  const base = kind === "svg" ? (element.getAttribute("transform") ?? "") : elementStyle(element).transform;
  element.setAttribute(transformData.base, base);
}

export function renderEditorTransform(element: Element, kind: DocumentKind, values: TransformValues): void {
  rememberBaseTransform(element, kind);
  element.setAttribute(transformData.x, String(values.x));
  element.setAttribute(transformData.y, String(values.y));
  element.setAttribute(transformData.rotation, String(values.rotation));
  element.setAttribute(transformData.scaleX, String(values.scaleX));
  element.setAttribute(transformData.scaleY, String(values.scaleY));
  const base = element.getAttribute(transformData.base)?.trim() ?? "";

  if (kind === "svg") {
    const transform = [
      `translate(${values.x} ${values.y})`,
      `rotate(${values.rotation})`,
      `scale(${values.scaleX} ${values.scaleY})`,
      base,
    ].filter(Boolean).join(" ");
    element.setAttribute("transform", transform);
  } else {
    const transform = [
      `translate(${values.x}px, ${values.y}px)`,
      `rotate(${values.rotation}deg)`,
      `scale(${values.scaleX}, ${values.scaleY})`,
      base,
    ].filter(Boolean).join(" ");
    elementStyle(element).transform = transform;
    elementStyle(element).transformOrigin ||= "center center";
  }
}

export function setElementTranslation(element: Element, kind: DocumentKind, x: number, y: number): void {
  renderEditorTransform(element, kind, { ...getTransformValues(element), x, y });
}

export function moveElementBy(element: Element, kind: DocumentKind, dx: number, dy: number): void {
  const transform = getTransformValues(element);
  renderEditorTransform(element, kind, { ...transform, x: transform.x + dx, y: transform.y + dy });
}

export function setElementRotation(element: Element, kind: DocumentKind, rotation: number): void {
  renderEditorTransform(element, kind, { ...getTransformValues(element), rotation });
}

export function setElementScale(element: Element, kind: DocumentKind, scaleX: number, scaleY: number): void {
  renderEditorTransform(element, kind, { ...getTransformValues(element), scaleX, scaleY });
}

export function setElementSize(element: Element, kind: DocumentKind, width: number, height: number): void {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  if (kind === "html") {
    const style = elementStyle(element);
    style.width = `${safeWidth}px`;
    style.height = `${safeHeight}px`;
    return;
  }

  switch (element.localName) {
    case "rect":
    case "image":
    case "svg":
      element.setAttribute("width", String(safeWidth));
      element.setAttribute("height", String(safeHeight));
      break;
    case "circle":
      element.setAttribute("r", String(Math.min(safeWidth, safeHeight) / 2));
      break;
    case "ellipse":
      element.setAttribute("rx", String(safeWidth / 2));
      element.setAttribute("ry", String(safeHeight / 2));
      break;
    default:
      element.setAttribute("data-editor-width", String(safeWidth));
      element.setAttribute("data-editor-height", String(safeHeight));
      break;
  }
}

export function setElementVisible(element: Element, kind: DocumentKind, visible: boolean): void {
  element.setAttribute("data-editor-visible", String(visible));
  if (kind === "html") {
    if (visible) element.removeAttribute("hidden");
    else element.setAttribute("hidden", "");
    return;
  }

  const style = elementStyle(element);
  if (visible) {
    const previous = element.getAttribute("data-editor-previous-display");
    if (previous) style.display = previous;
    else style.removeProperty("display");
    element.removeAttribute("data-editor-previous-display");
  } else {
    if (style.display && style.display !== "none") element.setAttribute("data-editor-previous-display", style.display);
    style.display = "none";
  }
}

export function setElementLocked(element: Element, locked: boolean): void {
  element.setAttribute("data-editor-locked", String(locked));
}

function setImageSource(element: Element, source: string): void {
  if (!source.trim()) return;
  if (element.localName === "image") {
    element.setAttribute("href", source);
    element.removeAttribute("xlink:href");
  } else {
    element.setAttribute("src", source);
  }
}

export function applyElementChanges(element: Element, kind: DocumentKind, changes: ElementChanges): void {
  if (changes.text !== undefined) element.textContent = changes.text;
  if (changes.name !== undefined) element.setAttribute("data-editor-name", changes.name);
  if (changes.className !== undefined) element.setAttribute("class", changes.className);
  if (changes.visible !== undefined) setElementVisible(element, kind, changes.visible);
  if (changes.locked !== undefined) setElementLocked(element, changes.locked);
  if (changes.src !== undefined) setImageSource(element, changes.src);

  const style = elementStyle(element);
  if (changes.fontFamily !== undefined) style.fontFamily = changes.fontFamily;
  if (changes.fontSize !== undefined) style.fontSize = cssValue(changes.fontSize, "px");
  if (changes.fontWeight !== undefined) style.fontWeight = String(changes.fontWeight);
  if (changes.lineHeight !== undefined) style.lineHeight = cssValue(changes.lineHeight, typeof changes.lineHeight === "number" ? "px" : "");
  if (changes.letterSpacing !== undefined) style.letterSpacing = cssValue(changes.letterSpacing, "px");
  if (changes.textAlign !== undefined) style.textAlign = changes.textAlign;
  if (changes.color !== undefined) style.color = changes.color;
  if (changes.backgroundColor !== undefined) style.backgroundColor = changes.backgroundColor;
  if (changes.fill !== undefined) kind === "svg" ? element.setAttribute("fill", changes.fill) : (style.backgroundColor = changes.fill);
  if (changes.stroke !== undefined) kind === "svg" ? element.setAttribute("stroke", changes.stroke) : (style.borderColor = changes.stroke);
  if (changes.strokeWidth !== undefined) kind === "svg"
    ? element.setAttribute("stroke-width", String(changes.strokeWidth))
    : (style.borderWidth = cssValue(changes.strokeWidth, "px"));
  if (changes.opacity !== undefined) style.opacity = String(Math.min(1, Math.max(0, changes.opacity)));
  if (changes.borderRadius !== undefined) style.borderRadius = cssValue(changes.borderRadius, "px");
  if (changes.boxShadow !== undefined) style.boxShadow = changes.boxShadow;
  if (changes.filter !== undefined) style.filter = changes.filter;
  if (changes.objectFit !== undefined) style.objectFit = changes.objectFit;

  if (changes.style) {
    for (const [property, value] of Object.entries(changes.style)) {
      const cssName = cssPropertyName(property);
      if (value === null || value === "") style.removeProperty(cssName);
      else style.setProperty(cssName, String(value));
    }
  }

  const currentTransform = getTransformValues(element);
  const hasTransformChange = [changes.x, changes.y, changes.rotation, changes.scaleX, changes.scaleY].some((value) => value !== undefined);
  if (hasTransformChange) {
    renderEditorTransform(element, kind, {
      x: changes.x ?? currentTransform.x,
      y: changes.y ?? currentTransform.y,
      rotation: changes.rotation ?? currentTransform.rotation,
      scaleX: changes.scaleX ?? currentTransform.scaleX,
      scaleY: changes.scaleY ?? currentTransform.scaleY,
    });
  }
  if (changes.width !== undefined || changes.height !== undefined) {
    const bounds = readDeclaredBounds(element, kind);
    setElementSize(element, kind, changes.width ?? bounds.width, changes.height ?? bounds.height);
  }
}

function createSvgElement(document: Document, spec: NewElementSpec): Element {
  const tag = spec.tag ?? ({ text: "text", image: "image", rect: "rect", circle: "circle", group: "g", container: "g" } as const)[spec.type];
  const element = document.createElementNS(SVG_NS, tag);
  element.setAttribute("data-editor-type", spec.type);
  if (tag === "text") {
    element.textContent = spec.text ?? "New text";
    element.setAttribute("x", String(spec.x ?? 0));
    element.setAttribute("y", String(spec.y ?? 0));
  } else if (tag === "circle") {
    element.setAttribute("cx", String(spec.x ?? 50));
    element.setAttribute("cy", String(spec.y ?? 50));
    element.setAttribute("r", String(Math.min(spec.width ?? 100, spec.height ?? 100) / 2));
  } else if (tag === "rect" || tag === "image") {
    element.setAttribute("x", String(spec.x ?? 0));
    element.setAttribute("y", String(spec.y ?? 0));
    element.setAttribute("width", String(spec.width ?? 160));
    element.setAttribute("height", String(spec.height ?? 90));
  }
  return element;
}

function createHtmlElement(document: Document, spec: NewElementSpec): Element {
  const tag = spec.tag ?? ({ text: "div", image: "img", rect: "div", circle: "div", group: "div", container: "section" } as const)[spec.type];
  const element = document.createElement(tag);
  element.setAttribute("data-editor-type", spec.type);
  const style = elementStyle(element);
  if (spec.type === "text") element.textContent = spec.text ?? "New text";
  if (spec.type === "rect") style.background = spec.fill ?? "#5b8cff";
  if (spec.type === "circle") {
    style.background = spec.fill ?? "#5b8cff";
    style.borderRadius = "50%";
  }
  if (["text", "image", "rect", "circle"].includes(spec.type)) {
    style.position = "absolute";
    style.left = `${spec.x ?? 0}px`;
    style.top = `${spec.y ?? 0}px`;
    style.width = `${spec.width ?? (spec.type === "text" ? 240 : 160)}px`;
    style.height = `${spec.height ?? (spec.type === "text" ? 60 : 90)}px`;
  }
  return element;
}

export function addElement(document: Document, kind: DocumentKind, parentId: string, spec: NewElementSpec): string {
  const parent = getElementByEditorId(document, parentId);
  if (!parent) throw new Error(`Parent element not found: ${parentId}`);
  if (parent.getAttribute("data-editor-locked") === "true") throw new Error(`Parent element is locked: ${parentId}`);
  const element = kind === "svg" ? createSvgElement(document, spec) : createHtmlElement(document, spec);
  const id = createUniqueEditorId(document, spec.id ?? `${spec.type}-new`);
  element.setAttribute("data-editor-id", id);
  parent.append(element);
  const { x: _x, y: _y, width: _width, height: _height, ...remaining } = spec;
  applyElementChanges(element, kind, remaining);
  return id;
}

export function duplicateElement(document: Document, kind: DocumentKind, elementId: string): string {
  const element = getElementByEditorId(document, elementId);
  if (!element?.parentElement) throw new Error(`Element cannot be duplicated: ${elementId}`);
  const clone = element.cloneNode(true) as Element;
  assignFreshIds(clone, document, kind);
  element.after(clone);
  const newId = clone.getAttribute("data-editor-id");
  if (!newId) throw new Error("Failed to assign an ID to the duplicate.");
  moveElementBy(clone, kind, 16, 16);
  return newId;
}

export function reorderElement(element: Element, direction: "up" | "down" | "front" | "back"): void {
  const parent = element.parentElement;
  if (!parent) return;
  if (direction === "front") parent.append(element);
  else if (direction === "back") parent.prepend(element);
  else if (direction === "up" && element.nextElementSibling) element.nextElementSibling.after(element);
  else if (direction === "down" && element.previousElementSibling) element.previousElementSibling.before(element);
}

export function applyEditorCommand(document: Document, kind: DocumentKind, command: EditorCommand): CommandResult {
  if (command.action === "addElement") {
    const createdId = addElement(document, kind, command.parentId, command.element);
    return { action: command.action, elementId: command.parentId, createdId };
  }

  const element = getElementByEditorId(document, command.elementId);
  if (!element) throw new Error(`Element not found: ${command.elementId}`);
  if (element.getAttribute("data-editor-locked") === "true" && command.action !== "setLocked") {
    throw new Error(`Element is locked: ${command.elementId}`);
  }

  switch (command.action) {
    case "updateElement":
      applyElementChanges(element, kind, command.changes);
      break;
    case "replaceText":
      element.textContent = command.text;
      break;
    case "moveElement":
      setElementTranslation(element, kind, command.x, command.y);
      break;
    case "moveElementBy":
      moveElementBy(element, kind, command.dx, command.dy);
      break;
    case "resizeElement":
      setElementSize(element, kind, command.width, command.height);
      break;
    case "rotateElement":
      setElementRotation(element, kind, command.angle);
      break;
    case "updateStyle":
      applyElementChanges(element, kind, { style: command.style });
      break;
    case "deleteElement":
      if (element === document.body || element === document.documentElement) throw new Error("The document root cannot be deleted.");
      element.remove();
      break;
    case "setVisibility":
      setElementVisible(element, kind, command.visible);
      break;
    case "setLocked":
      setElementLocked(element, command.locked);
      break;
    case "reorderElement":
      reorderElement(element, command.direction);
      break;
  }
  return { action: command.action, elementId: command.elementId };
}

function numericStyle(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

export function readDeclaredBounds(element: Element, kind: DocumentKind): Bounds {
  const style = elementStyle(element);
  const transform = getTransformValues(element);
  if (kind === "svg") {
    if (element.localName === "circle") {
      const radius = numberAttribute(element, "r", 0);
      return {
        x: numberAttribute(element, "cx", radius) - radius + transform.x,
        y: numberAttribute(element, "cy", radius) - radius + transform.y,
        width: radius * 2,
        height: radius * 2,
      };
    }
    if (element.localName === "ellipse") {
      const rx = numberAttribute(element, "rx", 0);
      const ry = numberAttribute(element, "ry", 0);
      return {
        x: numberAttribute(element, "cx", rx) - rx + transform.x,
        y: numberAttribute(element, "cy", ry) - ry + transform.y,
        width: rx * 2,
        height: ry * 2,
      };
    }
    return {
      x: numberAttribute(element, "x", 0) + transform.x,
      y: numberAttribute(element, "y", 0) + transform.y,
      width: numberAttribute(element, "width", numberAttribute(element, "data-editor-width", 0)),
      height: numberAttribute(element, "height", numberAttribute(element, "data-editor-height", 0)),
    };
  }
  return {
    x: numericStyle(style, "left", 0) + transform.x,
    y: numericStyle(style, "top", 0) + transform.y,
    width: numericStyle(style, "width", 0),
    height: numericStyle(style, "height", 0),
  };
}

function elementType(element: Element): string {
  const editorType = element.getAttribute("data-editor-type");
  if (editorType) return editorType;
  if (["img", "image"].includes(element.localName)) return "image";
  if (["text", "p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "label", "button"].includes(element.localName)) return "text";
  if (element.children.length === 0 && Boolean(element.textContent?.trim())) return "text";
  if (["rect", "circle", "ellipse", "line", "polyline", "polygon", "path"].includes(element.localName)) return "shape";
  if (["g", "svg", "section", "article", "main", "div", "body"].includes(element.localName)) return "container";
  return element.localName;
}

function compactText(element: Element): string | undefined {
  if (element.children.length > 0 && elementType(element) !== "text") return undefined;
  const text = element.textContent?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 240) : undefined;
}

export function summarizeElement(
  element: Element,
  kind: DocumentKind,
  boundsResolver?: (element: Element) => Bounds | null,
): ElementSummary {
  const id = element.getAttribute("data-editor-id") ?? "";
  const parent = element.parentElement?.closest("[data-editor-id]");
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    if (["data-editor-base-transform"].includes(attribute.name)) continue;
    attributes[attribute.name] = attribute.value;
  }
  return {
    id,
    type: elementType(element),
    tag: element.localName,
    name: element.getAttribute("data-editor-name") ?? element.getAttribute("aria-label") ?? id,
    text: compactText(element),
    bounds: boundsResolver?.(element) ?? readDeclaredBounds(element, kind),
    parentId: parent?.getAttribute("data-editor-id") ?? null,
    locked: element.getAttribute("data-editor-locked") === "true",
    visible: element.getAttribute("data-editor-visible") !== "false" && !element.hasAttribute("hidden") && elementStyle(element).display !== "none",
    className: element.getAttribute("class") ?? undefined,
    attributes,
  };
}

export function buildStructureSummary(
  document: Document,
  kind: DocumentKind,
  canvas: CanvasSize,
  boundsResolver?: (element: Element) => Bounds | null,
): StructureSummary {
  const root = kind === "html" ? document.body : document.documentElement;
  const elements = root
    ? [root, ...Array.from(root.querySelectorAll("*"))]
        .filter((element) => isEditableElement(element, kind) && element.hasAttribute("data-editor-id"))
        .map((element) => summarizeElement(element, kind, boundsResolver))
    : [];
  const isSlide = kind === "html" && (canvas.width / canvas.height > 1.3);
  return { documentType: isSlide ? "html-slide" : kind, canvas, elements };
}
