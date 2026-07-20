#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { JSDOM } from "jsdom";
import { getTransformValues, readDeclaredBounds } from "../core/commands";
import { detectDocumentKind, SourceDocument } from "../core/document-model";
import { extractVisualFragment } from "../core/fragments/extract";
import { applyVisualFragmentInsertPlan, planVisualFragmentInsert } from "../core/fragments/import";
import { ingestVisualFragmentBytes } from "../core/fragments/ingest";
import { decodeVisualFragmentPackage, encodeVisualFragmentPackage } from "../core/fragments/package";
import {
  createSavedProject,
  parseSavedProject,
  ProjectAssets,
} from "../core/project";
import type { VisualFragmentPlacement, VisualFragmentProperty, VisualFragmentSlot, VisualFragmentType } from "../core/fragments/types";
import type { Bounds, DocumentKind, EditorCommand, OperationLogEntry, SavedProject } from "../core/types";

function installDomGlobals(): void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, {
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
  });
}

interface ParsedInput {
  model: SourceDocument;
  assets: ProjectAssets;
  sourcePath: string;
  project?: SavedProject;
}

function modelFromSource(source: string, sourceName: string, forcedKind?: DocumentKind, canvas?: { width: number; height: number }): SourceDocument {
  const kind = forcedKind ?? detectDocumentKind(source, sourceName);
  const dom = new JSDOM(source, {
    contentType: kind === "svg" ? "image/svg+xml" : "text/html",
    pretendToBeVisual: true,
  });
  return SourceDocument.fromDocument(dom.window.document, kind, sourceName, canvas);
}

function runtimeBounds(element: Element, kind: DocumentKind): Bounds {
  const fallback = readDeclaredBounds(element, kind);
  if (kind === "svg") return fallback;
  const view = element.ownerDocument.defaultView;
  if (!view) return fallback;
  const style = view.getComputedStyle(element);
  const transform = getTransformValues(element);
  const parsed = (value: string, defaultValue: number): number => {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : defaultValue;
  };
  const width = parsed(style.width, fallback.width);
  let height = parsed(style.height, fallback.height);
  if (height <= 0 && element.textContent?.trim()) {
    const fontSize = parsed(style.fontSize, 16);
    const lineHeightValue = style.lineHeight.trim();
    const lineHeightNumber = Number.parseFloat(lineHeightValue);
    const lineHeight = !Number.isFinite(lineHeightNumber) || lineHeightValue === "normal"
      ? fontSize * 1.2
      : lineHeightValue.endsWith("%")
        ? fontSize * lineHeightNumber / 100
        : lineHeightValue.endsWith("em") || /^-?(?:\d+|\d*\.\d+)$/.test(lineHeightValue)
          ? fontSize * lineHeightNumber
          : lineHeightNumber;
    const letterSpacing = style.letterSpacing.endsWith("em")
      ? fontSize * parsed(style.letterSpacing, 0)
      : parsed(style.letterSpacing, 0);
    const averageGlyphWidth = Math.max(1, fontSize * 0.55 + letterSpacing);
    const charactersPerLine = width > 0 ? Math.max(1, Math.floor(width / averageGlyphWidth)) : Number.POSITIVE_INFINITY;
    const lineCount = element.textContent.split("\n").reduce((total, line) => (
      total + Math.max(1, Math.ceil(line.trim().length / charactersPerLine))
    ), 0);
    height = lineHeight * lineCount;
  }
  return {
    x: parsed(style.left, fallback.x) + transform.x,
    y: parsed(style.top, fallback.y) + transform.y,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

async function readInput(path: string): Promise<ParsedInput> {
  const value = await readFile(path, "utf8");
  if (path.endsWith(".visual-project.json") || path.endsWith(".lastmile.json")) {
    const { project, assets } = parseSavedProject(value);
    return {
      project,
      assets,
      sourcePath: project.sourcePath,
      model: modelFromSource(project.source, project.sourceName, project.documentType, project.canvas),
    };
  }
  return { model: modelFromSource(value, path), assets: new ProjectAssets(), sourcePath: basename(path) };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function has(args: string[], name: string): boolean {
  return args.includes(name);
}

function print(value: unknown): void {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

function usage(): never {
  print(`AfterPrompt CLI

Usage:
  npm run cli -- list <input>
  npm run cli -- get <input> <element-id>
  npm run cli -- summary <input> [--output summary.json]
  npm run cli -- fragments <input>
  npm run cli -- prepare <input> --output <output>
  npm run cli -- apply <input> --commands <commands.json> (--output <output> | --in-place)
  npm run cli -- validate <input>
  npm run cli -- fragment-inspect <fragment.vfrag>
  npm run cli -- fragment-validate <fragment.vfrag>
  npm run cli -- fragment-create <input> --elements <id,id> --name <name> --output <fragment.vfrag>
      [--type element|group|component|template] [--mode source-preserving|self-contained]
      [--fragment-id <stable-id>] [--version 1.0.0] [--category <name>] [--tags <tag,tag>]
      [--schema component-schema.json]
  npm run cli -- fragment-pack <input.svg|input.png|input.jpg> --output <fragment.vfrag>
      [--name <name>] [--description <text>] [--category <name>] [--tags <tag,tag>]
  npm run cli -- fragment-insert <input> --fragment <fragment.vfrag> --parent <element-id>
      [--placement center|original|x,y] [--linked] (--output <output> | --in-place)

Input may be HTML, SVG, or *.visual-project.json. apply accepts one command object
or an array of command objects. fragment-create may receive a JSON file with
{ properties, slots } through --schema. Source files are never overwritten
unless --in-place is explicitly present.`);
  process.exit(1);
}

async function writeAssets(outputPath: string, assets: ProjectAssets): Promise<number> {
  const outputDirectory = resolve(dirname(outputPath));
  let written = 0;
  for (const asset of assets.list()) {
    const destination = resolve(outputDirectory, asset.path);
    if (destination !== outputDirectory && !destination.startsWith(`${outputDirectory}/`)) throw new Error(`Refusing to write asset outside output directory: ${asset.path}`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, asset.bytes);
    written += 1;
  }
  return written;
}

async function writeResult(inputPath: string, parsed: ParsedInput, outputPath: string): Promise<void> {
  const asProject = parsed.project || /\.visual-project\.json$|\.lastmile\.json$/i.test(outputPath);
  let assetsWritten = 0;
  if (asProject) {
    const value = createSavedProject(
      parsed.model.serialize(),
      parsed.project?.sourceName ?? basename(outputPath).replace(/\.visual-project\.json$/i, ".html"),
      parsed.project?.sourcePath ?? basename(outputPath).replace(/\.visual-project\.json$/i, ".html"),
      parsed.model.kind,
      parsed.model.canvas,
      parsed.assets,
      parsed.project?.operations ?? [],
    );
    await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } else {
    await writeFile(outputPath, parsed.model.serialize(), "utf8");
    assetsWritten = await writeAssets(outputPath, parsed.assets);
  }
  print({ input: inputPath, output: outputPath, documentType: parsed.model.kind, assetsWritten });
}

function fragmentType(value: string | undefined, selectionCount: number): VisualFragmentType {
  const fallback: VisualFragmentType = selectionCount === 1 ? "element" : "group";
  const type = value ?? fallback;
  if (!["element", "group", "component", "template"].includes(type)) throw new Error(`Unsupported fragment type: ${type}`);
  return type as VisualFragmentType;
}

function fragmentPlacement(value = "center"): VisualFragmentPlacement {
  if (value === "center" || value === "original") return { mode: value };
  const match = value.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (!match) throw new Error("--placement must be center, original, or x,y.");
  return { mode: "point", x: Number(match[1]), y: Number(match[2]) };
}

async function readComponentSchema(path: string | undefined): Promise<{ properties: VisualFragmentProperty[]; slots: VisualFragmentSlot[] }> {
  if (!path) return { properties: [], slots: [] };
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("--schema must contain a JSON object.");
  const record = value as Record<string, unknown>;
  if (record.properties !== undefined && !Array.isArray(record.properties)) throw new Error("--schema properties must be an array.");
  if (record.slots !== undefined && !Array.isArray(record.slots)) throw new Error("--schema slots must be an array.");
  return {
    properties: (record.properties ?? []) as VisualFragmentProperty[],
    slots: (record.slots ?? []) as VisualFragmentSlot[],
  };
}

function appendCliOperation(parsed: ParsedInput, label: string, elementIds: string[]): void {
  if (!parsed.project) return;
  parsed.project.operations ??= [];
  const entry: OperationLogEntry = { at: new Date().toISOString(), label, elementIds, source: "cli" };
  parsed.project.operations.push(entry);
}

async function main(): Promise<void> {
  installDomGlobals();
  const args = process.argv.slice(2);
  const command = args[0];
  const inputPath = args[1];
  if (!command || !inputPath || has(args, "--help")) usage();
  if (command === "fragment-inspect" || command === "fragment-validate") {
    const fragment = await decodeVisualFragmentPackage(await readFile(inputPath));
    if (command === "fragment-validate") {
      print({
        valid: true,
        fragmentId: fragment.manifest.fragmentId,
        version: fragment.manifest.version,
        contentType: fragment.manifest.contentType,
        assets: fragment.assets.length,
        warnings: fragment.warnings,
      });
    } else {
      print({
        manifest: fragment.manifest,
        files: {
          entry: fragment.manifest.entry,
          contentBytes: typeof fragment.content === "string" ? new TextEncoder().encode(fragment.content).byteLength : fragment.content.byteLength,
          stylesBytes: new TextEncoder().encode(fragment.styles).byteLength,
          previewBytes: new TextEncoder().encode(fragment.previewSvg).byteLength,
          assets: fragment.assets.map((asset) => ({ path: asset.path, mimeType: asset.mimeType, bytes: asset.bytes.byteLength })),
        },
        warnings: fragment.warnings,
      });
    }
    return;
  }
  if (command === "fragment-pack") {
    const outputPath = option(args, "--output");
    if (!outputPath) throw new Error("fragment-pack requires --output <fragment.vfrag>.");
    const fragment = await ingestVisualFragmentBytes(new Uint8Array(await readFile(inputPath)), basename(inputPath), {
      name: option(args, "--name"),
      description: option(args, "--description"),
      category: option(args, "--category"),
      tags: (option(args, "--tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      sourceProject: inputPath,
    });
    const bytes = await encodeVisualFragmentPackage(fragment);
    await writeFile(outputPath, bytes);
    print({ output: outputPath, fragmentId: fragment.manifest.fragmentId, contentType: fragment.manifest.contentType, bytes: bytes.byteLength });
    return;
  }
  const parsed = await readInput(inputPath);

  if (command === "fragment-create") {
    const ids = (option(args, "--elements") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    const name = option(args, "--name");
    const outputPath = option(args, "--output");
    if (!ids.length || !name || !outputPath) throw new Error("fragment-create requires --elements, --name, and --output.");
    const mode = option(args, "--mode") ?? "self-contained";
    if (!['source-preserving', 'self-contained'].includes(mode)) throw new Error(`Unsupported fragment mode: ${mode}`);
    const items = ids.map((id) => {
      const element = parsed.model.find(id);
      if (!element) throw new Error(`Element not found: ${id}`);
      return { element, bounds: runtimeBounds(element, parsed.model.kind) };
    });
    const schema = await readComponentSchema(option(args, "--schema"));
    const fragment = extractVisualFragment(parsed.model, parsed.assets, parsed.sourcePath, items, {
      fragmentId: option(args, "--fragment-id"),
      name,
      description: option(args, "--description") ?? "",
      fragmentType: fragmentType(option(args, "--type"), items.length),
      saveMode: mode as "source-preserving" | "self-contained",
      category: option(args, "--category") ?? "Uncategorized",
      tags: (option(args, "--tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      version: option(args, "--version") ?? "1.0.0",
      sourceProject: inputPath,
      properties: schema.properties,
      slots: schema.slots,
    });
    const bytes = await encodeVisualFragmentPackage(fragment);
    await writeFile(outputPath, bytes);
    print({ output: outputPath, fragmentId: fragment.manifest.fragmentId, version: fragment.manifest.version, bytes: bytes.byteLength, warnings: fragment.warnings });
    return;
  }

  if (command === "fragment-insert") {
    const fragmentPath = option(args, "--fragment");
    const parentId = option(args, "--parent");
    const outputPath = has(args, "--in-place") ? inputPath : option(args, "--output");
    if (!fragmentPath || !parentId || !outputPath) throw new Error("fragment-insert requires --fragment, --parent, and --output or --in-place.");
    const fragment = await decodeVisualFragmentPackage(await readFile(fragmentPath));
    const plan = planVisualFragmentInsert(parsed.model, parsed.assets, fragment, {
      parentId,
      placement: fragmentPlacement(option(args, "--placement")),
      linked: has(args, "--linked"),
      targetSourcePath: parsed.project ? parsed.sourcePath : basename(outputPath),
    });
    if (!plan.report.compatible) throw new Error(`Fragment compatibility check failed:\n${JSON.stringify(plan.report, null, 2)}`);
    const inserted = applyVisualFragmentInsertPlan(parsed.model, parsed.assets, plan);
    appendCliOperation(parsed, `Insert fragment ${fragment.manifest.fragmentId}@${fragment.manifest.version}`, inserted.rootEditorIds);
    await writeResult(inputPath, parsed, outputPath);
    print({ inserted: inserted.rootEditorIds, instanceId: inserted.instanceId, compatibility: inserted.report });
    return;
  }

  if (command === "list") {
    print(parsed.model.summary((element) => runtimeBounds(element, parsed.model.kind)).elements.map(({ id, type, tag, name, parentId, locked, visible }) => ({ id, type, tag, name, parentId, locked, visible })));
    return;
  }
  if (command === "get") {
    const id = args[2];
    if (!id) usage();
    const summary = parsed.model.elementSummary(id, (element) => runtimeBounds(element, parsed.model.kind));
    if (!summary) throw new Error(`Element not found: ${id}`);
    print(summary);
    return;
  }
  if (command === "summary") {
    const result = `${JSON.stringify(parsed.model.summary((element) => runtimeBounds(element, parsed.model.kind)), null, 2)}\n`;
    const outputPath = option(args, "--output");
    if (outputPath) await writeFile(outputPath, result, "utf8");
    else process.stdout.write(result);
    return;
  }
  if (command === "fragments") {
    print(parsed.model.summary((element) => runtimeBounds(element, parsed.model.kind)).fragments);
    return;
  }
  if (command === "validate") {
    print({
      valid: true,
      documentType: parsed.model.kind,
      elements: parsed.model.summary().elements.length,
      canvas: parsed.model.canvas,
      warnings: parsed.model.warnings,
    });
    return;
  }
  if (command === "prepare") {
    const outputPath = option(args, "--output");
    if (!outputPath) throw new Error("prepare requires --output; the input is kept unchanged.");
    await writeResult(inputPath, parsed, outputPath);
    return;
  }
  if (command === "apply") {
    const commandPath = option(args, "--commands");
    if (!commandPath) throw new Error("apply requires --commands <commands.json>.");
    const payload = JSON.parse(await readFile(commandPath, "utf8")) as EditorCommand | EditorCommand[];
    const commands = Array.isArray(payload) ? payload : [payload];
    const results = commands.map((editorCommand) => parsed.model.apply(editorCommand));
    if (parsed.project) {
      parsed.project.operations ??= [];
      parsed.project.operations.push(...results.map((result) => ({
        at: new Date().toISOString(),
        label: result.action,
        elementIds: [result.createdId ?? result.elementId],
        source: "cli" as const,
      })));
    }
    const outputPath = has(args, "--in-place") ? inputPath : option(args, "--output");
    if (!outputPath) throw new Error("apply requires --output, or explicit --in-place.");
    await writeResult(inputPath, parsed, outputPath);
    print({ applied: results.length, results });
    return;
  }
  usage();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
