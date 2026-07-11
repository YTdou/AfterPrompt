import { getElementByEditorId } from "./ids";
import type { BuildGroup, BuildWarning, PageBuildSequence } from "./types";

export function readBuildStep(element: Element): number | null {
  const raw = element.getAttribute("data-build");
  if (raw === null) return null;
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

function buildElements(page: Element): Element[] {
  return [page, ...Array.from(page.querySelectorAll("[data-build]"))]
    .filter((element, index, elements) => element.hasAttribute("data-build") && elements.indexOf(element) === index);
}

function warningForInvalid(element: Element): BuildWarning {
  const id = element.getAttribute("data-editor-id") ?? element.localName;
  return {
    code: "invalid-step",
    elementId: id,
    message: `${id} 的 data-build=${JSON.stringify(element.getAttribute("data-build"))} 不是正整数，已按 Always Visible 处理。`,
  };
}

export function deriveBuildSequence(page: Element): PageBuildSequence {
  const pageId = page.getAttribute("data-editor-id") ?? "";
  const groups = new Map<number, string[]>();
  const warnings: BuildWarning[] = [];

  for (const element of buildElements(page)) {
    const step = readBuildStep(element);
    const id = element.getAttribute("data-editor-id") ?? "";
    if (step === null) {
      warnings.push(warningForInvalid(element));
      continue;
    }
    if (!id) continue;
    const ids = groups.get(step) ?? [];
    ids.push(id);
    groups.set(step, ids);

    let ancestor = element.parentElement?.closest("[data-build]") ?? null;
    while (ancestor && page.contains(ancestor)) {
      const ancestorStep = readBuildStep(ancestor);
      if (ancestorStep !== null && ancestorStep > step) {
        warnings.push({
          code: "nested-conflict",
          elementId: id,
          message: `${id} 属于 Build ${step}，但可见祖先 ${ancestor.getAttribute("data-editor-id") ?? ancestor.localName} 要到 Build ${ancestorStep} 才出现。`,
        });
        break;
      }
      ancestor = ancestor.parentElement?.closest("[data-build]") ?? null;
    }
  }

  const steps = Array.from(groups.keys()).sort((left, right) => left - right);
  const buildGroups: BuildGroup[] = steps.map((step) => ({ step, elementIds: groups.get(step) ?? [] }));
  return {
    pageId,
    steps,
    groups: buildGroups,
    maxStep: steps.at(-1) ?? 0,
    elementCount: buildGroups.reduce((sum, group) => sum + group.elementIds.length, 0),
    warnings,
  };
}

export function setElementBuild(document: Document, elementIds: string[], step: number | null): void {
  if (step !== null && (!Number.isInteger(step) || step <= 0)) throw new Error("Build step must be a positive integer or null.");
  const elements = elementIds.map((id) => {
    const element = getElementByEditorId(document, id);
    if (!element) throw new Error(`Element not found: ${id}`);
    if (element.getAttribute("data-editor-locked") === "true") throw new Error(`Element is locked: ${id}`);
    return element;
  });
  elements.forEach((element) => {
    if (step === null) element.removeAttribute("data-build");
    else element.setAttribute("data-build", String(step));
    // Runtime state is never canonical Build data.
    element.classList.remove("revealed");
    element.removeAttribute("aria-hidden");
  });
}

function applyGroupOrder(document: Document, groups: BuildGroup[]): void {
  groups.forEach((group, index) => setElementBuild(document, group.elementIds, index + 1));
}

export function normalizeBuildSteps(document: Document, page: Element): void {
  applyGroupOrder(document, deriveBuildSequence(page).groups);
}

export function moveBuildGroup(document: Document, page: Element, fromStep: number, toStep: number): void {
  const groups = deriveBuildSequence(page).groups.map((group) => ({ ...group, elementIds: [...group.elementIds] }));
  const fromIndex = groups.findIndex((group) => group.step === fromStep);
  const toIndex = groups.findIndex((group) => group.step === toStep);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
  const [moved] = groups.splice(fromIndex, 1);
  groups.splice(toIndex, 0, moved!);
  applyGroupOrder(document, groups);
}

export function mergeBuildGroups(document: Document, page: Element, sourceStep: number, targetStep: number): void {
  if (sourceStep === targetStep) return;
  const sequence = deriveBuildSequence(page);
  const source = sequence.groups.find((group) => group.step === sourceStep);
  const target = sequence.groups.find((group) => group.step === targetStep);
  if (!source || !target) throw new Error("The Build group no longer exists.");
  const groups = sequence.groups
    .filter((group) => group.step !== sourceStep)
    .map((group) => group.step === targetStep
      ? { ...group, elementIds: [...group.elementIds, ...source.elementIds] }
      : { ...group, elementIds: [...group.elementIds] });
  applyGroupOrder(document, groups);
}

export function splitBuildGroup(document: Document, page: Element, elementIds: string[], targetPosition: number): void {
  if (!elementIds.length) return;
  const selected = new Set(elementIds);
  const sequence = deriveBuildSequence(page);
  const pageElements = elementIds.map((id) => getElementByEditorId(document, id));
  if (pageElements.some((element) => !element || !(element === page || page.contains(element)))) {
    throw new Error("All split elements must belong to the active page.");
  }
  const groups = sequence.groups
    .map((group) => ({ ...group, elementIds: group.elementIds.filter((id) => !selected.has(id)) }))
    .filter((group) => group.elementIds.length > 0);
  const position = Math.min(Math.max(0, Math.trunc(targetPosition)), groups.length);
  groups.splice(position, 0, { step: -1, elementIds: [...selected] });
  applyGroupOrder(document, groups);
}
