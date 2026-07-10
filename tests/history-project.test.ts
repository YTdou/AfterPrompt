import { describe, expect, it } from "vitest";
import { History } from "../src/core/history";
import {
  createSavedProject,
  exportProjectZip,
  parseSavedProject,
  ProjectAssets,
  resolveProjectPath,
} from "../src/core/project";

describe("History", () => {
  it("supports undo, redo, and coalesced continuous edits", () => {
    const history = new History({ value: 0 }, (left, right) => left.value === right.value);
    history.commit({ value: 1 }, "drag", "drag:item");
    history.commit({ value: 2 }, "drag", "drag:item");

    expect(history.value.value).toBe(2);
    expect(history.undo()?.value).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.redo()?.value).toBe(2);
  });

  it("clears redo history after a new branch", () => {
    const history = new History("a", (left, right) => left === right);
    history.commit("b", "B");
    history.undo();
    history.commit("c", "C");
    expect(history.redo()).toBeNull();
    expect(history.value).toBe("c");
  });
});

describe("project resource paths", () => {
  it("resolves local references relative to the source document", () => {
    expect(resolveProjectPath("../images/hero.png?size=2#x", "pages/deck/index.html")).toBe("pages/images/hero.png");
    expect(resolveProjectPath("assets/main.css", "index.html")).toBe("assets/main.css");
    expect(resolveProjectPath("https://example.com/image.png", "index.html")).toBeNull();
    expect(resolveProjectPath("data:image/png;base64,abc", "index.html")).toBeNull();
  });

  it("round-trips the readable project format and bundled assets", async () => {
    const assets = new ProjectAssets([{
      path: "assets/example.svg",
      mimeType: "image/svg+xml",
      bytes: new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>")
    }]);
    const saved = createSavedProject(
      "<!doctype html><p>hello</p>",
      "index.html",
      "index.html",
      "html",
      { width: 800, height: 600 },
      assets,
      [{ at: "2026-07-10T00:00:00.000Z", label: "Edit text", elementIds: ["title-001"], source: "ui" }],
    );
    const restored = parseSavedProject(JSON.stringify(saved));

    expect(restored.project.documentType).toBe("html");
    expect(restored.project.operations).toHaveLength(1);
    expect(new TextDecoder().decode(restored.assets.get("assets/example.svg")?.bytes)).toContain("<svg");

    const zipBlob = await exportProjectZip(saved.source, saved.sourcePath, restored.assets);
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(await zip.file("index.html")?.async("string")).toContain("hello");
    expect(await zip.file("assets/example.svg")?.async("string")).toContain("<svg");
  });
});
