import { describe, expect, it } from "vitest";
import { detectUiLocale, translateUiText } from "../src/ui/i18n";

describe("editor localization", () => {
  it("uses Chinese only when the browser reports a Chinese language", () => {
    expect(detectUiLocale(["zh-CN", "en-US"])).toBe("zh-CN");
    expect(detectUiLocale(["en-US", "zh-CN"])).toBe("zh-CN");
    expect(detectUiLocale(["en-US"])).toBe("en");
    expect(detectUiLocale([])).toBe("en");
  });

  it("translates direct labels and dynamic messages in both directions", () => {
    expect(translateUiText("导出", "en")).toBe("Export");
    expect(translateUiText("Export", "zh-CN")).toBe("导出");
    expect(translateUiText("已导出 sample.html", "en")).toBe("Exported sample.html");
    expect(translateUiText("Source applied to canvas", "zh-CN")).toBe("代码已应用到画布");
    expect(translateUiText('slide-a 的 data-build="bad" 不是正整数，已按 Always Visible 处理。', "en"))
      .toBe('slide-a has data-build="bad" that is not a positive integer; it was treated as Always Visible.');
    expect(translateUiText("Drop here to create Build 1", "zh-CN")).toBe("在此放置以创建构建步骤 1");
    expect(translateUiText("ai-slide.html", "zh-CN")).toBe("ai-slide.html");
    expect(translateUiText("sample.svg 不是有效的 SVG 文档。", "en")).toBe("sample.svg is not a valid SVG document.");
    expect(translateUiText("片段内容无法解析：bad source", "en")).toBe("Fragment content could not be parsed: bad source");
    expect(translateUiText("Visual Fragment manifest validation failed: $.name: Required field is missing", "zh-CN"))
      .toBe("Visual Fragment manifest 验证失败：$.name: 缺少必填字段");
    expect(translateUiText('$.type: 必须是 "a"、"b" 之一', "en")).toBe('$.type: Must be one of "a", "b"');
  });
});
