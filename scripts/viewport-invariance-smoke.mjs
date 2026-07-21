import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { runtimePresentationLayoutCss } from "../src/core/presentation-layout.ts";

const executablePath = process.env.CHROME_PATH ?? [
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);
function assert(condition, message) { if (!condition) throw new Error(message); }

async function snapshot(page) {
  return page.locator("#boundary-text").evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => Math.round(rect.top * 2) / 2);
    return { lineCount: Math.max(1, new Set(tops).size), clientWidth: element.clientWidth, clientHeight: element.clientHeight, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight };
  });
}

async function run() {
  assert(executablePath, "Chrome/Chromium was not found.");
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.setContent(`<!doctype html><html><head><style>${runtimePresentationLayoutCss}
      #stage { position:absolute; width:1920px; height:1080px; transform-origin:0 0; }
      #boundary-text { position:absolute; left:100px; top:100px; width:820px; margin:0; font:700 42px/1.2 Arial,sans-serif; }
    </style></head><body><main id="stage"><section data-lms-slide="active"><p id="boundary-text">Viewport scaling must never participate in authored text reflow.</p></section></main>
    <script>function fit(){stage.style.transform='scale('+Math.min(innerWidth/1920,innerHeight/1080)+')'} addEventListener('resize',fit); fit();<\/script></body></html>`);
    const wide = await snapshot(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    const compact = await snapshot(page);
    assert(JSON.stringify(wide) === JSON.stringify(compact), `Viewport changed authored layout: ${JSON.stringify({ wide, compact })}`);
    process.stdout.write(`${JSON.stringify({ ok: true, viewportInvariant: true, wide, compact })}\n`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
