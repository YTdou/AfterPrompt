import manifestSchema from "../../../schemas/visual-fragment-manifest.schema.json";
import type {
  VisualFragmentManifest,
  VisualFragmentValidationIssue,
  VisualFragmentValidationResult,
} from "./types";

type JsonSchema = Record<string, unknown>;

export const visualFragmentManifestSchema = manifestSchema as JsonSchema;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => key in right && deepEqual(left[key], right[key]));
  }
  return false;
}

function typeMatches(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecord(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}

function resolveReference(reference: string): JsonSchema | null {
  if (!reference.startsWith("#/") || reference.includes("~")) return null;
  let value: unknown = visualFragmentManifestSchema;
  for (const part of reference.slice(2).split("/")) {
    if (!isRecord(value) || !(part in value)) return null;
    value = value[part];
  }
  return isRecord(value) ? value : null;
}

function appendIssue(issues: VisualFragmentValidationIssue[], path: string, message: string): void {
  issues.push({ path: path || "$", message });
}

function validateNode(value: unknown, schema: JsonSchema, path: string, issues: VisualFragmentValidationIssue[]): void {
  if (typeof schema.$ref === "string") {
    const resolved = resolveReference(schema.$ref);
    if (!resolved) appendIssue(issues, path, `无法解析 Schema 引用 ${schema.$ref}`);
    else validateNode(value, resolved, path, issues);
    return;
  }

  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.filter((candidate) => {
      if (!isRecord(candidate)) return false;
      const candidateIssues: VisualFragmentValidationIssue[] = [];
      validateNode(value, candidate, path, candidateIssues);
      return candidateIssues.length === 0;
    }).length;
    if (matched !== 1) appendIssue(issues, path, "值必须且只能匹配一个允许的 Schema 分支");
    return;
  }

  if ("const" in schema && !deepEqual(value, schema.const)) {
    appendIssue(issues, path, `必须等于 ${JSON.stringify(schema.const)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(value, candidate))) {
    appendIssue(issues, path, `必须是 ${schema.enum.map((candidate) => JSON.stringify(candidate)).join("、")} 之一`);
    return;
  }

  const acceptedTypes = typeof schema.type === "string"
    ? [schema.type]
    : Array.isArray(schema.type) ? schema.type.filter((item): item is string => typeof item === "string") : [];
  if (acceptedTypes.length > 0 && !acceptedTypes.some((type) => typeMatches(value, type))) {
    appendIssue(issues, path, `类型必须是 ${acceptedTypes.join(" 或 ")}`);
    return;
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) appendIssue(issues, path, `长度不能小于 ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) appendIssue(issues, path, `长度不能大于 ${schema.maxLength}`);
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) appendIssue(issues, path, `不符合格式 ${schema.pattern}`);
      } catch {
        appendIssue(issues, path, "Schema 包含无效的正则表达式");
      }
    }
    if (schema.format === "date-time" && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value)))) {
      appendIssue(issues, path, "必须是有效的 ISO 8601 日期时间");
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) appendIssue(issues, path, `不能小于 ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) appendIssue(issues, path, `不能大于 ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) appendIssue(issues, path, `必须大于 ${schema.exclusiveMinimum}`);
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) appendIssue(issues, path, `必须小于 ${schema.exclusiveMaximum}`);
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) appendIssue(issues, path, `项目数不能小于 ${schema.minItems}`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) appendIssue(issues, path, `项目数不能大于 ${schema.maxItems}`);
    if (schema.uniqueItems === true) {
      for (let index = 0; index < value.length; index += 1) {
        if (value.slice(index + 1).some((candidate) => deepEqual(value[index], candidate))) {
          appendIssue(issues, path, "数组项目必须唯一");
          break;
        }
      }
    }
    if (isRecord(schema.items)) value.forEach((item, index) => validateNode(item, schema.items as JsonSchema, `${path}[${index}]`, issues));
  }

  if (isRecord(value)) {
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
    for (const key of required) {
      if (!(key in value) || value[key] === undefined) appendIssue(issues, `${path}.${key}`, "缺少必填字段");
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      const childSchema = properties[key];
      if (isRecord(childSchema)) validateNode(child, childSchema, `${path}.${key}`, issues);
      else if (schema.additionalProperties === false) appendIssue(issues, `${path}.${key}`, "不允许未知字段");
    }
  }
}

function addSemanticIssues(value: Record<string, unknown>, issues: VisualFragmentValidationIssue[]): void {
  const contentType = value.contentType;
  const entry = value.entry;
  if ((contentType === "html" && entry !== "content.html") || (contentType === "svg" && entry !== "content.svg")) {
    appendIssue(issues, "$.entry", "入口文件必须与 contentType 一致");
  }
  const canvas = isRecord(value.canvas) ? value.canvas : {};
  if (typeof canvas.width === "number" && typeof canvas.height === "number" && canvas.width * canvas.height > 100_000_000) {
    appendIssue(issues, "$.canvas", "画布面积不能超过 100,000,000 像素");
  }

  for (const key of ["properties", "slots"] as const) {
    const items = Array.isArray(value[key]) ? value[key] as Array<Record<string, unknown>> : [];
    const names = new Set<string>();
    items.forEach((item, index) => {
      if (typeof item.name !== "string") return;
      if (names.has(item.name)) appendIssue(issues, `$.${key}[${index}].name`, "名称在同一片段中必须唯一");
      names.add(item.name);
      if (key === "properties" && item.type === "enum" && (!Array.isArray(item.options) || item.options.length === 0)) {
        appendIssue(issues, `$.properties[${index}].options`, "enum 属性必须提供至少一个选项");
      }
      if (key === "properties" && item.defaultValue !== undefined) {
        if (item.type === "number" && typeof item.defaultValue !== "number") appendIssue(issues, `$.properties[${index}].defaultValue`, "number 属性默认值必须是数字");
        if (item.type === "boolean" && typeof item.defaultValue !== "boolean") appendIssue(issues, `$.properties[${index}].defaultValue`, "boolean 属性默认值必须是布尔值");
        if (item.type === "enum" && Array.isArray(item.options) && !item.options.includes(item.defaultValue)) appendIssue(issues, `$.properties[${index}].defaultValue`, "enum 默认值必须属于 options");
      }
      if (key === "slots" && isRecord(item.size)) {
        const pairs: Array<[string, string]> = [["minWidth", "maxWidth"], ["minHeight", "maxHeight"]];
        for (const [minimum, maximum] of pairs) {
          if (typeof item.size[minimum] === "number" && typeof item.size[maximum] === "number" && item.size[minimum] > item.size[maximum]) {
            appendIssue(issues, `$.slots[${index}].size`, `${minimum} 不能大于 ${maximum}`);
          }
        }
      }
    });
  }

  const permissions = isRecord(value.permissions) ? value.permissions : {};
  if (permissions.network === "none" && Array.isArray(permissions.origins) && permissions.origins.length > 0) {
    appendIssue(issues, "$.permissions.origins", "network 为 none 时不能声明网络来源");
  }
  if (Array.isArray(permissions.origins)) {
    permissions.origins.forEach((origin, index) => {
      if (typeof origin !== "string") return;
      try {
        const parsed = new URL(origin);
        if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== origin) appendIssue(issues, `$.permissions.origins[${index}]`, "必须是规范化的 HTTP(S) origin");
      } catch {
        appendIssue(issues, `$.permissions.origins[${index}]`, "不是有效 URL origin");
      }
    });
  }

  const fragmentType = value.fragmentType;
  const properties = Array.isArray(value.properties) ? value.properties : [];
  const slots = Array.isArray(value.slots) ? value.slots : [];
  if (["element", "group"].includes(String(fragmentType)) && (properties.length > 0 || slots.length > 0)) {
    appendIssue(issues, "$.fragmentType", "element 和 group 不能声明组件属性或插槽");
  }
  if (fragmentType === "template" && slots.length === 0) appendIssue(issues, "$.slots", "template 必须声明至少一个插槽");

  for (const key of ["assets", "fonts"] as const) {
    const items = Array.isArray(value[key]) ? value[key] as Array<Record<string, unknown>> : [];
    const identityName = key === "assets" ? "path" : "family";
    const identities = new Set<string>();
    items.forEach((item, index) => {
      const identity = item[identityName];
      if (typeof identity !== "string") return;
      if (identities.has(identity)) appendIssue(issues, `$.${key}[${index}].${identityName}`, "依赖标识必须唯一");
      identities.add(identity);
    });
  }
}

export function validateVisualFragmentManifest(value: unknown): VisualFragmentValidationResult {
  const issues: VisualFragmentValidationIssue[] = [];
  validateNode(value, visualFragmentManifestSchema, "$", issues);
  if (isRecord(value) && issues.length === 0) addSemanticIssues(value, issues);
  return { valid: issues.length === 0, issues };
}

export function assertVisualFragmentManifest(value: unknown): asserts value is VisualFragmentManifest {
  const result = validateVisualFragmentManifest(value);
  if (result.valid) return;
  const detail = result.issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join("；");
  throw new Error(`Visual Fragment manifest 验证失败：${detail}${result.issues.length > 8 ? `；另有 ${result.issues.length - 8} 项` : ""}`);
}
