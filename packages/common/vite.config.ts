import { resolve } from "node:path";
import { defineConfig } from "vite";

// One entry: pure helpers, no Views and no styles. Nothing is external
// because nothing is imported.
export default defineConfig({
  build: {
    lib: {
      entry: { index: resolve(__dirname, "src/index.ts") },
      formats: ["es", "cjs"],
      fileName: (format, entry) => `${entry}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: { output: { exports: "named" } },
  },
});
