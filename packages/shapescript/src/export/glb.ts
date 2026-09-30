// GLB (binary glTF) export of a ShapeScript model — the format the web, game
// engines and most 3D tools read natively. Like the USDZ exporter it is
// browser-safe: three's `GLTFExporter` reaches for a canvas only to bake
// textures, and the converter's materials are untextured plain colours. It
// is Node-safe too, by way of one shim (below): the exporter merges its
// buffers through `FileReader`, which browsers have and Node does not.
// Vertex-coloured meshes (a `mesh { }` of coloured polygons, a `minkowski`
// result) need no splitting here: glTF carries them as `COLOR_0`, which
// viewers multiply into the material as the spec requires.

import type * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { exportShapeScript, type ExportOptions } from "./model";

/** The MIME type a `.glb` is served / downloaded as (Khronos' registration). */
export const GLB_MIME_TYPE = "model/gltf-binary";

/** The extension a binary glTF carries. */
export const GLB_EXTENSION = ".glb";

/** The two `FileReader` calls `GLTFExporter` makes, on top of `Blob`, which
 *  Node has had as a global since 18. Installed only where `FileReader` is
 *  missing, so a browser keeps its own; a server-side host calling
 *  `sceneToGlb` otherwise rejects with a `ReferenceError` (codex on #3171). */
class BlobFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => this.finish(buffer));
  }
  readAsDataURL(blob: Blob): void {
    void blob
      .arrayBuffer()
      .then((buffer) =>
        this.finish(
          `data:${blob.type};base64,${bytesToBase64(new Uint8Array(buffer))}`,
        ),
      );
  }
  private finish(result: ArrayBuffer | string): void {
    this.result = result;
    this.onloadend?.();
  }
}

/** Base64 without `Buffer`, so the shim stays runtime-neutral. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function ensureFileReader(): void {
  const scope = globalThis as { FileReader?: unknown };
  if (scope.FileReader === undefined) scope.FileReader = BlobFileReader;
}

/** Serialise an already-built Three.js object tree to a GLB. */
export async function sceneToGlb(
  object: THREE.Object3D,
): Promise<Uint8Array<ArrayBuffer>> {
  ensureFileReader();
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(object, { binary: true });
  return new Uint8Array(result as ArrayBuffer);
}

/** Parse, evaluate and export one ShapeScript source as a GLB. */
export function shapeScriptToGlb(
  script: string,
  options: ExportOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  return exportShapeScript(script, sceneToGlb, options);
}
