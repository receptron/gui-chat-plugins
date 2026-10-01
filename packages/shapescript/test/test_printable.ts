// The printable STL export: every part merged through manifold into one
// solid in print coordinates, and a report of what a slicer will find.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FileOps } from "gui-chat-protocol";
import { binaryStl, shapeScriptToPrintableStl } from "../src/export/printable";
import {
  EXPORT_STL_SCHEMA,
  EXPORT_STL_TOOL_NAME,
  executeExportShapeScriptStl,
} from "../src/export/stlTool";

const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((value, i) =>
    assert.ok(
      Math.abs(value - (expected[i] ?? NaN)) < 1e-4,
      `${actual.join(", ")} is not ${expected.join(", ")}`,
    ),
  );

/** A cube lattice of `cells` per side: a strut on every cell edge and a
 *  joint sphere on every node. Struts run along Y, then laid along X by roll
 *  and along Z by pitch (half-turns). */
function lattice(cells: number, joints = true): string {
  const nodes = Array.from({ length: cells + 1 }, (_, i) => i);
  const lines = ["detail 12"];
  for (const a of nodes)
    for (const b of nodes)
      for (let s = 0; s < cells; s++) {
        lines.push(
          `cylinder {\n size 0.2 1 0.2\n position ${a} ${s + 0.5} ${b}\n}`,
        );
        lines.push(
          `cylinder {\n size 0.2 1 0.2\n position ${s + 0.5} ${a} ${b}\n orientation 0.5 0 0\n}`,
        );
        lines.push(
          `cylinder {\n size 0.2 1 0.2\n position ${a} ${b} ${s + 0.5}\n orientation 0 0 0.5\n}`,
        );
      }
  if (joints)
    for (const x of nodes)
      for (const y of nodes)
        for (const z of nodes)
          lines.push(`sphere {\n size 0.35\n position ${x} ${y} ${z}\n}`);
  return lines.join("\n");
}

describe("shapeScriptToPrintableStl", () => {
  it("merges overlapping parts into one solid with no union block", async () => {
    const { report } = await shapeScriptToPrintableStl(
      "cube\ncube {\n position 0.5 0 0\n}",
    );
    assert.equal(report.parts, 2);
    assert.equal(report.bodies, 1);
    assert.equal(report.genus, 0);
    near([report.volumeMm3], [1.5]);
    assert.equal(report.nonManifoldEdges, 0);
    assert.deepEqual(report.warnings, []);
  });

  it("writes Z up, in millimetres, resting on Z = 0", async () => {
    // 1 wide (X), 2 tall (Y in ShapeScript), 3 deep (Z in ShapeScript).
    const { report } = await shapeScriptToPrintableStl(
      "cube {\n size 1 2 3\n}",
    );
    near(report.sizeMm, [1, 3, 2]);
    const scaled = await shapeScriptToPrintableStl("cube {\n size 1 2 3\n}", {
      unitScale: 10,
    });
    near(scaled.report.sizeMm, [10, 30, 20]);
    near([scaled.report.volumeMm3], [6000]);
    // Resting on Z = 0: every vertex's Z is at least 0, and some are 0.
    const zs = vertexZs(scaled.stl);
    near([Math.min(...zs)], [0]);
  });

  it("fuses a lattice into one body whose genus is struts - nodes + 1", async () => {
    // 2 x 2 x 2 cells: 27 nodes and 54 struts, so genus 28.
    const { report } = await shapeScriptToPrintableStl(lattice(2));
    assert.equal(report.parts, 54 + 27);
    assert.equal(report.bodies, 1);
    assert.equal(report.genus, 28);
    assert.equal(report.nonManifoldEdges, 0);
    assert.deepEqual(report.warnings, []);
  });

  it("evaluates CSG blocks through manifold, watertight, in the preview's order", async () => {
    const report = async (script: string) =>
      (await shapeScriptToPrintableStl(`detail 24\n${script}`)).report;
    // Sphere minus the cube over its right half: the left hemisphere.
    const difference = await report(
      "difference {\n sphere\n cube {\n  position 0.5 0 0\n }\n}",
    );
    near(difference.sizeMm, [0.5, 1, 1]);
    assert.ok(Math.abs(difference.volumeMm3 - Math.PI / 12) < 0.01);
    assert.equal(difference.nonManifoldEdges, 0);
    // A hollow shell with a window cut through it, as a print would be.
    const shell = await report(
      "difference {\n sphere {\n  size 2\n }\n sphere {\n  size 1.8\n }\n cylinder {\n  size 0.6 3 0.6\n }\n}",
    );
    assert.equal(shell.bodies, 1);
    assert.equal(shell.genus, 1);
    assert.equal(shell.nonManifoldEdges, 0);
    // A union block, and a block moved as a whole.
    const union = await report(
      "union {\n cube\n sphere {\n  position 0.5 0 0\n }\n}",
    );
    assert.equal(union.bodies, 1);
    near(union.sizeMm, [1.5, 1, 1]);
    const slot = await report(
      "translate 5 0 0\ndifference {\n cube\n cube {\n  size 0.5 2 0.5\n }\n}",
    );
    assert.equal(slot.genus, 1);
    near([slot.volumeMm3], [0.75]);
    near(
      (await report("intersection {\n sphere\n cube {\n  size 0.8\n }\n}"))
        .sizeMm,
      [0.8, 0.8, 0.8],
    );
    // xor leaves the two ends of overlapping cubes: two loose pieces.
    const xor = await report(
      "xor {\n cube\n cube {\n  position 0.5 0 0\n }\n}",
    );
    assert.equal(xor.bodies, 2);
    near([xor.volumeMm3], [1]);
  });

  it("evaluates a CSG block the same placed, stored with define, or returned by a function", async () => {
    const cut = "difference {\n cube\n cube {\n  size 0.5 2 0.5\n }\n}";
    for (const script of [
      cut,
      `define slot ${cut}\nslot`,
      "define cutter(s) {\n difference {\n  cube\n  cube {\n   size s 2 s\n  }\n }\n}\ncutter(0.5)",
    ]) {
      const { report } = await shapeScriptToPrintableStl(script);
      assert.equal(report.bodies, 1, script);
      assert.equal(report.genus, 1, script);
      near([report.volumeMm3], [0.75]);
    }
    // A block inside a block.
    const nested = await shapeScriptToPrintableStl(
      "difference {\n union {\n  cube\n  cube {\n   position 1 0 0\n  }\n }\n cube {\n  size 0.5 2 0.5\n }\n}",
    );
    near([nested.report.volumeMm3], [1.75]);
    near(nested.report.sizeMm, [2, 1, 1]);
  });

  it("refuses a model whose booleans leave nothing, and reports an empty block beside others", async () => {
    await assert.rejects(
      shapeScriptToPrintableStl("difference {\n cube\n cube\n}"),
      /Nothing to print: .*difference block/,
    );
    const { report } = await shapeScriptToPrintableStl(
      "difference {\n cube\n cube\n}\ncube {\n position 3 0 0\n}",
    );
    assert.equal(report.parts, 1);
    assert.deepEqual(report.skipped, [
      { part: "difference block", reason: "it leaves nothing" },
    ]);
  });

  it("skips a CSG block whose first operand is not a closed solid", async () => {
    const { report } = await shapeScriptToPrintableStl(
      "difference {\n circle\n cube\n}\ncube {\n position 3 0 0\n}",
    );
    assert.equal(report.parts, 1);
    assert.deepEqual(
      report.skipped.map((entry) => entry.reason),
      ["not a closed solid", "its first operand is not a closed solid"],
    );
  });

  it("prints the proposal's 4 x 4 x 4 lattice as one body of genus 176", async () => {
    // As the proposal built it: 75 struts, each one whole lattice line (4
    // cells long), and 125 joint spheres — 200 parts, no union. The graph has
    // 300 cell edges on 125 nodes, so genus 300 - 125 + 1 = 176.
    const lines = ["detail 12"];
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
    const { report } = await shapeScriptToPrintableStl(lines.join("\n"), {
      unitScale: 10,
    });
    assert.equal(report.parts, 200);
    assert.equal(report.bodies, 1);
    assert.equal(report.genus, 176);
    assert.equal(report.nonManifoldEdges, 0);
    assert.deepEqual(report.warnings, []);
    near(report.sizeMm, [43.5, 43.5, 43.5]);
  });

  it("counts a sealed hollow as a cavity, not a second body", async () => {
    const { report } = await shapeScriptToPrintableStl(
      "difference {\n cube\n cube {\n  size 0.5\n }\n}",
    );
    assert.equal(report.bodies, 1);
    assert.equal(report.cavities, 1);
    near([report.volumeMm3], [0.875]);
    assert.deepEqual(report.warnings, []);
  });

  it("corrects a mirrored operand's winding before evaluating the block", async () => {
    // Under `scale -1 1 1` the outer cube's triangles face inwards; read as
    // they are, the difference came out as two bodies of negative volume.
    const { report } = await shapeScriptToPrintableStl(
      "difference {\n scale -1 1 1\n cube\n cube {\n  size 0.5\n }\n}",
    );
    assert.equal(report.bodies, 1);
    assert.equal(report.cavities, 1);
    near([report.volumeMm3], [0.875]);
  });

  it("lists lines and text outlines as skipped", async () => {
    for (const script of [
      "cube\npath {\n point 2 0\n point 3 1\n}",
      'cube\ntext "label"',
    ]) {
      const { report } = await shapeScriptToPrintableStl(script);
      assert.equal(report.parts, 1, script);
      assert.deepEqual(
        report.skipped.map((entry) => entry.reason),
        ["a line or outline, not a solid"],
        script,
      );
      assert.match(report.warnings.join("\n"), /skipped/);
    }
  });

  it("warns about parts that only touch along an edge", async () => {
    const { report } = await shapeScriptToPrintableStl(
      "cube\ncube {\n position 1 1 0\n}",
    );
    assert.ok(report.nonManifoldEdges > 0);
    assert.equal(report.bodies, 2);
    assert.match(report.warnings.join("\n"), /only touch/);
    assert.match(report.warnings.join("\n"), /2 separate bodies/);
  });

  it("skips a part that is not a closed solid, names it, and prints the rest", async () => {
    const { report } = await shapeScriptToPrintableStl(
      'cube\ncircle {\n name "label"\n position 3 0 0\n}',
    );
    assert.equal(report.parts, 1);
    assert.deepEqual(report.skipped, [
      { part: "label", reason: "not a closed solid" },
    ]);
    assert.match(
      report.warnings.join("\n"),
      /skipped as not closed solids: label/,
    );
  });

  it("refuses a model with nothing to print, and a bad unitScale", async () => {
    await assert.rejects(
      shapeScriptToPrintableStl("circle"),
      /Nothing to print: no part is a closed solid/,
    );
    await assert.rejects(
      shapeScriptToPrintableStl("cube", { unitScale: 0 }),
      /unitScale/,
    );
  });
});

describe("binaryStl", () => {
  it("writes the 80-byte header, the count and 50 bytes per triangle, normal from the winding", () => {
    const stl = binaryStl(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
    );
    const view = new DataView(stl.buffer);
    assert.equal(stl.byteLength, 84 + 50);
    assert.equal(view.getUint32(80, true), 1);
    // Counter-clockwise in the XY plane seen from +Z: the normal is +Z.
    near(
      [0, 4, 8].map((o) => view.getFloat32(84 + o, true)),
      [0, 0, 1],
    );
  });
});

function vertexZs(stl: Uint8Array<ArrayBuffer>): number[] {
  const view = new DataView(stl.buffer);
  const zs: number[] = [];
  for (let t = 0; t < view.getUint32(80, true); t++)
    for (let v = 0; v < 3; v++)
      zs.push(view.getFloat32(84 + t * 50 + 12 + v * 12 + 8, true));
  return zs;
}

describe("exportShapeScriptStl", () => {
  function memoryFiles(seed: Record<string, string> = {}) {
    const store = new Map<string, string | Uint8Array>(Object.entries(seed));
    const files = {
      read: async (rel: string) => {
        const value = store.get(rel);
        if (typeof value !== "string") throw new Error(`ENOENT: ${rel}`);
        return value;
      },
      write: async (rel: string, content: string | Uint8Array) => {
        store.set(rel, content);
      },
      exists: async (rel: string) => store.has(rel),
    } as unknown as FileOps;
    return { files, store };
  }

  it("is offered with unitScale beside the USDZ tool's inputs", () => {
    assert.equal(EXPORT_STL_TOOL_NAME, "exportShapeScriptStl");
    assert.deepEqual(Object.keys(EXPORT_STL_SCHEMA.properties).sort(), [
      "path",
      "script",
      "title",
      "unitScale",
    ]);
  });

  it("saves the STL under artifacts/shapes/ and answers the report", async () => {
    const { files, store } = memoryFiles({
      "shapes/lamp-1-aaaaaaaa.shape": "cube\ncube {\n position 0.5 0 0\n}",
    });
    const result = await executeExportShapeScriptStl(
      { files: { artifacts: files } },
      { path: "artifacts/shapes/lamp-1-aaaaaaaa.shape", unitScale: 10 },
    );
    assert.match(
      result.filePath,
      /^artifacts\/shapes\/lamp-1-aaaaaaaa-\d+-[a-z0-9]+\.stl$/,
    );
    const written = store.get(result.filePath.replace(/^artifacts\//, ""));
    assert.ok(written instanceof Uint8Array);
    assert.equal(written.byteLength, result.bytes);
    assert.equal(result.report.bodies, 1);
    assert.match(result.message, /Size 15 x 10 x 10 mm, 1 body/);
  });

  it("refuses a unitScale that is not a positive number", async () => {
    const { files } = memoryFiles();
    await assert.rejects(
      executeExportShapeScriptStl(
        { files: { artifacts: files } },
        { script: "cube", unitScale: -1 },
      ),
      /unitScale/,
    );
  });
});
