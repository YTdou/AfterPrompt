import type { SourceDocument } from "../document-model";
import { getElementByEditorId } from "../ids";
import type { ProjectAssets } from "../project";
import { isSafeAssetUrl, sanitizeCss } from "../sanitizer";
import type { DocumentKind, NewElementSpec } from "../types";
import { insertVisualFragment } from "./import";
import type {
  VisualFragmentCompatibilityReport,
  VisualFragmentPackage,
  VisualFragmentProperty,
  VisualFragmentSlot,
} from "./types";

export type ComponentPropertyValue = string | number | boolean;

export interface ComponentPropertyUpdateResult {
  instanceId: string;
  changed: string[];
  overrides: Record<string, ComponentPropertyValue>;
}

export interface ComponentSyncResult {
  updated: number;
  failed: number;
  reports: VisualFragmentCompatibilityReport[];
  errors: string[];
}

function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

function uniqueValue(preferred: string, used: Set<string>): string {
  const base = preferred.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "fragment-instance";
  let candidate = `${base}-copy`;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-copy-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function remapCloneReferences(root: Element, remaps: Record<string, string>): void {
  const idrefNames = new Set(["aria-activedescendant", "aria-controls", "aria-describedby", "aria-details", "aria-errormessage", "aria-flowto", "aria-labelledby", "aria-owns", "for", "headers", "list"]);
  for (const element of allElements(root)) {
    for (const attribute of Array.from(element.attributes)) {
      let value = attribute.value;
      if (idrefNames.has(attribute.name)) value = value.split(/\s+/).map((id) => remaps[id] ?? id).join(" ");
      if (["href", "xlink:href"].includes(attribute.name) && value.startsWith("#")) value = `#${remaps[value.slice(1)] ?? value.slice(1)}`;
      for (const [source, target] of Object.entries(remaps)) {
        const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        value = value.replace(new RegExp(`url\\(\\s*(['"]?)#${escaped}\\1\\s*\\)`, "g"), `url(#${target})`);
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
  }
}

export function refreshClonedFragmentInstances(root: Element, document: Document): void {
  const instances = allElements(root).filter((element) => element.hasAttribute("data-vfrag-instance-id"));
  if (instances.length === 0) return;
  const usedInstances = new Set(Array.from(document.querySelectorAll("[data-vfrag-instance-id]"))
    .map((element) => element.getAttribute("data-vfrag-instance-id")).filter((value): value is string => Boolean(value)));
  const usedIds = new Set(Array.from(document.querySelectorAll("[id]"))
    .map((element) => element.getAttribute("id")).filter((value): value is string => Boolean(value)));
  for (const instance of instances) {
    const oldInstanceId = instance.getAttribute("data-vfrag-instance-id") ?? "fragment-instance";
    const newInstanceId = uniqueValue(oldInstanceId, usedInstances);
    const idRemaps: Record<string, string> = {};
    for (const element of allElements(instance)) {
      const id = element.getAttribute("id");
      if (!id || !usedIds.has(id)) {
        if (id) usedIds.add(id);
        continue;
      }
      const next = uniqueValue(id, usedIds);
      idRemaps[id] = next;
      element.setAttribute("id", next);
    }
    remapCloneReferences(instance, idRemaps);
    const definitionId = instance.getAttribute("data-vfrag-definition-id") ?? "";
    const version = instance.getAttribute("data-vfrag-definition-version") ?? "";
    const oldStyleKey = `${definitionId}@${version}#${oldInstanceId}`;
    const sourceStyle = Array.from(document.querySelectorAll("style[data-vfrag-style]"))
      .find((style) => style.getAttribute("data-vfrag-style") === oldStyleKey);
    if (sourceStyle) {
      const styleClone = sourceStyle.cloneNode(true) as Element;
      styleClone.setAttribute("data-vfrag-style", `${definitionId}@${version}#${newInstanceId}`);
      let css = (styleClone.textContent ?? "").replaceAll(`[data-vfrag-instance-id="${oldInstanceId}"]`, `[data-vfrag-instance-id="${newInstanceId}"]`);
      for (const [source, target] of Object.entries(idRemaps)) {
        const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        css = css.replace(new RegExp(`url\\(\\s*(['"]?)#${escaped}\\1\\s*\\)`, "g"), `url(#${target})`);
        css = css.replace(/([^{}]*)\{/g, (ruleStart) => {
          if (ruleStart.trimStart().startsWith("@")) return ruleStart;
          let selector = ruleStart.replace(
            new RegExp(`(\\[(?:id|href|xlink\\:href)\\s*=\\s*["']?#?)${escaped}(["']?\\])`, "gi"),
            `$1${target}$2`,
          );
          selector = selector.replace(
            new RegExp(`(^|[^"'=:])#${escaped}(?![A-Za-z0-9_-])`, "g"),
            (_match, prefix: string) => `${prefix}#${target}`,
          );
          return selector;
        });
      }
      styleClone.textContent = css;
      sourceStyle.after(styleClone);
    }
    instance.setAttribute("data-vfrag-instance-id", newInstanceId);
  }
}

function componentRoot(document: Document, elementId: string): Element {
  const element = getElementByEditorId(document, elementId);
  if (!element) throw new Error(`组件元素不存在：${elementId}`);
  const root = element.hasAttribute("data-vfrag-root") ? element : element.closest("[data-vfrag-root]");
  if (!root) throw new Error(`元素不属于视觉组件实例：${elementId}`);
  return root;
}

function parseSchema<T>(root: Element, attribute: string, label: string): T[] {
  const source = root.getAttribute(attribute) ?? "[]";
  try {
    const value: unknown = JSON.parse(source);
    if (!Array.isArray(value)) throw new Error("not an array");
    return value as T[];
  } catch {
    throw new Error(`组件实例的 ${label} 元数据损坏。`);
  }
}

function parseOverrides(root: Element): Record<string, ComponentPropertyValue> {
  try {
    const parsed: unknown = JSON.parse(root.getAttribute("data-vfrag-property-overrides") ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ComponentPropertyValue] => ["string", "number", "boolean"].includes(typeof entry[1])));
  } catch {
    return {};
  }
}

function targetByKey(root: Element, key: string): Element | null {
  return allElements(root).find((element) => element.getAttribute("data-vfrag-node-key") === key) ?? null;
}

function cssPropertyName(name: string): string {
  return name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function coerceValue(property: VisualFragmentProperty, value: ComponentPropertyValue): ComponentPropertyValue {
  if (property.type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) throw new Error(`${property.label} 必须是有限数字。`);
    return number;
  }
  if (property.type === "size") {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`${property.label} 必须是有限尺寸。`);
      return value;
    }
    const text = String(value).trim();
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return Number(text);
    if (!/^-?(?:\d+\.?\d*|\.\d+)(?:px|%|em|rem|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc)$|^(?:auto|min-content|max-content|fit-content)$/i.test(text)) {
      throw new Error(`${property.label} 不是支持的 CSS 尺寸。`);
    }
    return text;
  }
  if (property.type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === 1 || value === "1") return true;
    if (value === "false" || value === 0 || value === "0") return false;
    throw new Error(`${property.label} 必须是布尔值。`);
  }
  const text = String(value);
  if (property.required && !text.trim()) throw new Error(`${property.label} 不能为空。`);
  if (property.type === "enum" && !property.options?.includes(text)) throw new Error(`${property.label} 不在允许选项中。`);
  if (["url", "image", "icon"].includes(property.type) && !isSafeAssetUrl(text)) throw new Error(`${property.label} 包含不安全 URL。`);
  return text;
}

function applyBinding(target: Element, property: VisualFragmentProperty, value: ComponentPropertyValue): void {
  const binding = property.binding;
  if (binding.kind === "text") {
    target.textContent = String(value);
    return;
  }
  if (binding.kind === "attribute") {
    if (property.type === "boolean") {
      if (value) target.setAttribute(binding.name, "");
      else target.removeAttribute(binding.name);
    } else target.setAttribute(binding.name, String(value));
    return;
  }
  const style = (target as HTMLElement | SVGElement).style;
  const propertyName = cssPropertyName(binding.name);
  const cssValue = property.type === "size" && typeof value === "number" ? `${value}px` : String(value);
  const warnings: string[] = [];
  const sanitized = sanitizeCss(`${propertyName}:${cssValue}`, warnings);
  if (warnings.length || !sanitized.endsWith(cssValue)) throw new Error(`${property.label} 包含不安全样式值。`);
  style.setProperty(propertyName, cssValue);
}

export function componentPropertySchema(document: Document, elementId: string): VisualFragmentProperty[] {
  return parseSchema<VisualFragmentProperty>(componentRoot(document, elementId), "data-vfrag-property-schema", "属性 Schema");
}

export function componentSlotSchema(document: Document, elementId: string): VisualFragmentSlot[] {
  return parseSchema<VisualFragmentSlot>(componentRoot(document, elementId), "data-vfrag-slot-schema", "插槽 Schema");
}

export function updateComponentProperties(
  document: Document,
  elementId: string,
  values: Record<string, ComponentPropertyValue>,
  recordOverrides = true,
): ComponentPropertyUpdateResult {
  const root = componentRoot(document, elementId);
  if (root.getAttribute("data-editor-locked") === "true") throw new Error(`组件实例已锁定：${elementId}`);
  const schema = parseSchema<VisualFragmentProperty>(root, "data-vfrag-property-schema", "属性 Schema");
  const properties = new Map(schema.map((property) => [property.name, property]));
  const overrides = parseOverrides(root);
  const planned = Object.entries(values).map(([name, rawValue]) => {
    const property = properties.get(name);
    if (!property) throw new Error(`组件未暴露属性：${name}`);
    const target = targetByKey(root, property.target);
    if (!target) throw new Error(`组件属性目标不存在：${property.target}`);
    const value = coerceValue(property, rawValue);
    applyBinding(target.cloneNode(true) as Element, property, value);
    return { name, property, target, value };
  });
  const changed: string[] = [];
  for (const { name, property, target, value } of planned) {
    applyBinding(target, property, value);
    if (recordOverrides) overrides[name] = value;
    changed.push(name);
  }
  if (recordOverrides) root.setAttribute("data-vfrag-property-overrides", JSON.stringify(overrides));
  return { instanceId: root.getAttribute("data-vfrag-instance-id") ?? "", changed, overrides };
}

export function insertIntoComponentSlot(
  document: Document,
  elementId: string,
  slotName: string,
  element: NewElementSpec,
  add: (targetId: string, targetKind: DocumentKind) => string,
): string {
  const root = componentRoot(document, elementId);
  if (root.getAttribute("data-editor-locked") === "true") throw new Error(`组件实例已锁定：${elementId}`);
  const slots = parseSchema<VisualFragmentSlot>(root, "data-vfrag-slot-schema", "插槽 Schema");
  const slot = slots.find((candidate) => candidate.name === slotName);
  if (!slot) throw new Error(`组件未暴露插槽：${slotName}`);
  if (slot.allowedElementTypes.length > 0 && !slot.allowedElementTypes.includes(element.type) && !slot.allowedElementTypes.includes(element.tag ?? "")) {
    throw new Error(`插槽 ${slot.label} 不允许 ${element.type} 类型。`);
  }
  if (slot.size?.maxWidth !== undefined && element.width !== undefined && element.width > slot.size.maxWidth) throw new Error(`插入元素宽度超过插槽 ${slot.label} 上限。`);
  if (slot.size?.maxHeight !== undefined && element.height !== undefined && element.height > slot.size.maxHeight) throw new Error(`插入元素高度超过插槽 ${slot.label} 上限。`);
  if (slot.size?.minWidth !== undefined && element.width !== undefined && element.width < slot.size.minWidth) throw new Error(`插入元素宽度低于插槽 ${slot.label} 下限。`);
  if (slot.size?.minHeight !== undefined && element.height !== undefined && element.height < slot.size.minHeight) throw new Error(`插入元素高度低于插槽 ${slot.label} 下限。`);
  const target = targetByKey(root, slot.target);
  const targetId = target?.getAttribute("data-editor-id");
  if (!target || !targetId) throw new Error(`插槽目标不存在或不可编辑：${slot.target}`);
  if (target.getAttribute("data-editor-locked") === "true") throw new Error(`插槽目标已锁定：${slot.target}`);
  if (!slot.multiple && target.getAttribute("data-vfrag-slot-filled") === "true") throw new Error(`插槽 ${slot.label} 只允许一个元素。`);
  const previousChildren = slot.multiple ? [] : Array.from(target.childNodes, (node) => node.cloneNode(true));
  if (!slot.multiple) target.replaceChildren();
  let createdId: string;
  try {
    createdId = add(targetId, target.namespaceURI === "http://www.w3.org/2000/svg" ? "svg" : "html");
  } catch (error) {
    if (!slot.multiple) target.replaceChildren(...previousChildren);
    throw error;
  }
  target.setAttribute("data-vfrag-slot-filled", "true");
  return createdId;
}

export function unlinkComponentInstance(document: Document, elementId: string): string {
  const root = componentRoot(document, elementId);
  if (root.getAttribute("data-editor-locked") === "true") throw new Error(`组件实例已锁定：${elementId}`);
  root.setAttribute("data-vfrag-linked", "false");
  return root.getAttribute("data-vfrag-instance-id") ?? "";
}

function placementOf(root: Element): { mode: "point"; x: number; y: number } {
  const style = (root as HTMLElement | SVGElement).style;
  const number = (value: string | null): number => {
    const parsed = Number.parseFloat(value ?? "");
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    mode: "point",
    x: root.namespaceURI === "http://www.w3.org/2000/svg" ? number(root.getAttribute("x")) : number(style.left),
    y: root.namespaceURI === "http://www.w3.org/2000/svg" ? number(root.getAttribute("y")) : number(style.top),
  };
}

export function syncLinkedVisualFragmentInstances(
  model: SourceDocument,
  targetAssets: ProjectAssets,
  fragment: VisualFragmentPackage,
  targetSourcePath = model.sourceName,
): ComponentSyncResult {
  const roots = Array.from(model.document.querySelectorAll("[data-vfrag-definition-id][data-vfrag-linked='true']"))
    .filter((root) => root.getAttribute("data-vfrag-definition-id") === fragment.manifest.fragmentId);
  const result: ComponentSyncResult = { updated: 0, failed: 0, reports: [], errors: [] };
  for (const oldRoot of roots) {
    const parent = oldRoot.parentElement;
    const parentId = parent?.getAttribute("data-editor-id");
    const oldEditorId = oldRoot.getAttribute("data-editor-id") ?? "";
    const oldInstanceId = oldRoot.getAttribute("data-vfrag-instance-id") ?? "";
    const oldVersion = oldRoot.getAttribute("data-vfrag-definition-version") ?? "";
    const overrides = parseOverrides(oldRoot);
    const slotContents = parseSchema<VisualFragmentSlot>(oldRoot, "data-vfrag-slot-schema", "插槽 Schema").flatMap((slot) => {
      const target = targetByKey(oldRoot, slot.target);
      return target?.getAttribute("data-vfrag-slot-filled") === "true"
        ? [{ slot, nodes: Array.from(target.childNodes, (node) => node.cloneNode(true)) }]
        : [];
    });
    if (!parent || !parentId || !oldEditorId) {
      result.failed += 1;
      result.errors.push(`实例 ${oldInstanceId || oldEditorId || "<unknown>"} 的父级不可编辑，未同步。`);
      continue;
    }
    let newRoot: Element | null = null;
    let insertedStyleKey = "";
    try {
      const inserted = insertVisualFragment(model, targetAssets, fragment, {
        parentId,
        placement: placementOf(oldRoot),
        linked: true,
        targetSourcePath,
      });
      result.reports.push(inserted.report);
      insertedStyleKey = `${fragment.manifest.fragmentId}@${fragment.manifest.version}#${inserted.instanceId ?? ""}`;
      newRoot = inserted.rootEditorIds[0] ? getElementByEditorId(model.document, inserted.rootEditorIds[0]) : null;
      if (!newRoot) throw new Error("新实例插入后无法定位。");
      updateComponentProperties(model.document, newRoot.getAttribute("data-editor-id")!, overrides, true);
      for (const { slot, nodes } of slotContents) {
        const target = targetByKey(newRoot, slot.target);
        if (!target) throw new Error(`新定义缺少已填充插槽目标：${slot.target}`);
        target.replaceChildren(...nodes);
        target.setAttribute("data-vfrag-slot-filled", "true");
      }
      const insertedInstanceId = inserted.instanceId ?? "";
      const preservedInstanceId = oldInstanceId || insertedInstanceId;
      if (insertedInstanceId && preservedInstanceId !== insertedInstanceId) {
        const style = Array.from(model.document.querySelectorAll("style[data-vfrag-style]"))
          .find((candidate) => candidate.getAttribute("data-vfrag-style") === `${fragment.manifest.fragmentId}@${fragment.manifest.version}#${insertedInstanceId}`);
        if (style) {
          const targetStyleKey = `${fragment.manifest.fragmentId}@${fragment.manifest.version}#${preservedInstanceId}`;
          Array.from(model.document.querySelectorAll("style[data-vfrag-style]"))
            .filter((candidate) => candidate !== style && candidate.getAttribute("data-vfrag-style") === targetStyleKey)
            .forEach((candidate) => candidate.remove());
          style.textContent = (style.textContent ?? "").replaceAll(`[data-vfrag-instance-id="${insertedInstanceId}"]`, `[data-vfrag-instance-id="${preservedInstanceId}"]`);
          style.setAttribute("data-vfrag-style", targetStyleKey);
        }
      }
      newRoot.setAttribute("data-vfrag-instance-id", preservedInstanceId);
      oldRoot.before(newRoot);
      oldRoot.remove();
      const oldStyleKey = `${fragment.manifest.fragmentId}@${oldVersion}#${oldInstanceId}`;
      if (oldStyleKey !== `${fragment.manifest.fragmentId}@${fragment.manifest.version}#${preservedInstanceId}`) {
        Array.from(model.document.querySelectorAll("style[data-vfrag-style]"))
          .filter((candidate) => candidate.getAttribute("data-vfrag-style") === oldStyleKey)
          .forEach((candidate) => candidate.remove());
      }
      newRoot.setAttribute("data-editor-id", oldEditorId);
      result.updated += 1;
    } catch (error) {
      newRoot?.remove();
      if (insertedStyleKey) {
        Array.from(model.document.querySelectorAll("style[data-vfrag-style]"))
          .filter((candidate) => candidate.getAttribute("data-vfrag-style") === insertedStyleKey)
          .forEach((candidate) => candidate.remove());
      }
      result.failed += 1;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}
