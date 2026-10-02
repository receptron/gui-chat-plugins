import type * as THREE from "three";

/** Swap the second and third vertex of every triangle in place. Indexed: in
 *  the index, which every attribute follows. Non-indexed: in EVERY attribute
 *  — swapping positions alone left a mirrored operand's normals (and uvs) on
 *  the wrong corners (codex on #24). */
export function reverseWinding(geometry: THREE.BufferGeometry): void {
  const attributes = geometry.index
    ? [geometry.index]
    : Object.values(geometry.attributes);
  for (const attribute of attributes) {
    for (let face = 0; face * 3 + 2 < attribute.count; face++) {
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
}
