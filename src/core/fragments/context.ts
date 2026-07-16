const TRANSIENT_BUILD_ATTRIBUTES = [
  "aria-hidden",
  "data-editor-build-label",
  "data-editor-build-relation",
  "data-editor-build-visibility",
  "data-editor-build-warning",
] as const;

function coordinateLayerChildren(root: Element): Element[] {
  return Array.from(root.children).flatMap((child) => {
    if (!child.hasAttribute("data-vfrag-coordinate-layer")) return [];
    return Array.from(child.children);
  });
}

/**
 * A selected top-level element's Build membership belongs to its source page,
 * not to the portable fragment definition. Descendant Build steps are left
 * untouched because they may describe choreography inside the component.
 */
export function neutralizePortableTopLevelBuild(element: Element, stabilizeLegacyStyle = false): boolean {
  if (!element.hasAttribute("data-build")) return false;
  const hadBuildRuntimeClass = element.classList.contains("build") || element.classList.contains("revealed");
  element.removeAttribute("data-build");
  element.classList.remove("build", "revealed");
  for (const attribute of TRANSIENT_BUILD_ATTRIBUTES) element.removeAttribute(attribute);
  if (!element.getAttribute("class")?.trim()) element.removeAttribute("class");

  if (stabilizeLegacyStyle && hadBuildRuntimeClass) {
    const style = (element as HTMLElement | SVGElement).style;
    // Old self-contained fragments may have sampled the hidden `.build`
    // frame into their node rule. Inline stable-state values safely outrank
    // those legacy rules without rewriting arbitrary user CSS.
    style.opacity = "1";
    style.filter = "none";
    style.visibility = "visible";
    style.pointerEvents = "auto";
  }
  return true;
}

export function normalizeFragmentRootBuildContext(root: Element, stabilizeLegacyStyle = false): number {
  return coordinateLayerChildren(root)
    .filter((element) => neutralizePortableTopLevelBuild(element, stabilizeLegacyStyle))
    .length;
}

export function normalizeLegacyFragmentBuildContexts(document: Document): number {
  return Array.from(document.querySelectorAll("[data-vfrag-root]"))
    .reduce((count, root) => count + normalizeFragmentRootBuildContext(root, true), 0);
}
