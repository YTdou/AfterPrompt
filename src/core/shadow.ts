export interface ShadowValue {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
}

export interface ShadowPreset {
  id: string;
  label: string;
  value: ShadowValue | null;
}

export const DEFAULT_SHADOW: ShadowValue = { x: 0, y: 8, blur: 24, spread: -4, color: "#000000", opacity: 0.28 };

export const SHADOW_PRESETS: readonly ShadowPreset[] = [
  { id: "none", label: "无", value: null },
  { id: "soft", label: "柔和", value: { x: 0, y: 2, blur: 8, spread: 0, color: "#000000", opacity: 0.18 } },
  { id: "floating", label: "悬浮", value: { ...DEFAULT_SHADOW } },
  { id: "strong", label: "强烈", value: { x: 0, y: 12, blur: 32, spread: 0, color: "#000000", opacity: 0.38 } },
  { id: "glow", label: "发光", value: { x: 0, y: 0, blur: 18, spread: 2, color: "#5b8cff", opacity: 0.45 } },
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function byteHex(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
}

function parseColor(value: string): { color: string; opacity: number } | null {
  const hex = value.trim().match(/^#([\da-f]{6})$/i);
  if (hex) return { color: `#${hex[1]!.toLowerCase()}`, opacity: 1 };
  const rgb = value.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;
  const channels = rgb[1]!.split(/[,\s/]+/).filter(Boolean).map(Number);
  if (channels.length < 3 || channels.slice(0, 3).some((channel) => !Number.isFinite(channel))) return null;
  return {
    color: `#${byteHex(channels[0]!)}${byteHex(channels[1]!)}${byteHex(channels[2]!)}`,
    opacity: clamp(Number.isFinite(channels[3]) ? channels[3]! : 1, 0, 1),
  };
}

function hasTopLevelComma(value: string): boolean {
  let depth = 0;
  for (const character of value) {
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) return true;
  }
  return false;
}

export function parseBoxShadow(value: string): ShadowValue | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none" || hasTopLevelComma(trimmed) || /\binset\b/i.test(trimmed)) return null;
  const colorToken = trimmed.match(/rgba?\([^)]*\)|#[\da-f]{6}/i)?.[0];
  if (!colorToken) return null;
  const color = parseColor(colorToken);
  if (!color) return null;
  const lengths = trimmed.replace(colorToken, " ").match(/-?(?:\d+\.?\d*|\.\d+)px/g)?.map(Number.parseFloat) ?? [];
  if (lengths.length < 2 || lengths.some((length) => !Number.isFinite(length))) return null;
  return {
    x: lengths[0]!,
    y: lengths[1]!,
    blur: Math.max(0, lengths[2] ?? 0),
    spread: lengths[3] ?? 0,
    color: color.color,
    opacity: color.opacity,
  };
}

export function serializeBoxShadow(value: ShadowValue | null): string {
  if (!value) return "none";
  const hex = value.color.match(/^#([\da-f]{6})$/i)?.[1] ?? "000000";
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `${value.x}px ${value.y}px ${Math.max(0, value.blur)}px ${value.spread}px rgba(${red}, ${green}, ${blue}, ${clamp(value.opacity, 0, 1)})`;
}

export function matchingShadowPreset(value: ShadowValue | null): string | null {
  const serialized = serializeBoxShadow(value);
  return SHADOW_PRESETS.find((preset) => serializeBoxShadow(preset.value) === serialized)?.id ?? null;
}
