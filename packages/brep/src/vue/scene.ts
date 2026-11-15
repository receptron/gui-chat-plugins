// The three.js objects a mesh becomes, and where the camera stands to look at
// them. No renderer and no DOM here, so it runs in the tests.
//
// The model's axes are kept: Z is up, as in the script and the drawing sheet.

import * as THREE from "three";
import type { DecodedMesh } from "../core/mesh";

export const FACE_COLOUR = 0xc3d0dc;
export const EDGE_COLOUR = 0x1f2937;

export interface ModelObjects {
  faces: THREE.Mesh;
  edges: THREE.LineSegments;
  dispose(): void;
}

export function buildObjects(mesh: DecodedMesh): ModelObjects {
  const faceGeometry = new THREE.BufferGeometry();
  faceGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(mesh.positions, 3),
  );
  faceGeometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(mesh.normals, 3),
  );
  faceGeometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: FACE_COLOUR,
    metalness: 0.1,
    roughness: 0.65,
    side: THREE.DoubleSide,
    // Pushed back a little, so an edge line lying on a face is not half
    // hidden by it.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(mesh.edges, 3),
  );
  const edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOUR });
  return {
    faces: new THREE.Mesh(faceGeometry, faceMaterial),
    edges: new THREE.LineSegments(edgeGeometry, edgeMaterial),
    dispose() {
      faceGeometry.dispose();
      faceMaterial.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
    },
  };
}

export type ViewName = "iso" | "top" | "front" | "right";

type Triple = readonly [number, number, number];

/** Where the camera stands, as a direction from the model's centre: the same
 *  four views as the drawing sheet. The top view leans a hair toward the
 *  front, because orbit controls cannot look exactly along their up axis. */
const DIRECTIONS: Record<ViewName, Triple> = {
  iso: [1, -1.2, 0.9],
  top: [0, -0.001, 1],
  front: [0, -1, 0],
  right: [1, 0, 0],
};

export interface CameraPlacement {
  position: Triple;
  target: Triple;
  /** Distance from the target, mm. */
  distance: number;
  /** The radius of the sphere the model fits in, mm. */
  radius: number;
}

/** Room left around the model, as a fraction of its radius. */
const MARGIN = 1.02;

/** Stand far enough back that the model's bounding sphere fits the narrower
 *  side of the viewport. */
export function placeCamera(
  min: Triple,
  max: Triple,
  view: ViewName,
  fovDegrees: number,
  aspect: number,
): CameraPlacement {
  const target: Triple = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const radius =
    Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
  const vertical = (fovDegrees * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  const distance = (radius * MARGIN) / Math.sin(Math.min(vertical, horizontal));
  const direction = DIRECTIONS[view];
  const length = Math.hypot(...direction);
  return {
    position: [
      target[0] + (direction[0] / length) * distance,
      target[1] + (direction[1] / length) * distance,
      target[2] + (direction[2] / length) * distance,
    ],
    target,
    distance,
    radius,
  };
}
