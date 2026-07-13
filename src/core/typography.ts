import { interVariableWoff2DataUrl } from "../assets/fonts/inter-latin-wght-normal";

export const DETERMINISTIC_FONT_FAMILY = "LMS Inter";
export const DETERMINISTIC_FONT_ATTRIBUTE = "data-lms-deterministic-font";
export const DETERMINISTIC_FONT_STYLE_ID = "lms-deterministic-typography";
export const EDITOR_FONT_STYLE_ID = "lms-editor-font-face";

export function deterministicFontFaceCss(): string {
  return `@font-face {
  font-family: "${DETERMINISTIC_FONT_FAMILY}";
  src: url("${interVariableWoff2DataUrl}") format("woff2");
  font-style: normal;
  font-weight: 100 900;
  font-display: block;
}`;
}

export function deterministicTypographyCss(): string {
  return `${deterministicFontFaceCss()}
:root[${DETERMINISTIC_FONT_ATTRIBUTE}="inter"],
:root[${DETERMINISTIC_FONT_ATTRIBUTE}="inter"] body,
:root[${DETERMINISTIC_FONT_ATTRIBUTE}="inter"] deck-stage {
  font-family: "${DETERMINISTIC_FONT_FAMILY}", sans-serif !important;
  font-synthesis: none;
  text-rendering: geometricPrecision;
}`;
}

export function deterministicEditorTypographyCss(): string {
  return `:host, body, deck-stage {
  font-family: "${DETERMINISTIC_FONT_FAMILY}", sans-serif !important;
  font-synthesis: none;
  text-rendering: geometricPrecision;
}`;
}

export function ensureEditorFontRegistered(): void {
  let style = document.getElementById(EDITOR_FONT_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = EDITOR_FONT_STYLE_ID;
    document.head.append(style);
  }
  style.textContent = deterministicFontFaceCss();
}

export function enableDeterministicTypography(document: Document): void {
  document.documentElement.setAttribute(DETERMINISTIC_FONT_ATTRIBUTE, "inter");
  let style = document.getElementById(DETERMINISTIC_FONT_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = DETERMINISTIC_FONT_STYLE_ID;
    document.head.append(style);
  }
  style.textContent = deterministicTypographyCss();
}

export function refreshDeterministicTypography(document: Document): void {
  if (document.documentElement.getAttribute(DETERMINISTIC_FONT_ATTRIBUTE) === "inter") {
    enableDeterministicTypography(document);
  }
}
