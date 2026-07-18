export interface FragmentStyleMigrationResult {
  removedFontFaces: number;
  removedBytes: number;
  changedStyleBlocks: number;
}

interface CssRuleRange {
  start: number;
  end: number;
  prelude: string;
  cssText: string;
}

function topLevelRules(css: string): CssRuleRange[] {
  const rules: CssRuleRange[] = [];
  let index = 0;
  const skipSpaceAndComments = (): void => {
    while (index < css.length) {
      if (/\s/.test(css[index]!)) index += 1;
      else if (css.startsWith("/*", index)) {
        const end = css.indexOf("*/", index + 2);
        index = end < 0 ? css.length : end + 2;
      } else break;
    }
  };

  while (index < css.length) {
    skipSpaceAndComments();
    const start = index;
    let quote = "";
    let parentheses = 0;
    let brackets = 0;
    while (index < css.length) {
      const character = css[index]!;
      if (quote) {
        if (character === quote && css[index - 1] !== "\\") quote = "";
      } else if (css.startsWith("/*", index)) {
        const end = css.indexOf("*/", index + 2);
        index = end < 0 ? css.length : end + 2;
        continue;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === "(") parentheses += 1;
      else if (character === ")") parentheses = Math.max(0, parentheses - 1);
      else if (character === "[") brackets += 1;
      else if (character === "]") brackets = Math.max(0, brackets - 1);
      else if (parentheses === 0 && brackets === 0 && (character === "{" || character === ";")) break;
      index += 1;
    }
    if (index >= css.length) break;
    const prelude = css.slice(start, index).trim();
    if (css[index] === ";") {
      index += 1;
      continue;
    }
    index += 1;
    let depth = 1;
    quote = "";
    while (index < css.length && depth > 0) {
      const character = css[index]!;
      if (quote) {
        if (character === quote && css[index - 1] !== "\\") quote = "";
      } else if (css.startsWith("/*", index)) {
        const end = css.indexOf("*/", index + 2);
        index = end < 0 ? css.length : end + 2;
        continue;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      index += 1;
    }
    if (depth !== 0) break;
    if (prelude) rules.push({ start, end: index, prelude, cssText: css.slice(start, index) });
  }
  return rules;
}

function fontFaceFingerprint(cssText: string): string {
  return cssText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([:;,{}])\s*/g, "$1")
    .trim();
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function compactRedundantFragmentFontFaces(document: Document): FragmentStyleMigrationResult {
  const result: FragmentStyleMigrationResult = { removedFontFaces: 0, removedBytes: 0, changedStyleBlocks: 0 };
  const seen = new Set<string>();
  const styles = Array.from(document.querySelectorAll("style"));

  for (const style of styles.filter((element) => !element.hasAttribute("data-vfrag-style"))) {
    for (const rule of topLevelRules(style.textContent ?? "")) {
      if (/^@font-face\b/i.test(rule.prelude)) seen.add(fontFaceFingerprint(rule.cssText));
    }
  }

  for (const style of styles.filter((element) => element.hasAttribute("data-vfrag-style"))) {
    const css = style.textContent ?? "";
    const removals: CssRuleRange[] = [];
    for (const rule of topLevelRules(css)) {
      if (!/^@font-face\b/i.test(rule.prelude)) continue;
      const fingerprint = fontFaceFingerprint(rule.cssText);
      if (seen.has(fingerprint)) removals.push(rule);
      else seen.add(fingerprint);
    }
    if (removals.length === 0) continue;
    let compacted = css;
    for (const removal of removals.reverse()) {
      result.removedBytes += byteLength(compacted.slice(removal.start, removal.end));
      compacted = `${compacted.slice(0, removal.start)}${compacted.slice(removal.end)}`;
    }
    style.textContent = compacted;
    result.removedFontFaces += removals.length;
    result.changedStyleBlocks += 1;
  }

  return result;
}
