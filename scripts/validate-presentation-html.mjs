#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { chromium } from "playwright-core";
import { auditPresentationSource } from "../src/core/presentation-audit.ts";
import { comparePresentationProjections } from "../src/core/presentation-projection.ts";

function installDomGlobals() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, {
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
  });
}

function usage() {
  process.stdout.write(`Usage: npm run validate:presentation -- <input.html> [--browser]\n`);
}

function executablePath() {
  return process.env.CHROME_PATH ?? [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google-chrome",
  ].find(existsSync);
}

async function browserProjection(source, useBrowser) {
  if (!useBrowser) return { status: "not-requested" };
  const executable = executablePath();
  if (!executable) return { status: "unavailable", error: "Chrome/Chromium was not found." };

  const browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => {
      const install = () => {
        if (window.__lmsPresentationMutationObserverInstalled) return;
        window.__lmsPresentationMutationObserverInstalled = true;
        const mutations = [];
        window.__lmsPresentationMutations = mutations;
        const observer = new MutationObserver((records) => {
          records.forEach((record) => {
            if (record.type !== "childList") return;
            mutations.push({
              targetId: record.target instanceof Element ? record.target.getAttribute("data-editor-id") : null,
              targetTag: record.target instanceof Element ? record.target.localName : null,
              added: record.addedNodes.length,
              removed: record.removedNodes.length,
            });
          });
        });
        const root = document.documentElement || document;
        observer.observe(root, { childList: true, subtree: true });
      };
      if (document.documentElement) install();
      else document.addEventListener("DOMContentLoaded", install, { once: true });
    });
    await page.setContent(source, { waitUntil: "load" });
    await page.waitForTimeout(150);
    const result = await page.evaluate(() => {
      const selectors = [
        "deck-stage > section",
        "[data-editor-deck] > section",
        ".slides > section",
        "[data-slides] > section",
      ];
      const unique = (elements) => elements.filter((element, index) => elements.indexOf(element) === index);
      const ref = (element) => ({
        tag: element.localName,
        editorId: element.getAttribute("data-editor-id"),
        htmlId: element.getAttribute("id"),
      });
      const build = (root) => {
        const groups = new Map();
        const warnings = [];
        [root, ...root.querySelectorAll("[data-build]")].forEach((element) => {
          if (!element.hasAttribute("data-build")) return;
          const raw = element.getAttribute("data-build");
          const step = Number(raw?.trim());
          const id = element.getAttribute("data-editor-id") || "";
          if (!Number.isInteger(step) || step <= 0) {
            warnings.push({ code: "invalid-step", elementId: id || element.localName, message: `${id || element.localName} has invalid data-build` });
            return;
          }
          if (!id) return;
          const ids = groups.get(step) || [];
          ids.push(id);
          groups.set(step, ids);
        });
        const steps = [...groups.keys()].sort((left, right) => left - right);
        return { steps, groups: steps.map((step) => ({ step, elementIds: groups.get(step) || [] })), warnings };
      };
      const project = (doc) => {
        const body = doc.body;
        if (!body) return { version: 1, documentKind: "html", mode: "none", strategy: "none", container: null, root: null, pages: [] };
        let mode = "document-root";
        let strategy = "document-body";
        let container = body;
        let pages = [];
        for (const selector of selectors) {
          const candidates = unique([...body.querySelectorAll(selector)]);
          if (!candidates.length) continue;
          mode = "deck";
          strategy = selector;
          pages = candidates;
          const parents = unique(candidates.map((page) => page.parentElement).filter(Boolean));
          container = parents.length === 1 ? parents[0] : null;
          break;
        }
        if (!pages.length) {
          const direct = [...body.children].filter((element) => element.matches("section[data-slide], section[data-label], section.slide, [data-slide].slide"));
          if (direct.length > 1) {
            mode = "deck";
            strategy = "body-direct-explicit-page";
            pages = direct;
            container = body;
          }
        }
        return {
          version: 1,
          documentKind: "html",
          mode,
          strategy,
          container: container ? ref(container) : null,
          root: mode === "document-root" ? { ...ref(body), build: build(body) } : null,
          pages: pages.map((page, index) => ({ ...ref(page), index, key: page.getAttribute("data-key"), kind: page.getAttribute("data-kind"), build: build(page) })),
        };
      };
      const frame = document.querySelector("iframe#lms-slides");
      const canonical = frame?.contentDocument || document;
      const mutationWindows = [window, frame?.contentWindow].filter(Boolean);
      return {
        projection: project(canonical),
        mutations: mutationWindows.flatMap((candidate) => candidate.__lmsPresentationMutations || []),
      };
    });
    return { status: "ok", ...result };
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const input = args.find((argument) => !argument.startsWith("--"));
  if (args.includes("--help")) {
    usage();
    return;
  }
  if (!input) {
    usage();
    process.exitCode = 1;
    return;
  }

  installDomGlobals();
  const source = await readFile(input, "utf8");
  const report = auditPresentationSource(source, input);
  let browser = { status: "not-requested" };
  if (args.includes("--browser")) {
    try {
      browser = await browserProjection(source, true);
    } catch (error) {
      browser = { status: "error", error: error instanceof Error ? error.stack ?? error.message : String(error) };
    }
  }

  const parity = browser.status === "ok"
    ? comparePresentationProjections(report.projection, browser.projection)
    : [];
  const browserValid = !args.includes("--browser") || (browser.status === "ok" && parity.length === 0);
  const output = {
    input,
    sourceMode: report.sourceMode,
    payloadChecksum: report.payloadChecksum,
    valid: report.valid && browserValid,
    static: report,
    browser: browser.status === "ok" ? { ...browser, parity } : browser,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.valid) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
