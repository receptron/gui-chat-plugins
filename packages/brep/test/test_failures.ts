// What goes wrong, and what the script's author is told. The six cases are
// the ones the trial provoked: there, three of them surfaced as
// "[object WebAssembly.Exception]" and one returned a broken solid in silence.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BrepError, buildModel } from "../src/kernel/index";
import { plate } from "./parts";

async function failure(script: string, timeoutMs?: number): Promise<BrepError> {
  try {
    await buildModel(script, timeoutMs === undefined ? {} : { timeoutMs });
  } catch (cause) {
    assert.ok(cause instanceof BrepError, `not a BrepError: ${String(cause)}`);
    return cause;
  }
  return assert.fail("the build should have failed");
}

/** `plate(...)` puts its statement on line 5. */
const STATEMENT_LINE = 5;

describe("operations that do not fit", () => {
  // The kernel returns here, with a volume of 4226 mm3 for a rounded
  // 4000 mm3 plate.
  it("stops at a fillet that returns an invalid solid", async () => {
    const error = await failure(plate("plate.fillet(3)"));
    assert.equal(error.code, "INVALID_RESULT");
    assert.equal(error.line, STATEMENT_LINE);
    assert.match(
      error.message,
      /^fillet\(3\) at line 5 returned a shape that is not a valid solid/,
    );
    assert.match(error.message, /volume 4000 -> 4226\.\d+ mm3/);
    assert.match(error.message, /selected 12 of 12 edges/);
    assert.match(error.message, /the solid is 40 x 20 x 5 mm/);
  });

  it("names a fillet the kernel refuses, with the sizes it had to fit", async () => {
    const error = await failure(
      plate('plate.fillet(12, (e) => e.inDirection("Z"))'),
    );
    assert.equal(error.code, "OPERATION_FAILED");
    assert.equal(error.line, STATEMENT_LINE);
    assert.match(
      error.message,
      /^fillet\(12\) at line 5 failed: StdFail_NotDone/,
    );
    assert.match(
      error.message,
      /selected 4 of 12 edges; the shortest selected edge is 5 mm/,
    );
    assert.match(error.message, /smaller radius/);
    assert.doesNotMatch(error.message, /WebAssembly/);
  });

  for (const radius of [2, 1])
    it(`names a shell whose inside corner cannot exist (outside R${radius}, wall 2)`, async () => {
      const error = await failure(
        plate(
          `drawRoundedRectangle(80, 50, 6).sketchOnPlane("XY").extrude(25)
            .fillet(${radius}, (e) => e.inPlane("XY", 0))
            .shell(2, (f) => f.inPlane("XY", 25))`,
        ),
      );
      assert.equal(error.code, "OPERATION_FAILED");
      assert.equal(error.line, STATEMENT_LINE + 2);
      assert.match(error.message, /^shell\(2\) at line 7 failed/);
      assert.match(error.message, /selected 1 of \d+ faces/);
      assert.match(error.message, /larger than the wall thickness/);
      // The fillet before it worked, and the error says so.
      assert.equal(error.completed.length, 1);
      assert.match(error.completed[0] ?? "", /^line 6: fillet/);
    });

  it("says a selector matched nothing, without advice about the radius", async () => {
    const error = await failure(
      plate('plate.fillet(1, (e) => e.inPlane("XY", 99))'),
    );
    assert.equal(error.code, "OPERATION_FAILED");
    assert.match(error.message, /no edge was selected/);
    assert.match(error.message, /selected 0 of 12 edges/);
    assert.doesNotMatch(error.message, /smaller radius/);
  });
});

describe("a profile that is drawn wrong", () => {
  // From a train built in MulmoChat. These two came back as
  // "Standard_OutOfRange" with no line and as "[object
  // WebAssembly.Exception]"; the model took its script apart looking for
  // them and stopped at the piece that built.
  const profile = (arc: string) =>
    [
      "const { draw } = replicad;",
      "function main() {",
      "  return draw([-10, 0]).lineTo([10, 0]).lineTo([10, 20])",
      `    ${arc}`,
      '    .close().sketchOnPlane("XZ")',
      "    .extrude(50);",
      "}",
    ].join("\n");

  it("says an arc given points where it takes distances, with its line", async () => {
    const error = await failure(profile(".threePointsArc([-10, 20], [0, 26])"));
    assert.equal(error.code, "SCRIPT_ERROR");
    assert.equal(error.line, 4);
    assert.match(
      error.message,
      /^threePointsArc\(\[-10, 20\], \[0, 26\]\) at line 4: .*use threePointsArcTo/,
    );
  });

  it("builds the same arc given as points", async () => {
    const { report } = await buildModel(
      profile(".threePointsArcTo([-10, 20], [0, 26])"),
    );
    assert.deepEqual(report.size, [20, 50, 26]);
    assert.deepEqual(report.warnings, []);
  });

  it("stops at an extrusion of a profile that crosses itself", async () => {
    // The train's plan, a tenth the size: rounded corners written with
    // points, given as numbers. Each arc runs off and comes back across.
    const error = await failure(
      [
        "const { draw } = replicad;",
        "function main() {",
        "  return draw([-140, 1000]).lineTo([140, 1000]).lineTo([140, -920])",
        "    .threePointsArc(60, -1000, 116.6, -976.6)",
        "    .lineTo([-60, -1000])",
        "    .threePointsArc(-140, -920, -116.6, -976.6)",
        '    .close().sketchOnPlane("XY")',
        "    .extrude(400);",
        "}",
      ].join("\n"),
    );
    assert.equal(error.code, "INVALID_RESULT");
    assert.equal(error.line, 8);
    assert.match(
      error.message,
      /^extrude\(400\) at line 8 returned a shape that is not a valid solid/,
    );
    assert.match(error.message, /crosses itself/);
  });
});

describe("what a radius function selects", () => {
  it("does not count an edge it gives a radius of 0", async () => {
    // replicad leaves such an edge alone; counted, the report said 12 of 12
    // for a fillet of the four short edges.
    const { report } = await buildModel(
      plate("plate.fillet((e) => (replicad.measureLength(e) < 6 ? 1 : 0))"),
    );
    assert.equal(report.operations[0]?.selected, 4);
    assert.equal(report.operations[0]?.available, 12);
  });
});

describe("results that are built but wrong", () => {
  it("warns that fused pieces do not touch", async () => {
    const { report } = await buildModel(
      plate("plate.fuse(makeCylinder(3, 10, [100, 0, 0]))"),
    );
    assert.equal(report.solids, 2);
    assert.match(report.warnings.join("\n"), /2 separate solids/);
  });

  it("warns that a cut removed nothing", async () => {
    const { report } = await buildModel(
      plate("plate.cut(makeCylinder(3, 10, [100, 0, 0]))"),
    );
    assert.equal(report.volume, 4000);
    assert.deepEqual(report.warnings, [
      "cut at line 5 removed nothing: the tool does not overlap the solid.",
    ]);
  });
});

describe("scripts that do not run", () => {
  it("reports a syntax error with its line", async () => {
    const error = await failure("const a = 1;\nfunction main() { return (; }");
    assert.equal(error.code, "SYNTAX_ERROR");
    assert.equal(error.line, 2);
  });

  it("says what to write in place of an import", async () => {
    const error = await failure(
      'import { makeBaseBox } from "replicad";\nexport const main = () => makeBaseBox(1, 1, 1);',
    );
    assert.equal(error.code, "SYNTAX_ERROR");
    assert.match(error.message, /const \{ draw, makeCylinder \} = replicad;/);
  });

  it("reports a script's own exception with its line", async () => {
    const error = await failure(
      "function main() {\n  return replicad.makeNothing(1);\n}",
    );
    assert.equal(error.code, "SCRIPT_ERROR");
    assert.equal(error.line, 2);
    assert.match(error.message, /makeNothing is not a function/);
  });

  it("requires main", async () => {
    const error = await failure("const box = replicad.makeBaseBox(1, 1, 1);");
    assert.equal(error.code, "SCRIPT_ERROR");
    assert.match(error.message, /define a function named `main`/);
  });

  it("refuses a drawing that was never extruded", async () => {
    const error = await failure("const main = () => replicad.drawCircle(5);");
    assert.equal(error.code, "SCRIPT_ERROR");
    assert.match(error.message, /extruded or revolved/);
  });

  it("stops a script that loops", async () => {
    const started = Date.now();
    const error = await failure("function main() { for (;;) {} }", 200);
    assert.equal(error.code, "TIMEOUT");
    assert.ok(Date.now() - started < 5000);
  });

  it("refuses an async main, without running it", async () => {
    // V8's limit ends when main() returns its promise. `await` and then a
    // loop ran outside it and held the host, and every later build, for
    // good: this script would never come back if it were called.
    const error = await failure(
      "async function main() { await Promise.resolve(); for (;;) {} }",
      200,
    );
    assert.equal(error.code, "SCRIPT_ERROR");
    assert.match(error.message, /not an async one/);
    const { report } = await buildModel(plate("plate"));
    assert.equal(report.volume, 4000);
  });

  it("refuses a promise returned by an ordinary main", async () => {
    const error = await failure(
      "function main() { return new Promise(() => {}); }",
    );
    assert.equal(error.code, "SCRIPT_ERROR");
    assert.match(error.message, /not an async one/);
  });

  it("builds again after a failure", async () => {
    await failure(plate("plate.fillet(3)"));
    const { report } = await buildModel(plate("plate.fillet(1)"));
    assert.ok(report.volume < 4000);
    assert.deepEqual(report.warnings, []);
  });
});
