import { createServer, preview } from "vite";

const DEFAULT_START_TIMEOUT_MS = 20_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;

export async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function isReachable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

function localServerAddress(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(`The test target must be a reachable external URL or a local HTTP URL: ${baseUrl}`);
  }
  return {
    hostname: url.hostname,
    port: Number(url.port || 80),
  };
}

async function waitUntilReachable(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReachable(baseUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${baseUrl} after ${timeoutMs}ms.`);
}

function externalServerHandle(baseUrl) {
  return {
    baseUrl,
    owned: false,
    async close() {},
  };
}

function managedServerHandle(baseUrl, server, closeTimeoutMs, label) {
  let closePromise;
  return {
    baseUrl,
    owned: true,
    close() {
      closePromise ??= withTimeout(server.close(), closeTimeoutMs, `${label} shutdown`);
      return closePromise;
    },
  };
}

export async function startViteDevServer({
  baseUrl,
  reuseExisting = false,
  startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
  closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
} = {}) {
  if (!baseUrl) throw new Error("startViteDevServer requires baseUrl.");
  if (await isReachable(baseUrl)) {
    if (reuseExisting) return externalServerHandle(baseUrl);
    throw new Error(`Refusing to reuse an unexpected server at ${baseUrl}.`);
  }

  const { hostname, port } = localServerAddress(baseUrl);
  const server = await createServer({
    logLevel: "error",
    optimizeDeps: { force: true },
    server: { host: hostname, port, strictPort: true },
  });
  const handle = managedServerHandle(baseUrl, server, closeTimeoutMs, "Vite development server");
  try {
    await withTimeout(server.listen(), startTimeoutMs, "Vite development server startup");
    await waitUntilReachable(baseUrl, startTimeoutMs);
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function startVitePreviewServer({
  baseUrl,
  basePath = "/",
  reuseExisting = false,
  startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
  closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
} = {}) {
  if (!baseUrl) throw new Error("startVitePreviewServer requires baseUrl.");
  if (await isReachable(baseUrl)) {
    if (reuseExisting) return externalServerHandle(baseUrl);
    throw new Error(`Refusing to reuse an unexpected server at ${baseUrl}.`);
  }

  const { hostname, port } = localServerAddress(baseUrl);
  const previewPromise = preview({
    base: basePath,
    logLevel: "error",
    preview: { host: hostname, port, strictPort: true },
  });
  let server;
  try {
    server = await withTimeout(previewPromise, startTimeoutMs, "Vite preview server startup");
  } catch (error) {
    previewPromise.then((lateServer) => lateServer.close()).catch(() => undefined);
    throw error;
  }
  const handle = managedServerHandle(baseUrl, server, closeTimeoutMs, "Vite preview server");
  try {
    await waitUntilReachable(baseUrl, startTimeoutMs);
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}
