import type { CanvasSize } from "./types";

export const EDITABLE_HTML_FORMAT = "last-mile-studio/editable-html";
export const EDITABLE_HTML_VERSION = 1;

export interface EditableHtmlPayloadV1 {
  format: typeof EDITABLE_HTML_FORMAT;
  version: typeof EDITABLE_HTML_VERSION;
  source: string;
  sourceName: string;
  sourcePath: string;
  canvas: CanvasSize;
  checksum: string;
}

export interface DecodedEditableHtml {
  payload: EditableHtmlPayloadV1;
  legacy: boolean;
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
  const compact = value.replace(/\s+/g, "");
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function payloadChecksum(payload: Omit<EditableHtmlPayloadV1, "checksum">): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function encodeEditableHtmlPayload(payload: Omit<EditableHtmlPayloadV1, "checksum">): string {
  const complete: EditableHtmlPayloadV1 = { ...payload, checksum: payloadChecksum(payload) };
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(complete)));
}

export function decodeEditableHtmlPayload(encoded: string): EditableHtmlPayloadV1 {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(base64ToBytes(encoded)));
  } catch {
    throw new Error("The embedded AfterPrompt document payload is malformed.");
  }
  const payload = value as Partial<EditableHtmlPayloadV1>;
  if (payload.format !== EDITABLE_HTML_FORMAT || payload.version !== EDITABLE_HTML_VERSION ||
      typeof payload.source !== "string" || !payload.source.trim() || typeof payload.sourceName !== "string" ||
      typeof payload.sourcePath !== "string" || !payload.canvas ||
      !Number.isFinite(payload.canvas.width) || !Number.isFinite(payload.canvas.height)) {
    throw new Error("This AfterPrompt HTML format is unsupported or incomplete.");
  }
  const complete = payload as EditableHtmlPayloadV1;
  const { checksum, ...unsigned } = complete;
  if (typeof checksum !== "string" || checksum !== payloadChecksum(unsigned)) {
    throw new Error("The embedded AfterPrompt document payload failed its integrity check.");
  }
  return complete;
}

function quotedRuntimeValue(source: string, variableName: string): string | null {
  const match = source.match(new RegExp(`const\\s+${variableName}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*;`));
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return null;
  }
}

export function decodeEditableHtml(source: string, fallbackName = "presentation.html"): DecodedEditableHtml | null {
  if (!/<meta\s+name=["']lms-format["']\s+content=["']editable-html-presentation["']/i.test(source)) {
    // Compatibility with the 0.3.0 standalone exporter. Its canonical source was
    // recoverable, but only as a JavaScript string consumed by iframe.srcdoc.
    if (!/<meta\s+name=["']generator["']\s+content=["']Last Mile Studio 0\.3\.0["']/i.test(source) ||
        !source.includes("frame.srcdoc = decodeSource()")) return null;
    const sourceBase64 = quotedRuntimeValue(source, "sourceBase64");
    if (!sourceBase64) throw new Error("This legacy Last Mile Studio Slides file does not contain a recoverable source payload.");
    const innerSource = new TextDecoder().decode(base64ToBytes(sourceBase64));
    const canvasMatch = source.match(/const\s+canvas\s*=\s*(\{[^;]+\})\s*;/);
    let canvas: CanvasSize = { width: 1280, height: 720 };
    if (canvasMatch?.[1]) {
      try { canvas = JSON.parse(canvasMatch[1]) as CanvasSize; } catch { /* use fallback */ }
    }
    return {
      legacy: true,
      payload: {
        format: EDITABLE_HTML_FORMAT,
        version: EDITABLE_HTML_VERSION,
        source: innerSource,
        sourceName: fallbackName.replace(/-slides(?=\.html?$)/i, ""),
        sourcePath: fallbackName.replace(/-slides(?=\.html?$)/i, ""),
        canvas,
        checksum: "legacy-unverified",
      },
    };
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(source, "text/html");
  const payloadNode = document.querySelector<HTMLTemplateElement>("template#lms-document-payload[data-encoding='base64-json']");
  const encoded = payloadNode?.content.textContent?.trim() ?? "";
  if (!encoded) throw new Error("This AfterPrompt HTML file is missing its editable document payload.");
  return { payload: decodeEditableHtmlPayload(encoded), legacy: false };
}
