import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Two entries. `.` is for Node: the tool definition and execute. The kernel
// (`replicad`, and `replicad-opencascadejs` with its WebAssembly beside it) is
// external and imported dynamically on the first build, so a host that only
// lists the tool never loads 22 MB of WebAssembly, and the host's hoisted copy
// is the one that runs. `node:vm` runs the model's script.
//
// `./vue` is for the page: the View and the Preview. It imports nothing that
// reaches the kernel, so a host's browser bundle never sees `node:vm` or the
// WebAssembly. `vue` and `gui-chat-protocol/vue` are external so the plugin
// and the host share ONE instance (the injected PLUGIN_RUNTIME_KEY must
// match), and `three` so a host that draws with its own three shares one copy;
// `three/examples/jsm/*` stays bundled and imports that `three`.
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
        "@gui-chat-plugin/common",
        "gui-chat-protocol",
        "gui-chat-protocol/vue",
        "replicad",
        "replicad-opencascadejs",
        "three",
        "vue",
        "node:vm",
      ],
      output: {
        exports: "named",
        globals: { vue: "Vue" },
        assetFileNames: "style.[ext]",
      },
    },
    cssCodeSplit: false,
  },
});
