import { guessMimeType } from "../project";
import { sanitizeCss, sanitizeDocument } from "../sanitizer";
import type { ProjectAsset } from "../types";
import { assertVisualFragmentManifest } from "./schema";
import type { VisualFragmentPackage } from "./types";

const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const MAX_FILE_COUNT = 256;
const MAX_TEXT_BYTES = 12 * 1024 * 1024;

interface ZipEntryLike {
  name: string;
  dir: boolean;
  unsafeOriginalName?: string;
  async(type: "string"): Promise<string>;
  async(type: "uint8array"): Promise<Uint8Array>;
  _data?: { uncompressedSize?: number };
}

function safePackagePath(path: string): string {
  if (!path || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`Visual Fragment 包含不安全路径：${path || "<empty>"}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Visual Fragment 包含不安全路径：${path}`);
  }
  return parts.join("/");
}

function safeAssetPath(path: string): string {
  const safe = safePackagePath(path);
  if (!safe.startsWith("assets/") || safe === "assets/") throw new Error(`片段资源必须位于 assets/：${path}`);
  return safe;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertTextSize(name: string, value: string): void {
  if (byteLength(value) > MAX_TEXT_BYTES) throw new Error(`${name} 超过 ${MAX_TEXT_BYTES / 1024 / 1024} MiB 文本上限。`);
}

function validatePackageShape(fragment: VisualFragmentPackage): void {
  assertVisualFragmentManifest(fragment.manifest);
  assertTextSize(fragment.manifest.entry, fragment.content);
  assertTextSize(fragment.manifest.styles, fragment.styles);
  assertTextSize(fragment.manifest.preview, fragment.previewSvg);
  const manifestAssetPaths = new Set(fragment.manifest.assets.filter((asset) => !asset.external).map((asset) => safeAssetPath(asset.path)));
  const requiredAssetPaths = new Set(fragment.manifest.assets.filter((asset) => !asset.external && asset.required).map((asset) => safeAssetPath(asset.path)));
  const actualAssetPaths = new Set<string>();
  for (const asset of fragment.assets) {
    const path = safeAssetPath(asset.path);
    if (actualAssetPaths.has(path)) throw new Error(`片段资源路径重复：${path}`);
    if (asset.bytes.byteLength > MAX_FILE_BYTES) throw new Error(`片段资源过大：${path}`);
    actualAssetPaths.add(path);
  }
  for (const path of requiredAssetPaths) {
    if (!actualAssetPaths.has(path)) throw new Error(`manifest 声明的资源不存在：${path}`);
  }
  for (const path of actualAssetPaths) {
    if (!manifestAssetPaths.has(path)) throw new Error(`资源未在 manifest 中声明：${path}`);
  }
}

export async function encodeVisualFragmentPackage(fragment: VisualFragmentPackage): Promise<Uint8Array> {
  const sanitizedContent = sanitizePackageContent(fragment.content, fragment.manifest.contentType);
  const cssWarnings: string[] = [];
  const sanitizedPreview = sanitizePreviewSvg(fragment.previewSvg);
  const normalized: VisualFragmentPackage = {
    ...fragment,
    content: sanitizedContent.value,
    styles: sanitizeCss(fragment.styles, cssWarnings),
    previewSvg: sanitizedPreview.value,
    warnings: Array.from(new Set([...fragment.warnings, ...sanitizedContent.warnings, ...cssWarnings, ...sanitizedPreview.warnings])),
  };
  validatePackageShape(normalized);
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("manifest.json", `${JSON.stringify(normalized.manifest, null, 2)}\n`);
  zip.file(normalized.manifest.entry, normalized.content);
  zip.file(normalized.manifest.styles, normalized.styles);
  zip.file(normalized.manifest.tokens, `${JSON.stringify(normalized.tokens, null, 2)}\n`);
  zip.file(normalized.manifest.preview, normalized.previewSvg);
  for (const asset of normalized.assets) zip.file(safeAssetPath(asset.path), asset.bytes);
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
  });
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new Error(`.vfrag 包超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MiB 上限。`);
  return bytes;
}

async function inputBytes(input: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(await input.arrayBuffer());
}

function parseTokens(value: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`tokens.json 不是有效 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("tokens.json 必须是对象。");
  const tokens: Record<string, string> = {};
  for (const [name, tokenValue] of Object.entries(parsed)) {
    if (!/^--[A-Za-z0-9_-]+$/.test(name) || typeof tokenValue !== "string") {
      throw new Error(`tokens.json 包含无效令牌：${name}`);
    }
    tokens[name] = tokenValue;
  }
  return tokens;
}

function sanitizePreviewSvg(value: string): { value: string; warnings: string[] } {
  const warnings: string[] = [];
  const Parser = globalThis.DOMParser;
  if (!Parser) {
    if (/<(?:script|iframe|object|embed)\b|\son[a-z]+\s*=|(?:javascript|vbscript):/i.test(value)) {
      throw new Error("当前环境无法安全解析包含活动内容的 preview.svg。");
    }
    return { value, warnings };
  }
  const document = new Parser().parseFromString(value, "image/svg+xml");
  const error = document.querySelector("parsererror");
  if (error || document.documentElement.localName !== "svg") throw new Error("preview.svg 不是有效的 SVG 文档。");
  const blocked = Array.from(document.querySelectorAll("script,iframe,object,embed,base,portal,animate,animateMotion,animateTransform,set"));
  if (blocked.length) {
    blocked.forEach((element) => element.remove());
    warnings.push(`preview.svg 已移除 ${blocked.length} 个活动节点。`);
  }
  let removedAttributes = 0;
  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const compact = attribute.value.trim().replace(/[\u0000-\u0020]+/g, "").toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || compact.startsWith("javascript:") || compact.startsWith("vbscript:")) {
        element.removeAttribute(attribute.name);
        removedAttributes += 1;
      } else if (["href", "xlink:href", "src", "poster"].includes(name) && /^(?:https?:)?\/\//i.test(attribute.value.trim())) {
        element.removeAttribute(attribute.name);
        removedAttributes += 1;
      } else if (name === "style") {
        const cssWarnings: string[] = [];
        let css = sanitizeCss(attribute.value, cssWarnings).replace(/url\(\s*(['"]?)(?:https?:)?\/\/[^)]*\)/gi, "none");
        if (/(?:https?:)?\/\//i.test(css)) {
          css = "";
          warnings.push("preview.svg 已清空包含外部网络引用的 inline style。");
        }
        element.setAttribute(attribute.name, css);
        warnings.push(...cssWarnings.map((warning) => `preview.svg: ${warning}`));
      }
    }
  }
  for (const style of Array.from(document.querySelectorAll("style"))) {
    const cssWarnings: string[] = [];
    let css = sanitizeCss(style.textContent ?? "", cssWarnings).replace(/url\(\s*(['"]?)(?:https?:)?\/\/[^)]*\)/gi, "none");
    if (/(?:https?:)?\/\//i.test(css)) {
      css = "";
      warnings.push("preview.svg 已清空包含外部网络引用的样式表。");
    }
    style.textContent = css;
    warnings.push(...cssWarnings.map((warning) => `preview.svg: ${warning}`));
  }
  if (removedAttributes) warnings.push(`preview.svg 已移除 ${removedAttributes} 个活动或联网属性。`);
  const Serializer = document.defaultView?.XMLSerializer ?? globalThis.XMLSerializer;
  return { value: Serializer ? new Serializer().serializeToString(document.documentElement) : document.documentElement.outerHTML, warnings };
}

function sanitizePackageContent(value: string, contentType: "html" | "svg"): { value: string; warnings: string[] } {
  const Parser = globalThis.DOMParser;
  if (!Parser) {
    if (/<(?:script|iframe|object|embed|foreignObject)\b|\son[a-z]+\s*=|(?:javascript|vbscript):/i.test(value)) {
      throw new Error(`当前环境无法安全解析 ${contentType.toUpperCase()} 片段中的活动内容。`);
    }
    return { value, warnings: [] };
  }
  const document = new Parser().parseFromString(value, contentType === "svg" ? "image/svg+xml" : "text/html");
  const error = document.querySelector("parsererror");
  if (error) throw new Error(`片段内容无法解析：${error.textContent?.replace(/\s+/g, " ").trim()}`);
  const warnings = sanitizeDocument(document, contentType);
  const root = contentType === "svg" ? document.documentElement : document.body.firstElementChild;
  if (!root) throw new Error(`content.${contentType} 没有根元素。`);
  if (contentType === "html" && document.body.children.length !== 1) throw new Error("content.html 必须且只能包含一个片段根元素。");
  const Serializer = document.defaultView?.XMLSerializer ?? globalThis.XMLSerializer;
  const serialized = contentType === "svg" && Serializer ? new Serializer().serializeToString(root) : root.outerHTML;
  return { value: `${serialized}\n`, warnings };
}

export async function decodeVisualFragmentPackage(input: Blob | ArrayBuffer | Uint8Array): Promise<VisualFragmentPackage> {
  const bytes = await inputBytes(input);
  if (bytes.byteLength === 0) throw new Error(".vfrag 包为空。");
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new Error(`.vfrag 包超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MiB 上限。`);
  const { default: JSZip } = await import("jszip");
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  } catch (error) {
    throw new Error(`无法读取 .vfrag ZIP：${error instanceof Error ? error.message : String(error)}`);
  }

  const entries = Object.values(zip.files) as ZipEntryLike[];
  if (entries.length > MAX_FILE_COUNT) throw new Error(`.vfrag 文件数超过 ${MAX_FILE_COUNT} 个上限。`);
  const files = new Map<string, ZipEntryLike>();
  let declaredTotalBytes = 0;
  for (const entry of entries) {
    const original = entry.unsafeOriginalName ?? entry.name;
    const safe = safePackagePath(original.replace(/\/$/, ""));
    if (entry.dir) continue;
    if (entry.name !== original && entry.name !== safe) throw new Error(`ZIP 路径被隐式改写，已拒绝：${original}`);
    const declaredSize = entry._data?.uncompressedSize;
    if (typeof declaredSize === "number" && declaredSize > MAX_FILE_BYTES) throw new Error(`.vfrag 内文件过大：${safe}`);
    if (typeof declaredSize === "number") {
      declaredTotalBytes += declaredSize;
      if (declaredTotalBytes > MAX_PACKAGE_BYTES) throw new Error(".vfrag 声明的解压总量超过安全大小上限。");
    }
    if (files.has(safe)) throw new Error(`.vfrag 内路径重复：${safe}`);
    files.set(safe, entry);
  }

  const manifestEntry = files.get("manifest.json");
  if (!manifestEntry) throw new Error(".vfrag 缺少 manifest.json。");
  let manifestValue: unknown;
  let manifestText = "";
  try {
    manifestText = await manifestEntry.async("string");
    assertTextSize("manifest.json", manifestText);
    manifestValue = JSON.parse(manifestText);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Visual Fragment manifest")) throw error;
    throw new Error(`manifest.json 不是有效 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  assertVisualFragmentManifest(manifestValue);
  const manifest = manifestValue;

  const requiredText = async (path: string): Promise<string> => {
    const entry = files.get(safePackagePath(path));
    if (!entry) throw new Error(`.vfrag 缺少 ${path}。`);
    const value = await entry.async("string");
    assertTextSize(path, value);
    return value;
  };

  const warnings: string[] = [];
  const sanitizedContent = sanitizePackageContent(await requiredText(manifest.entry), manifest.contentType);
  const content = sanitizedContent.value;
  warnings.push(...sanitizedContent.warnings);
  const cssWarnings: string[] = [];
  const styles = sanitizeCss(await requiredText(manifest.styles), cssWarnings);
  warnings.push(...cssWarnings.map((warning) => `styles.css: ${warning}`));
  const tokensText = await requiredText(manifest.tokens);
  const tokens = parseTokens(tokensText);
  const preview = sanitizePreviewSvg(await requiredText(manifest.preview));
  const previewSvg = preview.value;
  warnings.push(...preview.warnings);
  const assets: ProjectAsset[] = [];
  const declaredAssets = new Map(manifest.assets.filter((asset) => !asset.external).map((asset) => [safeAssetPath(asset.path), asset]));
  let totalBytes = byteLength(manifestText) + byteLength(content) + byteLength(styles) + byteLength(tokensText) + byteLength(previewSvg);
  if (totalBytes > MAX_PACKAGE_BYTES) throw new Error(".vfrag 解压后超过安全大小上限。");
  for (const [path, dependency] of declaredAssets) {
    const entry = files.get(path);
    if (!entry) {
      if (dependency.required) throw new Error(`.vfrag 缺少必需资源：${path}`);
      warnings.push(`可选资源未包含：${path}`);
      continue;
    }
    const assetBytes = await entry.async("uint8array");
    totalBytes += assetBytes.byteLength;
    if (assetBytes.byteLength > MAX_FILE_BYTES || totalBytes > MAX_PACKAGE_BYTES) throw new Error(".vfrag 解压后超过安全大小上限。");
    assets.push({ path, mimeType: dependency.mimeType || guessMimeType(path), bytes: assetBytes });
  }

  const expected = new Set(["manifest.json", manifest.entry, manifest.styles, manifest.tokens, manifest.preview, ...declaredAssets.keys()]);
  for (const path of files.keys()) {
    if (!expected.has(path)) warnings.push(`忽略未在 manifest 声明的文件：${path}`);
  }
  if (manifest.permissions.network === "declared") warnings.push("片段声明了外部网络依赖；导入不会自动下载这些资源。");

  const fragment: VisualFragmentPackage = { manifest, content, styles, tokens, assets, previewSvg, warnings };
  validatePackageShape(fragment);
  return fragment;
}

export function visualFragmentBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: "application/vnd.last-mile-studio.vfrag+zip" });
}
