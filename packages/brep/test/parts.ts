// The three parts of the trial this package started from, as model scripts,
// and the first drafts of two of them, whose selectors picked too much.

/** L bracket: 60 x 40 x 50, 5 thick, a rib, four M5 holes with countersinks. */
export const bracket = (chamferSelector: "rims" | "circlesInPlane") => `
const { draw, makeCylinder } = replicad;
const T = 5, W = 40, LX = 60, LZ = 50;

function main() {
  let body = draw([0, 0]).lineTo([LX, 0]).lineTo([LX, T]).lineTo([T, T]).lineTo([T, LZ]).lineTo([0, LZ]).close()
    .sketchOnPlane("XZ").extrude(-W);
  const rib = draw([T, T]).lineTo([T + 30, T]).lineTo([T, T + 30]).close()
    .sketchOnPlane("XZ", -(W / 2 - 2)).extrude(-4);
  body = body.fuse(rib);
  body = body.fillet(6, (e) => e.inDirection("Z").inPlane("YZ", LX));
  body = body.fillet(6, (e) => e.inDirection("X").inPlane("XY", LZ));
  for (const y of [8, W - 8]) {
    body = body.cut(makeCylinder(2.75, T + 2, [48, y, -1], [0, 0, 1]));
    body = body.cut(makeCylinder(2.75, T + 2, [-1, y, 40], [1, 0, 0]));
  }
  body = body.fillet(3, (e) => e.inDirection("Y").containsPoint([T, 5, T]));
  body = body.fillet(3, (e) => e.inDirection("Y").containsPoint([T, W - 5, T]));
  const rim = (l) => Math.abs(l - 2 * Math.PI * 2.75) < 0.01;
  ${
    chamferSelector === "rims"
      ? `body = body.chamfer(1, (e) => e.ofCurveType("CIRCLE").ofLength(rim).inPlane("XY", T));
  body = body.chamfer(1, (e) => e.ofCurveType("CIRCLE").ofLength(rim).inPlane("YZ", T));`
      : `body = body.chamfer(1, (e) => e.ofCurveType("CIRCLE").inPlane("XY", T));
  body = body.chamfer(1, (e) => e.ofCurveType("CIRCLE").inPlane("YZ", T));`
  }
  return body;
}
`;

/** Board enclosure: 80 x 50 x 25, 2 mm wall, screw bosses, a lid step, a
 *  USB-C opening and vent slots. */
export const enclosure = `
const { drawRoundedRectangle, makeCylinder } = replicad;
const L = 80, W = 50, H = 25, T = 2;

function main() {
  let box = drawRoundedRectangle(L, W, 6).sketchOnPlane("XY").extrude(H);
  box = box.fillet(3, (e) => e.inPlane("XY", 0));
  box = box.shell(T, (f) => f.inPlane("XY", H));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const x = sx * (L / 2 - 5), y = sy * (W / 2 - 5);
    box = box.fuse(makeCylinder(3.5, H - T - 3, [x, y, T - 1], [0, 0, 1]).intersect(
      drawRoundedRectangle(L - 1, W - 1, 5.5).sketchOnPlane("XY", 1).extrude(H)));
    box = box.cut(makeCylinder(1.25, 12, [x, y, H - 3 - 12], [0, 0, 1]));
  }
  box = box.cut(drawRoundedRectangle(L - 2, W - 2, 5).sketchOnPlane("XY", H - 1.5).extrude(2));
  box = box.cut(drawRoundedRectangle(9.5, 3.5, 1.7).translate(0, 10).sketchOnPlane("YZ", L / 2 - T - 1).extrude(T + 2));
  for (let i = -2; i <= 2; i++)
    box = box.cut(drawRoundedRectangle(24, 2, 1).translate(0, i * 5).sketchOnPlane("XY", -1).extrude(T + 2));
  return box.chamfer(0.4, (e) => e.inPlane("XY", H).containsPoint([0, -W / 2, H]));
}
`;

/** Flanged hub: a revolved profile, a root fillet, chamfers, six bolt holes
 *  and a keyway. */
export const hub = `
const { draw, makeCylinder, makeBaseBox } = replicad;

function main() {
  let hub = draw([10, 0]).lineTo([40, 0]).lineTo([40, 8]).lineTo([20, 8]).lineTo([20, 30]).lineTo([10, 30]).close()
    .sketchOnPlane("XZ").revolve();
  const circ = (rad) => (l) => Math.abs(l - 2 * Math.PI * rad) < 0.01;
  hub = hub.fillet(4, (e) => e.ofCurveType("CIRCLE").inPlane("XY", 8).ofLength(circ(20)));
  hub = hub.chamfer(1, (e) => e.ofCurveType("CIRCLE").ofLength(circ(10)));
  hub = hub.chamfer(1, (e) => e.ofCurveType("CIRCLE").inPlane("XY", 30).ofLength(circ(20)));
  hub = hub.chamfer(0.5, (e) => e.ofCurveType("CIRCLE").ofLength(circ(40)));
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    hub = hub.cut(makeCylinder(3.3, 10, [30 * Math.cos(a), 30 * Math.sin(a), -1], [0, 0, 1]));
  }
  return hub.cut(makeBaseBox(6, 12.8, 32).translate([0, 6.4, -1]));
}
`;

/** A 40 x 20 x 5 plate, and one statement applied to it: the failure cases. */
export const plate = (statement: string) => `
const { makeBaseBox, makeCylinder, drawRoundedRectangle } = replicad;
function main() {
  const plate = makeBaseBox(40, 20, 5);
  return ${statement};
}
`;
