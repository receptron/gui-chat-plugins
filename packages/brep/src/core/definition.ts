export const TOOL_NAME = "presentBrep";

const SCRIPT_GUIDE = `JavaScript in replicad's form. \`replicad\` is in scope; the script defines \`main()\`, which returns the solid (or an array of solids, or of \`{ shape, name }\`). No \`import\` or \`export\`. Units are millimetres, Z is up, and the front of the part faces -Y: the Front view and the first 3D view look from -Y toward +Y, so a chair's backrest goes at +Y and a panel's connectors face -Y.

## Example: a flanged hub

const { draw, makeCylinder, makeBaseBox } = replicad;

function main() {
  // Half the cross-section as (radius, height), revolved around Z
  let hub = draw([10, 0]).lineTo([40, 0]).lineTo([40, 8]).lineTo([20, 8]).lineTo([20, 30]).lineTo([10, 30]).close()
    .sketchOnPlane("XZ").revolve();
  // An edge is picked by what it is: a circle of this radius, at this height
  const circle = (radius) => (length) => Math.abs(length - 2 * Math.PI * radius) < 0.01;
  hub = hub.fillet(4, (e) => e.ofCurveType("CIRCLE").inPlane("XY", 8).ofLength(circle(20)));
  hub = hub.chamfer(1, (e) => e.ofCurveType("CIRCLE").ofLength(circle(10)));
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    hub = hub.cut(makeCylinder(3.3, 10, [30 * Math.cos(a), 30 * Math.sin(a), -1], [0, 0, 1]));
  }
  return hub.cut(makeBaseBox(6, 12.8, 32).translate([0, 6.4, -1]));
}

## Building

- Profiles: \`draw([x, y]).lineTo(...).close()\`, \`drawRoundedRectangle(w, h, r)\`, \`drawCircle(r)\`; then \`.sketchOnPlane("XY", offset)\` and \`.extrude(distance)\` or \`.revolve()\`. A sketch on "XZ" extrudes toward -Y: pass a negative distance to go toward +Y.
- Solids: \`makeBaseBox(x, y, z)\` (centred in X and Y, from Z = 0), \`makeCylinder(radius, height, [x, y, z], [dx, dy, dz])\`, \`makeSphere(radius)\`.
- Combining: \`a.fuse(b)\`, \`a.cut(b)\`, \`a.intersect(b)\`; \`.translate([x, y, z])\`, \`.rotate(degrees, [x, y, z], [dx, dy, dz])\`. Every operation returns a new solid.
- \`solid.shell(thickness, (f) => f.inPlane("XY", height))\` hollows the solid and opens the selected face.

## Selecting edges for fillet and chamfer

\`solid.fillet(radius, (e) => ...)\` and \`solid.chamfer(distance, (e) => ...)\`. The filter narrows with \`inDirection("Z")\`, \`inPlane("XY", height)\`, \`ofCurveType("CIRCLE" | "LINE")\`, \`ofLength(n | (l) => boolean)\`, \`containsPoint([x, y, z])\`, \`inBox(corner1, corner2)\`. With no filter, every edge is taken.

- A fillet or chamfer runs on along every edge that continues the selected one smoothly. One edge of a rounded outline, picked with \`containsPoint\`, takes the whole outline; a selector that matches one arc too many takes an outline you did not mean.
- "A circle in this plane" also matches the arcs of rounded corners in that plane. Pick a hole's rim by its circumference with \`ofLength\`.
- Order matters: an edge that a later cut divides no longer has its length. Fillet and chamfer an edge while it is whole.
- A fillet's radius has to fit on the faces beside the edge, and a shell needs every outside fillet larger than the wall thickness.

## Checking the result

Every call returns a report: the size, the volume, the faces and edges by kind, and for each fillet, chamfer and shell how many edges or faces it selected. Read it against what you meant: four countersunk holes are four cones, and a chamfer meant for 4 rims that selected 12 edges went somewhere else. A selector that picks too much is not an error. Then look at the drawing sheet (the \`.svg\`).`;

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: TOOL_NAME,
  description:
    "Build a solid model for manufacturing from a replicad script: exact geometry with fillets, chamfers and shells, checked on every build and exported as STEP (for CAD and machine shops) and STL (for 3D printing). A new `script` is saved under `artifacts/brep/` with its exports beside it; pass `path` instead to rebuild a saved script after editing the file. Use this for parts that are made or that must fit; for a model that is only looked at, ShapeScript is faster.",
  parameters: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description: "A short name for the part",
      },
      script: {
        type: "string",
        description: SCRIPT_GUIDE,
      },
      path: {
        type: "string",
        description:
          "A saved script to rebuild, e.g. `artifacts/brep/hub-1718765432101-1a2b3c4d.replicad.js`: the `files.script` an earlier call returned. Its exports are written again beside it. Give `script` or `path`, not both.",
      },
    },
    required: ["title"],
  },
};
