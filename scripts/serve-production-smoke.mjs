import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const host = "127.0.0.1";
const port = Number(process.env.PRODUCTION_SMOKE_PORT ?? "4175");
const basePath = "/AfterPrompt/";
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(repositoryRoot, "dist");
const securityConfigPath = path.join(repositoryRoot, "deploy/nginx/last-mile-studio-security-headers.conf");

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function parseSecurityHeaders(source) {
  const headers = new Map();
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^add_header\s+(\S+)\s+"(.*)"\s+always;$/);
    if (!match) throw new Error(`Unsupported Nginx security-header line: ${line}`);
    headers.set(match[1], match[2]);
  }
  return headers;
}

const securityHeaders = parseSecurityHeaders(await readFile(securityConfigPath, "utf8"));

function applyHeaders(response) {
  for (const [name, value] of securityHeaders) response.setHeader(name, value);
}

function safePath(relativePath) {
  const resolved = path.resolve(distRoot, relativePath);
  if (resolved !== distRoot && !resolved.startsWith(`${distRoot}${path.sep}`)) return null;
  return resolved;
}

const server = createServer(async (request, response) => {
  try {
    applyHeaders(response);
    if (!request.url || !["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405).end();
      return;
    }

    const requestUrl = new URL(request.url, `http://${host}:${port}`);
    if (requestUrl.pathname === "/AfterPrompt/healthz") {
      const body = Buffer.from("ok");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Content-Length", body.byteLength);
      response.writeHead(200);
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }

    if (requestUrl.pathname === "/last-mile-studio" || requestUrl.pathname.startsWith("/last-mile-studio/")) {
      response.setHeader("Location", basePath);
      response.writeHead(308).end();
      return;
    }

    if (!requestUrl.pathname.startsWith(basePath)) {
      response.writeHead(404).end();
      return;
    }

    let relativePath = decodeURIComponent(requestUrl.pathname.slice(basePath.length));
    if (!relativePath || relativePath.endsWith("/")) relativePath = `${relativePath}index.html`;
    let filePath = safePath(relativePath);
    if (!filePath) {
      response.writeHead(400).end();
      return;
    }

    try {
      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) filePath = path.join(filePath, "index.html");
    } catch {
      filePath = path.join(distRoot, "index.html");
    }

    const body = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.setHeader("Content-Type", mimeTypes.get(extension) ?? "application/octet-stream");
    response.setHeader("Content-Length", body.byteLength);
    response.setHeader(
      "Cache-Control",
      relativePath.startsWith("assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    response.writeHead(200);
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    response.writeHead(500).end(error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, host, () => {
  process.stdout.write(`[production-smoke-server] http://${host}:${port}${basePath}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
