import { describe, expect, it } from "vitest";
import { colorValue } from "../src/ui/editor-app";

describe("color input normalization", () => {
  it("converts computed RGB colors to the equivalent native color-input value", () => {
    expect(colorValue("rgb(130, 226, 191)")).toBe("#82e2bf");
    expect(colorValue("rgba(21, 33, 59, 0.4)")).toBe("#15213b");
    expect(colorValue("rgb(50% 0% 100%)")).toBe("#8000ff");
  });

  it("preserves or expands hexadecimal colors", () => {
    expect(colorValue("#82e2bf")).toBe("#82e2bf");
    expect(colorValue("#8eB")).toBe("#88eebb");
  });
});
