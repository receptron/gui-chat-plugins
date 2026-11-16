// The files a build writes: STEP for CAD and machine shops, STL for a slicer,
// and a sheet of line drawings to look at.

import type { ProjectionCamera, Shape3D } from "replicad";
import { encodeMesh, type BrepMesh } from "../core/mesh";
import type { Kernel } from "./load";
import type { ModelPart } from "./script";

const bytesOf = async (blob: Blob): Promise<Uint8Array> =>
  new Uint8Array(await blob.arrayBuffer());

/** STEP, in millimetres: the exact surfaces, one named product per part. */
export function toStep(
  kernel: Kernel,
  parts: ModelPart[],
): Promise<Uint8Array> {
  const blob = kernel.replicad.exportSTEP(
    parts.map((part, index) => ({
      shape: part.shape,
      name: part.name ?? (parts.length > 1 ? `part ${index + 1}` : "model"),
    })),
    { unit: "MM", modelUnit: "MM" },
  );
  return bytesOf(blob);
}

/** How far a triangle may stray from the true surface, mm, and how far a
 *  facet may turn, radians: fine enough for a printed part's round holes,
 *  coarse enough that a small part stays near a megabyte. */
const STL_TOLERANCE = 0.05;
const STL_ANGULAR_TOLERANCE = 0.25;

/** Binary STL, in millimetres. */
export function toStl(whole: Shape3D): Promise<Uint8Array> {
  return bytesOf(
    whole.blobSTL({
      tolerance: STL_TOLERANCE,
      angularTolerance: STL_ANGULAR_TOLERANCE,
      binary: true,
    }),
  );
}

/** The display mesh is coarser than the STL: it is looked at, not printed. */
const DISPLAY_TOLERANCE = 0.1;
const DISPLAY_ANGULAR_TOLERANCE = 0.3;

/** The faces as triangles and the edges as line segments, for a View. Call
 *  it BEFORE `toStl`: the kernel keeps a shape's finest triangulation, and
 *  meshing coarse after fine returns the fine one. */
export function toDisplayMesh(whole: Shape3D): BrepMesh {
  const options = {
    tolerance: DISPLAY_TOLERANCE,
    angularTolerance: DISPLAY_ANGULAR_TOLERANCE,
  };
  const faces = whole.mesh(options);
  const edges = whole.meshEdges(options);
  return encodeMesh({
    vertices: faces.vertices,
    normals: faces.normals,
    triangles: faces.triangles,
    lines: edges.lines,
  });
}

interface View {
  label: string;
  /** Where the camera stands, as a direction from the model's centre. */
  from: [number, number, number];
  /** The direction that points right on the page. */
  right: [number, number, number];
}

/** Third-angle views, Z up: the top view sits above the front view, the
 *  right view beside it, and a view from above-front-right fills the corner. */
const VIEWS: View[] = [
  { label: "Top", from: [0, 0, 1], right: [1, 0, 0] },
  {
    label: "From above, front right",
    from: [1, -1.2, 0.9],
    right: [1.2, 1, 0],
  },
  { label: "Front", from: [0, -1, 0], right: [1, 0, 0] },
  { label: "Right", from: [1, 0, 0], right: [0, 1, 0] },
];

const CELL = 600;
const LABEL_HEIGHT = 28;

function cameraFor(
  kernel: Kernel,
  whole: Shape3D,
  view: View,
): ProjectionCamera {
  const [cx, cy, cz] = whole.boundingBox.center;
  const box = whole.boundingBox;
  const reach = Math.max(box.width, box.height, box.depth, 1) * 4;
  const length = Math.hypot(...view.from);
  const position: [number, number, number] = [
    cx + (view.from[0] / length) * reach,
    cy + (view.from[1] / length) * reach,
    cz + (view.from[2] / length) * reach,
  ];
  const direction: [number, number, number] = [
    view.from[0],
    view.from[1],
    view.from[2],
  ];
  return new kernel.replicad.ProjectionCamera(position, direction, view.right);
}

const pathsOf = (drawing: { toSVGPaths(): string[] | string[][] }): string =>
  drawing
    .toSVGPaths()
    .flat()
    .map((d) => `<path d="${d}"/>`)
    .join("");

/** A sheet of four line drawings, hidden edges dashed: what the model's
 *  author looks at to see the shape, with no renderer and no browser. */
export function toViewsSvg(kernel: Kernel, whole: Shape3D): string {
  const cells = VIEWS.map((view, index) => {
    const { visible, hidden } = kernel.replicad.drawProjection(
      whole,
      cameraFor(kernel, whole, view),
    );
    const x = (index % 2) * CELL;
    const y = Math.floor(index / 2) * CELL;
    return (
      `<text x="${x + 16}" y="${y + 22}" font-family="sans-serif" font-size="16" fill="#555">${view.label}</text>` +
      `<svg x="${x}" y="${y + LABEL_HEIGHT}" width="${CELL}" height="${CELL - LABEL_HEIGHT}" viewBox="${visible.toSVGViewBox(6)}" preserveAspectRatio="xMidYMid meet" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      `<g stroke="#b0b0b0" stroke-width="1" stroke-dasharray="5 4" vector-effect="non-scaling-stroke">${pathsOf(hidden).replace(/<path /g, '<path vector-effect="non-scaling-stroke" ')}</g>` +
      `<g stroke="#111" stroke-width="1.8">${pathsOf(visible).replace(/<path /g, '<path vector-effect="non-scaling-stroke" ')}</g>` +
      `</svg>`
    );
  });
  const side = CELL * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side}" height="${side}">` +
    `<rect width="${side}" height="${side}" fill="#fff"/>` +
    `<path d="M${CELL} 0V${side}M0 ${CELL}H${side}" stroke="#e5e5e5"/>` +
    cells.join("") +
    `</svg>`
  );
}
