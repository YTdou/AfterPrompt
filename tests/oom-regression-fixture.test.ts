import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { buildOomRegressionFixture } from "../scripts/oom-regression-fixture.mjs";

function structure(root: Element): Array<{ tag: string; id: string | null; parentId: string | null }> {
  return [root, ...Array.from(root.querySelectorAll("[data-editor-id]"))].map((element) => ({
    tag: element.localName,
    id: element.getAttribute("data-editor-id"),
    parentId: element === root ? null : element.parentElement?.closest("[data-editor-id]")?.getAttribute("data-editor-id") ?? null,
  }));
}

describe("deterministic OOM regression fixture", () => {
  it("pins the large input, page count, stable IDs, and fragment structure", () => {
    const fixture = buildOomRegressionFixture();
    const document = new JSDOM(fixture.source).window.document;
    const ids = Array.from(document.querySelectorAll("[data-editor-id]"), (element) => element.getAttribute("data-editor-id"));
    const fragmentRoot = document.querySelector(`[data-editor-id="${fixture.ids.fragmentRoot}"]`);

    expect(Buffer.byteLength(fixture.source)).toBeGreaterThan(8 * 1024 * 1024);
    expect(document.querySelectorAll("deck-stage > section")).toHaveLength(18);
    expect(document.querySelectorAll("style[data-vfrag-style]")).toHaveLength(18);
    expect(new Set(ids).size).toBe(ids.length);
    expect(fragmentRoot).not.toBeNull();
    expect(structure(fragmentRoot!)).toEqual([
      { tag: "article", id: "oom-fragment-root", parentId: null },
      { tag: "i", id: "oom-dot-low", parentId: "oom-fragment-root" },
      { tag: "i", id: "oom-dot-medium", parentId: "oom-fragment-root" },
      { tag: "i", id: "oom-dot-high", parentId: "oom-fragment-root" },
      { tag: "span", id: "oom-shot-label", parentId: "oom-fragment-root" },
    ]);
  });
});
