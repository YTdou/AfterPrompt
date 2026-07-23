import { decodeEditableHtml } from "./editable-html";
import { readBuildStep } from "./builds";
import {
  PRESENTATION_CONTRACT_VERSION,
  readPresentationContract,
  type PresentationEditingContractV1,
} from "./presentation-contract";
import {
  detectPresentationPages,
  projectPresentation,
  projectionDigest,
  type PresentationProjection,
} from "./presentation-projection";
import type { DocumentKind } from "./types";

export type PresentationAuditSeverity = "ERROR" | "WARNING" | "INFO";

export interface PresentationAuditIssue {
  severity: PresentationAuditSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface PresentationAuditReport {
  valid: boolean;
  legacy: boolean;
  projection: PresentationProjection;
  contract: PresentationEditingContractV1 | null;
  issues: PresentationAuditIssue[];
}

export interface PresentationSourceAuditReport extends PresentationAuditReport {
  sourceMode: "direct" | "reversible" | "legacy-wrapper";
  payloadChecksum: "valid" | "legacy-unverified" | "not-applicable" | "invalid";
}

export interface PresentationAuditOptions {
  warnIfContractMissing?: boolean;
}

function issue(
  severity: PresentationAuditSeverity,
  code: string,
  message: string,
  path?: string,
): PresentationAuditIssue {
  return path ? { severity, code, message, path } : { severity, code, message };
}

function isPresentationLike(document: Document): boolean {
  const detection = detectPresentationPages(document, "html");
  return detection.mode === "deck" || Boolean(document.querySelector("deck-stage, [data-editor-deck], .slides, [data-slides], [data-build]"));
}

function auditStableIds(document: Document, projection: PresentationProjection, contract: PresentationEditingContractV1 | null, issues: PresentationAuditIssue[]): void {
  const elements = [
    ...(document.body ? [document.body] : []),
    ...Array.from(document.querySelectorAll("[data-editor-id]")),
  ].filter((element, index, values) => values.indexOf(element) === index);
  const owners = new Map<string, Element>();
  for (const element of elements) {
    const id = element.getAttribute("data-editor-id")?.trim() ?? "";
    if (!id) continue;
    const previous = owners.get(id);
    if (previous) {
      issues.push(issue("ERROR", "duplicate-editor-id", `data-editor-id=${JSON.stringify(id)} 在原始 DOM 中重复。`, `[data-editor-id="${id}"]`));
    } else {
      owners.set(id, element);
    }
  }

  for (const page of projection.pages) {
    if (page.editorId) continue;
    issues.push(issue(
      contract ? "ERROR" : "WARNING",
      "page-id-missing",
      `第 ${page.index + 1} 个静态页面缺少 data-editor-id${contract ? "，无法满足已声明契约" : "，旧格式可在导入时兼容补充"}。`,
      `pages[${page.index}]`,
    ));
  }

  if (contract) {
    const editableWithoutIds = Array.from(document.querySelectorAll("body *"))
      .filter((element) => !["script", "style", "meta", "link", "template"].includes(element.localName))
      .filter((element) => !element.hasAttribute("data-editor-id"));
    if (editableWithoutIds.length > 0) {
      issues.push(issue(
        "WARNING",
        "element-id-missing",
        `发现 ${editableWithoutIds.length} 个未声明 data-editor-id 的元素；编辑器导入可能会兼容补 ID。`,
      ));
    }
  }
}

function auditBuilds(document: Document, projection: PresentationProjection, issues: PresentationAuditIssue[]): void {
  for (const element of Array.from(document.querySelectorAll("[data-build]"))) {
    if (readBuildStep(element) !== null) continue;
    issues.push(issue(
      "ERROR",
      "invalid-build-step",
      `${element.getAttribute("data-editor-id") ?? element.localName} 的 data-build=${JSON.stringify(element.getAttribute("data-build"))} 不是正整数。`,
      element.getAttribute("data-editor-id") ? `[data-editor-id="${element.getAttribute("data-editor-id")}"]` : element.localName,
    ));
  }

  const sequences = [
    ...projection.pages.map((page) => page.build),
    ...(projection.root ? [projection.root.build] : []),
  ];
  for (const sequence of sequences) {
    for (const warning of sequence.warnings) {
      issues.push(issue("WARNING", `build-${warning.code}`, warning.message));
    }
  }
}

function auditRuntimeHeuristics(document: Document, issues: PresentationAuditIssue[]): void {
  const structuralMutation = /\b(?:insertBefore|appendChild|prepend|removeChild|replaceChild|\.remove\s*\(|innerHTML\s*=|outerHTML\s*=)\b/;
  Array.from(document.querySelectorAll("script:not([type='application/json'])")).forEach((script, index) => {
    const text = script.textContent ?? "";
    if (!structuralMutation.test(text)) return;
    issues.push(issue(
      "WARNING",
      "runtime-structure-heuristic",
      "源脚本包含疑似结构变更 API；静态扫描只能提供 heuristic warning，需通过浏览器 projection parity 确认是否触及 canonical 页面。",
      `script[${index}]`,
    ));
  });
}

function auditContract(
  document: Document,
  projection: PresentationProjection,
  contract: PresentationEditingContractV1 | null,
  issues: PresentationAuditIssue[],
): void {
  if (!contract) return;

  const actualContainer = projection.container;
  const declaredContainerId = contract.container.id;
  const actualContainerId = actualContainer?.editorId ?? actualContainer?.htmlId ?? null;
  if (contract.container.tag !== actualContainer?.tag || contract.container.strategy !== projection.strategy ||
      declaredContainerId !== actualContainerId) {
    issues.push(issue("ERROR", "contract-container-mismatch", "契约声明的页面容器与当前 canonical DOM 不一致。", "container"));
  }

  if (projection.pages.some((page) => page.tag !== contract.container.directPageTag)) {
    issues.push(issue("ERROR", "contract-page-tag-mismatch", "契约声明的直接页面节点类型与当前页面不一致。", "container.directPageTag"));
  }

  if (contract.kindPolicy.mode === "enforce") {
    projection.pages.forEach((page) => {
      if (!page.kind) issues.push(issue("ERROR", "page-kind-missing", `页面 ${page.index + 1} 缺少契约要求的 data-kind。`, `pages[${page.index}]`));
    });
  }

  if (contract.kindPolicy.ordering === "enforce-only-when-declared") {
    let backupSeen = false;
    projection.pages.forEach((page) => {
      if (page.kind === contract.kindPolicy.backupValue) backupSeen = true;
      else if (backupSeen && page.kind) {
        issues.push(issue("ERROR", "page-kind-ordering", "Backup 页面之后出现了带 kind 的主页面，违反契约声明的页面顺序。", `pages[${page.index}]`));
      }
    });
  }

  const digest = projectionDigest(projection);
  if (contract.integrity.projectionDigest !== digest) {
    issues.push(issue(
      "ERROR",
      "projection-digest-mismatch",
      `projection digest 已过期：契约为 ${contract.integrity.projectionDigest}，当前为 ${digest}。`,
      "integrity.projectionDigest",
    ));
  }

  if (contract.version !== PRESENTATION_CONTRACT_VERSION) {
    issues.push(issue("ERROR", "unsupported-contract-version", `不支持的编辑契约版本：${contract.version}。`, "version"));
  }
}

export function auditPresentationDocument(
  document: Document,
  kind: DocumentKind = "html",
  options: PresentationAuditOptions = {},
): PresentationAuditReport {
  const projection = projectPresentation(document, kind);
  const issues: PresentationAuditIssue[] = [];
  const parsed = kind === "html" ? readPresentationContract(document) : { contract: null, nodes: [], error: null };
  const contract = parsed.contract;

  if (parsed.error) issues.push(issue("ERROR", "contract-invalid", parsed.error, `#${parsed.nodes[0]?.id ?? "lms-editing-contract"}`));

  const detection = detectPresentationPages(document, kind);
  if (detection.candidateParents.length > 1) {
    issues.push(issue("ERROR", "multiple-page-containers", "页面节点分布在多个候选容器中，canonical 页面容器不唯一。", "container"));
  }

  const shouldWarnLegacy = options.warnIfContractMissing ?? true;
  if (!contract && !parsed.error && shouldWarnLegacy && kind === "html" && isPresentationLike(document)) {
    issues.push(issue("WARNING", "contract-absent", "文件没有编辑契约，按旧版兼容模式导入；导出时会生成 v1 契约。"));
  }

  auditStableIds(document, projection, contract, issues);
  auditBuilds(document, projection, issues);
  auditContract(document, projection, contract, issues);
  if (kind === "html") auditRuntimeHeuristics(document, issues);

  issues.push(issue("INFO", "projection-summary", `projection: ${projection.pages.length} 页，${projection.pages.reduce((sum, page) => sum + page.build.groups.length, 0)} 个 Build group。`));
  return {
    valid: issues.every(({ severity }) => severity !== "ERROR"),
    legacy: !contract,
    projection,
    contract,
    issues,
  };
}

function parseHtmlSource(source: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(source, "text/html");
}

function auditWrapperRuntime(source: string, issues: PresentationAuditIssue[]): void {
  const outer = parseHtmlSource(source);
  const patchPattern = /(?:return\s+payload\.source|payload\.source\s*=)[\s\S]{0,800}(?:\.replace\s*\(|innerHTML\s*=|outerHTML\s*=|\.remove\s*\(|removeChild\s*\(|insertBefore\s*\(|appendChild\s*\()/;
  Array.from(outer.querySelectorAll("script:not([type='application/json'])")).forEach((script, index) => {
    const text = script.textContent ?? "";
    if (!/decodeSource|lms-document-payload|payload\.source/.test(text) || !patchPattern.test(text)) return;
    issues.push(issue(
      "ERROR",
      "outer-payload-patch",
      "reversible wrapper 的 outer runtime 疑似通过 replace/remove/HTML 写入修改 payload.source；canonical source 必须直接承载内容变化。",
      `outer-script[${index}]`,
    ));
  });
}

export function auditPresentationSource(source: string, sourceName = "presentation.html"): PresentationSourceAuditReport {
  try {
    const editable = decodeEditableHtml(source, sourceName);
    const canonicalSource = editable?.payload.source ?? source;
    const document = parseHtmlSource(canonicalSource);
    const report = auditPresentationDocument(document, "html");
    if (editable) auditWrapperRuntime(source, report.issues);
    if (editable?.legacy) {
      report.issues.unshift(issue("WARNING", "legacy-wrapper", "这是旧版 standalone wrapper，payload checksum 未经过验证；重新导出会升级格式。"));
    }
    report.valid = report.issues.every(({ severity }) => severity !== "ERROR");
    return {
      ...report,
      legacy: report.legacy || Boolean(editable?.legacy),
      sourceMode: editable ? (editable.legacy ? "legacy-wrapper" : "reversible") : "direct",
      payloadChecksum: editable ? (editable.legacy ? "legacy-unverified" : "valid") : "not-applicable",
    };
  } catch (error) {
    const document = parseHtmlSource("<!doctype html><html><body></body></html>");
    const report = auditPresentationDocument(document, "html", { warnIfContractMissing: false });
    report.issues.unshift(issue("ERROR", "payload-invalid", error instanceof Error ? error.message : String(error), sourceName));
    return {
      ...report,
      valid: false,
      sourceMode: "reversible",
      payloadChecksum: "invalid",
    };
  }
}

export function formatPresentationAuditIssue(item: PresentationAuditIssue): string {
  return `[${item.severity}] ${item.code}: ${item.message}${item.path ? ` (${item.path})` : ""}`;
}
