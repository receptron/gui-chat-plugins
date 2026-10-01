// The preview's CSG through manifold (`csgEngine: "manifold"`): the same
// operations as three-bvh-csg, with the result watertight, each face keeping
// its operand's material, and smooth normals carried through.
//
// Each operand goes in as a manifold whose triangles are tagged per material
// group with an ID from `reserveIDs`, and with its normals as vertex
// properties. manifold reports, per run of output triangles, which ID it came
// from and whether it is the back side of its original (a subtracted
// operand's faces), so the result is rebuilt with every face's material and
// its normals turned the right way. A block with an operand manifold cannot
// take — an open or flat mesh — is left to three-bvh-csg (`undefined`).

import * as THREE from "three";
import type { Manifold, ManifoldToplevel, Mesh } from "manifold-3d";
import { at } from "./at";
import type { CsgEvaluator, CsgOperand } from "./toThreeJS";

/** Position x y z and normal x y z per vertex. */
const PROPERTIES = 6;

/** One operand as a manifold, the material slot of each of its IDs, and its
 *  first slot (the material a `stencil` cutter paints with). */
interface Solid {
  manifold: Manifold;
  firstSlot: number;
  ids: number[];
}

export function manifoldCsgEvaluator(wasm: ManifoldToplevel): CsgEvaluator {
  return (operation, operands) => {
    const owned: Manifold[] = [];
    const keep = (manifold: Manifold): Manifold => {
      owned.push(manifold);
      return manifold;
    };
    try {
      const slotOf = new Map<number, number>();
      let slot = 0;
      const solids: Solid[] = [];
      for (const operand of operands) {
        const solid = solidOf(wasm, operand, slot, slotOf);
        if (!solid) return undefined;
        keep(solid.manifold);
        solids.push(solid);
        slot += operand.materials;
      }
      const [first, ...rest] = solids;
      if (!first) return null;
      if (operation === "stencil") return stencil(first, rest, slotOf);
      const result = combine(
        wasm,
        operation,
        first.manifold,
        rest.map((solid) => solid.manifold),
        keep,
      );
      return result.isEmpty()
        ? null
        : geometryOf([{ manifold: result }], slotOf);
    } finally {
      for (const manifold of owned) manifold.delete();
    }
  };
}

/** One operand as a manifold: positions and normals per vertex, one run per
 *  material group with an ID of its own. Undefined when it is not a closed
 *  solid. */
function solidOf(
  wasm: ManifoldToplevel,
  operand: CsgOperand,
  firstSlot: number,
  slotOf: Map<number, number>,
): Solid | undefined {
  const { geometry } = operand;
  const position = geometry.getAttribute("position");
  const normals = normalsOf(geometry);
  const vertProperties = new Float32Array(position.count * PROPERTIES);
  for (let v = 0; v < position.count; v++) {
    vertProperties.set(
      [
        position.getX(v),
        position.getY(v),
        position.getZ(v),
        normals.getX(v),
        normals.getY(v),
        normals.getZ(v),
      ],
      v * PROPERTIES,
    );
  }
  const corner = (k: number) => (geometry.index ? geometry.index.getX(k) : k);
  const groups = [...geometry.groups].sort((a, b) => a.start - b.start);
  const triVerts: number[] = [];
  const runIndex: number[] = [];
  const runOriginalID: number[] = [];
  const ids: number[] = [];
  for (const group of groups) {
    const id = wasm.Manifold.reserveIDs(1);
    slotOf.set(id, firstSlot + (group.materialIndex ?? 0));
    ids.push(id);
    runIndex.push(triVerts.length);
    runOriginalID.push(id);
    for (let k = group.start; k < group.start + group.count; k++)
      triVerts.push(corner(k));
  }
  runIndex.push(triVerts.length);
  if (triVerts.length < 12) return undefined;
  const mesh = new wasm.Mesh({
    numProp: PROPERTIES,
    vertProperties,
    triVerts: new Uint32Array(triVerts),
    runIndex: new Uint32Array(runIndex),
    runOriginalID: new Uint32Array(runOriginalID),
  });
  mesh.merge();
  let manifold: Manifold;
  try {
    manifold = new wasm.Manifold(mesh);
  } catch {
    return undefined;
  }
  if (manifold.status() !== "NoError" || manifold.isEmpty()) {
    manifold.delete();
    return undefined;
  }
  return { manifold, firstSlot, ids };
}

/** The geometry's normals, computed when it has none. */
function normalsOf(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
  const normal = geometry.getAttribute("normal");
  if (normal instanceof THREE.BufferAttribute) return normal;
  const copy = geometry.clone();
  copy.computeVertexNormals();
  const computed = copy.getAttribute("normal");
  copy.dispose();
  return computed as THREE.BufferAttribute;
}

/** union / difference / intersection / xor, operands in the order the
 *  default engine takes them. */
function combine(
  wasm: ManifoldToplevel,
  operation: string,
  first: Manifold,
  rest: Manifold[],
  keep: (manifold: Manifold) => Manifold,
): Manifold {
  const { Manifold: M } = wasm;
  if (rest.length === 0) return first;
  switch (operation) {
    case "union":
      return keep(M.union([first, ...rest]));
    case "difference":
      return keep(first.subtract(keep(M.union(rest))));
    case "intersection":
      return keep(M.intersection([first, ...rest]));
    case "xor":
      return rest.reduce(
        (acc, next) =>
          keep(keep(acc.subtract(next)).add(keep(next.subtract(acc)))),
        first,
      );
    default:
      throw new Error(`Unknown CSG operation: ${operation}`);
  }
}

/** `stencil`: the first operand's surface, unchanged in shape, painted with
 *  each later operand's first material where it lies inside that operand.
 *  Split by each cutter in turn; only faces of the first operand's own
 *  originals are kept, so the cut faces inside it are not drawn. */
function stencil(
  first: Solid,
  cutters: Solid[],
  slotOf: Map<number, number>,
): THREE.BufferGeometry | null {
  let pieces: Piece[] = [{ manifold: first.manifold }];
  // Pieces this function made, freed when replaced or at the end; the first
  // operand is the caller's.
  const own = (manifold: Manifold) => manifold !== first.manifold;
  try {
    for (const cutter of cutters) {
      pieces = pieces.flatMap((piece) => {
        const [inside, outside] = piece.manifold.split(cutter.manifold);
        if (own(piece.manifold)) piece.manifold.delete();
        // An empty half is dropped at once: kept, every later cutter would
        // split it again, and n cutters that miss the shape made 2^n pieces
        // (codex on #24).
        const halves: Piece[] = [];
        if (inside.isEmpty()) inside.delete();
        else halves.push({ manifold: inside, paint: cutter.firstSlot });
        if (outside.isEmpty()) outside.delete();
        else
          halves.push({
            manifold: outside,
            ...(piece.paint === undefined ? {} : { paint: piece.paint }),
          });
        return halves;
      });
    }
    return geometryOf(pieces, slotOf, new Set(first.ids));
  } finally {
    for (const piece of pieces)
      if (own(piece.manifold)) piece.manifold.delete();
  }
}

interface Piece {
  manifold: Manifold;
  /** A slot every face of this piece is drawn with, overriding its own. */
  paint?: number;
}

/** Triangles of `pieces` as one non-indexed geometry with a group per run of
 *  one material slot. Normals come from the vertex properties, turned over on
 *  the back side of their original (a subtracted operand's faces). With
 *  `only`, runs from other originals are left out. */
function geometryOf(
  pieces: Piece[],
  slotOf: Map<number, number>,
  only?: Set<number>,
): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const runs: { slot: number; triangles: number }[] = [];
  for (const piece of pieces) {
    if (piece.manifold.isEmpty()) continue;
    const mesh = piece.manifold.getMesh();
    for (let run = 0; run + 1 < mesh.runIndex.length; run++) {
      const id = at(mesh.runOriginalID, run);
      if (only && !only.has(id)) continue;
      const slot = piece.paint ?? slotOf.get(id) ?? 0;
      const flip = (at(mesh.runFlags, run) & 1) === 1 ? -1 : 1;
      const from = at(mesh.runIndex, run);
      const to = at(mesh.runIndex, run + 1);
      if (to === from) continue;
      appendTriangles(mesh, from, to, flip, positions, normals);
      runs.push({ slot, triangles: (to - from) / 3 });
    }
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  // three-bvh-csg needs position, normal and uv on every operand, and a block
  // that falls back to it may take this result as one (codex on #24). Nothing
  // reads the coordinates — `texture` is not supported — so zeros will do.
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(
      new Float32Array((positions.length / 3) * 2),
      2,
    ),
  );
  let start = 0;
  for (const { slot, triangles } of runs) {
    const last = geometry.groups.at(-1);
    if (
      last &&
      last.materialIndex === slot &&
      last.start + last.count === start
    )
      last.count += triangles * 3;
    else geometry.addGroup(start, triangles * 3, slot);
    start += triangles * 3;
  }
  return geometry;
}

function appendTriangles(
  mesh: Mesh,
  from: number,
  to: number,
  flip: number,
  positions: number[],
  normals: number[],
): void {
  const props = mesh.vertProperties;
  const stride = mesh.numProp;
  for (let k = from; k < to; k++) {
    const at0 = at(mesh.triVerts, k) * stride;
    positions.push(at(props, at0), at(props, at0 + 1), at(props, at0 + 2));
    // Interpolated along a cut, a normal comes out a little short of unit.
    const normal = new THREE.Vector3(
      at(props, at0 + 3),
      at(props, at0 + 4),
      at(props, at0 + 5),
    )
      .normalize()
      .multiplyScalar(flip);
    normals.push(normal.x, normal.y, normal.z);
  }
}
