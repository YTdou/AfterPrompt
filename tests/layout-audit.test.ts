import { describe, expect, it } from "vitest";
import { compareLayouts, type LayoutSnapshot } from "../src/core/layout-audit";

function snapshot(overrides: Partial<LayoutSnapshot> = {}): LayoutSnapshot {
  return {
    id: "title",
    fontFamily: '"LMS Inter", sans-serif',
    fontSize: "32px",
    fontWeight: "700",
    letterSpacing: "0px",
    lineHeight: "normal",
    clientWidth: 500,
    clientHeight: 40,
    scrollWidth: 500,
    scrollHeight: 40,
    lineCount: 1,
    x: 10,
    y: 20,
    width: 500,
    height: 40,
    ...overrides,
  };
}

describe("layout parity audit", () => {
  it("accepts sub-pixel geometry noise within tolerance", () => {
    expect(compareLayouts([snapshot()], [snapshot({ width: 500.4, height: 40.4 })])).toEqual([]);
  });

  it("reports a one-line to two-line typography drift", () => {
    const differences = compareLayouts([snapshot()], [snapshot({ lineCount: 2, height: 80, scrollHeight: 80 })]);
    expect(differences).toHaveLength(1);
    expect(differences[0]?.fields).toEqual(expect.arrayContaining(["lineCount", "height", "scrollHeight"]));
  });

  it("reports resolved font mismatches", () => {
    const differences = compareLayouts([snapshot()], [snapshot({ fontFamily: '"DejaVu Sans"' })]);
    expect(differences[0]?.fields).toContain("fontFamily");
  });
});
