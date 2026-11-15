// What the View puts in its scene and where it stands to look: the parts with
// no renderer in them.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { decodeMesh, encodeMesh } from "../src/core/mesh";
import { buildObjects, placeCamera, type ViewName } from "../src/vue/scene";

describe("the scene's objects", () => {
  it("are the mesh's triangles and its edge segments", () => {
    const objects = buildObjects(
      decodeMesh(
        encodeMesh({
          vertices: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0],
          normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
          triangles: [0, 1, 2, 0, 2, 3],
          lines: [0, 0, 0, 10, 0, 0, 10, 0, 0, 10, 10, 0],
        }),
      ),
    );
    assert.equal(objects.faces.geometry.getAttribute("position").count, 4);
    assert.equal(objects.faces.geometry.getAttribute("normal").count, 4);
    assert.equal(objects.faces.geometry.getIndex()?.count, 6);
    assert.equal(objects.edges.geometry.getAttribute("position").count, 4);
    assert.ok(objects.edges instanceof THREE.LineSegments);
    objects.dispose();
  });
});

describe("the camera's place", () => {
  const min = [-40, -25, 0] as const;
  const max = [40, 25, 25] as const;
  const views: ViewName[] = ["iso", "top", "front", "right"];

  for (const aspect of [16 / 9, 1, 9 / 16])
    it(`keeps every corner of the model in view at aspect ${aspect.toFixed(2)}`, () => {
      for (const view of views) {
        const placement = placeCamera(min, max, view, 35, aspect);
        const camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 10_000);
        camera.up.set(0, 0, 1);
        camera.position.set(...placement.position);
        camera.lookAt(...placement.target);
        camera.updateMatrixWorld();
        for (const x of [min[0], max[0]])
          for (const y of [min[1], max[1]])
            for (const z of [min[2], max[2]]) {
              const point = new THREE.Vector3(x, y, z).project(camera);
              assert.ok(
                Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1,
                `${view}: corner ${x},${y},${z} is outside the view`,
              );
            }
      }
    });

  it("looks down for the top view, along +Y for the front, along -X for the right", () => {
    const from = (view: ViewName) => {
      const { position, target } = placeCamera(min, max, view, 35, 1);
      return position.map((value, i) => value - (target[i] ?? 0));
    };
    const [tx, ty, tz] = from("top");
    assert.ok(
      (tz ?? 0) > 0 &&
        Math.abs(tx ?? 1) < 1e-9 &&
        Math.abs((ty ?? 1) / (tz ?? 1)) < 0.01,
    );
    const [fx, fy, fz] = from("front");
    assert.ok((fy ?? 0) < 0 && fx === 0 && fz === 0);
    const [rx, ry, rz] = from("right");
    assert.ok((rx ?? 0) > 0 && ry === 0 && rz === 0);
  });

  it("stands back from a model with no size instead of on it", () => {
    const placement = placeCamera([5, 5, 5], [5, 5, 5], "iso", 35, 1);
    assert.ok(Number.isFinite(placement.distance) && placement.distance > 0);
  });
});
