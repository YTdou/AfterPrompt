import type { SourceDocument } from "../document-model";
import { getElementByEditorId } from "../ids";
import type { ProjectAssets } from "../project";
import { sanitizeCss, sanitizeDocument } from "../sanitizer";
import type { ProjectAsset } from "../types";
import type {
  VisualFragmentCompatibilityReport,
  VisualFragmentInsertOptions,
  VisualFragmentInsertPlan,
  VisualFragmentInsertResult,
  VisualFragmentPackage,
  VisualFragmentPlacement,
} from "./types";
import { normalizeFragmentRootBuildContext } from "./context";

const SVG_NS = "http://www.w3.org/2000/svg";
const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace"]);
const IDREF_ATTRIBUTES = new Set(["aria-activedescendant", "aria-controls", "aria-describedby", "aria-details", "aria-errormessage", "aria-flowto", "aria-labelledby", "aria-owns", "for", "headers", "list"]);

function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(value: string, fallback = "element"): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || fallback;
}

function allocateUnique(preferred: string, used: Set<string>): string {
  const base = slugify(preferred);
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function parseFragmentRoot(fragment: VisualFragmentPackage): { root: Element; warnings: string[] } {
  if (fragment.manifest.contentType === "raster" || typeof fragment.content !== "string") {
    throw new Error("Raster 片段不包含可解析的结构化根元素。");
  }
  const Parser = globalThis.DOMParser;
  if (!Parser) throw new Error("当前环境不提供 DOMParser，无法导入视觉片段。");
  const parsed = new Parser().parseFromString(fragment.content, fragment.manifest.contentType === "svg" ? "image/svg+xml" : "text/html");
  const parseError = parsed.querySelector("parsererror");
  if (parseError) throw new Error(`片段内容无法解析：${parseError.textContent?.replace(/\s+/g, " ").trim()}`);
  const warnings = sanitizeDocument(parsed, fragment.manifest.contentType);
  const root = fragment.manifest.contentType === "svg" ? parsed.documentElement : parsed.body.firstElementChild;
  if (!root) throw new Error("片段入口没有根元素。");
  if (fragment.manifest.contentType === "html" && parsed.body.children.length !== 1) throw new Error("content.html 必须且只能包含一个片段根元素。");
  if (root.getAttribute("data-vfrag-root") !== fragment.manifest.fragmentId) throw new Error("片段根元素与 manifest.fragmentId 不一致。");
  const normalizedBuilds = normalizeFragmentRootBuildContext(root, true);
  if (normalizedBuilds > 0) warnings.push(`已移除 ${normalizedBuilds} 个来自源页面的顶层 Build 状态；组件内部 Build 保持不变。`);
  return { root, warnings };
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function directoryName(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  return normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
}

function fileName(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "asset";
}

function appendSuffix(path: string, counter: number): string {
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? `${path.slice(0, dot)}-${counter}${path.slice(dot)}` : `${path}-${counter}`;
}

function prepareAssets(
  fragment: VisualFragmentPackage,
  targetAssets: ProjectAssets,
  targetSourcePath: string,
): { assets: ProjectAsset[]; remaps: Record<string, string>; references: Record<string, string> } {
  const directory = directoryName(targetSourcePath);
  const baseReference = `fragments/${fragment.manifest.fragmentId}/${fragment.manifest.version}`;
  const basePath = directory ? `${directory}/${baseReference}` : baseReference;
  const assets: ProjectAsset[] = [];
  const remaps: Record<string, string> = {};
  const references: Record<string, string> = {};
  const reserved = new Set(targetAssets.list().map((asset) => asset.path));
  const packageAssets = fragment.manifest.contentType === "raster"
    ? [{
      path: fragment.manifest.entry,
      mimeType: fragment.manifest.entry === "content.png" ? "image/png" : "image/jpeg",
      bytes: new Uint8Array(fragment.content as Uint8Array),
    }, ...fragment.assets]
    : fragment.assets;
  for (const asset of packageAssets) {
    let targetPath = `${basePath}/${fileName(asset.path)}`;
    let counter = 2;
    while (reserved.has(targetPath) && !byteArraysEqual(targetAssets.get(targetPath)?.bytes ?? new Uint8Array(), asset.bytes)) {
      targetPath = appendSuffix(`${basePath}/${fileName(asset.path)}`, counter);
      counter += 1;
    }
    reserved.add(targetPath);
    const reference = `${baseReference}/${fileName(targetPath)}`;
    remaps[asset.path] = targetPath;
    references[asset.path] = reference;
    if (!targetAssets.get(targetPath)) assets.push({ path: targetPath, mimeType: asset.mimeType, bytes: new Uint8Array(asset.bytes) });
  }
  return { assets, remaps, references };
}

function replaceAssetReferences(value: string, references: Record<string, string>): string {
  return Object.entries(references).sort(([left], [right]) => right.length - left.length)
    .reduce((result, [source, target]) => result.replaceAll(source, target), value);
}

function remapCssIds(css: string, idRemaps: Record<string, string>, editorIdRemaps: Record<string, string>): string {
  let result = css;
  for (const [source, target] of Object.entries(idRemaps)) {
    const escaped = escapeRegex(source);
    result = result.replace(new RegExp(`url\\(\\s*(['"]?)#${escaped}\\1\\s*\\)`, "g"), `url(#${target})`);
    result = result.replace(/([^{}]*)\{/g, (ruleStart) => {
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
  for (const [source, target] of Object.entries(editorIdRemaps)) {
    const escaped = escapeRegex(source);
    result = result.replace(new RegExp(`(\\[data-editor-id\\s*=\\s*['"])${escaped}(['"]\\])`, "g"), `$1${target}$2`);
  }
  return result;
}

function remapElementReferences(root: Element, idRemaps: Record<string, string>): void {
  for (const element of allElements(root)) {
    for (const attribute of Array.from(element.attributes)) {
      let value = attribute.value;
      if (IDREF_ATTRIBUTES.has(attribute.name)) {
        value = value.split(/\s+/).map((id) => idRemaps[id] ?? id).join(" ");
      }
      if (["href", "xlink:href"].includes(attribute.name) && value.startsWith("#")) {
        value = `#${idRemaps[value.slice(1)] ?? value.slice(1)}`;
      }
      for (const [source, target] of Object.entries(idRemaps)) {
        value = value.replace(new RegExp(`url\\(\\s*(['"]?)#${escapeRegex(source)}\\1\\s*\\)`, "g"), `url(#${target})`);
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
  }
}

function assignInstanceIds(root: Element, targetDocument: Document): { editorIdRemaps: Record<string, string>; rootEditorIds: string[]; instanceId: string } {
  const targetEditorIds = new Set(Array.from(targetDocument.querySelectorAll("[data-editor-id]"))
    .map((element) => element.getAttribute("data-editor-id")).filter((value): value is string => Boolean(value)));
  const sourceIds = new Set<string>();
  const editorIdRemaps: Record<string, string> = {};
  for (const element of allElements(root)) {
    const source = element.getAttribute("data-editor-id");
    if (!source) continue;
    if (sourceIds.has(source)) throw new Error(`片段内 data-editor-id 重复：${source}`);
    sourceIds.add(source);
    const target = allocateUnique(`${source}-instance`, targetEditorIds);
    editorIdRemaps[source] = target;
    element.setAttribute("data-editor-id", target);
  }
  if (!root.hasAttribute("data-editor-id")) root.setAttribute("data-editor-id", allocateUnique("fragment-instance", targetEditorIds));
  const instanceIds = new Set(Array.from(targetDocument.querySelectorAll("[data-vfrag-instance-id]"))
    .map((element) => element.getAttribute("data-vfrag-instance-id")).filter((value): value is string => Boolean(value)));
  const instanceId = allocateUnique(`${root.getAttribute("data-vfrag-root") ?? "fragment"}-instance`, instanceIds);
  return { editorIdRemaps, rootEditorIds: [root.getAttribute("data-editor-id")!], instanceId };
}

function assignRegularIds(root: Element, targetDocument: Document): Record<string, string> {
  const used = new Set(Array.from(targetDocument.querySelectorAll("[id]"))
    .map((element) => element.getAttribute("id")).filter((value): value is string => Boolean(value)));
  const sourceIds = new Set<string>();
  const remaps: Record<string, string> = {};
  for (const element of allElements(root)) {
    const source = element.getAttribute("id");
    if (!source) continue;
    if (sourceIds.has(source)) throw new Error(`片段内普通 id 重复，无法无歧义修复引用：${source}`);
    sourceIds.add(source);
    if (!used.has(source)) {
      used.add(source);
      continue;
    }
    const target = allocateUnique(`${root.getAttribute("data-vfrag-root")}-${source}`, used);
    remaps[source] = target;
    element.setAttribute("id", target);
  }
  remapElementReferences(root, remaps);
  return remaps;
}

function setPlacement(root: Element, placement: VisualFragmentPlacement, model: SourceDocument, fragment: VisualFragmentPackage): void {
  let x = fragment.manifest.coordinateSystem.origin.x;
  let y = fragment.manifest.coordinateSystem.origin.y;
  if (placement.mode === "center") {
    x = (model.canvas.width - fragment.manifest.canvas.width) / 2;
    y = (model.canvas.height - fragment.manifest.canvas.height) / 2;
  } else if (placement.mode === "point") {
    x = placement.x;
    y = placement.y;
  }
  const maxX = Math.max(0, model.canvas.width - fragment.manifest.canvas.width);
  const maxY = Math.max(0, model.canvas.height - fragment.manifest.canvas.height);
  x = Math.min(maxX, Math.max(0, Number.isFinite(x) ? x : 0));
  y = Math.min(maxY, Math.max(0, Number.isFinite(y) ? y : 0));
  if (model.kind === "svg") {
    root.setAttribute("x", String(x));
    root.setAttribute("y", String(y));
  } else {
    const style = (root as HTMLElement | SVGElement).style;
    style.position = "absolute";
    style.left = `${x}px`;
    style.top = `${y}px`;
  }
}

function classConflicts(root: Element, targetDocument: Document): string[] {
  const source = new Set(allElements(root).flatMap((element) => Array.from(element.classList)));
  const target = new Set(Array.from(targetDocument.querySelectorAll("[class]")).flatMap((element) => Array.from(element.classList)));
  return Array.from(source).filter((name) => target.has(name)).sort().map((name) => `class .${name}`);
}

function resourceReferences(root: Element, styles: string): string[] {
  const references = new Set<string>();
  const add = (value: string): void => {
    const clean = value.trim().replace(/^['"]|['"]$/g, "");
    if (clean && !clean.startsWith("#") && !clean.startsWith("var(") && !/^data:/i.test(clean)) references.add(clean);
  };
  for (const element of allElements(root)) {
    for (const name of ["src", "poster", "href", "xlink:href"]) {
      const value = element.getAttribute(name);
      if (value) add(value);
    }
    const srcset = element.getAttribute("srcset");
    if (srcset) srcset.split(",").forEach((candidate) => add(candidate.trim().split(/\s+/, 1)[0] ?? ""));
    const inlineStyle = element.getAttribute("style") ?? "";
    for (const match of inlineStyle.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi)) add(match[2] ?? "");
  }
  for (const match of styles.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi)) add(match[2] ?? "");
  return Array.from(references);
}

function networkOrigin(reference: string): string | null {
  if (!/^(?:https?:)?\/\//i.test(reference)) return null;
  try {
    return new URL(reference.startsWith("//") ? `https:${reference}` : reference).origin;
  } catch {
    return null;
  }
}

function keyframeConflicts(styles: string, targetDocument: Document): string[] {
  const names = (value: string): Set<string> => new Set(Array.from(value.matchAll(/@(?:-webkit-)?keyframes\s+([A-Za-z_][\w-]*)/gi), (match) => match[1]!));
  const source = names(styles);
  const target = names(Array.from(targetDocument.querySelectorAll("style")).map((style) => style.textContent ?? "").join("\n"));
  return Array.from(source).filter((name) => target.has(name)).sort().map((name) => `@keyframes ${name}`);
}

function tokenConflicts(fragment: VisualFragmentPackage, targetDocument: Document): string[] {
  const targetCss = Array.from(targetDocument.querySelectorAll("style, [style]"))
    .map((element) => element.localName === "style" ? element.textContent ?? "" : element.getAttribute("style") ?? "").join("\n");
  return Object.keys(fragment.tokens).filter((name) => new RegExp(`${escapeRegex(name)}\\s*:`).test(targetCss)).sort().map((name) => `token ${name}`);
}

function missingFonts(fragment: VisualFragmentPackage, targetDocument: Document): string[] {
  const fontSet = (targetDocument as Document & { fonts?: FontFaceSet }).fonts;
  return fragment.manifest.fonts.filter((font) => {
    if (font.bundled || GENERIC_FONTS.has(font.family.toLowerCase())) return false;
    if (!fontSet?.check) return true;
    try {
      return !fontSet.check(`12px "${font.family.replaceAll('"', '\\"')}"`);
    } catch {
      return true;
    }
  }).map((font) => font.family);
}

function addVersionScope(styles: string, fragment: VisualFragmentPackage, instanceId: string): string {
  const root = `[data-vfrag-root="${fragment.manifest.fragmentId}"]`;
  const scoped = `${root}[data-vfrag-definition-version="${fragment.manifest.version}"][data-vfrag-instance-id="${instanceId}"]`;
  return styles.replaceAll(root, scoped);
}

function serializeRoot(root: Element, contentType: "html" | "svg"): string {
  if (contentType === "html") return `${root.outerHTML}\n`;
  const Serializer = root.ownerDocument.defaultView?.XMLSerializer ?? globalThis.XMLSerializer;
  return `${Serializer ? new Serializer().serializeToString(root) : root.outerHTML}\n`;
}

function createRasterRoot(fragment: VisualFragmentPackage, targetType: "html" | "svg"): Element {
  const Parser = globalThis.DOMParser;
  if (!Parser) throw new Error("当前环境不提供 DOMParser，无法创建 Raster 片段实例。");
  const width = fragment.manifest.canvas.width;
  const height = fragment.manifest.canvas.height;
  const id = fragment.manifest.fragmentId;
  if (targetType === "svg") {
    const document = new Parser().parseFromString("<svg xmlns=\"http://www.w3.org/2000/svg\"/>", "image/svg+xml");
    const image = document.createElementNS(SVG_NS, "image");
    image.setAttribute("data-vfrag-root", id);
    image.setAttribute("data-vfrag-node-key", "fragment-root");
    image.setAttribute("data-editor-id", id);
    image.setAttribute("width", String(width));
    image.setAttribute("height", String(height));
    image.setAttribute("href", fragment.manifest.entry);
    return image;
  }
  const document = new Parser().parseFromString("<!doctype html><html><body></body></html>", "text/html");
  const image = document.createElement("img");
  image.setAttribute("data-vfrag-root", id);
  image.setAttribute("data-vfrag-node-key", "fragment-root");
  image.setAttribute("data-editor-id", id);
  image.setAttribute("src", fragment.manifest.entry);
  image.setAttribute("alt", fragment.manifest.name);
  image.style.position = "absolute";
  image.style.width = `${width}px`;
  image.style.height = `${height}px`;
  return image;
}

function compatibilityError(report: VisualFragmentCompatibilityReport, message: string): void {
  report.errors.push(message);
  report.compatible = false;
}

export function planVisualFragmentInsert(
  model: SourceDocument,
  targetAssets: ProjectAssets,
  fragment: VisualFragmentPackage,
  options: VisualFragmentInsertOptions,
): VisualFragmentInsertPlan {
  const report: VisualFragmentCompatibilityReport = {
    compatible: true,
    sourceType: fragment.manifest.contentType,
    targetType: model.kind,
    idRemaps: {},
    editorIdRemaps: {},
    cssConflicts: [],
    missingFonts: [],
    missingAssets: [],
    externalResources: [],
    warnings: [...fragment.warnings],
    errors: [],
  };
  const parent = getElementByEditorId(model.document, options.parentId);
  if (!parent) compatibilityError(report, `插入父元素不存在：${options.parentId}`);
  else if (parent.getAttribute("data-editor-locked") === "true") compatibilityError(report, `插入父元素已锁定：${options.parentId}`);
  if (fragment.manifest.contentType === "html" && model.kind === "svg") compatibilityError(report, "HTML 片段不能导入 SVG 文档。");
  if (fragment.manifest.contentType === "html" && parent?.namespaceURI === SVG_NS) compatibilityError(report, "HTML 片段不能插入 SVG 子树。");
  if (fragment.manifest.contentType === "raster" && options.linked) compatibilityError(report, "Raster 片段只能插入为独立副本。");

  const plannedContentType = model.kind === "svg" || parent?.namespaceURI === SVG_NS ? "svg" : "html";
  const parsed = fragment.manifest.contentType === "raster"
    ? { root: createRasterRoot(fragment, plannedContentType), warnings: [] }
    : parseFragmentRoot(fragment);
  report.warnings.push(...parsed.warnings);
  const root = parsed.root;
  const actualReferences = fragment.manifest.contentType === "raster" ? [] : resourceReferences(root, fragment.styles);
  const externalReferences = actualReferences.filter((reference) => networkOrigin(reference));
  const declaredOrigins = new Set(fragment.manifest.permissions.origins);
  report.externalResources = Array.from(new Set([
    ...externalReferences,
    ...fragment.manifest.assets.filter((asset) => asset.external).map((asset) => asset.source),
  ]));
  if (externalReferences.length > 0 && fragment.manifest.permissions.network !== "declared") {
    compatibilityError(report, "片段内容包含未在 permissions 中声明的网络资源。");
  }
  for (const reference of externalReferences) {
    const origin = networkOrigin(reference);
    if (origin && !declaredOrigins.has(origin)) compatibilityError(report, `网络来源未在 manifest 声明：${origin}`);
  }
  const declaredAssetReferences = new Set([
    ...(fragment.manifest.contentType === "raster" ? [fragment.manifest.entry] : []),
    ...fragment.manifest.assets.flatMap((asset) => [asset.path, asset.source]),
  ]);
  const undeclaredAssets = actualReferences.filter((reference) => {
    const path = reference.split(/[?#]/, 1)[0]!;
    if (declaredAssetReferences.has(reference) || declaredAssetReferences.has(path)) return false;
    if (networkOrigin(reference)) return false;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(reference)) return true;
    return true;
  });
  if (undeclaredAssets.length > 0) {
    report.missingAssets.push(...undeclaredAssets);
    compatibilityError(report, `片段引用了未在 manifest 声明的资源：${undeclaredAssets.join("、")}`);
  }
  const preparedAssets = prepareAssets(fragment, targetAssets, options.targetSourcePath ?? model.sourceName);
  for (const [source, targetReference] of Object.entries(preparedAssets.references)) {
    for (const element of allElements(root)) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.value.includes(source)) element.setAttribute(attribute.name, attribute.value.replaceAll(source, targetReference));
      }
    }
  }

  report.idRemaps = assignRegularIds(root, model.document);
  const identities = assignInstanceIds(root, model.document);
  report.editorIdRemaps = identities.editorIdRemaps;
  root.setAttribute("data-vfrag-definition-id", fragment.manifest.fragmentId);
  root.setAttribute("data-vfrag-definition-version", fragment.manifest.version);
  root.setAttribute("data-vfrag-instance-id", identities.instanceId);
  root.setAttribute("data-vfrag-linked", String(options.linked));
  root.setAttribute("data-vfrag-property-schema", JSON.stringify(fragment.manifest.properties));
  root.setAttribute("data-vfrag-slot-schema", JSON.stringify(fragment.manifest.slots));
  root.setAttribute("data-vfrag-property-overrides", "{}");
  const rootStyle = (root as HTMLElement | SVGElement).style;
  for (const [name, value] of Object.entries(fragment.tokens)) rootStyle.setProperty(name, value);
  setPlacement(root, options.placement, model, fragment);

  let styles = replaceAssetReferences(fragment.styles, preparedAssets.references);
  styles = remapCssIds(styles, report.idRemaps, report.editorIdRemaps);
  styles = addVersionScope(sanitizeCss(styles, report.warnings), fragment, identities.instanceId);
  const styleKey = `${fragment.manifest.fragmentId}@${fragment.manifest.version}#${identities.instanceId}`;
  const existingStyle = Array.from(model.document.querySelectorAll("style[data-vfrag-style]"))
    .find((style) => style.getAttribute("data-vfrag-style") === styleKey);
  if (existingStyle && (existingStyle.textContent ?? "").trim() !== styles.trim()) {
    compatibilityError(report, `目标文档已有同 ID/版本但内容不同的片段样式：${styleKey}`);
  }
  report.cssConflicts = [...classConflicts(root, model.document), ...keyframeConflicts(styles, model.document), ...tokenConflicts(fragment, model.document)];
  report.missingFonts = missingFonts(fragment, model.document);
  report.missingAssets.push(...fragment.manifest.assets.filter((asset) => asset.external && asset.required && !/^(?:https?:)?\/\//i.test(asset.source)).map((asset) => asset.source));
  report.missingAssets = Array.from(new Set(report.missingAssets));
  if (report.cssConflicts.length) report.warnings.push(`检测到 ${report.cssConflicts.length} 个潜在 CSS 名称冲突；片段节点规则已按定义和版本隔离。`);
  if (report.missingFonts.length) report.warnings.push(`字体可能缺失：${report.missingFonts.join("、")}`);
  if (report.externalResources.length) report.warnings.push(`保留 ${report.externalResources.length} 个外部或未打包资源引用。`);
  if (report.missingAssets.length) report.warnings.push(`缺少 ${report.missingAssets.length} 个必需的本地资源。`);
  if (report.missingAssets.length) compatibilityError(report, "片段缺少必需的本地资源，已阻止导入。");

  return {
    fragment,
    report: { ...report, warnings: Array.from(new Set(report.warnings)), errors: Array.from(new Set(report.errors)) },
    parentId: options.parentId,
    placement: options.placement,
    linked: options.linked,
    content: serializeRoot(root, plannedContentType),
    plannedContentType,
    styles,
    assets: preparedAssets.assets,
    assetPathRemaps: preparedAssets.remaps,
    rootEditorIds: identities.rootEditorIds,
    instanceId: identities.instanceId,
  };
}

function parsePlannedRoot(plan: VisualFragmentInsertPlan): Element {
  const Parser = globalThis.DOMParser;
  const parsed = new Parser().parseFromString(plan.content, plan.plannedContentType === "svg" ? "image/svg+xml" : "text/html");
  const error = parsed.querySelector("parsererror");
  if (error) throw new Error(`已验证的片段计划无法重新解析：${error.textContent?.replace(/\s+/g, " ").trim()}`);
  const root = plan.plannedContentType === "svg" ? parsed.documentElement : parsed.body.firstElementChild;
  if (!root) throw new Error("已验证的片段计划没有根元素。");
  return root;
}

function ensureFragmentStyle(document: Document, kind: "html" | "svg", plan: VisualFragmentInsertPlan): { element: Element; created: boolean } {
  const key = `${plan.fragment.manifest.fragmentId}@${plan.fragment.manifest.version}#${plan.instanceId ?? "instance"}`;
  const existing = Array.from(document.querySelectorAll("style[data-vfrag-style]")).find((style) => style.getAttribute("data-vfrag-style") === key);
  if (existing) {
    if ((existing.textContent ?? "").trim() !== plan.styles.trim()) throw new Error(`文档中已存在同 ID/版本但内容不同的片段样式：${key}`);
    return { element: existing, created: false };
  }
  const style = kind === "svg" ? document.createElementNS(SVG_NS, "style") : document.createElement("style");
  style.setAttribute("data-vfrag-style", key);
  style.setAttribute("data-editor-structural", "true");
  style.textContent = plan.styles;
  if (kind === "html") document.head.append(style);
  else {
    let defs = document.documentElement.querySelector(":scope > defs[data-vfrag-definitions]");
    if (!defs) {
      defs = document.createElementNS(SVG_NS, "defs");
      defs.setAttribute("data-vfrag-definitions", "");
      defs.setAttribute("data-editor-structural", "true");
      document.documentElement.prepend(defs);
    }
    defs.append(style);
  }
  return { element: style, created: true };
}

export function applyVisualFragmentInsertPlan(
  model: SourceDocument,
  targetAssets: ProjectAssets,
  plan: VisualFragmentInsertPlan,
): VisualFragmentInsertResult {
  if (!plan.report.compatible || plan.report.errors.length > 0) throw new Error(`片段不兼容：${plan.report.errors.join("；")}`);
  const parent = getElementByEditorId(model.document, plan.parentId);
  if (!parent) throw new Error(`插入父元素在确认后发生变化：${plan.parentId}`);
  if (parent.getAttribute("data-editor-locked") === "true") throw new Error(`插入父元素在确认后被锁定：${plan.parentId}`);
  const plannedRoot = parsePlannedRoot(plan);
  const root = model.document.importNode(plannedRoot, true) as Element;
  const style = ensureFragmentStyle(model.document, model.kind, plan);
  try {
    parent.append(root);
    for (const asset of plan.assets) targetAssets.set(asset);
  } catch (error) {
    root.remove();
    if (style.created) style.element.remove();
    throw error;
  }
  return { rootEditorIds: [...plan.rootEditorIds], instanceId: plan.instanceId, report: plan.report };
}

export function insertVisualFragment(
  model: SourceDocument,
  targetAssets: ProjectAssets,
  fragment: VisualFragmentPackage,
  options: VisualFragmentInsertOptions,
): VisualFragmentInsertResult {
  return applyVisualFragmentInsertPlan(model, targetAssets, planVisualFragmentInsert(model, targetAssets, fragment, options));
}
