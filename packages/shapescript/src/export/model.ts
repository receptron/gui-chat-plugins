// What every "export the model as X" shares: parse and evaluate one
// ShapeScript source the way `presentShapeScript` validates it (same converter,
// same limits), solid rather than wireframe, hand the tree to a serialiser, and
// release it once serialised — the CSG buffers are the expensive part and
// nothing keeps them after this. The USDZ, GLB and STL exporters differ only
// in the serialiser.

import type * as THREE from "three";
import { parseShapeScript } from "../shapescript/parser";
import { astToThreeJS, type ConversionOptions } from "../shapescript/toThreeJS";
import { disposeObject3D } from "../shapescript/dispose";

/** The conversion knobs an export accepts — everything but `wireframe`, which
 *  an export always turns off. */
export type ExportOptions = Omit<ConversionOptions, "wireframe">;

/** Turn a serialiser of Three.js trees into a serialiser of ShapeScript. */
export async function exportShapeScript(
  script: string,
  serialise: (object: THREE.Object3D) => Promise<Uint8Array<ArrayBuffer>>,
  options: ExportOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const group = astToThreeJS(parseShapeScript(script), {
    ...options,
    wireframe: false,
  });
  try {
    return await serialise(group);
  } finally {
    disposeObject3D(group);
  }
}
