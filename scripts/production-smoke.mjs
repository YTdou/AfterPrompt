import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import { chromium } from "playwright-core";

const host = "127.0.0.1";
const port = process.env.PRODUCTION_SMOKE_PORT ?? "4193";
const baseUrl = process.env.PRODUCTION_BASE_URL ?? `http://${host}:${port}/AfterPrompt/`;
const executablePath = process.env.CHROME_PATH ?? [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);

function assert(condition, message) { if (!condition) throw new Error(message); }

async function waitUntilReachable(server, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The preview server may still be starting.
    }
    if (server.exitCode !== null) throw new Error(`Vite preview exited before becoming ready.\n${output.value}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.\n${output.value}`);
}

async function main() {
  if (!executablePath) throw new Error("Chrome/Chromium was not found. Set CHROME_PATH to its executable.");
  const output = { value: "" };
  const server = spawn("npm", ["run", "preview", "--", "--host", host, "--port", port, "--strictPort"], {
    cwd: process.cwd(),
    env: { ...process.env, DEPLOY_BASE_PATH: "/AfterPrompt/" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { output.value += chunk; });
  server.stderr.on("data", (chunk) => { output.value += chunk; });

  let browser;
  try {
    await waitUntilReachable(server, output);
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.stack ?? error.message));
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
        failures.push(`${response.status()} ${response.url()}`);
      }
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#document-status").waitFor();
    assert(await page.title() === "AfterPrompt — Visually refine what AI generates.", "The production page title is incorrect.");
    assert((await page.locator(".brand strong").textContent()) === "AfterPrompt", "The production editor did not initialize.");
    assert(failures.length === 0, `Production smoke observed browser failures:\n${failures.join("\n")}`);
    process.stdout.write(`${JSON.stringify({ ok: true, baseUrl, assets: true, editor: true })}\n`);
  } finally {
    await browser?.close();
    if (server.exitCode === null) server.kill("SIGTERM");
  }
}

main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
