#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { JSDOM } from "jsdom";
import { getTransformValues, readDeclaredBounds } from "../core/commands";
import { detectDocumentKind, SourceDocument } from "../core/document-model";
import type { Bounds, DocumentKind, EditorCommand, SavedProject } from "../core/types";

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
  return {
    x: parsed(style.left, fallback.x) + transform.x,
    y: parsed(style.top, fallback.y) + transform.y,
    width: parsed(style.width, fallback.width),
    height: parsed(style.height, fallback.height),
  };
}

async function readInput(path: string): Promise<ParsedInput> {
  const value = await readFile(path, "utf8");
  if (path.endsWith(".visual-project.json") || path.endsWith(".lastmile.json")) {
    const project = JSON.parse(value) as SavedProject;
    if (project.format !== "last-mile-studio" || project.version !== 1) throw new Error("Unsupported project file.");
    return {
      project,
      model: modelFromSource(project.source, project.sourceName, project.documentType, project.canvas),
    };
  }
  return { model: modelFromSource(value, path) };
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
  print(`Last Mile Studio CLI

Usage:
  npm run cli -- list <input>
  npm run cli -- get <input> <element-id>
  npm run cli -- summary <input> [--output summary.json]
  npm run cli -- prepare <input> --output <output>
  npm run cli -- apply <input> --commands <commands.json> (--output <output> | --in-place)
  npm run cli -- validate <input>

Input may be HTML, SVG, or *.visual-project.json. apply accepts one command object
or an array of command objects. Source files are never overwritten unless
--in-place is explicitly present.`);
  process.exit(1);
}

async function writeResult(inputPath: string, parsed: ParsedInput, outputPath: string): Promise<void> {
  if (parsed.project) {
    const value: SavedProject = {
      ...parsed.project,
      source: parsed.model.serialize(),
      canvas: parsed.model.canvas,
      metadata: { ...parsed.project.metadata, savedAt: new Date().toISOString() },
    };
    await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } else {
    await writeFile(outputPath, parsed.model.serialize(), "utf8");
  }
  print({ input: inputPath, output: outputPath, documentType: parsed.model.kind });
}

async function main(): Promise<void> {
  installDomGlobals();
  const args = process.argv.slice(2);
  const command = args[0];
  const inputPath = args[1];
  if (!command || !inputPath || has(args, "--help")) usage();
  const parsed = await readInput(inputPath);

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
