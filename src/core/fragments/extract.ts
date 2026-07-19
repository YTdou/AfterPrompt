import { readDeclaredBounds } from "../commands";
import type { SourceDocument } from "../document-model";
import { resolveProjectPath, type ProjectAssets } from "../project";
import { sanitizeCss } from "../sanitizer";
import type { Bounds, ProjectAsset } from "../types";
import {
  VISUAL_FRAGMENT_FORMAT,
  VISUAL_FRAGMENT_FORMAT_VERSION,
  type VisualFragmentAssetDependency,
  type VisualFragmentExtractOptions,
  type VisualFragmentFontDependency,
  type VisualFragmentManifest,
  type StructuredVisualFragmentPackage,
  type VisualFragmentProperty,
  type VisualFragmentSelectionItem,
  type VisualFragmentSlot,
} from "./types";
import { assertVisualFragmentManifest } from "./schema";
import { neutralizePortableTopLevelBuild } from "./context";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const URL_ATTRIBUTES = ["src", "poster", "href", "xlink:href"] as const;
const INHERITED_STYLE_PROPERTIES = [
  "color", "cursor", "direction", "font-family", "font-feature-settings", "font-kerning", "font-size",
  "font-stretch", "font-style", "font-variant", "font-weight", "letter-spacing", "line-height", "list-style",
  "text-align", "text-decoration", "text-indent", "text-rendering", "text-transform", "white-space", "word-break",
] as const;
const SELF_CONTAINED_STYLE_PROPERTIES = [
  "align-content", "align-items", "align-self", "appearance", "aspect-ratio", "backdrop-filter", "background",
  "background-attachment", "background-blend-mode", "background-clip", "background-color", "background-image",
  "background-origin", "background-position", "background-repeat", "background-size", "block-size", "border",
  "border-block", "border-bottom", "border-collapse", "border-color", "border-image", "border-inline", "border-left",
  "border-radius", "border-right", "border-spacing", "border-style", "border-top", "border-width", "bottom",
  "box-shadow", "box-sizing", "break-after", "break-before", "break-inside", "clip-path", "column-count", "column-gap",
  "column-rule", "column-width", "contain", "content", "display", "fill", "fill-opacity", "filter", "flex",
  "flex-basis", "flex-direction", "flex-flow", "flex-grow", "flex-shrink", "flex-wrap", "float", "gap", "grid",
  "grid-area", "grid-auto-columns", "grid-auto-flow", "grid-auto-rows", "grid-column", "grid-row", "grid-template",
  "height", "inline-size", "inset", "isolation", "justify-content", "justify-items", "justify-self", "left", "mask",
  "max-height", "max-width", "min-height", "min-width", "mix-blend-mode", "object-fit", "object-position", "opacity",
  "order", "outline", "overflow", "overflow-wrap", "overflow-x", "overflow-y", "padding", "perspective", "position",
  "right", "rotate", "row-gap", "scale", "shape-rendering", "stroke", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "stroke-opacity", "stroke-width", "table-layout", "text-shadow", "top",
  "transform", "transform-box", "transform-origin", "transform-style", "translate", "vertical-align", "visibility",
  "width", "writing-mode", "z-index", ...INHERITED_STYLE_PROPERTIES,
] as const;

interface CloneMapping {
  source: Element;
  clone: Element;
  key: string;
  rendered: Element | null;
  topLevel: boolean;
  bounds?: Bounds;
}

interface CssBlock {
  css: string;
  sourcePath: string;
  label: string;
}

interface ExtractedCss {
  css: string;
  fontFaces: string[];
  keyframes: string[];
}

function slugify(value: string, fallback: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "").slice(0, 96) || fallback;
}

function createFragmentId(name: string): string {
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${slugify(name, "fragment")}-${suffix}`;
}

function normalizeVersion(value = "1.0.0"): string {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) throw new Error(`片段版本不是有效语义版本：${value}`);
  return value;
}

function finiteBounds(bounds: Bounds): Bounds {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (!values.every(Number.isFinite)) throw new Error("选区包含无效的渲染边界。");
  return { x: bounds.x, y: bounds.y, width: Math.max(0, bounds.width), height: Math.max(0, bounds.height) };
}

function unionBounds(items: VisualFragmentSelectionItem[]): Bounds {
  const bounds = items.map((item) => finiteBounds(item.bounds));
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function normalizeSelection(items: VisualFragmentSelectionItem[]): VisualFragmentSelectionItem[] {
  const unique = items.filter((item, index) => items.findIndex((candidate) => candidate.element === item.element) === index);
  const roots = unique.filter((item) => !unique.some((candidate) => candidate !== item && candidate.element.contains(item.element)));
  if (roots.length === 0) throw new Error("请先选择至少一个可编辑元素。");
  return roots;
}

function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

function pairClones(
  sourceRoot: Element,
  cloneRoot: Element,
  renderedRoot: Element | null,
  usedKeys: Set<string>,
  topLevel: boolean,
  bounds?: Bounds,
): CloneMapping[] {
  const sourceElements = allElements(sourceRoot);
  const cloneElements = allElements(cloneRoot);
  return sourceElements.map((source, index) => {
    const clone = cloneElements[index];
    if (!clone) throw new Error("复制选区时节点结构不一致。");
    const editorId = source.getAttribute("data-editor-id") ?? "";
    const existingKey = source.getAttribute("data-vfrag-node-key") ?? "";
    const base = slugify(existingKey || editorId || source.getAttribute("id") || source.localName, `node-${index + 1}`);
    let key = base;
    let counter = 2;
    while (usedKeys.has(key)) {
      key = `${base}-${counter}`;
      counter += 1;
    }
    usedKeys.add(key);
    clone.setAttribute("data-vfrag-node-key", key);
    if (index === 0) {
      for (const attribute of [
        "data-vfrag-root", "data-vfrag-definition-id", "data-vfrag-definition-version", "data-vfrag-instance-id",
        "data-vfrag-linked", "data-vfrag-property-overrides", "data-vfrag-property-schema", "data-vfrag-slot-schema",
      ]) clone.removeAttribute(attribute);
    }
    const rendered = editorId
      ? (renderedRoot?.getAttribute("data-editor-id") === editorId
          ? renderedRoot
          : renderedRoot
            ? allElements(renderedRoot).find((element) => element.getAttribute("data-editor-id") === editorId) ?? null
            : null)
      : null;
    return { source, clone, key, rendered, topLevel: topLevel && index === 0, bounds: index === 0 ? bounds : undefined };
  });
}

function computedStyle(mapping: CloneMapping): CSSStyleDeclaration | null {
  const element = mapping.rendered ?? mapping.source;
  const view = element.ownerDocument.defaultView;
  if (!view?.getComputedStyle) return null;
  const portableBuildContext = mapping.topLevel && mapping.source.hasAttribute("data-build");
  const originalClass = element.getAttribute("class");
  const originalAriaHidden = element.getAttribute("aria-hidden");
  const originalBuildVisibility = element.getAttribute("data-editor-build-visibility");
  try {
    if (portableBuildContext) {
      element.classList.add("revealed");
      element.setAttribute("aria-hidden", "false");
      element.setAttribute("data-editor-build-visibility", "shown");
    }
    const source = view.getComputedStyle(element);
    const snapshot = element.ownerDocument.createElement("span").style;
    for (let index = 0; index < source.length; index += 1) {
      const property = source.item(index);
      const value = source.getPropertyValue(property);
      if (value) snapshot.setProperty(property, value, source.getPropertyPriority(property));
    }
    return snapshot;
  } catch {
    return null;
  } finally {
    if (portableBuildContext) {
      if (originalClass === null) element.removeAttribute("class");
      else element.setAttribute("class", originalClass);
      if (originalAriaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", originalAriaHidden);
      if (originalBuildVisibility === null) element.removeAttribute("data-editor-build-visibility");
      else element.setAttribute("data-editor-build-visibility", originalBuildVisibility);
    }
  }
}

function isBuildRuntimeSelector(selector: string): boolean {
  return /(?:^|[^A-Za-z0-9_-])\.(?:build|revealed)(?![A-Za-z0-9_-])|\[(?:data-build|aria-hidden|data-editor-build-[^\]]*)/i.test(selector);
}

function cssEscapeString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function nodeSelector(fragmentId: string, key: string, pseudo = ""): string {
  const root = `[data-vfrag-root="${cssEscapeString(fragmentId)}"]`;
  const node = `[data-vfrag-node-key="${cssEscapeString(key)}"]`;
  return `${root}${node}${pseudo}, ${root} ${node}${pseudo}`;
}

function serializeDeclarations(style: CSSStyleDeclaration, properties: readonly string[]): string {
  const declarations: string[] = [];
  for (const property of properties) {
    const value = style.getPropertyValue(property).trim();
    if (!value || value.includes("blob:")) continue;
    const priority = style.getPropertyPriority(property);
    declarations.push(`  ${property}: ${value}${priority ? " !important" : ""};`);
  }
  return declarations.join("\n");
}

function mappingForSelector(selector: string, mappings: CloneMapping[]): Array<{ mapping: CloneMapping; pseudo: string }> {
  const pseudoMatch = selector.match(/(::(?:before|after|first-letter|first-line))\s*$/i);
  const pseudo = pseudoMatch?.[1] ?? "";
  const matchable = pseudo ? selector.slice(0, -pseudo.length).trim() : selector;
  if (!matchable || /:(?:hover|active|focus|visited|target|checked|disabled|enabled|open)(?:\b|\()/i.test(matchable)) return [];
  return mappings.flatMap((mapping) => {
    if (mapping.topLevel && mapping.source.hasAttribute("data-build") && isBuildRuntimeSelector(selector)) return [];
    try {
      return mapping.source.matches(matchable) ? [{ mapping, pseudo }] : [];
    } catch {
      return [];
    }
  });
}

function splitSelectors(value: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      selectors.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(value.slice(start).trim());
  return selectors.filter(Boolean);
}

interface RawCssRule {
  prelude: string;
  body: string;
  cssText: string;
}

function rawCssRules(css: string): RawCssRule[] {
  const rules: RawCssRule[] = [];
  let index = 0;
  const skipSpaceAndComments = (): void => {
    while (index < css.length) {
      if (/\s/.test(css[index]!)) index += 1;
      else if (css.startsWith("/*", index)) {
        const end = css.indexOf("*/", index + 2);
        index = end < 0 ? css.length : end + 2;
      } else break;
    }
  };
  while (index < css.length) {
    skipSpaceAndComments();
    const start = index;
    let quote = "";
    let parentheses = 0;
    let brackets = 0;
    while (index < css.length) {
      const character = css[index]!;
      if (quote) {
        if (character === quote && css[index - 1] !== "\\") quote = "";
      } else if (character === '"' || character === "'") quote = character;
      else if (character === "(") parentheses += 1;
      else if (character === ")") parentheses = Math.max(0, parentheses - 1);
      else if (character === "[") brackets += 1;
      else if (character === "]") brackets = Math.max(0, brackets - 1);
      else if (parentheses === 0 && brackets === 0 && (character === "{" || character === ";")) break;
      index += 1;
    }
    if (index >= css.length) break;
    const prelude = css.slice(start, index).trim();
    if (css[index] === ";") {
      index += 1;
      continue;
    }
    index += 1;
    const bodyStart = index;
    let depth = 1;
    quote = "";
    while (index < css.length && depth > 0) {
      const character = css[index]!;
      if (quote) {
        if (character === quote && css[index - 1] !== "\\") quote = "";
      } else if (css.startsWith("/*", index)) {
        const end = css.indexOf("*/", index + 2);
        index = end < 0 ? css.length : end + 2;
        continue;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      index += 1;
    }
    if (depth !== 0) break;
    const body = css.slice(bodyStart, index - 1);
    if (prelude) rules.push({ prelude, body, cssText: `${prelude} {${body}}` });
  }
  return rules;
}

function extractCssWithoutCssom(css: string, scratch: Document, mappings: CloneMapping[], fragmentId: string): ExtractedCss {
  const fontFaces: string[] = [];
  const keyframes: string[] = [];
  const output: string[] = [];
  const walk = (value: string): string => {
    const nestedOutput: string[] = [];
    for (const rule of rawCssRules(value)) {
      if (/^@font-face\b/i.test(rule.prelude)) {
        fontFaces.push(rule.cssText);
        continue;
      }
      if (/^@(?:-webkit-)?keyframes\b/i.test(rule.prelude)) {
        keyframes.push(rule.cssText);
        continue;
      }
      if (/^@(?:media|supports|layer|container)\b/i.test(rule.prelude)) {
        const nested = walk(rule.body);
        if (nested) nestedOutput.push(`${rule.prelude} {\n${nested}\n}`);
        continue;
      }
      if (rule.prelude.startsWith("@")) continue;
      const matches = splitSelectors(rule.prelude).flatMap((selector) => mappingForSelector(selector, mappings));
      const unique = matches.filter((item, matchIndex) => matches.findIndex((candidate) => candidate.mapping.key === item.mapping.key && candidate.pseudo === item.pseudo) === matchIndex);
      if (unique.length === 0) continue;
      const probe = scratch.createElement("div") as HTMLElement;
      probe.style.cssText = rule.body;
      if (!probe.style.cssText) continue;
      nestedOutput.push(`/* Source selector: ${rule.prelude.replaceAll("*/", "* /")} */\n${unique.map(({ mapping, pseudo }) => nodeSelector(fragmentId, mapping.key, pseudo)).join(",\n")} { ${probe.style.cssText} }`);
    }
    return nestedOutput.join("\n\n");
  };
  output.push(walk(css));
  return { css: output.filter(Boolean).join("\n\n"), fontFaces, keyframes };
}

function extractCssBlock(block: CssBlock, mappings: CloneMapping[], fragmentId: string, warnings: string[]): ExtractedCss {
  const cssWarnings: string[] = [];
  const css = sanitizeCss(block.css, cssWarnings);
  warnings.push(...cssWarnings.map((warning) => `${block.label}: ${warning}`));
  const scratch = mappings[0]?.source.ownerDocument.implementation.createHTMLDocument("vfrag-css");
  if (!scratch) return { css: "", fontFaces: [], keyframes: [] };
  const styleElement = scratch.createElement("style");
  styleElement.textContent = css;
  scratch.head.append(styleElement);
  const rules = styleElement.sheet?.cssRules;
  if (!rules || rules.length === 0) {
    const fallback = extractCssWithoutCssom(css, scratch, mappings, fragmentId);
    if (!fallback.css && fallback.fontFaces.length === 0 && fallback.keyframes.length === 0) {
      warnings.push(`无法解析样式表 ${block.label}；Self-contained 计算样式将作为回退。`);
    }
    return fallback;
  }

  const fontFaces: string[] = [];
  const keyframes: string[] = [];
  const walk = (ruleList: CSSRuleList, wrapper?: { prefix: string; suffix: string }): string => {
    const output: string[] = [];
    for (const rule of Array.from(ruleList)) {
      const candidate = rule as CSSRule & {
        selectorText?: string;
        style?: CSSStyleDeclaration;
        cssRules?: CSSRuleList;
        conditionText?: string;
        name?: string;
      };
      if (candidate.selectorText && candidate.style) {
        const matches = splitSelectors(candidate.selectorText).flatMap((selector) => mappingForSelector(selector, mappings));
        const unique = matches.filter((item, index) => matches.findIndex((candidateItem) => candidateItem.mapping.key === item.mapping.key && candidateItem.pseudo === item.pseudo) === index);
        if (unique.length > 0) {
          const selectors = unique.map(({ mapping, pseudo }) => nodeSelector(fragmentId, mapping.key, pseudo));
          output.push(`/* Source selector: ${candidate.selectorText.replaceAll("*/", "* /")} */\n${selectors.join(",\n")} { ${candidate.style.cssText} }`);
        }
      } else if (/^@font-face/i.test(candidate.cssText)) {
        fontFaces.push(candidate.cssText);
      } else if (/^@(?:-webkit-)?keyframes/i.test(candidate.cssText)) {
        keyframes.push(candidate.cssText);
      } else if (candidate.cssRules && candidate.cssRules.length > 0) {
        const header = candidate.cssText.slice(0, candidate.cssText.indexOf("{")).trim();
        const nested = walk(candidate.cssRules, { prefix: `${header} {`, suffix: "}" });
        if (nested) output.push(nested);
      }
    }
    const body = output.join("\n\n");
    return body && wrapper ? `${wrapper.prefix}\n${body}\n${wrapper.suffix}` : body;
  };
  return { css: walk(rules), fontFaces, keyframes };
}

function selectedFragmentStyleKeys(mappings: CloneMapping[]): Set<string> {
  const keys = new Set<string>();
  for (const { source } of mappings) {
    const root = source.closest("[data-vfrag-root]");
    if (!root) continue;
    const definitionId = root.getAttribute("data-vfrag-definition-id") ?? root.getAttribute("data-vfrag-root");
    const version = root.getAttribute("data-vfrag-definition-version");
    const instanceId = root.getAttribute("data-vfrag-instance-id");
    if (definitionId && version && instanceId) keys.add(`${definitionId}@${version}#${instanceId}`);
  }
  return keys;
}

function collectCssBlocks(model: SourceDocument, assets: ProjectAssets, sourcePath: string, warnings: string[], mappings: CloneMapping[]): CssBlock[] {
  const blocks: CssBlock[] = [];
  const relevantFragmentStyles = selectedFragmentStyleKeys(mappings);
  Array.from(model.document.querySelectorAll("style")).forEach((style, index) => {
    const fragmentStyleKey = style.getAttribute("data-vfrag-style");
    // Imported fragment styles are generated artifacts. Feeding every prior
    // instance back into a new extraction recursively duplicates embedded
    // fonts and other payloads. Only the style belonging to the selected
    // fragment is relevant when updating/re-saving that definition.
    if (fragmentStyleKey && !relevantFragmentStyles.has(fragmentStyleKey)) return;
    blocks.push({ css: style.textContent ?? "", sourcePath, label: `内联样式 ${index + 1}` });
  });
  for (const link of Array.from(model.document.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const reference = link.getAttribute("href") ?? "";
    const path = resolveProjectPath(reference, sourcePath);
    const css = path ? assets.text(path) : null;
    if (path && css !== null) blocks.push({ css, sourcePath: path, label: path });
    else warnings.push(`未能读取样式表：${reference}`);
  }
  return blocks;
}

function uniqueCssRules(rules: string[]): string[] {
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const normalized = rule.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function customProperties(style: CSSStyleDeclaration | null): Record<string, string> {
  const tokens: Record<string, string> = {};
  if (!style) return tokens;
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);
    if (!name.startsWith("--")) continue;
    const value = style.getPropertyValue(name).trim();
    if (value && !value.includes("blob:")) tokens[name] = value;
  }
  return tokens;
}

function normalizeFontFamily(value: string): string[] {
  return value.split(",").map((family) => family.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

function propertyDefault(property: VisualFragmentProperty, mapping: CloneMapping): string | number | boolean | undefined {
  if (property.defaultValue !== undefined) return property.defaultValue;
  const element = mapping.clone;
  let value: string;
  if (property.binding.kind === "text") value = element.textContent ?? "";
  else if (property.binding.kind === "attribute") {
    if (property.type === "boolean") return element.hasAttribute(property.binding.name);
    value = element.getAttribute(property.binding.name) ?? "";
  } else if (property.binding.kind === "style") value = (element as HTMLElement | SVGElement).style.getPropertyValue(property.binding.name);
  else value = (element as HTMLElement | SVGElement).style.getPropertyValue(property.binding.name) || customProperties(computedStyle(mapping))[property.binding.name] || "";
  if (property.type === "number") {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (property.type === "boolean") return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  return value;
}

function bindComponentMetadata(
  properties: VisualFragmentProperty[],
  slots: VisualFragmentSlot[],
  mappings: CloneMapping[],
): { properties: VisualFragmentProperty[]; slots: VisualFragmentSlot[] } {
  const mappingByTarget = new Map<string, CloneMapping>();
  for (const mapping of mappings) {
    mappingByTarget.set(mapping.key, mapping);
    const editorId = mapping.source.getAttribute("data-editor-id");
    if (editorId) mappingByTarget.set(editorId, mapping);
  }

  const normalizedProperties = properties.map((property) => {
    const mapping = mappingByTarget.get(property.target);
    if (!mapping) throw new Error(`组件属性 ${property.name} 的目标不在当前选区：${property.target}`);
    const defaultValue = propertyDefault(property, mapping);
    return { ...property, target: mapping.key, ...(defaultValue !== undefined ? { defaultValue } : {}) };
  });
  const normalizedSlots = slots.map((slot) => {
    const mapping = mappingByTarget.get(slot.target);
    if (!mapping) throw new Error(`组件插槽 ${slot.name} 的目标不在当前选区：${slot.target}`);
    const existing = mapping.clone.getAttribute("data-vfrag-slot");
    mapping.clone.setAttribute("data-vfrag-slot", existing ? `${existing} ${slot.name}` : slot.name);
    return { ...slot, target: mapping.key, allowedElementTypes: [...slot.allowedElementTypes] };
  });
  return { properties: normalizedProperties, slots: normalizedSlots };
}

function referencedSvgIds(root: Element): Set<string> {
  const ids = new Set<string>();
  for (const element of allElements(root)) {
    for (const attribute of Array.from(element.attributes)) {
      const value = attribute.value;
      for (const match of value.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g)) ids.add(match[1]!);
      if (["href", "xlink:href"].includes(attribute.name) && value.startsWith("#") && value.length > 1) ids.add(value.slice(1));
    }
  }
  return ids;
}

function addSvgDependencies(contentRoot: Element, sourceDocument: Document, contentType: "html" | "svg"): void {
  const existingIds = new Set(allElements(contentRoot).map((element) => element.getAttribute("id")).filter((id): id is string => Boolean(id)));
  const queue = [...referencedSvgIds(contentRoot)];
  const dependencies: Element[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (existingIds.has(id)) continue;
    const dependency = Array.from(sourceDocument.querySelectorAll("[id]")).find((element) => element.getAttribute("id") === id);
    if (!dependency) continue;
    const clone = dependency.cloneNode(true) as Element;
    dependencies.push(clone);
    existingIds.add(id);
    for (const referenced of referencedSvgIds(clone)) if (!existingIds.has(referenced)) queue.push(referenced);
  }
  if (dependencies.length === 0) return;
  if (contentType === "svg") {
    const defs = sourceDocument.createElementNS(SVG_NS, "defs");
    defs.setAttribute("data-editor-structural", "true");
    defs.append(...dependencies);
    contentRoot.prepend(defs);
  } else {
    const svg = sourceDocument.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("data-editor-structural", "true");
    const defs = sourceDocument.createElementNS(SVG_NS, "defs");
    defs.append(...dependencies);
    svg.append(defs);
    contentRoot.prepend(svg);
  }
}

function pathBaseName(path: string): string {
  const clean = path.split(/[?#]/, 1)[0]?.replaceAll("\\", "/") ?? "asset";
  return clean.slice(clean.lastIndexOf("/") + 1) || "asset";
}

function bytesToDataUrl(asset: ProjectAsset): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < asset.bytes.length; index += chunk) binary += String.fromCharCode(...asset.bytes.subarray(index, index + chunk));
  return `data:${asset.mimeType || "application/octet-stream"};base64,${btoa(binary)}`;
}

class AssetBundler {
  readonly assets: ProjectAsset[] = [];
  readonly dependencies: VisualFragmentAssetDependency[] = [];
  readonly warnings: string[] = [];
  readonly origins = new Set<string>();
  private readonly sourceToPackage = new Map<string, string>();
  private readonly packagePaths = new Set<string>();
  private externalCounter = 0;

  constructor(private readonly projectAssets: ProjectAssets) {}

  private nextPath(source: string): string {
    const rawName = pathBaseName(source);
    const dot = rawName.lastIndexOf(".");
    const stem = slugify(dot > 0 ? rawName.slice(0, dot) : rawName, "asset");
    const extension = dot > 0 ? rawName.slice(dot).replace(/[^A-Za-z0-9.]/g, "") : "";
    let candidate = `assets/${stem}${extension}`;
    let counter = 2;
    while (this.packagePaths.has(candidate)) {
      candidate = `assets/${stem}-${counter}${extension}`;
      counter += 1;
    }
    this.packagePaths.add(candidate);
    return candidate;
  }

  private registerUnbundled(reference: string, required: boolean, message: string): void {
    if (this.sourceToPackage.has(`unbundled:${reference}`)) return;
    this.externalCounter += 1;
    const name = pathBaseName(reference);
    const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")).replace(/[^A-Za-z0-9.]/g, "") : "";
    const path = `assets/unbundled-${String(this.externalCounter).padStart(3, "0")}${extension}`;
    this.sourceToPackage.set(`unbundled:${reference}`, path);
    this.dependencies.push({ path, mimeType: "application/octet-stream", source: reference, required, external: true });
    this.warnings.push(message);
    try {
      const url = new URL(reference.startsWith("//") ? `https:${reference}` : reference);
      this.origins.add(url.origin);
    } catch {
      // A missing local reference has no network origin.
    }
  }

  rewrite(reference: string, contextPath: string, required = true): string {
    const clean = reference.trim();
    if (!clean || clean.startsWith("#") || /^(?:data):/i.test(clean)) return reference;
    if (/^(?:https?:)?\/\//i.test(clean)) {
      this.registerUnbundled(clean, false, `保留外部资源引用，未自动下载：${clean}`);
      return reference;
    }
    if (/^(?:blob|file|javascript|vbscript):/i.test(clean)) {
      this.registerUnbundled(clean, false, `无法打包临时或不安全资源引用：${clean}`);
      return reference;
    }
    const resolved = resolveProjectPath(clean, contextPath);
    if (!resolved) return reference;
    const [pathPart, suffix = ""] = clean.match(/^([^?#]*)(.*)$/)?.slice(1) ?? [clean, ""];
    void pathPart;
    const existing = this.sourceToPackage.get(resolved);
    if (existing) return `${existing}${suffix}`;
    const asset = this.projectAssets.get(resolved);
    if (!asset) {
      this.registerUnbundled(clean, required, `项目资源中未找到：${clean}（相对于 ${contextPath}）`);
      return reference;
    }
    const packagePath = this.nextPath(resolved);
    this.sourceToPackage.set(resolved, packagePath);
    this.assets.push({ path: packagePath, mimeType: asset.mimeType, bytes: new Uint8Array(asset.bytes) });
    this.dependencies.push({ path: packagePath, mimeType: asset.mimeType, source: resolved, required });
    return `${packagePath}${suffix}`;
  }

  rewriteCss(css: string, contextPath: string): string {
    return css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (match, quote: string, reference: string) => {
      if (reference.startsWith("var(")) return match;
      const rewritten = this.rewrite(reference, contextPath, true);
      return rewritten === reference ? match : `url(${quote || '"'}${rewritten}${quote || '"'})`;
    });
  }
}

function rewriteElementAssets(root: Element, bundler: AssetBundler, sourcePath: string): void {
  for (const element of allElements(root)) {
    for (const name of URL_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value) element.setAttribute(name, bundler.rewrite(value, sourcePath, true));
    }
    const srcset = element.getAttribute("srcset");
    if (srcset) {
      const rewritten = srcset.split(",").map((candidate) => {
        const [reference, ...descriptor] = candidate.trim().split(/\s+/);
        return reference ? [bundler.rewrite(reference, sourcePath, true), ...descriptor].join(" ") : candidate;
      }).join(", ");
      element.setAttribute("srcset", rewritten);
    }
    const inlineStyle = element.getAttribute("style");
    if (inlineStyle?.includes("url(")) element.setAttribute("style", bundler.rewriteCss(inlineStyle, sourcePath));
  }
}

function xmlSerialize(element: Element): string {
  const Serializer = element.ownerDocument.defaultView?.XMLSerializer ?? globalThis.XMLSerializer;
  return Serializer ? new Serializer().serializeToString(element) : element.outerHTML;
}

function inlinePreviewAssets(value: string, assets: ProjectAsset[]): string {
  return assets.reduce((result, asset) => result.replaceAll(asset.path, bytesToDataUrl(asset)), value);
}

function buildPreview(contentType: "html" | "svg", root: Element, content: string, styles: string, bounds: Bounds, assets: ProjectAsset[]): string {
  const width = Math.max(1, Math.ceil(bounds.width));
  const height = Math.max(1, Math.ceil(bounds.height));
  const safeStyles = inlinePreviewAssets(styles, assets).replaceAll("]]>", "]] >");
  if (contentType === "svg") {
    const embedded = inlinePreviewAssets(content, assets).replace(/^\s*<\?xml[^>]*>\s*/i, "");
    return `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style><![CDATA[${safeStyles}]]></style>${embedded}</svg>\n`;
  }
  const xhtmlRoot = root.cloneNode(true) as Element;
  const xhtml = inlinePreviewAssets(xmlSerialize(xhtmlRoot), assets);
  return `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="${XHTML_NS}" style="width:100%;height:100%;overflow:hidden"><style><![CDATA[${safeStyles}]]></style>${xhtml}</div></foreignObject></svg>\n`;
}

function normalizeTags(tags: string[] = []): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 64);
}

function validateFragmentSemantics(options: VisualFragmentExtractOptions, selectionCount: number): void {
  if (!options.name.trim()) throw new Error("视觉片段名称不能为空。");
  if (options.fragmentType === "element" && selectionCount !== 1) throw new Error("element 类型必须且只能包含一个顶层元素；多选请使用 group 或 component。");
  if (options.fragmentType === "template" && (options.slots?.length ?? 0) === 0) throw new Error("template 类型必须定义至少一个内容插槽。");
  if (!["component", "template"].includes(options.fragmentType) && ((options.properties?.length ?? 0) > 0 || (options.slots?.length ?? 0) > 0)) {
    throw new Error("只有 component 或 template 可以暴露属性和插槽。");
  }
}

export function extractVisualFragment(
  model: SourceDocument,
  projectAssets: ProjectAssets,
  sourcePath: string,
  selectedItems: VisualFragmentSelectionItem[],
  options: VisualFragmentExtractOptions,
): StructuredVisualFragmentPackage {
  const selection = normalizeSelection(selectedItems);
  validateFragmentSemantics(options, selection.length);
  const bounds = unionBounds(selection);
  const fragmentId = slugify(options.fragmentId ?? createFragmentId(options.name), "fragment");
  const contentType = selection.every((item) => item.element.namespaceURI === SVG_NS) ? "svg" : model.kind;
  const warnings: string[] = [];
  const reusingFragmentRoot = selection.length === 1 && selection[0]!.element.hasAttribute("data-vfrag-root");
  const usedKeys = new Set<string>(reusingFragmentRoot ? [] : ["fragment-root"]);
  const mappings: CloneMapping[] = [];
  const clones: Element[] = [];

  for (const item of selection) {
    const clone = item.element.cloneNode(true) as Element;
    clones.push(clone);
    mappings.push(...pairClones(item.element, clone, item.renderedElement ?? null, usedKeys, true, item.bounds));
  }
  for (const mapping of mappings) {
    if (mapping.topLevel && mapping.source.hasAttribute("data-build")) neutralizePortableTopLevelBuild(mapping.clone);
  }

  const boundMetadata = bindComponentMetadata(options.properties ?? [], options.slots ?? [], mappings);
  const ownerDocument = model.document;
  let contentRoot: Element;
  if (reusingFragmentRoot) {
    contentRoot = clones[0]!;
    contentRoot.setAttribute("data-vfrag-root", fragmentId);
    contentRoot.setAttribute("data-vfrag-node-key", "fragment-root");
    contentRoot.setAttribute("data-editor-id", fragmentId);
    contentRoot.setAttribute("data-editor-name", options.name.trim());
    contentRoot.setAttribute("data-vfrag-type", options.fragmentType);
    if (contentType === "html") {
      const style = (contentRoot as HTMLElement).style;
      style.position = "absolute";
      style.left = "0px";
      style.top = "0px";
      style.width = `${bounds.width}px`;
      style.height = `${bounds.height}px`;
    } else {
      contentRoot.removeAttribute("x");
      contentRoot.removeAttribute("y");
      contentRoot.setAttribute("width", String(bounds.width));
      contentRoot.setAttribute("height", String(bounds.height));
      contentRoot.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
    }
  } else if (contentType === "html") {
    const root = ownerDocument.createElement("div");
    root.setAttribute("data-vfrag-root", fragmentId);
    root.setAttribute("data-vfrag-node-key", "fragment-root");
    root.setAttribute("data-editor-id", fragmentId);
    root.setAttribute("data-editor-name", options.name.trim());
    root.setAttribute("data-vfrag-type", options.fragmentType);
    root.style.cssText = `position:absolute;left:0;top:0;width:${bounds.width}px;height:${bounds.height}px;box-sizing:border-box;overflow:visible;`;
    const coordinateLayer = ownerDocument.createElement("div");
    coordinateLayer.setAttribute("data-editor-structural", "true");
    coordinateLayer.setAttribute("data-vfrag-coordinate-layer", "");
    coordinateLayer.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;overflow:visible;transform:translate(${-bounds.x}px, ${-bounds.y}px);transform-origin:0 0;`;
    coordinateLayer.append(...clones);
    root.append(coordinateLayer);
    contentRoot = root;
  } else {
    const root = ownerDocument.createElementNS(SVG_NS, "svg");
    root.setAttribute("data-vfrag-root", fragmentId);
    root.setAttribute("data-vfrag-node-key", "fragment-root");
    root.setAttribute("data-editor-id", fragmentId);
    root.setAttribute("data-editor-name", options.name.trim());
    root.setAttribute("data-vfrag-type", options.fragmentType);
    root.setAttribute("width", String(bounds.width));
    root.setAttribute("height", String(bounds.height));
    root.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
    const coordinateLayer = ownerDocument.createElementNS(SVG_NS, "g");
    coordinateLayer.setAttribute("data-editor-structural", "true");
    coordinateLayer.setAttribute("data-vfrag-coordinate-layer", "");
    coordinateLayer.setAttribute("transform", `translate(${-bounds.x} ${-bounds.y})`);
    coordinateLayer.append(...clones);
    root.append(coordinateLayer);
    contentRoot = root;
  }
  addSvgDependencies(contentRoot, model.document, contentType);

  const tokens: Record<string, string> = {};
  const fontFamilies = new Set<string>();
  const computedRules: string[] = [];
  const inheritedRules: string[] = [];
  for (const mapping of mappings) {
    const style = computedStyle(mapping);
    Object.assign(tokens, customProperties(style));
    if (style) normalizeFontFamily(style.fontFamily).forEach((family) => fontFamilies.add(family));
    if (style) {
      const inherited = serializeDeclarations(style, INHERITED_STYLE_PROPERTIES);
      if (inherited) inheritedRules.push(`${nodeSelector(fragmentId, mapping.key)} {\n${inherited}\n}`);
      if (options.saveMode === "self-contained") {
        const declarations = serializeDeclarations(style, SELF_CONTAINED_STYLE_PROPERTIES);
        if (declarations) computedRules.push(`${nodeSelector(fragmentId, mapping.key)} {\n${declarations}\n}`);
      }
    }
    if (mapping.topLevel && mapping.bounds && style && !["absolute", "fixed"].includes(style.position)) {
      const placement = [
        "  position: absolute !important;",
        `  left: ${mapping.bounds.x}px !important;`,
        `  top: ${mapping.bounds.y}px !important;`,
        "  margin: 0 !important;",
      ];
      computedRules.push(`${nodeSelector(fragmentId, mapping.key)} {\n${placement.join("\n")}\n}`);
    }
  }

  const cssBlocks = collectCssBlocks(model, projectAssets, sourcePath, warnings, mappings);
  const bundler = new AssetBundler(projectAssets);
  const extractedBlocks = cssBlocks.map((block) => ({ block, extracted: extractCssBlock(block, mappings, fragmentId, warnings) }));
  for (const { extracted } of extractedBlocks) {
    for (const match of extracted.css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) normalizeFontFamily(match[1] ?? "").forEach((family) => fontFamilies.add(family));
  }
  const referencedTokens = new Set(cssBlocks.flatMap((block) => Array.from(block.css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g), (match) => match[1]!)));
  for (const name of referencedTokens) {
    if (tokens[name]) continue;
    for (const mapping of mappings) {
      const value = computedStyle(mapping)?.getPropertyValue(name).trim();
      if (value && !value.includes("blob:")) {
        tokens[name] = value;
        break;
      }
    }
  }
  const matchedCss = extractedBlocks.map(({ block, extracted }) => bundler.rewriteCss(extracted.css, block.sourcePath)).filter(Boolean);
  const fontFaceCss = uniqueCssRules(extractedBlocks.flatMap(({ block, extracted }) => extracted.fontFaces
    .filter((css) => {
      if (fontFamilies.size === 0) return true;
      const family = css.match(/font-family\s*:\s*([^;}]+)/i)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
      return !family || fontFamilies.has(family);
    })
    .map((css) => bundler.rewriteCss(css, block.sourcePath))));
  const keyframeCss = uniqueCssRules(extractedBlocks.flatMap(({ block, extracted }) => extracted.keyframes.map((css) => bundler.rewriteCss(css, block.sourcePath))));

  rewriteElementAssets(contentRoot, bundler, sourcePath);
  warnings.push(...bundler.warnings);
  const styles = [
    `/* Visual Fragment ${fragmentId}; mode: ${options.saveMode}. */`,
    ...fontFaceCss,
    ...keyframeCss,
    ...matchedCss,
    ...(options.saveMode === "self-contained" ? computedRules : [...inheritedRules, ...computedRules]),
  ].filter(Boolean).join("\n\n").trim() + "\n";

  const fontSources = fontFaceCss.join("\n");
  const fonts: VisualFragmentFontDependency[] = Array.from(fontFamilies).sort().map((family) => {
    const source = fontFaceCss
      .find((rule) => new RegExp(`font-family\\s*:\\s*['\"]?${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(rule))
      ?.match(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/i)?.[1];
    const embedded = Boolean(source && /^data:/i.test(source));
    return {
      family,
      bundled: embedded || bundler.dependencies.some((asset) => !asset.external && fontSources.includes(asset.path)),
      // A data URL is the font payload, not a useful provenance reference. It
      // already lives in styles.css, and copying it into this short manifest
      // field can make a fragment fail its own public Schema validation.
      ...(source && !embedded ? { source } : {}),
    };
  });

  const content = contentType === "html" ? `${contentRoot.outerHTML}\n` : `${xmlSerialize(contentRoot)}\n`;
  const previewSvg = buildPreview(contentType, contentRoot, content, styles, bounds, bundler.assets);
  const permissions = {
    scripts: false as const,
    network: bundler.origins.size > 0 ? "declared" as const : "none" as const,
    origins: Array.from(bundler.origins).sort(),
  };
  const manifest: StructuredVisualFragmentPackage["manifest"] = {
    format: VISUAL_FRAGMENT_FORMAT,
    formatVersion: VISUAL_FRAGMENT_FORMAT_VERSION,
    fragmentId,
    name: options.name.trim().slice(0, 160),
    description: (options.description ?? "").trim().slice(0, 2000),
    fragmentType: options.fragmentType,
    contentType,
    saveMode: options.saveMode,
    entry: contentType === "html" ? "content.html" : "content.svg",
    styles: "styles.css",
    tokens: "tokens.json",
    preview: "preview.svg",
    canvas: { width: bounds.width, height: bounds.height },
    coordinateSystem: { unit: "px", origin: { x: bounds.x, y: bounds.y }, originalBounds: { ...bounds } },
    insertion: { anchor: "top-left" },
    properties: boundMetadata.properties,
    slots: boundMetadata.slots,
    assets: bundler.dependencies,
    fonts,
    permissions,
    provenance: {
      sourceProject: (options.sourceProject ?? sourcePath).slice(0, 512),
      sourceDocument: model.sourceName.slice(0, 512),
      createdAt: new Date().toISOString(),
      generator: "Last Mile Studio 0.4.0",
    },
    version: normalizeVersion(options.version),
    tags: normalizeTags(options.tags),
    category: (options.category ?? "Uncategorized").trim().slice(0, 120),
  };
  assertVisualFragmentManifest(manifest);
  return { manifest, content, styles, tokens, assets: bundler.assets, previewSvg, warnings: Array.from(new Set(warnings)) };
}

export function selectionItemsFromElements(elements: Element[]): VisualFragmentSelectionItem[] {
  return elements.map((element) => ({ element, bounds: readDeclaredBounds(element, element.namespaceURI === SVG_NS ? "svg" : "html") }));
}
