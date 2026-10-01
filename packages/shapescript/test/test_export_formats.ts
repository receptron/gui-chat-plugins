// Coverage for the GLB and STL exports added in 5.1.0: the pure serialisers
// the View's download buttons use. Both are checked at the byte level — a GLB
// header and its JSON chunk, an STL header and its triangle count — since the
// point of each is that a third-party reader opens the file.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three";
import {
  sceneToGlb,
  shapeScriptToGlb,
  GLB_MIME_TYPE,
  GLB_EXTENSION,
} from "../src/export/glb";
import {
  sceneToStl,
  shapeScriptToStl,
  STL_MIME_TYPE,
  STL_EXTENSION,
} from "../src/export/stl";
import { parseShapeScript } from "../src/shapescript/parser";
import { astToThreeJS } from "../src/shapescript/toThreeJS";
import { disposeObject3D } from "../src/shapescript/dispose";

const CUBE = "cube { size 1 }";
const TWO = "cube { size 1 }\ncube {\n size 1\n position 3 0 0\n}";

/** The JSON chunk of a GLB, after its 12-byte header and 8-byte chunk prefix. */
function glbJson(bytes: Uint8Array): {
  meshes?: unknown[];
  nodes?: unknown[];
  materials?: unknown[];
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, "magic 'glTF'");
  assert.equal(view.getUint32(4, true), 2, "glTF 2.0");
  assert.equal(view.getUint32(8, true), bytes.byteLength, "total length");
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, "first chunk is JSON");
  return JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  );
}

/** A binary STL is an 80-byte header, a uint32 triangle count, then 50 bytes per triangle. */
function stlTriangles(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  assert.equal(
    bytes.byteLength,
    84 + count * 50,
    "byte length matches the triangle count",
  );
  return count;
}

describe("shapeScriptToGlb", () => {
  it("writes a binary glTF 2.0 with the model's mesh", async () => {
    const json = glbJson(await shapeScriptToGlb(CUBE));
    assert.equal(json.meshes?.length, 1);
    assert.equal(json.materials?.length, 1);
  });

  it("keeps a vertex-coloured mesh's colours as COLOR_0", async () => {
    const script =
      "mesh {\n polygon {\n  color 1 0 0\n  point 0 0 0\n  point 1 0 0\n  point 0 1 0\n }\n}";
    const json = glbJson(await shapeScriptToGlb(script)) as {
      meshes?: { primitives: { attributes: Record<string, number> }[] }[];
    };
    assert.ok(
      json.meshes?.[0]?.primitives[0]?.attributes.COLOR_0 !== undefined,
    );
  });

  it("rejects an invalid script rather than exporting nothing", async () => {
    await assert.rejects(shapeScriptToGlb("cube {"), /RBRACE/);
  });

  it("runs under Node, where three's exporter would otherwise want FileReader", () => {
    // The suite itself is that proof; this pins the reason the shim exists.
    assert.equal(typeof globalThis.FileReader, "function");
  });

  it("leaves a hidden subtree out", async () => {
    const group = astToThreeJS(parseShapeScript(TWO));
    group.children[1]!.visible = false;
    const json = glbJson(await sceneToGlb(group));
    assert.equal(json.meshes?.length, 1);
    disposeObject3D(group);
  });

  it("names the MIME type and extension", () => {
    assert.equal(GLB_MIME_TYPE, "model/gltf-binary");
    assert.equal(GLB_EXTENSION, ".glb");
  });
});

describe("shapeScriptToStl", () => {
  it("writes a binary STL with one triangle per face", async () => {
    // A cube is 6 faces of 2 triangles.
    assert.equal(stlTriangles(await shapeScriptToStl(CUBE)), 12);
  });

  it("places every mesh by its world matrix", async () => {
    const bytes = await shapeScriptToStl(TWO);
    assert.equal(stlTriangles(bytes), 24);
    // Vertex x of the first triangle of each 12-triangle run: the second cube
    // sits at x = 3, so its vertices land at 2.5 / 3.5 rather than ±0.5.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const xs = new Set<number>();
    for (let i = 0; i < 24; i++)
      for (let v = 0; v < 3; v++)
        xs.add(view.getFloat32(84 + i * 50 + 12 + v * 12, true));
    assert.ok(
      xs.has(2.5) && xs.has(3.5),
      `world-space x: ${[...xs].join(", ")}`,
    );
  });

  it("leaves a hidden subtree out", async () => {
    const group = astToThreeJS(parseShapeScript(TWO));
    group.children[1]!.visible = false;
    assert.equal(stlTriangles(await sceneToStl(group)), 12);
    disposeObject3D(group);
  });

  it("leaves the source geometry alone and releases what it baked", async () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    );
    let disposed = false;
    mesh.geometry.addEventListener("dispose", () => void (disposed = true));
    assert.equal(stlTriangles(await sceneToStl(mesh)), 12);
    assert.equal(disposed, false);
    assert.equal(
      mesh.geometry.getAttribute("position").getX(0),
      0.5,
      "source vertices untouched",
    );
    disposeObject3D(mesh);
  });

  it("exports a skinned mesh as posed, not in bind pose", async () => {
    // One bone, translated 2 along x after binding: every vertex must follow.
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute(
      "skinIndex",
      new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
    );
    geometry.setAttribute(
      "skinWeight",
      new THREE.Float32BufferAttribute(
        new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)),
        4,
      ),
    );
    const bone = new THREE.Bone();
    const skinned = new THREE.SkinnedMesh(
      geometry,
      new THREE.MeshStandardMaterial(),
    );
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    bone.position.x = 2;
    const bytes = await sceneToStl(skinned);
    assert.equal(stlTriangles(bytes), 12);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const xs = new Set<number>();
    for (let i = 0; i < 12; i++)
      for (let v = 0; v < 3; v++)
        xs.add(view.getFloat32(84 + i * 50 + 12 + v * 12, true));
    assert.deepEqual(
      [...xs].sort(),
      [1.5, 2.5],
      `posed x: ${[...xs].join(", ")}`,
    );
    disposeObject3D(skinned);
  });

  it("bakes an instanced mesh once per instance", async () => {
    const instanced = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
      2,
    );
    instanced.setMatrixAt(0, new THREE.Matrix4());
    instanced.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3, 0, 0));
    // The mesh itself is moved too: an instance is placed by BOTH matrices.
    instanced.position.y = 1;
    const bytes = await sceneToStl(instanced);
    assert.equal(stlTriangles(bytes), 24);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (let i = 0; i < 24; i++) {
      for (let v = 0; v < 3; v++) {
        xs.add(view.getFloat32(84 + i * 50 + 12 + v * 12, true));
        ys.add(view.getFloat32(84 + i * 50 + 16 + v * 12, true));
      }
    }
    assert.deepEqual(
      [...xs].sort(),
      [-0.5, 0.5, 2.5, 3.5],
      `instance x: ${[...xs].join(", ")}`,
    );
    assert.deepEqual(
      [...ys].sort(),
      [0.5, 1.5],
      `mesh y: ${[...ys].join(", ")}`,
    );
    disposeObject3D(instanced);
  });

  it("bakes each instance with its own morph weights", async () => {
    // One morph target that shifts every vertex +2 along x; instance 0 at
    // weight 0, instance 1 at weight 1, both at the same instance matrix.
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const base = geometry.getAttribute("position");
    const shifted = new Float32Array(base.array as Float32Array);
    for (let i = 0; i < base.count; i++) shifted[i * 3] = base.getX(i) + 2;
    geometry.morphAttributes.position = [
      new THREE.Float32BufferAttribute(shifted, 3),
    ];
    const instanced = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial(),
      2,
    );
    instanced.morphTargetInfluences = [0];
    instanced.setMatrixAt(0, new THREE.Matrix4());
    instanced.setMatrixAt(1, new THREE.Matrix4());
    const weights = new THREE.Mesh(geometry);
    weights.morphTargetInfluences = [0];
    instanced.setMorphAt(0, weights);
    weights.morphTargetInfluences = [1];
    instanced.setMorphAt(1, weights);
    const bytes = await sceneToStl(instanced);
    assert.equal(stlTriangles(bytes), 24);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const xs = new Set<number>();
    for (let i = 0; i < 24; i++)
      for (let v = 0; v < 3; v++)
        xs.add(view.getFloat32(84 + i * 50 + 12 + v * 12, true));
    assert.deepEqual(
      [...xs].sort(),
      [-0.5, 0.5, 1.5, 2.5],
      `morphed x: ${[...xs].join(", ")}`,
    );
    // The mesh's own weights are back to what they were.
    assert.deepEqual(instanced.morphTargetInfluences, [0]);
    disposeObject3D(instanced);
  });

  it("keeps facets facing outward under a mirroring transform", async () => {
    // Signed volume from the facets: positive when every triangle winds
    // outward, negative when a mirror has turned them all inside out.
    const signedVolume = (bytes: Uint8Array): number => {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      const count = view.getUint32(80, true);
      const at = (i: number, v: number) =>
        new THREE.Vector3(
          ...[0, 4, 8].map((k) =>
            view.getFloat32(84 + i * 50 + 12 + v * 12 + k, true),
          ),
        );
      return Array.from(
        { length: count },
        (_, i) => at(i, 0).dot(at(i, 1).cross(at(i, 2))) / 6,
      ).reduce((a, b) => a + b, 0);
    };
    const plain = signedVolume(await shapeScriptToStl(CUBE));
    assert.ok(Math.abs(plain - 1) < 1e-6, `volume ${plain}`);
    // Indexed and non-indexed geometry take different paths through the
    // winding reversal; a mirror on the mesh's own transform exercises both.
    for (const geometry of [
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
    ]) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
      mesh.scale.z = -1;
      const mirrored = signedVolume(await sceneToStl(mesh));
      assert.ok(
        Math.abs(mirrored - 1) < 1e-6,
        `mirrored volume ${mirrored} (indexed: ${Boolean(geometry.index)})`,
      );
      disposeObject3D(mesh);
    }
  });

  it("rejects an invalid script rather than exporting nothing", async () => {
    await assert.rejects(shapeScriptToStl("cube {"), /RBRACE/);
  });

  it("names the MIME type and extension", () => {
    assert.equal(STL_MIME_TYPE, "model/stl");
    assert.equal(STL_EXTENSION, ".stl");
  });
});
