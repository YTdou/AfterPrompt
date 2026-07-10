import type { CanvasSize, DocumentKind, OperationLogEntry, ProjectAsset, SavedProject } from "./types";

const textMimePattern = /^(?:text\/|application\/(?:json|javascript|xml)|image\/svg\+xml)/i;

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function directoryName(path: string): string {
  const normalized = normalizePath(path);
  return normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
}

export function resolveProjectPath(reference: string, sourcePath: string): string | null {
  const clean = reference.trim();
  if (!clean || clean.startsWith("#") || /^(?:[a-z]+:)?\/\//i.test(clean) || /^(?:data|blob):/i.test(clean)) return null;
  const [withoutHash] = clean.split("#", 1);
  const [withoutQuery] = (withoutHash ?? clean).split("?", 1);
  if (!withoutQuery) return null;
  return normalizePath(`${directoryName(sourcePath)}/${decodeURIComponent(withoutQuery)}`);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export class ProjectAssets {
  private readonly assets = new Map<string, ProjectAsset>();
  private readonly urls = new Map<string, string>();

  constructor(initial: ProjectAsset[] = []) {
    initial.forEach((asset) => this.set(asset));
  }

  set(asset: ProjectAsset): void {
    const path = normalizePath(asset.path);
    const previousUrl = this.urls.get(path);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    this.urls.delete(path);
    this.assets.set(path, { ...asset, path });
  }

  get(path: string): ProjectAsset | undefined {
    return this.assets.get(normalizePath(path));
  }

  list(): ProjectAsset[] {
    return Array.from(this.assets.values());
  }

  clear(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.assets.clear();
  }

  objectUrl(path: string): string | null {
    const normalized = normalizePath(path);
    const existing = this.urls.get(normalized);
    if (existing) return existing;
    const asset = this.assets.get(normalized);
    if (!asset) return null;
    const url = URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: asset.mimeType }));
    this.urls.set(normalized, url);
    return url;
  }

  resolveUrl(reference: string, sourcePath: string): string {
    const path = resolveProjectPath(reference, sourcePath);
    return path ? (this.objectUrl(path) ?? reference) : reference;
  }

  text(path: string): string | null {
    const asset = this.get(path);
    if (!asset || !textMimePattern.test(asset.mimeType)) return null;
    return new TextDecoder().decode(asset.bytes);
  }

  rewriteCssUrls(css: string, cssPath: string): string {
    return css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (match, _quote: string, reference: string) => {
      const resolved = this.resolveUrl(reference, cssPath);
      return resolved === reference ? match : `url("${resolved}")`;
    });
  }

  dispose(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

export interface DirectoryImport {
  source: string;
  sourceName: string;
  sourcePath: string;
  assets: ProjectAssets;
}

export async function importDirectory(files: FileList | File[]): Promise<DirectoryImport> {
  const allFiles = Array.from(files);
  if (allFiles.length === 0) throw new Error("The selected directory is empty.");
  const withPaths = allFiles.map((file) => ({
    file,
    path: normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name),
  }));
  const candidates = withPaths.filter(({ path }) => /\.(?:html?|svg)$/i.test(path));
  if (candidates.length === 0) throw new Error("No HTML or SVG entry file was found in the directory.");
  const main = candidates.find(({ path }) => /(?:^|\/)index\.html?$/i.test(path)) ?? candidates[0]!;
  const source = await main.file.text();
  const assets: ProjectAsset[] = [];
  for (const item of withPaths) {
    if (item === main) continue;
    assets.push({
      path: item.path,
      mimeType: item.file.type || guessMimeType(item.path),
      bytes: new Uint8Array(await item.file.arrayBuffer()),
    });
  }
  return {
    source,
    sourceName: main.file.name,
    sourcePath: main.path,
    assets: new ProjectAssets(assets),
  };
}

export function guessMimeType(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return ({
    css: "text/css",
    js: "text/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    html: "text/html",
    htm: "text/html",
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

export function createSavedProject(
  source: string,
  sourceName: string,
  sourcePath: string,
  kind: DocumentKind,
  canvas: CanvasSize,
  assets: ProjectAssets,
  operations: OperationLogEntry[] = [],
): SavedProject {
  return {
    format: "last-mile-studio",
    version: 1,
    source,
    sourceName,
    sourcePath,
    documentType: kind,
    canvas: { ...canvas },
    operations: operations.map((entry) => ({ ...entry, elementIds: [...entry.elementIds] })),
    assets: assets.list().map((asset) => ({
      path: asset.path,
      mimeType: asset.mimeType,
      base64: bytesToBase64(asset.bytes),
    })),
    metadata: {
      savedAt: new Date().toISOString(),
      generator: "Last Mile Studio 0.1.0",
    },
  };
}

export function parseSavedProject(value: string): { project: SavedProject; assets: ProjectAssets } {
  const project = JSON.parse(value) as SavedProject;
  if (project.format !== "last-mile-studio" || project.version !== 1 || !project.source) {
    throw new Error("This is not a supported Last Mile Studio project file.");
  }
  project.operations ??= [];
  const assets = new ProjectAssets(project.assets.map((asset) => ({
    path: asset.path,
    mimeType: asset.mimeType,
    bytes: base64ToBytes(asset.base64),
  })));
  return { project, assets };
}

export async function exportProjectZip(source: string, sourcePath: string, assets: ProjectAssets): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(normalizePath(sourcePath) || "index.html", source);
  for (const asset of assets.list()) zip.file(asset.path, asset.bytes);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(source: string, fileName: string, mimeType: string): void {
  downloadBlob(new Blob([source], { type: `${mimeType};charset=utf-8` }), fileName);
}
