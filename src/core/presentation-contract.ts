import {
  projectPresentation,
  projectionDigest,
  type PresentationProjection,
} from "./presentation-projection";

export const PRESENTATION_CONTRACT_ID = "lms-editing-contract";
export const PRESENTATION_CONTRACT_META_NAME = "lms-contract-version";
export const PRESENTATION_CONTRACT_SCHEMA = "last-mile-studio/html-editing-contract";
export const PRESENTATION_CONTRACT_VERSION = 1 as const;

export interface PresentationEditingContractV1 {
  schema: typeof PRESENTATION_CONTRACT_SCHEMA;
  version: typeof PRESENTATION_CONTRACT_VERSION;
  contractRole: "declaration-and-audit-policy";
  sourceOfTruth: "canonical-static-dom";
  container: {
    id: string | null;
    tag: string | null;
    strategy: string;
    directPageTag: string;
  };
  page: {
    idAttribute: "data-editor-id";
    keyAttribute: "data-key";
    kindAttribute: "data-kind";
  };
  kindPolicy: {
    mode: "optional" | "enforce";
    backupValue: string;
    ordering: "report-only" | "enforce-only-when-declared";
  };
  build: {
    attribute: "data-build";
    value: "positive-integer";
    runtimeViewAttributes: string[];
  };
  editorScriptPolicy: "do-not-execute-source-scripts";
  runtimePolicy: {
    canonicalStructure: "must-not-change";
    allowedScopes: string[];
  };
  integrity: {
    projectionDigest: string;
    digestScope: "derived-projection";
  };
}

export interface PresentationContractParseResult {
  nodes: Element[];
  contract: PresentationEditingContractV1 | null;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateContract(value: unknown): value is PresentationEditingContractV1 {
  if (!isRecord(value)) return false;
  if (value.schema !== PRESENTATION_CONTRACT_SCHEMA || value.version !== PRESENTATION_CONTRACT_VERSION) return false;
  if (value.contractRole !== "declaration-and-audit-policy" || value.sourceOfTruth !== "canonical-static-dom") return false;
  if (!isRecord(value.container) || !isRecord(value.page) || !isRecord(value.kindPolicy) ||
      !isRecord(value.build) || !isRecord(value.runtimePolicy) || !isRecord(value.integrity)) return false;
  if (!requiredString(value.container.strategy) || !requiredString(value.container.directPageTag)) return false;
  if (value.page.idAttribute !== "data-editor-id" || value.page.keyAttribute !== "data-key" ||
      value.page.kindAttribute !== "data-kind") return false;
  if (value.kindPolicy.mode !== "optional" && value.kindPolicy.mode !== "enforce") return false;
  if (value.kindPolicy.ordering !== "report-only" && value.kindPolicy.ordering !== "enforce-only-when-declared") return false;
  if (value.build.attribute !== "data-build" || value.build.value !== "positive-integer" ||
      !Array.isArray(value.build.runtimeViewAttributes)) return false;
  if (value.editorScriptPolicy !== "do-not-execute-source-scripts") return false;
  if (value.runtimePolicy.canonicalStructure !== "must-not-change" || !Array.isArray(value.runtimePolicy.allowedScopes)) return false;
  if (!requiredString(value.integrity.projectionDigest) || value.integrity.digestScope !== "derived-projection") return false;
  return true;
}

export function readPresentationContract(document: Document): PresentationContractParseResult {
  const nodes = Array.from(document.querySelectorAll(`script#${PRESENTATION_CONTRACT_ID}[type="application/json"]`));
  if (nodes.length === 0) return { nodes, contract: null, error: null };
  if (nodes.length > 1) return { nodes, contract: null, error: `发现 ${nodes.length} 个重复的 #${PRESENTATION_CONTRACT_ID}。` };

  const text = nodes[0]?.textContent?.trim() ?? "";
  if (!text) return { nodes, contract: null, error: "编辑契约 JSON 为空。" };
  try {
    const value: unknown = JSON.parse(text);
    if (!validateContract(value)) return { nodes, contract: null, error: "编辑契约版本未知或字段不完整。" };
    return { nodes, contract: value, error: null };
  } catch {
    return { nodes, contract: null, error: "编辑契约 JSON 无法解析。" };
  }
}

function escapedJson(value: unknown): string {
  return (JSON.stringify(value, null, 2) ?? "null").replaceAll("<", "\\u003c");
}

export function contractFromProjection(projection: PresentationProjection): PresentationEditingContractV1 {
  const firstPageTag = projection.pages[0]?.tag ?? "section";
  return {
    schema: PRESENTATION_CONTRACT_SCHEMA,
    version: PRESENTATION_CONTRACT_VERSION,
    contractRole: "declaration-and-audit-policy",
    sourceOfTruth: "canonical-static-dom",
    container: {
      id: projection.container?.editorId ?? projection.container?.htmlId ?? null,
      tag: projection.container?.tag ?? null,
      strategy: projection.strategy,
      directPageTag: firstPageTag,
    },
    page: {
      idAttribute: "data-editor-id",
      keyAttribute: "data-key",
      kindAttribute: "data-kind",
    },
    kindPolicy: {
      mode: "optional",
      backupValue: "backup",
      ordering: "enforce-only-when-declared",
    },
    build: {
      attribute: "data-build",
      value: "positive-integer",
      runtimeViewAttributes: [
        "class:revealed",
        "aria-hidden",
        "data-lms-build-visible",
      ],
    },
    editorScriptPolicy: "do-not-execute-source-scripts",
    runtimePolicy: {
      canonicalStructure: "must-not-change",
      allowedScopes: [
        "active-page-state",
        "build-visibility",
        "speaker-notes",
        "fullscreen",
        "presentation-controls",
        "hud",
      ],
    },
    integrity: {
      projectionDigest: projectionDigest(projection),
      digestScope: "derived-projection",
    },
  };
}

export function upsertPresentationContract(
  document: Document,
  projection = projectPresentation(document, "html"),
): PresentationEditingContractV1 {
  const contract = contractFromProjection(projection);
  const existingNodes = Array.from(document.querySelectorAll(`#${PRESENTATION_CONTRACT_ID}`));
  existingNodes.forEach((node) => node.remove());

  const head = document.head ?? document.documentElement;
  if (!head) throw new Error("Cannot insert the presentation contract without a document root.");

  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${PRESENTATION_CONTRACT_META_NAME}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", PRESENTATION_CONTRACT_META_NAME);
    head.append(meta);
  }
  meta.setAttribute("content", String(PRESENTATION_CONTRACT_VERSION));

  const node = document.createElement("script");
  node.id = PRESENTATION_CONTRACT_ID;
  node.type = "application/json";
  node.textContent = escapedJson(contract);
  head.append(node);
  return contract;
}
