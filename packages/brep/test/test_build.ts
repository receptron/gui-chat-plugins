// The three parts of the trial, built through the kernel entry: each volume
// was checked there by hand (bracket, hub) or by reading the STEP back.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildModel, formatReport } from "../src/kernel/index";
import { bracket, enclosure, hub } from "./parts";

const operation = (
  report: Awaited<ReturnType<typeof buildModel>>["report"],
  op: string,
  line: number,
) => report.operations.find((o) => o.op === op && o.line === line);

/** The 1-based line of the first script line containing `text`. */
const lineOf = (script: string, text: string): number => {
  const index = script.split("\n").findIndex((line) => line.includes(text));
  assert.notEqual(index, -1, `no line contains ${text}`);
  return index + 1;
};

describe("the trial's parts", () => {
  it("builds the flanged hub to the hand-calculated volume", async () => {
    const { report } = await buildModel(hub);
    assert.equal(report.volume, 56527.64);
    assert.deepEqual(report.size, [80, 80, 30]);
    assert.equal(report.solids, 1);
    // bottom, flange top, hub top, three keyway faces; bore, hub, rim and six
    // holes; five chamfers; the root fillet
    assert.deepEqual(report.faces, {
      plane: 6,
      cylinder: 9,
      cone: 5,
      torus: 1,
    });
    assert.deepEqual(report.warnings, []);
  });

  it("reports what each selector of the hub picked, and the holes as one line", async () => {
    const { report } = await buildModel(hub);
    const root = operation(report, "fillet", lineOf(hub, "hub.fillet(4"));
    assert.equal(root?.selected, 1);
    assert.equal(root?.size, 4);
    assert.ok((root?.volumeChange ?? 0) > 0, "a root fillet adds material");
    const bore = operation(
      report,
      "chamfer",
      lineOf(hub, "ofLength(circ(10))"),
    );
    assert.equal(bore?.selected, 2);
    const holes = operation(report, "cut", lineOf(hub, "makeCylinder(3.3"));
    assert.equal(holes?.count, 6);
    // six holes of radius 3.3 through 8 mm: 6 * pi * 3.3^2 * 8
    assert.equal(holes?.volumeChange, -1642.17);
    assert.match(formatReport(report), /cut\(\) x6 volume -1642\.17 mm3/);
  });

  it("builds the bracket to the hand-calculated volume", async () => {
    const { report } = await buildModel(bracket("rims"));
    assert.equal(report.volume, 22201.11);
    assert.deepEqual(report.size, [60, 40, 50]);
    // four countersinks; four holes, four rounded corners, two root fillets
    assert.equal(report.faces.cone, 4);
    assert.equal(report.faces.cylinder, 10);
  });

  it("builds the enclosure: shelled, with one valid solid", async () => {
    const { report } = await buildModel(enclosure);
    assert.equal(report.volume, 20099.45);
    assert.deepEqual(report.size, [80, 50, 25]);
    assert.equal(report.solids, 1);
    const shell = report.operations.find((o) => o.op === "shell");
    assert.equal(shell?.selected, 1);
    assert.equal(shell?.size, 2);
    assert.deepEqual(report.warnings, []);
  });
});

// The bracket's first draft picked "circles in this plane" for the hole rims.
// That also matches the arcs of the R6 corners, and a chamfer runs on round
// the outline they belong to. Nothing fails; the report is where it shows.
describe("a selector that picks too much", () => {
  it("shows in the selection count and the face counts, not as an error", async () => {
    const draft = bracket("circlesInPlane");
    const { report } = await buildModel(draft);
    const good = (await buildModel(bracket("rims"))).report;
    const line = lineOf(draft, 'inPlane("XY", T)');
    const picked = operation(report, "chamfer", line);
    const meant = operation(
      good,
      "chamfer",
      lineOf(bracket("rims"), 'inPlane("XY", T)'),
    );
    assert.equal(meant?.selected, 2);
    assert.ok(
      (picked?.selected ?? 0) > 2,
      `the draft's chamfer should select more than the two rims, got ${picked?.selected}`,
    );
    assert.equal(good.faces.cone, 4);
    assert.ok((report.faces.cone ?? 0) > 4);
    assert.ok(report.volume < good.volume);
  });
});

describe("the files of a build", () => {
  it("writes a STEP with exact surfaces, a binary STL and a drawing sheet", async () => {
    const built = await buildModel(hub);
    const step = new TextDecoder().decode(built.step);
    assert.match(step, /^ISO-10303-21;/);
    assert.equal(step.match(/MANIFOLD_SOLID_BREP/g)?.length, 1);
    assert.equal(step.match(/CYLINDRICAL_SURFACE/g)?.length, 9);
    assert.equal(step.match(/TOROIDAL_SURFACE/g)?.length, 1);
    // Binary STL: an 80-byte header, a triangle count, 50 bytes a triangle.
    const triangles = new DataView(
      built.stl.buffer,
      built.stl.byteOffset,
    ).getUint32(80, true);
    assert.ok(triangles > 1000);
    assert.equal(built.stl.length, 84 + triangles * 50);
    assert.match(built.views, /^<svg xmlns/);
    for (const label of ["Top", "Front", "Right", "From above"])
      assert.ok(built.views.includes(label), `no ${label} view`);
    assert.ok((built.views.match(/<path /g)?.length ?? 0) > 40);
  });

  // The kernel prints "Statistics on Transfer" for every STEP it writes. A
  // host that speaks MCP over stdio would send that to its client as protocol.
  it("writes nothing to stdout", async () => {
    const write = process.stdout.write;
    let written = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      written += typeof chunk === "string" ? chunk : chunk.length;
      return true;
    }) as typeof process.stdout.write;
    try {
      await buildModel(hub);
    } finally {
      process.stdout.write = write;
    }
    assert.equal(written, "");
  });

  it("names each part of an assembly in the report", async () => {
    const { report } = await buildModel(`
      const { makeBaseBox, makeCylinder } = replicad;
      const main = () => [
        { shape: makeBaseBox(20, 20, 5), name: "base" },
        { shape: makeCylinder(3, 10, [0, 0, 5]), name: "pin" },
      ];`);
    assert.deepEqual(
      report.parts?.map((part) => part.name),
      ["base", "pin"],
    );
    assert.equal(report.parts?.[0]?.volume, 2000);
    assert.equal(report.solids, 2);
    assert.deepEqual(report.warnings, []);
  });
});
