// The display mesh: packed in Node, unpacked in the page.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decodeMesh, encodeMesh, isBrepMesh } from "../src/core/mesh";
import { buildModel } from "../src/kernel/index";
import { enclosure } from "./parts";

const raw = {
  // A 40 x 20 x 5 box's corner region: uneven spans on the three axes.
  vertices: [0, 0, 0, 40, 0, 0, 40, 20, 0, 0, 20, 5, 13.37, 7.77, 2.5],
  normals: [0, 0, -1, 0, 0, -1, 0, 0, 1, 0.6, 0.8, 0, -0.577, 0.577, 0.577],
  triangles: [0, 1, 2, 0, 2, 3, 2, 3, 4],
  lines: [0, 0, 0, 40, 0, 0, 40, 0, 0, 40, 20, 0],
};

describe("the display mesh", () => {
  it("comes back within the quantisation step", () => {
    const decoded = decodeMesh(encodeMesh(raw));
    // 16-bit steps across 40 mm: under a micron.
    raw.vertices.forEach((value, i) =>
      assert.ok(Math.abs((decoded.positions[i] ?? NaN) - value) < 0.001),
    );
    raw.lines.forEach((value, i) =>
      assert.ok(Math.abs((decoded.edges[i] ?? NaN) - value) < 0.001),
    );
    raw.normals.forEach((value, i) =>
      assert.ok(Math.abs((decoded.normals[i] ?? NaN) - value) < 0.005),
    );
    assert.deepEqual([...decoded.indices], raw.triangles);
    assert.ok(decoded.indices instanceof Uint16Array);
  });

  it("keeps the corners of the box it is packed in", () => {
    const mesh = encodeMesh(raw);
    assert.deepEqual(mesh.min, [0, 0, 0]);
    assert.deepEqual(mesh.max, [40, 20, 5]);
  });

  it("survives a flat model, whose span on one axis is zero", () => {
    const flat = {
      ...raw,
      vertices: [0, 0, 3, 10, 0, 3, 10, 10, 3],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      triangles: [0, 1, 2],
      lines: [],
    };
    const decoded = decodeMesh(encodeMesh(flat));
    assert.deepEqual([...decoded.positions], flat.vertices);
    assert.equal(decoded.edges.length, 0);
  });

  it("uses 32-bit indices past 65 535 vertices", () => {
    const count = 65_537;
    const vertices = new Float32Array(count * 3).map((_, i) => i % 97);
    const mesh = encodeMesh({
      vertices,
      normals: new Float32Array(count * 3),
      triangles: [0, 1, count - 1],
      lines: [],
    });
    assert.equal(mesh.wideIndices, true);
    const decoded = decodeMesh(mesh);
    assert.ok(decoded.indices instanceof Uint32Array);
    assert.deepEqual([...decoded.indices], [0, 1, count - 1]);
  });

  it("tells a mesh from anything else", () => {
    assert.equal(isBrepMesh(encodeMesh(raw)), true);
    assert.equal(isBrepMesh(JSON.parse(JSON.stringify(encodeMesh(raw)))), true);
    for (const value of [
      undefined,
      null,
      "mesh",
      {},
      { ...encodeMesh(raw), min: [0, 0] },
      { ...encodeMesh(raw), positions: 1 },
    ])
      assert.equal(isBrepMesh(value), false);
  });

  it("carries the enclosure in about a hundred kilobytes, covering the whole part", async () => {
    const { mesh, report } = await buildModel(enclosure);
    const size = JSON.stringify(mesh).length;
    assert.ok(size < 150_000, `the mesh is ${size} bytes`);
    const decoded = decodeMesh(mesh);
    assert.ok(decoded.indices.length / 3 > 3000);
    assert.equal(decoded.positions.length, decoded.normals.length);
    assert.ok(decoded.edges.length % 6 === 0 && decoded.edges.length > 0);
    assert.ok(Math.max(...decoded.indices) < decoded.positions.length / 3);
    // The mesh's box is the part's.
    mesh.min.forEach((value, i) =>
      assert.ok(Math.abs(value - (report.bounds[0][i] ?? NaN)) < 0.05),
    );
    mesh.max.forEach((value, i) =>
      assert.ok(Math.abs(value - (report.bounds[1][i] ?? NaN)) < 0.05),
    );
  });
});
