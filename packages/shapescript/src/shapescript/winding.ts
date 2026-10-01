import type * as THREE from "three";

/** Swap the second and third vertex of every triangle in place. */
export function reverseWinding(geometry: THREE.BufferGeometry): void {
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
