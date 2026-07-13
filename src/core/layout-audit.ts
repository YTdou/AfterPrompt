export interface LayoutSnapshot {
  id: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  letterSpacing: string;
  lineHeight: string;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  lineCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutDifference {
  id: string;
  fields: string[];
  expected: LayoutSnapshot;
  actual: LayoutSnapshot;
}

function textLineCount(element: Element): number {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  const tops = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => Math.round(rect.top * 2) / 2);
  return Math.max(1, new Set(tops).size);
}

export function captureLayout(root: Document | ShadowRoot | Element, scale = 1): LayoutSnapshot[] {
  const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Array.from(root.querySelectorAll<HTMLElement>("[data-editor-id]")).map((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      id: element.getAttribute("data-editor-id") ?? "",
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      lineCount: textLineCount(element),
      x: rect.x / normalizedScale,
      y: rect.y / normalizedScale,
      width: rect.width / normalizedScale,
      height: rect.height / normalizedScale,
    };
  }).filter(({ id }) => Boolean(id));
}

export function compareLayouts(expected: LayoutSnapshot[], actual: LayoutSnapshot[], tolerance = 0.5): LayoutDifference[] {
  const actualById = new Map(actual.map((snapshot) => [snapshot.id, snapshot]));
  const typographyFields: Array<keyof LayoutSnapshot> = ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight", "lineCount"];
  const geometryFields: Array<keyof LayoutSnapshot> = ["clientWidth", "clientHeight", "scrollWidth", "scrollHeight", "width", "height"];
  const differences: LayoutDifference[] = [];
  for (const baseline of expected) {
    const candidate = actualById.get(baseline.id);
    if (!candidate) continue;
    const fields = typographyFields.filter((field) => baseline[field] !== candidate[field]).map(String);
    for (const field of geometryFields) {
      if (Math.abs(Number(baseline[field]) - Number(candidate[field])) > tolerance) fields.push(String(field));
    }
    if (fields.length) differences.push({ id: baseline.id, fields, expected: baseline, actual: candidate });
  }
  return differences;
}
