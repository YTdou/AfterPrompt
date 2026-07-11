import { defineConfig } from "vitest/config";

const deployBasePath = process.env.DEPLOY_BASE_PATH ?? "/";

if (!deployBasePath.startsWith("/") || !deployBasePath.endsWith("/")) {
  throw new Error("DEPLOY_BASE_PATH must start and end with '/'.");
}

export default defineConfig({
  base: deployBasePath,
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
