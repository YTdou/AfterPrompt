import type { DocumentKind } from "./types";

const blockedHtml = "script,iframe,object,embed,base,portal";
const blockedSvg = "script,foreignObject,animate,animateMotion,animateTransform,set";
const urlAttributes = new Set(["href", "src", "xlink:href", "poster", "action", "formaction"]);

function isPreservedInertDataBlock(element: Element): boolean {
  return element.localName === "script" &&
    element.getAttribute("type")?.toLowerCase() === "application/json" &&
    element.id === "lms-editing-contract";
}

function isDangerousUrl(value: string): boolean {
  const compact = value.trim().replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  if (compact.startsWith("javascript:") || compact.startsWith("vbscript:")) return true;
  if (compact.startsWith("data:") && !compact.startsWith("data:image/")) return true;
  return false;
}

function isExternalUrl(value: string): boolean {
  return /^(?:https?:)?\/\//i.test(value.trim());
}

export function sanitizeCss(css: string, warnings: string[]): string {
  let result = css;
  const importPattern = /@import\s+(?:url\()?[^;]+;?/gi;
  if (importPattern.test(result)) {
    warnings.push("已禁用 CSS @import；请通过项目目录导入本地样式。 ");
    result = result.replace(importPattern, "/* @import removed by Last Mile Studio */");
  }
  result = result.replace(/expression\s*\([^)]*\)/gi, "/* expression removed */");
  result = result.replace(/url\s*\(\s*(['\"]?)\s*javascript:[^)]*\)/gi, "none");
  result = result.replace(/-moz-binding\s*:[^;}]*/gi, "");
  return result;
}

export function sanitizeDocument(document: Document, kind: DocumentKind): string[] {
  const warnings: string[] = [];
  const blockedSelector = kind === "svg" ? blockedSvg : `${blockedHtml},${blockedSvg}`;
  const blocked = Array.from(document.querySelectorAll(blockedSelector)).filter((element) => !isPreservedInertDataBlock(element));
  if (blocked.length > 0) {
    warnings.push(`已移除 ${blocked.length} 个可执行或不安全节点。`);
    blocked.forEach((element) => element.remove());
  }

  let removedAttributes = 0;
  let externalResources = 0;
  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        removedAttributes += 1;
        continue;
      }
      if (urlAttributes.has(name)) {
        if (isDangerousUrl(attribute.value)) {
          element.removeAttribute(attribute.name);
          removedAttributes += 1;
        } else if (isExternalUrl(attribute.value)) {
          externalResources += 1;
        }
      }
      if (name === "style") {
        const sanitized = sanitizeCss(attribute.value, warnings);
        if (sanitized !== attribute.value) element.setAttribute(attribute.name, sanitized);
      }
    }
  }

  for (const style of Array.from(document.querySelectorAll("style"))) {
    style.textContent = sanitizeCss(style.textContent ?? "", warnings);
  }

  if (removedAttributes > 0) warnings.push(`已移除 ${removedAttributes} 个事件处理器或危险 URL 属性。`);
  if (externalResources > 0) warnings.push(`文档引用了 ${externalResources} 个外部资源；预览可能产生网络请求。`);
  return Array.from(new Set(warnings.map((warning) => warning.trim())));
}

export function isSafeAssetUrl(value: string): boolean {
  return !isDangerousUrl(value);
}
