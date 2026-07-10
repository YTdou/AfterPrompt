import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    port: 4173,
  },
  preview: {
    port: 4173,
  },
  build: {
    sourcemap: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["Silex/**", "grapesjs/**", "moveable/**", "VvvebJs/**", "css-shapes-editor/**"],
  },
});
