import { resolve } from "node:path";
import { defineConfig } from "vite";

// One entry: pure helpers, no Views and no styles. The protocol is the
// host's, so it stays external, as in every package here.
export default defineConfig({
  build: {
    lib: {
      entry: { index: resolve(__dirname, "src/index.ts") },
      formats: ["es", "cjs"],
      fileName: (format, entry) => `${entry}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: ["gui-chat-protocol"],
      output: { exports: "named" },
    },
  },
});
