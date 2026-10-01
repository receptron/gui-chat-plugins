import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Four entries: the server-facing `.`/core (tool definition + execute, which
// only type-imports gui-chat-protocol), the browser `./vue` (View/Preview +
// the Three.js renderer) and the SERVER-only `./render`. `vue` and
// `gui-chat-protocol/vue` are externalised so the plugin and host share ONE
// instance (the injected PLUGIN_RUNTIME_KEY Symbol must match). `three` itself
// is external for the same reason: a host that draws the model with its own
// three (mulmoserver's scene and exporters) must share ONE copy. Only the bare
// `three` — the `three/examples/jsm/*` modules and the CSG helpers stay bundled
// and import it from here. Leaving them external splits three in Node:
// `three-bvh-csg` has no `exports`, so Node loads its UMD build, which
// `require`s three.cjs next to our three.module.js. `@gui-chat-plugin/common` is
// a dependency, imported rather than copied.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        core: resolve(__dirname, "src/core/index.ts"),
        vue: resolve(__dirname, "src/vue/index.ts"),
        render: resolve(__dirname, "src/render/index.ts"),
      },
      name: "GuiChatPluginShapeScript",
      formats: ["es", "cjs"],
      fileName: (format, entry) => `${entry}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      // `puppeteer` and the node built-ins belong to the SERVER-only `./render`
      // entry: external so a browser driver is never bundled, and so the host's
      // own hoisted copy is the one that runs.
      external: [
        "@gui-chat-plugin/common",
        "vue",
        "gui-chat-protocol",
        "gui-chat-protocol/vue",
        "puppeteer",
        "three",
        "node:fs/promises",
        "node:module",
        "node:path",
        "node:url",
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
