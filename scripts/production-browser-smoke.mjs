import { spawn } from "node:child_process";
import process from "node:process";

const baseUrl = process.env.PRODUCTION_SMOKE_BASE_URL ?? "http://127.0.0.1:4175/AfterPrompt/";
const server = spawn(process.execPath, ["scripts/serve-production-smoke.mjs"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });

async function waitUntilReady() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    if (server.exitCode !== null) throw new Error(`Production smoke server exited early.\n${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.\n${serverOutput}`);
}

async function verifyProductionRoutes() {
  const healthResponse = await fetch(new URL("healthz", baseUrl));
  if (!healthResponse.ok || (await healthResponse.text()).trim() !== "ok") {
    throw new Error("Production health endpoint did not return ok.");
  }

  const legacyUrl = new URL("/last-mile-studio/", baseUrl);
  const legacyResponse = await fetch(legacyUrl, { redirect: "manual" });
  if (legacyResponse.status !== 308 || legacyResponse.headers.get("location") !== "/AfterPrompt/") {
    throw new Error("Legacy production path did not redirect to /AfterPrompt/.");
  }
}

function runBrowserSuite() {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "test:browser"], {
      cwd: process.cwd(),
      env: { ...process.env, STUDIO_BASE_URL: baseUrl },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Production browser smoke failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

try {
  await waitUntilReady();
  await verifyProductionRoutes();
  await runBrowserSuite();
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
