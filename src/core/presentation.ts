import { resolveProjectPath, type ProjectAssets } from "./project";
import { sanitizeCss, sanitizeDocument } from "./sanitizer";
import { serializeDocument, type SourceDocument } from "./document-model";
import type { ProjectAsset } from "./types";
import {
  EDITABLE_HTML_FORMAT,
  EDITABLE_HTML_VERSION,
  encodeEditableHtmlPayload,
} from "./editable-html";
import { runtimePresentationLayoutCss } from "./presentation-layout";
import { refreshDeterministicTypography } from "./typography";
import { projectPresentation } from "./presentation-projection";
import { upsertPresentationContract } from "./presentation-contract";

export interface PreparedPresentationSource {
  source: string;
  pageIds: string[];
  pageLabels: string[];
  buildSteps: number[][];
  warnings: string[];
}

export interface StandaloneSlidesResult {
  html: string;
  pageCount: number;
  warnings: string[];
}

export interface InteractiveHtmlResult {
  html: string;
  warnings: string[];
}

export interface StandaloneSlidesOptions {
  initialPageIndex?: number;
}

const NATIVE_BUILD_COMPAT_STYLE_ID = "lms-native-build-compat";

function ensureNativeBuildCompatibility(document: Document): void {
  if (document.getElementById(NATIVE_BUILD_COMPAT_STYLE_ID)) return;
  if (!document.querySelector("[data-build]:not(.build)")) return;

  const nativeScripts = Array.from(document.querySelectorAll("script"))
    .map((script) => script.textContent ?? "")
    .join("\n");
  const usesRevealedProtocol = /classList\.toggle\(\s*['\"]revealed['\"]/.test(nativeScripts)
    && /querySelectorAll\(\s*['\"]\[data-build\]['\"]\s*\)/.test(nativeScripts);
  if (!usesRevealedProtocol) return;

  const style = document.createElement("style");
  style.id = NATIVE_BUILD_COMPAT_STYLE_ID;
  style.setAttribute("data-lms-runtime-compat", "native-build");
  style.textContent = `
/* The editor's canonical Build contract is data-build. Some native decks only
   hide elements carrying their legacy .build class, even though their player
   toggles .revealed on every [data-build] element. Bridge that contract without
   mutating the canonical DOM or overriding authored transforms. */
[data-build]:not(.build):not(.revealed) {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
[data-build]:not(.build).revealed {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
`;
  (document.head ?? document.documentElement).append(style);
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    result += alphabet[(combined >> 18) & 63];
    result += alphabet[(combined >> 12) & 63];
    result += second === undefined ? "=" : alphabet[(combined >> 6) & 63];
    result += third === undefined ? "=" : alphabet[combined & 63];
  }
  return result;
}

function assetDataUrl(asset: ProjectAsset): string {
  return `data:${asset.mimeType || "application/octet-stream"};base64,${bytesToBase64(asset.bytes)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]!);
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function rewriteCssAssets(css: string, cssPath: string, assets: ProjectAssets, warnings: Set<string>): string {
  return css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (match, _quote: string, reference: string) => {
    const path = resolveProjectPath(reference, cssPath);
    if (!path) return match;
    const asset = assets.get(path);
    if (!asset) {
      warnings.add(`独立演示稿未能内嵌本地资源：${path}`);
      return match;
    }
    const fragment = reference.includes("#") ? `#${reference.split("#").slice(1).join("#")}` : "";
    return `url("${assetDataUrl(asset)}${fragment}")`;
  });
}

function rewriteAttributeAsset(element: Element, attributeName: string, sourcePath: string, assets: ProjectAssets, warnings: Set<string>): void {
  const reference = element.getAttribute(attributeName);
  if (!reference) return;
  const path = resolveProjectPath(reference, sourcePath);
  if (!path) return;
  const asset = assets.get(path);
  if (!asset) {
    warnings.add(`独立演示稿未能内嵌本地资源：${path}`);
    return;
  }
  const fragment = reference.includes("#") ? `#${reference.split("#").slice(1).join("#")}` : "";
  element.setAttribute(attributeName, `${assetDataUrl(asset)}${fragment}`);
}

export function preparePresentationSource(model: SourceDocument, assets: ProjectAssets, sourcePath: string): PreparedPresentationSource {
  if (model.kind !== "html") throw new Error("Presentation export is available for HTML documents only.");
  const parser = new DOMParser();
  const document = parser.parseFromString(model.serialize(), "text/html");
  const warnings = new Set(sanitizeDocument(document, "html"));

  for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('head link[rel~="stylesheet"][href]'))) {
    const reference = link.getAttribute("href") ?? "";
    const path = resolveProjectPath(reference, sourcePath);
    if (!path) continue;
    const css = assets.text(path);
    if (css === null) {
      warnings.add(`独立演示稿未能内嵌本地样式表：${path}`);
      continue;
    }
    const cssWarnings: string[] = [];
    const style = document.createElement("style");
    style.setAttribute("data-lms-embedded-from", path);
    style.textContent = rewriteCssAssets(sanitizeCss(css, cssWarnings), path, assets, warnings);
    cssWarnings.forEach((warning) => warnings.add(warning));
    link.replaceWith(style);
  }

  for (const style of Array.from(document.querySelectorAll("style"))) {
    if (style.hasAttribute("data-lms-embedded-from")) continue;
    style.textContent = rewriteCssAssets(style.textContent ?? "", sourcePath, assets, warnings);
  }

  for (const element of Array.from(document.querySelectorAll("*"))) {
    rewriteAttributeAsset(element, "src", sourcePath, assets, warnings);
    rewriteAttributeAsset(element, "poster", sourcePath, assets, warnings);
    if (["image", "use"].includes(element.localName)) {
      rewriteAttributeAsset(element, "href", sourcePath, assets, warnings);
      rewriteAttributeAsset(element, "xlink:href", sourcePath, assets, warnings);
    }
    const inlineStyle = element.getAttribute("style");
    if (inlineStyle?.includes("url(")) {
      element.setAttribute("style", rewriteCssAssets(inlineStyle, sourcePath, assets, warnings));
    }
  }

  const projection = projectPresentation(document, "html");
  upsertPresentationContract(document, projection);
  const pageIds = projection.pages.map(({ editorId }) => editorId).filter((id): id is string => Boolean(id));
  const sourceLabels = new Map(model.pages().map(({ id, label }) => [id, label]));
  const pageLabels = projection.pages.map((page, index) => sourceLabels.get(page.editorId ?? "") ?? page.key ?? page.editorId ?? `Slide ${index + 1}`);
  const buildSteps = projection.pages.length > 0
    ? projection.pages.map(({ build }) => build.steps)
    : [projection.root?.build.steps ?? []];
  return {
    source: serializeDocument(document, "html"),
    pageIds,
    pageLabels,
    buildSteps,
    warnings: Array.from(warnings),
  };
}

/** Export the edited canonical HTML without replacing its native runtime. */
export function buildInteractiveHtml(model: SourceDocument, assets: ProjectAssets, sourcePath: string): InteractiveHtmlResult {
  if (model.kind !== "html") throw new Error("Interactive HTML export is available for HTML documents only.");
  const parser = new DOMParser();
  const document = parser.parseFromString(model.serialize(), "text/html");
  refreshDeterministicTypography(document);
  ensureNativeBuildCompatibility(document);
  const warnings = new Set<string>();

  for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('head link[rel~="stylesheet"][href]'))) {
    const reference = link.getAttribute("href") ?? "";
    const path = resolveProjectPath(reference, sourcePath);
    if (!path) continue;
    const css = assets.text(path);
    if (css === null) {
      warnings.add(`可交互 HTML 未能内嵌本地样式表：${path}`);
      continue;
    }
    const style = document.createElement("style");
    style.setAttribute("data-lms-embedded-from", path);
    style.textContent = rewriteCssAssets(css, path, assets, warnings);
    link.replaceWith(style);
  }

  for (const style of Array.from(document.querySelectorAll("style"))) {
    if (style.hasAttribute("data-lms-embedded-from")) continue;
    style.textContent = rewriteCssAssets(style.textContent ?? "", sourcePath, assets, warnings);
  }
  for (const element of Array.from(document.querySelectorAll("*"))) {
    rewriteAttributeAsset(element, "src", sourcePath, assets, warnings);
    rewriteAttributeAsset(element, "poster", sourcePath, assets, warnings);
    if (["image", "use"].includes(element.localName)) {
      rewriteAttributeAsset(element, "href", sourcePath, assets, warnings);
      rewriteAttributeAsset(element, "xlink:href", sourcePath, assets, warnings);
    }
    const inlineStyle = element.getAttribute("style");
    if (inlineStyle?.includes("url(")) element.setAttribute("style", rewriteCssAssets(inlineStyle, sourcePath, assets, warnings));
  }
  upsertPresentationContract(document, projectPresentation(document, "html"));
  return { html: serializeDocument(document, "html"), warnings: Array.from(warnings) };
}

export function buildStandaloneSlides(model: SourceDocument, assets: ProjectAssets, sourcePath: string, options: StandaloneSlidesOptions = {}): StandaloneSlidesResult {
  const prepared = preparePresentationSource(model, assets, sourcePath);
  const editablePayload = encodeEditableHtmlPayload({
    format: EDITABLE_HTML_FORMAT,
    version: EDITABLE_HTML_VERSION,
    source: prepared.source,
    sourceName: model.sourceName,
    sourcePath,
    canvas: { ...model.canvas },
  });
  const pageCount = Math.max(1, prepared.pageIds.length);
  const title = model.document.title?.trim() || model.sourceName.replace(/\.html?$/i, "") || "Presentation";
  const labels = prepared.pageLabels.length ? prepared.pageLabels : [title];
  const { width, height } = model.canvas;
  const initialPageIndex = Math.min(Math.max(0, Math.trunc(options.initialPageIndex ?? 0)), pageCount - 1);

  const innerRuntimeCss = runtimePresentationLayoutCss;
  const runtime = `
    (() => {
      const payloadNode = document.getElementById("lms-document-payload");
      const pageIds = ${scriptJson(prepared.pageIds)};
      const pageLabels = ${scriptJson(labels)};
      const pageBuildSteps = ${scriptJson(prepared.buildSteps)};
      const presentationTitle = ${scriptJson(title)};
      const canvas = ${scriptJson({ width, height })};
      const initialPageIndex = ${initialPageIndex};
      const innerRuntimeCss = ${scriptJson(innerRuntimeCss)};
      const frame = document.getElementById("lms-slides");
      const stage = document.getElementById("lms-stage");
      const previous = document.getElementById("lms-previous");
      const next = document.getElementById("lms-next");
      const status = document.getElementById("lms-status");
      const fullscreen = document.getElementById("lms-fullscreen");
      let slides = [];
      let index = 0;
      let buildPosition = 0;

      const decodeSource = () => {
        const encodedPayload = payloadNode.content.textContent.replace(/\\s+/g, "");
        const payloadBinary = atob(encodedPayload);
        const payloadBytes = Uint8Array.from(payloadBinary, (character) => character.charCodeAt(0));
        const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
        return payload.source;
      };

      const resize = () => {
        const scale = Math.min(window.innerWidth / canvas.width, window.innerHeight / canvas.height);
        stage.style.left = Math.max(0, (window.innerWidth - canvas.width * scale) / 2) + "px";
        stage.style.top = Math.max(0, (window.innerHeight - canvas.height * scale) / 2) + "px";
        stage.style.transform = "scale(" + scale + ")";
      };

      const applyBuildState = () => {
        const slide = slides[index];
        if (!slide) return;
        const steps = pageBuildSteps[index] || [];
        buildPosition = Math.min(Math.max(0, buildPosition), steps.length);
        const activeStep = buildPosition === 0 ? 0 : steps[buildPosition - 1];
        slide.querySelectorAll("[data-build]").forEach((element) => {
          const step = Number(element.getAttribute("data-build"));
          if (!Number.isInteger(step) || step <= 0) {
            element.removeAttribute("data-lms-build-visible");
            return;
          }
          const visible = step <= activeStep;
          element.setAttribute("data-lms-build-visible", visible ? "true" : "false");
          element.classList.toggle("revealed", visible);
          element.setAttribute("aria-hidden", visible ? "false" : "true");
        });
      };

      const show = (requested, requestedBuild = 0) => {
        if (!slides.length) return;
        index = Math.min(Math.max(0, requested), slides.length - 1);
        buildPosition = Math.min(Math.max(0, requestedBuild), (pageBuildSteps[index] || []).length);
        slides.forEach((slide, slideIndex) => {
          const active = slideIndex === index;
          slide.setAttribute("data-lms-slide", active ? "active" : "inactive");
          slide.setAttribute("aria-hidden", active ? "false" : "true");
        });
        applyBuildState();
        const buildCount = (pageBuildSteps[index] || []).length;
        previous.disabled = index === 0 && buildPosition === 0;
        next.disabled = index === slides.length - 1 && buildPosition === buildCount;
        const label = pageLabels[index] || "Slide " + (index + 1);
        const buildLabel = buildCount ? (buildPosition === 0 ? "Initial / " + buildCount : "Build " + buildPosition + " / " + buildCount) : "No builds";
        status.textContent = (index + 1) + " / " + slides.length + " · " + buildLabel + " · " + label;
        document.title = label + " — " + presentationTitle;
      };

      const forward = () => {
        const buildCount = (pageBuildSteps[index] || []).length;
        if (buildPosition < buildCount) show(index, buildPosition + 1);
        else if (index < slides.length - 1) show(index + 1, 0);
      };

      const backward = () => {
        if (buildPosition > 0) show(index, buildPosition - 1);
        else if (index > 0) show(index - 1, (pageBuildSteps[index - 1] || []).length);
      };

      frame.addEventListener("load", () => {
        const inner = frame.contentDocument;
        if (!inner) return;
        const style = inner.createElement("style");
        style.setAttribute("data-lms-presentation-runtime", "");
        style.textContent = innerRuntimeCss;
        (inner.head || inner.documentElement).append(style);
        slides = pageIds.map((id) => Array.from(inner.querySelectorAll("[data-editor-id]")).find((element) => element.getAttribute("data-editor-id") === id)).filter(Boolean);
        if (!slides.length && inner.body) slides = [inner.body];
        slides.forEach((slide) => {
          let ancestor = slide.parentElement;
          while (ancestor && ancestor !== inner.body) {
            ancestor.setAttribute("data-lms-deck", "");
            ancestor = ancestor.parentElement;
          }
        });
        show(initialPageIndex);
      }, { once: true });

      previous.addEventListener("click", backward);
      next.addEventListener("click", forward);
      fullscreen.addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
      document.addEventListener("keydown", (event) => {
        if (["ArrowRight", "PageDown", " "].includes(event.key)) { event.preventDefault(); forward(); }
        else if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); backward(); }
        else if (event.key === "Home") { event.preventDefault(); show(0, 0); }
        else if (event.key === "End") { event.preventDefault(); show(slides.length - 1, (pageBuildSteps[slides.length - 1] || []).length); }
      });
      window.addEventListener("resize", resize);
      resize();
      frame.srcdoc = decodeSource();
    })();
  `;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="generator" content="Last Mile Studio 0.4.0" />
  <meta name="lms-format" content="editable-html-presentation" />
  <meta name="lms-format-version" content="1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #080a0f; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #080a0f; }
    body { position: relative; }
    #lms-stage { position: absolute; width: ${width}px; height: ${height}px; transform-origin: 0 0; background: white; box-shadow: 0 24px 100px rgba(0,0,0,.55); }
    #lms-slides { display: block; width: 100%; height: 100%; border: 0; background: white; }
    #lms-controls { position: fixed; z-index: 10; right: 18px; bottom: 18px; display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid rgba(255,255,255,.18); border-radius: 10px; background: rgba(13,16,23,.86); box-shadow: 0 12px 40px rgba(0,0,0,.35); backdrop-filter: blur(10px); }
    #lms-controls button { min-width: 36px; height: 32px; padding: 0 10px; border: 1px solid rgba(255,255,255,.16); border-radius: 6px; background: rgba(255,255,255,.08); color: #eef3ff; font: inherit; cursor: pointer; }
    #lms-controls button:hover:not(:disabled) { background: rgba(255,255,255,.16); }
    #lms-controls button:disabled { opacity: .35; cursor: default; }
    #lms-status { min-width: 86px; color: #dbe4f5; font-size: 12px; text-align: center; }
    #lms-help { position: fixed; left: 16px; bottom: 14px; color: rgba(225,232,245,.58); font-size: 11px; }
  </style>
</head>
<body>
  <template id="lms-document-payload" data-encoding="base64-json">${editablePayload}</template>
  <main id="lms-stage"><iframe id="lms-slides" title="Presentation canvas" sandbox="allow-same-origin"></iframe></main>
  <nav id="lms-controls" aria-label="Presentation controls">
    <button id="lms-previous" type="button" aria-label="Previous slide">‹</button>
    <span id="lms-status" aria-live="polite">1 / ${pageCount}</span>
    <button id="lms-next" type="button" aria-label="Next slide">›</button>
    <button id="lms-fullscreen" type="button" aria-label="Toggle fullscreen">⛶</button>
  </nav>
  <div id="lms-help">← → / Page Up / Page Down</div>
  <script>${runtime}</script>
</body>
</html>
`;

  return { html, pageCount, warnings: prepared.warnings };
}
