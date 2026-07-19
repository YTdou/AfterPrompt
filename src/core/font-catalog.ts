import interUrl from "../assets/fonts/inter-latin-wght-normal.woff2?url";
import liberationSerifUrl from "../assets/fonts/catalog/LiberationSerif-Regular.ttf?url";
import sourceHanSansUrl from "../assets/fonts/catalog/SourceHanSansSC-VF.woff2?url";
import sourceHanSerifUrl from "../assets/fonts/catalog/SourceHanSerifSC-VF.woff2?url";
import lxgwWenKaiUrl from "../assets/fonts/catalog/LXGWWenKaiLite-Regular.ttf?url";
import type { SourceDocument } from "./document-model";
import type { ProjectAsset } from "./types";

export type FontCatalogGroup = "通用" | "西文衬线" | "中文黑体" | "中文宋体" | "中文楷体";

export interface FontCatalogEntry {
  id: string;
  label: string;
  group: FontCatalogGroup;
  cssFamily: string;
  managedFamily?: string;
  localNames?: string[];
  fallbackLabel?: string;
  asset?: {
    url: string;
    fileName: string;
    mimeType: string;
    format: "woff2" | "truetype";
    weight: string;
  };
}

export interface FontAvailability {
  kind: "local" | "bundled" | "generic";
  actualLabel: string;
  requestedLabel: string;
}

export const FONT_CATALOG: readonly FontCatalogEntry[] = [
  {
    id: "system-sans",
    label: "系统无衬线体",
    group: "通用",
    cssFamily: "ui-sans-serif, system-ui, sans-serif",
  },
  {
    id: "system-serif",
    label: "系统衬线体",
    group: "通用",
    cssFamily: "ui-serif, serif",
  },
  {
    id: "system-mono",
    label: "系统等宽体",
    group: "通用",
    cssFamily: "ui-monospace, monospace",
  },
  {
    id: "inter",
    label: "Inter",
    group: "通用",
    cssFamily: '"LMS Catalog Inter", sans-serif',
    managedFamily: "LMS Catalog Inter",
    localNames: ["Inter"],
    fallbackLabel: "Inter（内嵌）",
    asset: { url: interUrl, fileName: "Inter-Variable.woff2", mimeType: "font/woff2", format: "woff2", weight: "100 900" },
  },
  {
    id: "times-new-roman",
    label: "Times New Roman",
    group: "西文衬线",
    cssFamily: '"LMS Times New Roman", serif',
    managedFamily: "LMS Times New Roman",
    localNames: ["Times New Roman"],
    fallbackLabel: "Liberation Serif",
    asset: { url: liberationSerifUrl, fileName: "LiberationSerif-Regular.ttf", mimeType: "font/ttf", format: "truetype", weight: "400" },
  },
  {
    id: "liberation-serif",
    label: "Liberation Serif",
    group: "西文衬线",
    cssFamily: '"LMS Liberation Serif", serif',
    managedFamily: "LMS Liberation Serif",
    fallbackLabel: "Liberation Serif（内嵌）",
    asset: { url: liberationSerifUrl, fileName: "LiberationSerif-Regular.ttf", mimeType: "font/ttf", format: "truetype", weight: "400" },
  },
  {
    id: "microsoft-yahei",
    label: "微软雅黑",
    group: "中文黑体",
    cssFamily: '"LMS Microsoft YaHei", sans-serif',
    managedFamily: "LMS Microsoft YaHei",
    localNames: ["Microsoft YaHei", "微软雅黑"],
    fallbackLabel: "思源黑体 SC",
    asset: { url: sourceHanSansUrl, fileName: "SourceHanSansSC-VF.woff2", mimeType: "font/woff2", format: "woff2", weight: "100 900" },
  },
  {
    id: "source-han-sans",
    label: "思源黑体 SC",
    group: "中文黑体",
    cssFamily: '"LMS Source Han Sans SC", sans-serif',
    managedFamily: "LMS Source Han Sans SC",
    fallbackLabel: "思源黑体 SC（内嵌）",
    asset: { url: sourceHanSansUrl, fileName: "SourceHanSansSC-VF.woff2", mimeType: "font/woff2", format: "woff2", weight: "100 900" },
  },
  {
    id: "simsun",
    label: "宋体",
    group: "中文宋体",
    cssFamily: '"LMS SimSun", serif',
    managedFamily: "LMS SimSun",
    localNames: ["SimSun", "宋体", "Songti SC"],
    fallbackLabel: "思源宋体 SC",
    asset: { url: sourceHanSerifUrl, fileName: "SourceHanSerifSC-VF.woff2", mimeType: "font/woff2", format: "woff2", weight: "200 900" },
  },
  {
    id: "source-han-serif",
    label: "思源宋体 SC",
    group: "中文宋体",
    cssFamily: '"LMS Source Han Serif SC", serif',
    managedFamily: "LMS Source Han Serif SC",
    fallbackLabel: "思源宋体 SC（内嵌）",
    asset: { url: sourceHanSerifUrl, fileName: "SourceHanSerifSC-VF.woff2", mimeType: "font/woff2", format: "woff2", weight: "200 900" },
  },
  {
    id: "kaiti",
    label: "楷体",
    group: "中文楷体",
    cssFamily: '"LMS KaiTi", serif',
    managedFamily: "LMS KaiTi",
    localNames: ["KaiTi", "楷体", "STKaiti", "Kaiti SC"],
    fallbackLabel: "霞鹜文楷 Lite",
    asset: { url: lxgwWenKaiUrl, fileName: "LXGWWenKaiLite-Regular.ttf", mimeType: "font/ttf", format: "truetype", weight: "400" },
  },
  {
    id: "lxgw-wenkai",
    label: "霞鹜文楷 Lite",
    group: "中文楷体",
    cssFamily: '"LMS LXGW WenKai Lite", serif',
    managedFamily: "LMS LXGW WenKai Lite",
    fallbackLabel: "霞鹜文楷 Lite（内嵌）",
    asset: { url: lxgwWenKaiUrl, fileName: "LXGWWenKaiLite-Regular.ttf", mimeType: "font/ttf", format: "truetype", weight: "400" },
  },
] as const;

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function sourceDirectory(sourcePath: string): string {
  const normalized = normalizePath(sourcePath);
  return normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
}

function cssString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function fontEntryById(id: string): FontCatalogEntry | undefined {
  return FONT_CATALOG.find((entry) => entry.id === id);
}

export function fontEntryForFamily(value: string): FontCatalogEntry | undefined {
  const normalized = value.toLowerCase();
  return FONT_CATALOG.find((entry) =>
    (entry.managedFamily && normalized.includes(entry.managedFamily.toLowerCase())) ||
    entry.cssFamily.toLowerCase() === normalized,
  );
}

export function managedFontReference(entry: FontCatalogEntry): string | null {
  return entry.asset ? `.lms/fonts/${entry.asset.fileName}` : null;
}

export function managedFontAssetPath(entry: FontCatalogEntry, sourcePath: string): string | null {
  const reference = managedFontReference(entry);
  if (!reference) return null;
  const directory = sourceDirectory(sourcePath);
  return normalizePath(`${directory}/${reference}`);
}

export function managedFontFaceCss(entry: FontCatalogEntry): string {
  if (!entry.managedFamily || !entry.asset) return "";
  const sources = [
    ...(entry.localNames ?? []).map((name) => `local(${cssString(name)})`),
    `url(${cssString(managedFontReference(entry)!)}) format(${cssString(entry.asset.format)})`,
  ];
  return `@font-face {
  font-family: ${cssString(entry.managedFamily)};
  src: ${sources.join(", ")};
  font-style: normal;
  font-weight: ${entry.asset.weight};
  font-display: swap;
}`;
}

export async function loadManagedFontAsset(entry: FontCatalogEntry, sourcePath: string): Promise<ProjectAsset | null> {
  if (!entry.asset) return null;
  const response = await fetch(entry.asset.url);
  if (!response.ok) throw new Error(`无法载入字体 ${entry.label}：HTTP ${response.status}`);
  return {
    path: managedFontAssetPath(entry, sourcePath)!,
    mimeType: entry.asset.mimeType,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

export function ensureManagedFontFace(model: SourceDocument, entry: FontCatalogEntry): void {
  if (!entry.managedFamily || !entry.asset) return;
  const selector = `style[data-lms-managed-font="${entry.id}"]`;
  let style = model.document.querySelector<HTMLStyleElement | SVGStyleElement>(selector);
  if (!style) {
    style = model.kind === "svg"
      ? model.document.createElementNS("http://www.w3.org/2000/svg", "style")
      : model.document.createElement("style");
    style.setAttribute("data-lms-managed-font", entry.id);
    if (model.kind === "html") (model.document.head ?? model.document.documentElement).append(style);
    else model.document.documentElement.prepend(style);
  }
  style.textContent = managedFontFaceCss(entry);
}

export async function resolveFontAvailability(entry: FontCatalogEntry): Promise<FontAvailability> {
  if (!entry.managedFamily) return { kind: "generic", actualLabel: entry.label, requestedLabel: entry.label };
  if (typeof FontFace !== "undefined") {
    for (const localName of entry.localNames ?? []) {
      try {
        const probe = new FontFace(`LMS Probe ${entry.id}`, `local(${cssString(localName)})`);
        await probe.load();
        return { kind: "local", actualLabel: localName, requestedLabel: entry.label };
      } catch {
        // Try the next explicit local alias before using the bundled font.
      }
    }
  }
  return { kind: "bundled", actualLabel: entry.fallbackLabel ?? entry.label, requestedLabel: entry.label };
}
