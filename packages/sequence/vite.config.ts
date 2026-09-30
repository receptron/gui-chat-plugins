import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Two entries, as the other @gui-chat-plugin packages: "." (core: runs
// wherever the host runs execute(), a server or a page) and "./vue" (Views).
// Vue, the protocol and ui-image are the host's, so they stay external: one
// Vue instance, one PLUGIN_RUNTIME_KEY. marked and KaTeX (Markdown slides)
// are dependencies, installed with the package and imported when needed.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        vue: resolve(__dirname, "src/vue/index.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entry) => `${entry}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: [
        "vue",
        "gui-chat-protocol",
        "gui-chat-protocol/vue",
        "@mulmochat-plugin/ui-image",
        "marked",
        "katex",
      ],
      output: { exports: "named", assetFileNames: "style.[ext]" },
    },
    cssCodeSplit: false,
  },
});
