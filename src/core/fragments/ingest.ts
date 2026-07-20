import { SourceDocument } from "../document-model";
import { ProjectAssets } from "../project";
import { extractVisualFragment } from "./extract";
import { decodeVisualFragmentPackage, inspectRasterImage } from "./package";
import {
  VISUAL_FRAGMENT_FORMAT,
  VISUAL_FRAGMENT_RASTER_FORMAT_VERSION,
  type VisualFragmentExtractOptions,
  type VisualFragmentPackage,
  type StructuredVisualFragmentPackage,
} from "./types";

export interface RawFragmentIngestOptions {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  sourceProject?: string;
}

function stem(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || "fragment";
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "fragment";
}

function base64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!;
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    result += alphabet[(value >>> 18) & 63];
    result += alphabet[(value >>> 12) & 63];
    result += second === undefined ? "=" : alphabet[(value >>> 6) & 63];
    result += third === undefined ? "=" : alphabet[value & 63];
  }
  return result;
}

function svgBounds(root: SVGSVGElement): { x: number; y: number; width: number; height: number } {
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0) {
    return { x: viewBox[0]!, y: viewBox[1]!, width: viewBox[2]!, height: viewBox[3]! };
  }
  const width = Number.parseFloat(root.getAttribute("width") ?? "");
  const height = Number.parseFloat(root.getAttribute("height") ?? "");
  return {
    x: 0,
    y: 0,
    width: Number.isFinite(width) && width > 0 ? width : 300,
    height: Number.isFinite(height) && height > 0 ? height : 150,
  };
}

export function createSvgVisualFragment(
  source: string,
  fileName: string,
  options: RawFragmentIngestOptions = {},
): StructuredVisualFragmentPackage {
  const model = SourceDocument.parse(source, fileName);
  if (model.kind !== "svg") throw new Error(`${fileName} 不是有效的 SVG 文档。`);
  const root = model.document.documentElement as unknown as SVGSVGElement;
  const bounds = svgBounds(root);
  const extractOptions: VisualFragmentExtractOptions = {
    name: options.name ?? stem(fileName),
    description: options.description ?? `Imported from ${fileName}`,
    fragmentType: "element",
    saveMode: "source-preserving",
    category: options.category ?? "Imported",
    tags: options.tags ?? ["svg"],
    version: "1.0.0",
    sourceProject: options.sourceProject ?? fileName,
  };
  return extractVisualFragment(model, new ProjectAssets(), fileName, [{ element: root, bounds }], extractOptions);
}

export function createRasterVisualFragment(
  bytes: Uint8Array,
  fileName: string,
  options: RawFragmentIngestOptions = {},
): VisualFragmentPackage {
  const info = inspectRasterImage(bytes);
  const entry = info.mimeType === "image/png" ? "content.png" : "content.jpg";
  const name = options.name ?? stem(fileName);
  const fragmentId = slug(name);
  const dataUrl = `data:${info.mimeType};base64,${base64(bytes)}`;
  return {
    manifest: {
      format: VISUAL_FRAGMENT_FORMAT,
      formatVersion: VISUAL_FRAGMENT_RASTER_FORMAT_VERSION,
      fragmentId,
      name,
      description: options.description ?? `Imported from ${fileName}`,
      fragmentType: "element",
      contentType: "raster",
      saveMode: "self-contained",
      entry,
      styles: "styles.css",
      tokens: "tokens.json",
      preview: "preview.svg",
      canvas: { width: info.width, height: info.height },
      coordinateSystem: {
        unit: "px",
        origin: { x: 0, y: 0 },
        originalBounds: { x: 0, y: 0, width: info.width, height: info.height },
      },
      insertion: { anchor: "top-left" },
      properties: [],
      slots: [],
      assets: [],
      fonts: [],
      permissions: { scripts: false, network: "none", origins: [] },
      provenance: {
        sourceProject: options.sourceProject ?? fileName,
        sourceDocument: fileName,
        createdAt: new Date().toISOString(),
        generator: "AfterPrompt",
      },
      version: "1.0.0",
      tags: options.tags ?? [info.mimeType === "image/png" ? "png" : "jpg"],
      category: options.category ?? "Imported",
    },
    content: new Uint8Array(bytes),
    styles: "",
    tokens: {},
    assets: [],
    previewSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}" viewBox="0 0 ${info.width} ${info.height}"><image width="${info.width}" height="${info.height}" href="${dataUrl}"/></svg>`,
    warnings: [],
  };
}

export async function ingestVisualFragmentBytes(
  bytes: Uint8Array,
  fileName: string,
  options: RawFragmentIngestOptions = {},
): Promise<VisualFragmentPackage> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".vfrag")) return decodeVisualFragmentPackage(bytes);
  if (lower.endsWith(".svg")) return createSvgVisualFragment(new TextDecoder().decode(bytes), fileName, options);
  if (/\.(?:png|jpe?g)$/.test(lower)) return createRasterVisualFragment(bytes, fileName, options);
  throw new Error("仅支持导入 .vfrag、.svg、.png、.jpg 或 .jpeg 文件。");
}
