// The preview's CSG through manifold (`csgEngine: "manifold"`): the same
// models as three-bvh-csg, face for face where it matters — each operand's
// material kept, normals facing out — and a block manifold cannot take left
// to three-bvh-csg. Runs in its own process, so the first tests see manifold
// not loaded yet.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { parseShapeScript } from "../src/shapescript/parser";
import {
  astToThreeJS,
  enableManifoldCsg,
  setDefaultCsgEngine,
  type CsgEngine,
} from "../src/shapescript/toThreeJS";
import { loadedManifold } from "../src/shapescript/manifoldModule";
import { disposeObject3D } from "../src/shapescript/dispose";
import { exportShapeScript } from "../src/export/model";
import { samples } from "../src/core/samples";

const FIXTURES = join(import.meta.dirname, "fixtures", "upstream-examples");

/** Surface area per material colour, and how many triangles face inwards
 *  (their normal against their winding). */
function surfaces(script: string, engine: CsgEngine) {
  const group = astToThreeJS(parseShapeScript(script), { csgEngine: engine });
  try {
    group.updateMatrixWorld(true);
    const area = new Map<string, number>();
    let inward = 0;
    let meshes = 0;
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes++;
      const geometry = mesh.geometry;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      const index = (k: number) =>
        geometry.index ? geometry.index.getX(k) : k;
      const groups = geometry.groups.length
        ? geometry.groups
        : [
            {
              start: 0,
              count: geometry.index?.count ?? position.count,
              materialIndex: 0,
            },
          ];
      for (const group of groups) {
        const material = materials[
          group.materialIndex ?? 0
        ] as THREE.MeshStandardMaterial;
        const key = `#${material.color.getHexString()}`;
        for (let k = group.start; k < group.start + group.count; k += 3) {
          const [a, b, c] = [0, 1, 2].map((j) =>
            new THREE.Vector3()
              .fromBufferAttribute(position, index(k + j))
              .applyMatrix4(mesh.matrixWorld),
          ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
          const face = new THREE.Vector3()
            .subVectors(c, b)
            .cross(new THREE.Vector3().subVectors(a, b));
          area.set(key, (area.get(key) ?? 0) + face.length() / 2);
          if (normal && face.lengthSq() > 1e-14) {
            const n = new THREE.Vector3()
              .fromBufferAttribute(normal, index(k))
              .transformDirection(mesh.matrixWorld);
            if (n.dot(face) < 0) inward++;
          }
        }
      }
    });
    return { area, inward, meshes };
  } finally {
    disposeObject3D(group);
  }
}

describe("before manifold is loaded", () => {
  it("refuses csgEngine manifold, saying what to do", () => {
    assert.equal(loadedManifold(), undefined);
    assert.throws(
      () =>
        astToThreeJS(parseShapeScript("difference {\n cube\n sphere\n}"), {
          csgEngine: "manifold",
        }),
      /needs manifold loaded first: await loadManifold\(\)/,
    );
  });

  it("an export asked for manifold loads it itself", async () => {
    const bytes = await exportShapeScript(
      "difference {\n cube\n sphere\n}",
      async () => new Uint8Array(1),
      { csgEngine: "manifold" },
    );
    assert.equal(bytes.byteLength, 1);
    assert.ok(loadedManifold());
  });
});

describe("csgEngine manifold", () => {
  const CASES: Record<string, string> = {
    "coloured difference":
      "detail 32\ndifference {\n sphere {\n  color red\n }\n cube {\n  color blue\n  position 0.5 0 0\n }\n}",
    nested:
      "detail 32\ndifference {\n union {\n  cube {\n   color red\n  }\n  sphere {\n   color yellow\n   position 0.5 0 0\n  }\n }\n cylinder {\n  color blue\n  size 0.4 3 0.4\n }\n}",
    stencil:
      "detail 32\nstencil {\n sphere {\n  color white\n }\n cube {\n  color green\n  size 0.5 2 2\n }\n}",
    Ball: readFileSync(join(FIXTURES, "Ball.shape"), "utf8"),
    Cog: readFileSync(join(FIXTURES, "Cog.shape"), "utf8"),
    "Hollow Sphere sample": String(
      samples.find((sample) => sample.args.title === "Hollow Sphere")?.args
        .script,
    ),
  };

  for (const [name, script] of Object.entries(CASES)) {
    it(`keeps every material's surface as three-bvh-csg does: ${name}`, () => {
      const bvh = surfaces(script, "three-bvh-csg");
      const manifold = surfaces(script, "manifold");
      assert.deepEqual(
        [...manifold.area.keys()].sort(),
        [...bvh.area.keys()].sort(),
      );
      for (const [colour, expected] of bvh.area) {
        const actual = manifold.area.get(colour) ?? 0;
        assert.ok(
          Math.abs(actual - expected) <= expected * 1e-3,
          `${colour}: ${actual} against ${expected}`,
        );
      }
      assert.equal(manifold.inward, 0);
    });
  }

  it("paints a stencil with several overlapping cutters as three-bvh-csg does", () => {
    // Where cutters overlap, the later one's colour wins in both engines.
    const script =
      "detail 32\nstencil {\n sphere {\n  color white\n }\n cube {\n  color red\n  size 0.6 2 2\n  position -0.2 0 0\n }\n cube {\n  color blue\n  size 0.6 2 2\n  position 0.2 0 0\n }\n cube {\n  color green\n  size 2 0.3 2\n }\n}";
    const bvh = surfaces(script, "three-bvh-csg");
    const manifold = surfaces(script, "manifold");
    assert.deepEqual(
      [...manifold.area.keys()].sort(),
      [...bvh.area.keys()].sort(),
    );
    for (const [colour, expected] of bvh.area) {
      const actual = manifold.area.get(colour) ?? 0;
      assert.ok(
        Math.abs(actual - expected) <= expected * 1e-3,
        `${colour}: ${actual} against ${expected}`,
      );
    }
  });

  it("keeps a stencil with many cutters that miss the shape linear (codex on #24)", () => {
    // Empty pieces used to be split again by every later cutter: 2^n pieces.
    const cutters = Array.from(
      { length: 30 },
      (_, i) =>
        ` cube {\n  color red\n  size 0.1\n  position ${(i + 1) * 3} 0 0\n }`,
    ).join("\n");
    const script = `detail 16\nstencil {\n sphere {\n  color white\n }\n${cutters}\n}`;
    const started = Date.now();
    const { area } = surfaces(script, "manifold");
    assert.ok(Date.now() - started < 2_000);
    assert.deepEqual([...area.keys()], ["#ffffff"]);
  });

  it("leaves out only faces inside the solid where operands coincide (Chessboard)", () => {
    // The board is a union of a recessed frame and squares sitting in it;
    // three-bvh-csg keeps faces between them that manifold's watertight result
    // cannot have. Rendered, the two differ in 0.12% of pixels
    // (scripts/compare-csg-engines.ts).
    const script = readFileSync(join(FIXTURES, "Chessboard.shape"), "utf8");
    const bvh = surfaces(script, "three-bvh-csg");
    const manifold = surfaces(script, "manifold");
    for (const [colour, expected] of bvh.area) {
      const actual = manifold.area.get(colour) ?? 0;
      assert.ok(
        actual <= expected * (1 + 1e-6) && actual >= expected * 0.9,
        `${colour}: ${actual} against ${expected}`,
      );
    }
    assert.equal(manifold.inward, 0);
  });

  it("leaves a block with an operand manifold cannot take to three-bvh-csg", () => {
    const script = "difference {\n cube\n circle {\n  size 0.5\n }\n}";
    const bvh = surfaces(script, "three-bvh-csg");
    const manifold = surfaces(script, "manifold");
    assert.deepEqual([...manifold.area], [...bvh.area]);
  });

  it("builds a lattice inside a union as one mesh, where three-bvh-csg runs out of time", () => {
    // The 4 x 4 x 4 lattice of the manifold proposal, wrapped in a union.
    const lines = ["detail 8", "union {"];
    const nodes = [0, 1, 2, 3, 4];
    for (const a of nodes)
      for (const b of nodes) {
        lines.push(`cylinder {\n size 0.2 4 0.2\n position ${a} 2 ${b}\n}`);
        lines.push(
          `cylinder {\n size 0.2 4 0.2\n position 2 ${a} ${b}\n orientation 0.5 0 0\n}`,
        );
        lines.push(
          `cylinder {\n size 0.2 4 0.2\n position ${a} ${b} 2\n orientation 0 0 0.5\n}`,
        );
      }
    for (const x of nodes)
      for (const y of nodes)
        for (const z of nodes)
          lines.push(`sphere {\n size 0.35\n position ${x} ${y} ${z}\n}`);
    lines.push("}");
    const started = Date.now();
    const { meshes, inward } = surfaces(lines.join("\n"), "manifold");
    assert.equal(meshes, 1);
    assert.equal(inward, 0);
    assert.ok(Date.now() - started < 10_000);
  });
});

/** Triangles in a conversion with `engine`, or with the default when none. */
function triangles(script: string, engine?: CsgEngine): number {
  const group = astToThreeJS(
    parseShapeScript(script),
    engine ? { csgEngine: engine } : {},
  );
  let count = 0;
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    count +=
      (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
  });
  disposeObject3D(group);
  return count;
}

describe("enableManifoldCsg", () => {
  it("makes manifold the engine of every conversion that names none", async () => {
    const script =
      "detail 16\ndifference {\n sphere {\n  color red\n }\n cube {\n  color blue\n  position 0.5 0 0\n }\n}";
    // The engines triangulate the cut differently, which tells them apart.
    const bvh = triangles(script, "three-bvh-csg");
    const manifold = triangles(script, "manifold");
    assert.notEqual(bvh, manifold);
    assert.equal(triangles(script), bvh);
    try {
      await enableManifoldCsg();
      assert.equal(triangles(script), manifold);
      assert.equal(triangles(script, "three-bvh-csg"), bvh);
    } finally {
      setDefaultCsgEngine("three-bvh-csg");
    }
    assert.equal(triangles(script), bvh);
  });
});
