// manifold's WebAssembly module, shared by everything that evaluates CSG with
// it: the printable STL export and the preview's `csgEngine: "manifold"`.
//
// Loading is asynchronous and the converter is not, so a caller awaits
// `loadManifold()` first and the converter reads `loadedManifold()`. Loaded on
// first use with a dynamic `import()`, so a host that never asks for manifold
// never fetches it.

import type { ManifoldToplevel } from "manifold-3d";

let loading: Promise<ManifoldToplevel> | undefined;
let loaded: ManifoldToplevel | undefined;

/** Load manifold once. A failed load is not cached, so the next call tries again. */
export function loadManifold(): Promise<ManifoldToplevel> {
  loading ??= import("manifold-3d")
    .then(async ({ default: Module }) => {
      const wasm = await Module();
      wasm.setup();
      loaded = wasm;
      return wasm;
    })
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
}

/** manifold if `loadManifold()` has finished, else undefined. */
export function loadedManifold(): ManifoldToplevel | undefined {
  return loaded;
}
