// STL export of a ShapeScript model — the format slicers take for 3D printing.
// STL is geometry only: colours, names and hierarchy are dropped, every
// triangle is written in world space. Browser-safe like the other exporters;
// `STLExporter` touches no DOM at all.

import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { exportShapeScript, type ExportOptions } from "./model";

/** The MIME type a `.stl` is served / downloaded as (IANA's registration). */
export const STL_MIME_TYPE = "model/stl";

/** The extension an STL carries. */
export const STL_EXTENSION = ".stl";

/** Serialise an already-built Three.js object tree to a binary STL.
 *
 *  `STLExporter` writes every mesh it can traverse to, hidden or not, and reads
 *  each one's `matrixWorld` as it stands. So the tree is flattened first into
 *  the meshes that are actually shown — a `visible = false` anywhere up the
 *  chain hides the subtree, as it does on screen — each with its vertices
 *  baked into world space. Baking goes through `getVertexPosition`, so a
 *  posed `SkinnedMesh` or a morph target handed in by a host exports as
 *  displayed rather than in bind pose (codex on #3171), and an `InstancedMesh`
 *  is baked once per instance (CodeRabbit on #3171). The baked geometries are
 *  released before returning; the source is untouched. */
export async function sceneToStl(
  object: THREE.Object3D,
): Promise<Uint8Array<ArrayBuffer>> {
  object.updateMatrixWorld(true);
  const flat = new THREE.Group();
  const baked = visibleMeshes(object).flatMap(bakedWorldGeometries);
  try {
    for (const geometry of baked) flat.add(new THREE.Mesh(geometry));
    flat.updateMatrixWorld(true);
    const view = new STLExporter().parse(flat, { binary: true }) as DataView;
    return new Uint8Array(
      view.buffer as ArrayBuffer,
      view.byteOffset,
      view.byteLength,
    );
  } finally {
    baked.forEach((geometry) => geometry.dispose());
  }
}

/** A mesh's triangles in world space, one geometry per drawn copy: a plain
 *  mesh is one, an `InstancedMesh` is one per instance, each placed by the
 *  mesh's world matrix composed with that instance's own. Per-instance morph
 *  weights (`setMorphAt`) live in a texture `getVertexPosition` never reads,
 *  so each instance's are loaded onto the mesh for its bake and the mesh's
 *  own restored after (codex on #3171). */
function bakedWorldGeometries(mesh: THREE.Mesh): THREE.BufferGeometry[] {
  const instanced = mesh as THREE.InstancedMesh;
  if (!instanced.isInstancedMesh)
    return [bakedWorldGeometry(mesh, mesh.matrixWorld)];
  const influences = instanced.morphTargetInfluences?.slice();
  try {
    return Array.from({ length: instanced.count }, (_, i) => {
      const matrix = new THREE.Matrix4();
      instanced.getMatrixAt(i, matrix);
      if (instanced.morphTexture && instanced.morphTargetInfluences)
        instanced.getMorphAt(i, instanced);
      return bakedWorldGeometry(mesh, matrix.premultiply(mesh.matrixWorld));
    });
  } finally {
    if (influences) instanced.morphTargetInfluences = influences;
  }
}

/** A mesh's triangles with every vertex taken through `transform`, as its own
 *  geometry. The index is copied rather than shared: disposing a geometry
 *  hands its index buffer back to the renderer too, and the source may still
 *  be on screen. A mirroring transform (`scale -1 1 1`, a negative
 *  determinant) turns every triangle inside out, which the renderer corrects
 *  by drawing clockwise faces as front — STL has no such flag, so the winding
 *  is reversed here instead (codex on #3171). */
function bakedWorldGeometry(
  mesh: THREE.Mesh,
  transform: THREE.Matrix4,
): THREE.BufferGeometry {
  const source = mesh.geometry;
  const count = source.getAttribute("position").count;
  const positions = new Float32Array(count * 3);
  const vertex = new THREE.Vector3();
  for (let i = 0; i < count; i++)
    mesh
      .getVertexPosition(i, vertex)
      .applyMatrix4(transform)
      .toArray(positions, i * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  if (source.index) geometry.setIndex(source.index.clone());
  if (transform.determinant() < 0) reverseWinding(geometry);
  return geometry;
}

/** Swap the second and third vertex of every triangle in place. */
function reverseWinding(geometry: THREE.BufferGeometry): void {
  const attribute = geometry.index ?? geometry.getAttribute("position");
  for (let face = 0; face * 3 < attribute.count; face++) {
    for (let k = 0; k < attribute.itemSize; k++) {
      const b = attribute.getComponent(face * 3 + 1, k);
      attribute.setComponent(
        face * 3 + 1,
        k,
        attribute.getComponent(face * 3 + 2, k),
      );
      attribute.setComponent(face * 3 + 2, k, b);
    }
  }
}

/** The meshes under `object` that are shown: none below a hidden node. */
function visibleMeshes(object: THREE.Object3D): THREE.Mesh[] {
  if (!object.visible) return [];
  const own = (object as THREE.Mesh).isMesh ? [object as THREE.Mesh] : [];
  return own.concat(...object.children.map(visibleMeshes));
}

/** Parse, evaluate and export one ShapeScript source as a binary STL. */
export function shapeScriptToStl(
  script: string,
  options: ExportOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  return exportShapeScript(script, sceneToStl, options);
}
