import { defineConfig } from "vitest/config";

const deployBasePath = process.env.DEPLOY_BASE_PATH ?? "/";

if (!deployBasePath.startsWith("/") || !deployBasePath.endsWith("/")) {
  throw new Error("DEPLOY_BASE_PATH must start and end with '/'.");
}

export default defineConfig({
  base: deployBasePath,
  // JSZip is intentionally loaded on demand by project/fragment workflows.
  // Pre-bundle it at dev-server startup so the first Save Fragment click does
  // not discover a new dependency, invalidate the page's optimizer hash, and
  // fail with an Outdated Optimize Dep / 504 response.
  optimizeDeps: {
    include: ["jszip"],
  },
  server: {
    port: 4173,
  },
  preview: {
    port: 4173,
  },
  build: {
    sourcemap: process.env.VITE_SOURCE_MAPS === "true",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["Silex/**", "grapesjs/**", "moveable/**", "VvvebJs/**", "css-shapes-editor/**"],
  },
});
