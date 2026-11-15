// The tool, against a fake host: what it saves, what it returns to the model
// and to a View, and what it refuses.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TOOL_DEFINITION,
  TOOL_NAME,
  executePresentBrep,
  isBrepMesh,
  pluginCore,
  scriptRelPathOf,
} from "../src/index";
import { fakeHost } from "./fakeHost";
import { hub, plate } from "./parts";

describe("presentBrep", () => {
  it("is the tool the plugin core runs", () => {
    assert.equal(TOOL_NAME, "presentBrep");
    assert.equal(pluginCore.toolDefinition, TOOL_DEFINITION);
    assert.equal(pluginCore.execute, executePresentBrep);
    assert.deepEqual(TOOL_DEFINITION.parameters.required, ["title"]);
  });

  it("saves the script with its exports beside it, and returns the report", async () => {
    const { artifacts, context } = fakeHost();
    const result = await executePresentBrep(context, {
      title: "Flanged Hub",
      script: hub,
    });
    assert.ok(result.data, result.message);
    const files = result.data.files;
    assert.ok(files);
    assert.match(
      files.script,
      /^artifacts\/brep\/flanged-hub-\d+-[0-9a-f]{8}\.replicad\.js$/,
    );
    const stem = files.script.slice(0, -".replicad.js".length);
    assert.deepEqual(files, {
      script: files.script,
      step: `${stem}.step`,
      stl: `${stem}.stl`,
      views: `${stem}.svg`,
    });
    const rel = (path: string) => path.slice("artifacts/".length);
    assert.equal(await artifacts.read(rel(files.script)), hub);
    assert.match(await artifacts.read(rel(files.step)), /MANIFOLD_SOLID_BREP/);
    assert.match(await artifacts.read(rel(files.views)), /^<svg/);
    assert.ok((await artifacts.readBytes(rel(files.stl))).length > 50_000);
    assert.equal(artifacts.files.size, 4);

    // To the View: the script and the report. To the model: the report as
    // text, the paths, and the same report as JSON.
    assert.equal(result.data.script, hub);
    assert.equal(result.data.report.volume, 56527.64);
    assert.equal(result.title, "Flanged Hub");
    assert.match(
      result.message,
      /^Built "Flanged Hub": 80 x 80 x 30 mm, volume 56527\.64 mm3/,
    );
    assert.match(
      result.message,
      /Faces: 9 cylinder, 6 plane, 5 cone, 1 torus\./,
    );
    assert.match(
      result.message,
      /fillet\(4\) selected 1 of \d+ edges, volume \+\d/,
    );
    assert.ok(result.message.includes(files.step));
    // Which side the user sees: the model cannot look, and built two chairs
    // with their backs to the viewer.
    assert.match(result.message, /Shown to the user from -Y first/);
    assert.match(result.instructions ?? "", /back to them/);
    assert.deepEqual(result.jsonData, { report: result.data.report, files });
    // The mesh goes to the View only: a hundred kilobytes of base64 is no
    // use to the model.
    assert.equal(isBrepMesh(result.data.mesh), true);
    assert.equal(result.message.includes(result.data.mesh.positions), false);
  });

  it("rebuilds a saved script from its path after an edit", async () => {
    const { artifacts, context } = fakeHost();
    const first = await executePresentBrep(context, {
      title: "Plate",
      script: plate("plate.fillet(1)"),
    });
    assert.ok(first.data?.files, first.message);
    const { files } = first.data;
    const rel = scriptRelPathOf(files.script);
    assert.ok(rel);
    const stepBefore = await artifacts.read(files.step.slice(10));
    // The model edits the file, then names it.
    await artifacts.write(
      rel,
      plate('plate.fillet(2, (e) => e.inDirection("Z"))'),
    );
    const second = await executePresentBrep(context, {
      title: "Plate",
      path: files.script,
    });
    assert.ok(second.data, second.message);
    assert.deepEqual(second.data.files, files);
    assert.equal(
      artifacts.files.size,
      4,
      "the exports are replaced, not added",
    );
    assert.notEqual(await artifacts.read(files.step.slice(10)), stepBefore);
    assert.equal(second.data.report.operations[0]?.selected, 4);
  });

  it("builds and reports without a file layer, and says nothing was saved", async () => {
    const result = await executePresentBrep(
      {},
      {
        title: "Plate",
        script: plate("plate.fillet(1)"),
      },
    );
    assert.ok(result.data, result.message);
    assert.equal(result.data.files, undefined);
    assert.match(result.message, /Not saved/);
  });

  it("returns a failed build as a diagnostic, and saves nothing", async () => {
    const { artifacts, context } = fakeHost();
    const result = await executePresentBrep(context, {
      title: "Plate",
      script: plate('plate.fillet(12, (e) => e.inDirection("Z"))'),
    });
    assert.equal(result.data, undefined);
    assert.ok("error" in result);
    assert.equal(result.error.code, "OPERATION_FAILED");
    assert.equal(result.error.line, 5);
    assert.match(
      result.message,
      /^presentBrep error \(line 5\): fillet\(12\) at line 5 failed/,
    );
    assert.deepEqual(result.jsonData, { error: result.error });
    assert.equal(artifacts.files.size, 0);
  });

  it("lists what was done before the failure", async () => {
    const result = await executePresentBrep(
      {},
      {
        title: "Plate",
        script: plate(`plate.fillet(1, (e) => e.inDirection("Z"))
        .fillet(12, (e) => e.inDirection("Z"))`),
      },
    );
    assert.ok("error" in result);
    assert.match(
      result.message,
      /Before it:\n {2}line 5: fillet\(1\) selected 4 of 12 edges/,
    );
  });

  const refused: [string, Record<string, unknown>, RegExp][] = [
    ["no title", { script: "x" }, /title/],
    ["neither script nor path", { title: "T" }, /`script` or a `path`/],
    [
      "both script and path",
      { title: "T", script: "x", path: "artifacts/brep/a.replicad.js" },
      /not both/,
    ],
    [
      "a path outside artifacts/brep",
      { title: "T", path: "src/a.replicad.js" },
      /under artifacts\/brep/,
    ],
    [
      "a path that climbs out",
      { title: "T", path: "artifacts/brep/../../a.replicad.js" },
      /under artifacts\/brep/,
    ],
    [
      "a path with a backslash climb",
      { title: "T", path: "artifacts/brep/..\\..\\a.replicad.js" },
      /under artifacts\/brep/,
    ],
    [
      "another extension",
      { title: "T", path: "artifacts/brep/a.js" },
      /\.replicad\.js/,
    ],
    [
      "a script that is not there",
      { title: "T", path: "artifacts/brep/a.replicad.js" },
      /No script exists/,
    ],
  ];
  for (const [name, args, expected] of refused)
    it(`refuses ${name}`, async () => {
      const { context } = fakeHost();
      const result = await executePresentBrep(
        context,
        args as unknown as Parameters<typeof executePresentBrep>[1],
      );
      assert.equal(result.data, undefined);
      assert.ok("error" in result);
      assert.equal(result.error.code, "INVALID_ARGUMENT");
      assert.match(result.message, expected);
    });

  it("refuses a path on a host with no file layer", async () => {
    const result = await executePresentBrep(
      {},
      {
        title: "T",
        path: "artifacts/brep/a.replicad.js",
      },
    );
    assert.match(result.message, /cannot open a script by path/);
  });
});
