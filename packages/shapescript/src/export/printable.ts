// A printable STL: the model as one watertight solid, for a slicer.
//
// The plain STL export (`./stl`) writes every mesh as displayed, and CSG
// output from three-bvh-csg is not watertight: triangles split on one side of
// a cut but not the other leave T-junctions, which slicers report as
// non-manifold edges. Here the geometry goes through manifold (`manifold-3d`,
// WebAssembly) instead: the model is converted with CSG left unevaluated
// (`deferCsg`), every closed part becomes a manifold, each CSG block is
// evaluated by manifold in the order the preview evaluates it, all top-level
// solids are merged in one batch union, and the result is written in print
// coordinates — millimetres, Z up, resting on Z = 0 — with a report of what a
// slicer will find.
//
// manifold is loaded on first use with a dynamic `import()`, so a host that
// never exports a printable STL never fetches the WebAssembly.

import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { parseShapeScript } from "../shapescript/parser";
import { astToThreeJS } from "../shapescript/toThreeJS";
import { disposeObject3D } from "../shapescript/dispose";
import type { ExportOptions } from "./model";
import { bakedWorldGeometries } from "./stl";

/** What a slicer will make of a printable STL. */
export interface PrintReport {
  /** Bounding box in millimetres: width (X), depth (Y), height (Z). */
  sizeMm: [number, number, number];
  /** Parts merged into the solid. */
  parts: number;
  /** Parts left out because they are not closed solids — a flat `circle`,
   *  a `fill`, text outlines — by `name`, or by position when unnamed. */
  skipped: { part: string; reason: string }[];
  /** Separate solids in the result. 1 is one printable object. */
  bodies: number;
  /** Handles (through-holes) in the result: struts - nodes + 1 for a lattice. */
  genus: number;
  volumeMm3: number;
  triangles: number;
  /** Edges not shared by exactly two triangles once vertices within
   *  `WELD_MM` are merged, as a slicer merges them. Parts that only touch
   *  along an edge or at a point produce these. */
  nonManifoldEdges: number;
  warnings: string[];
}

export interface PrintableOptions extends ExportOptions {
  /** Millimetres per ShapeScript unit. Default 1: `cube` is a 1 mm cube. */
  unitScale?: number;
}

/** Vertices this close in the output are one vertex to a slicer. */
const WELD_MM = 1e-5;

/** Seam vertices of one part closer than this fraction of the model's extent
 *  are merged before the part goes to manifold: a primitive's UV seam
 *  duplicates its vertices, which leaves it open otherwise. */
const SEAM_WELD = 1e-6;

let manifoldModule: Promise<ManifoldToplevel> | undefined;

/** manifold's WebAssembly module, loaded once on first use. A failed load is
 *  not cached, so the next export tries again. */
export function loadManifold(): Promise<ManifoldToplevel> {
  manifoldModule ??= import("manifold-3d")
    .then(async ({ default: Module }) => {
      const wasm = await Module();
      wasm.setup();
      return wasm;
    })
    .catch((error: unknown) => {
      manifoldModule = undefined;
      throw error;
    });
  return manifoldModule;
}

/** Parse, evaluate and export one ShapeScript source as a printable binary
 *  STL, with its report. Throws when no part is a closed solid. */
export async function shapeScriptToPrintableStl(
  script: string,
  options: PrintableOptions = {},
): Promise<{ stl: Uint8Array<ArrayBuffer>; report: PrintReport }> {
  const { unitScale = 1, ...conversion } = options;
  if (!(Number.isFinite(unitScale) && unitScale > 0))
    throw new Error("`unitScale` must be a positive number of millimetres");
  const wasm = await loadManifold();
  const group = astToThreeJS(parseShapeScript(script), {
    ...conversion,
    wireframe: false,
    deferCsg: true,
  });
  try {
    return sceneToPrintableStl(wasm, group, unitScale);
  } finally {
    disposeObject3D(group);
  }
}

/** Every manifold made during one export, freed together: they live in
 *  WebAssembly memory, which the JavaScript garbage collector does not see. */
class Owned {
  private readonly all: Manifold[] = [];
  keep<T extends Manifold>(manifold: T): T {
    this.all.push(manifold);
    return manifold;
  }
  free(): void {
    for (const manifold of this.all) manifold.delete();
  }
}

function sceneToPrintableStl(
  wasm: ManifoldToplevel,
  object: THREE.Object3D,
  unitScale: number,
): { stl: Uint8Array<ArrayBuffer>; report: PrintReport } {
  object.updateMatrixWorld(true);
  const owned = new Owned();
  try {
    const { solids, skipped } = partsOf(wasm, object, owned);
    if (solids.length === 0)
      throw new Error(
        `Nothing to print: no part is a closed solid${skipped.length ? ` (skipped: ${skipped.map((s) => s.part).join(", ")})` : ""}`,
      );
    const merged = owned.keep(wasm.Manifold.union(solids));
    const printed = toPrintCoordinates(merged, unitScale, owned);
    const mesh = printed.getMesh();
    const report = reportOf(printed, mesh, solids.length, skipped, owned);
    return {
      stl: binaryStl(mesh.vertProperties, mesh.triVerts, mesh.numProp),
      report,
    };
  } finally {
    owned.free();
  }
}

/** The top-level solids of the model: every closed part, and every CSG block
 *  evaluated by manifold. What is left out is recorded in `skipped`. */
function partsOf(
  wasm: ManifoldToplevel,
  object: THREE.Object3D,
  owned: Owned,
): { solids: Manifold[]; skipped: PrintReport["skipped"] } {
  const extent = new THREE.Box3()
    .setFromObject(object)
    .getSize(new THREE.Vector3())
    .length();
  const walk = new PartWalk(wasm, Math.max(extent, 1) * SEAM_WELD, owned);
  const solids = walk
    .solidsOf(object)
    .filter((solid): solid is Manifold => solid !== null);
  return { solids, skipped: walk.skipped };
}

/** One pass over a converted tree, in order. `null` stands for a part that was
 *  skipped, so a CSG block can tell when its first operand is missing. */
class PartWalk {
  readonly skipped: PrintReport["skipped"] = [];
  private leaves = 0;

  constructor(
    private readonly wasm: ManifoldToplevel,
    private readonly tolerance: number,
    private readonly owned: Owned,
  ) {}

  solidsOf(object: THREE.Object3D): (Manifold | null)[] {
    if (!object.visible) return [];
    const operation: unknown = object.userData.csgOperation;
    if (typeof operation === "string") return [this.csgOf(object, operation)];
    if ((object as THREE.Mesh).isMesh)
      return this.meshSolids(object as THREE.Mesh);
    return object.children.flatMap((child) => this.solidsOf(child));
  }

  private meshSolids(mesh: THREE.Mesh): (Manifold | null)[] {
    const part = mesh.name || `part ${++this.leaves}`;
    return bakedWorldGeometries(mesh).map((geometry) => {
      try {
        const solid = solidOf(this.wasm, geometry, this.tolerance);
        if (typeof solid !== "string") return this.owned.keep(solid);
        this.skipped.push({ part, reason: solid });
        return null;
      } finally {
        geometry.dispose();
      }
    });
  }

  /** A CSG block, its operands flattened in order as `convertCSG` flattens
   *  them: the first is what the others are subtracted from, intersected
   *  with, or xor-ed against. */
  private csgOf(group: THREE.Object3D, operation: string): Manifold | null {
    const operands = group.children.flatMap((child) => this.solidsOf(child));
    const [first, ...rest] = operands;
    if (!first) {
      if (operands.length > 0)
        this.skipped.push({
          part: group.name || `${operation} block`,
          reason: `its first operand is not a closed solid`,
        });
      return null;
    }
    return this.combine(
      operation,
      first,
      rest.filter((solid): solid is Manifold => solid !== null),
    );
  }

  private combine(
    operation: string,
    first: Manifold,
    rest: Manifold[],
  ): Manifold {
    const { Manifold: M } = this.wasm;
    if (rest.length === 0) return first;
    switch (operation) {
      case "union":
        return this.owned.keep(M.union([first, ...rest]));
      case "difference":
        return this.owned.keep(first.subtract(this.owned.keep(M.union(rest))));
      case "intersection":
        return this.owned.keep(M.intersection([first, ...rest]));
      case "xor":
        return rest.reduce(
          (acc, next) =>
            this.owned.keep(
              this.owned
                .keep(acc.subtract(next))
                .add(this.owned.keep(next.subtract(acc))),
            ),
          first,
        );
      default:
        // `stencil` repaints the first operand's surface; its shape is the first's.
        return first;
    }
  }
}

/** One baked part as a manifold, or why it cannot be one. */
function solidOf(
  wasm: ManifoldToplevel,
  geometry: THREE.BufferGeometry,
  tolerance: number,
): Manifold | string {
  const welded = mergeVertices(geometry, tolerance);
  try {
    const position = welded.getAttribute("position");
    const index = welded.index;
    if (!index || index.count < 12) return "not a closed solid";
    const mesh = new wasm.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(position.array),
      triVerts: new Uint32Array(index.array),
    });
    mesh.merge();
    let solid: Manifold;
    try {
      solid = new wasm.Manifold(mesh);
    } catch {
      return "not a closed solid";
    }
    const status = solid.status();
    if (status !== "NoError" || solid.isEmpty()) {
      solid.delete();
      return status === "NotManifold" || status === "NoError"
        ? "not a closed solid"
        : status;
    }
    return solid;
  } finally {
    welded.dispose();
  }
}

/** ShapeScript is Y-up; slicers are Z-up. Rotate +90 deg about X
 *  ((x, y, z) -> (x, -z, y)), scale to millimetres, and rest the model on Z = 0. */
function toPrintCoordinates(
  manifold: Manifold,
  unitScale: number,
  owned: Owned,
): Manifold {
  const upright = owned.keep(
    owned.keep(manifold.rotate([90, 0, 0])).scale(unitScale),
  );
  const { min } = upright.boundingBox();
  return owned.keep(upright.translate([0, 0, -min[2]]));
}

function reportOf(
  printed: Manifold,
  mesh: {
    vertProperties: Float32Array;
    triVerts: Uint32Array;
    numProp: number;
  },
  parts: number,
  skipped: PrintReport["skipped"],
  owned: Owned,
): PrintReport {
  const { min, max } = printed.boundingBox();
  const sizeMm: PrintReport["sizeMm"] = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ];
  const bodies = printed.decompose().map((body) => owned.keep(body)).length;
  const nonManifoldEdges = weldedNonManifoldEdges(mesh);
  const report: PrintReport = {
    sizeMm,
    parts,
    skipped,
    bodies,
    genus: printed.genus(),
    volumeMm3: printed.volume(),
    triangles: mesh.triVerts.length / 3,
    nonManifoldEdges,
    warnings: [],
  };
  report.warnings = warningsFor(report);
  return report;
}

function warningsFor(report: PrintReport): string[] {
  const warnings: string[] = [];
  if (report.nonManifoldEdges > 0)
    warnings.push(
      `${report.nonManifoldEdges} non-manifold edges: some parts only touch along an edge or at a point. Make them overlap (a joint sphere at a node, a longer strut) so they fuse.`,
    );
  if (report.skipped.length > 0)
    warnings.push(
      `${report.skipped.length} part(s) skipped as not closed solids: ${report.skipped.map((s) => s.part).join(", ")}. Give them thickness (extrude, a solid primitive) to print them.`,
    );
  if (report.bodies > 1)
    warnings.push(
      `${report.bodies} separate bodies: parts that do not touch print as loose pieces. Connect them if they are meant to be one object.`,
    );
  return warnings;
}

/** Edges not shared by exactly two triangles after merging vertices within
 *  `WELD_MM`, counting the way a slicer does. Triangles that collapse to a
 *  line under that merge are ignored, as slicers drop them. */
function weldedNonManifoldEdges(mesh: {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
}): number {
  const ids = new Map<string, number>();
  const idOf = (vertex: number): number => {
    const at = vertex * mesh.numProp;
    const key = [0, 1, 2]
      .map((axis) =>
        Math.round((mesh.vertProperties[at + axis] ?? 0) / WELD_MM),
      )
      .join(",");
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    return id;
  };
  const edges = new Map<string, number>();
  for (let t = 0; t < mesh.triVerts.length; t += 3) {
    const corner = [0, 1, 2].map((k) => idOf(mesh.triVerts[t + k] ?? 0));
    if (new Set(corner).size < 3) continue;
    for (let k = 0; k < 3; k++) {
      const a = corner[k] ?? 0;
      const b = corner[(k + 1) % 3] ?? 0;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const count of edges.values()) if (count !== 2) bad++;
  return bad;
}

/** A binary STL of indexed triangles, with each facet's normal from its
 *  winding (counter-clockwise from outside, as manifold writes them). */
export function binaryStl(
  vertProperties: Float32Array,
  triVerts: Uint32Array,
  numProp = 3,
): Uint8Array<ArrayBuffer> {
  const triangles = triVerts.length / 3;
  const view = new DataView(new ArrayBuffer(84 + triangles * 50));
  view.setUint32(80, triangles, true);
  const corner = (t: number, k: number) => {
    const at = (triVerts[t * 3 + k] ?? 0) * numProp;
    return new THREE.Vector3(
      vertProperties[at],
      vertProperties[at + 1],
      vertProperties[at + 2],
    );
  };
  for (let t = 0; t < triangles; t++) {
    const [a, b, c] = [corner(t, 0), corner(t, 1), corner(t, 2)];
    const normal = new THREE.Vector3()
      .subVectors(c, b)
      .cross(new THREE.Vector3().subVectors(a, b))
      .normalize();
    const offset = 84 + t * 50;
    [normal, a, b, c].forEach((vector, slot) => {
      view.setFloat32(offset + slot * 12, vector.x, true);
      view.setFloat32(offset + slot * 12 + 4, vector.y, true);
      view.setFloat32(offset + slot * 12 + 8, vector.z, true);
    });
  }
  return new Uint8Array(view.buffer);
}
