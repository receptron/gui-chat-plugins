# @gui-chat-plugin/brep

`presentBrep` — solid models for manufacturing. The model writes a
[replicad](https://replicad.xyz) script; the plugin builds it with the OpenCascade kernel, checks
the result, and writes STEP, STL and a sheet of line drawings.

It sits beside [`@gui-chat-plugin/shapescript`](../shapescript), and is for a different job.
ShapeScript combines triangle meshes: fast, in the browser, with colour and AR export, for models
that are looked at. This keeps exact surfaces (B-rep), so an edge can be selected and rounded, a
20 mm bore is a true cylinder, and the result opens in a CAD program as a solid. Use it for parts
that are made or that must fit.

## What a host provides

|                               | Used for                                                                   | Without it                                                   |
| ----------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `execute()` run in Node       | the kernel (22 MB of WebAssembly) and `node:vm`, which runs the script     | the plugin does not work: it cannot run in a page            |
| `files.artifacts` (`FileOps`) | saving the script and its exports under `artifacts/brep/`; `path` rebuilds | the model is built and reported, nothing is saved; no `path` |

## Exports

| Entry         | Contents                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`           | **Node only.** `TOOL_NAME`, `TOOL_DEFINITION`, `executePresentBrep`, `pluginCore`, the path rules, and `encodeMesh` / `decodeMesh` / `isBrepMesh`         |
| `./vue`       | For the page: the `ToolPlugin` (View + Preview + `SYSTEM_PROMPT`), `View`, `Preview`, `TOOL_DEFINITION`. Its `execute` refuses: it never loads the kernel |
| `./style.css` | the compiled component styles                                                                                                                             |

A host wires the two halves itself: the tool on its server with `executePresentBrep` from `.`, and
the View in its page with `plugin` from `./vue`. The page entry imports nothing that reaches the
kernel, so a browser bundle carries neither `node:vm` nor the WebAssembly; `plugin.execute` there
answers with a message saying where the tool runs, in place of building anything.

Two things a host has to know before enabling it:

- **The script is code, and it is not sandboxed.** It runs in the host's process with everything
  the host's own code can reach. Enable the plugin only where the model can already run code on
  the machine (MulmoClaude, MulmoTerminal). The time limit (60 s) stops a script that loops; it is
  not a defence.
- **A build blocks the event loop** while the kernel works: 0.2 to 1.6 s for the parts in the
  tests. Builds run one at a time.

`replicad` (MIT) and `replicad-opencascadejs` (LGPL-2.1) are dependencies, imported on the first
build and never bundled.

## The tool

```ts
import { executePresentBrep } from "@gui-chat-plugin/brep";

const result = await executePresentBrep(
  { files: { artifacts } },
  {
    title: "Flanged hub",
    script: `
const { draw, makeCylinder } = replicad;

function main() {
  let hub = draw([10, 0]).lineTo([40, 0]).lineTo([40, 8]).lineTo([20, 8]).lineTo([20, 30]).lineTo([10, 30]).close()
    .sketchOnPlane("XZ").revolve();
  const circle = (radius) => (length) => Math.abs(length - 2 * Math.PI * radius) < 0.01;
  hub = hub.fillet(4, (e) => e.ofCurveType("CIRCLE").inPlane("XY", 8).ofLength(circle(20)));
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    hub = hub.cut(makeCylinder(3.3, 10, [30 * Math.cos(a), 30 * Math.sin(a), -1], [0, 0, 1]));
  }
  return hub;
}`,
  },
);
```

A script is JavaScript in replicad Studio's form: `replicad` is in scope and `main()` returns the
solid, an array of solids, or `{ shape, name }` objects. It is not a module: `import` and `export`
are refused, with what to write instead. Units are millimetres, Z is up, and the front of a part
faces -Y.

- `script` builds a new model and saves it as `artifacts/brep/<slug>-<epoch-ms>-<token>.replicad.js`.
- `path` rebuilds a script that is already saved, after the model has edited the file. The exports
  beside it are replaced.

Beside the script, under the same name:

| File    | Contents                                                                               |
| ------- | -------------------------------------------------------------------------------------- |
| `.step` | the exact surfaces, in millimetres, one named product per part                         |
| `.stl`  | binary, in millimetres, within 0.05 mm of the true surface                             |
| `.svg`  | a sheet of four line drawings (top, front, right, and from above), hidden edges dashed |

`result.data` is `{ script, report, mesh, files?, downloads }`, for the View; `result.jsonData` is
`{ report, files? }`, for the model. `downloads` is the three exports themselves, gzipped and
base64 (`src/core/packed.ts`), under the saved files' name: about 95 kB for the hub in the tests,
about 220 kB for a chair. It is there on a host that saves nothing, too.

## The View

The model in 3D, turned with the mouse, with its true edges drawn as lines; four standard views
(from above front-right, top, front, right, the same four as the drawing sheet, Z up); the report,
with any warnings first; a button to download each file (script, STEP, STL, drawings); and the
script, read-only. The downloads are the saved files byte for byte: they travel in the result,
because a host owes a View no way to read a file.

The View cannot run the kernel, so the mesh it draws is made where the model is built and travels
in `result.data.mesh`: triangles and edge segments, positions as 16-bit steps across the bounding
box, base64. The enclosure in the tests is about 110 kB. It is for looking at; the STL and STEP
files are the model. The Preview is a card of text (title, size, warning count), not a second 3D
view: a page is allowed only a few WebGL contexts.

The View is the model on top, a bar, and everything else (report, files, script) below. The user
drags the bar to give the model more or less height (arrow keys move it too, a double click puts
it back), and the choice is kept in `localStorage` for the next result. What is below the bar
scrolls in the height that is left. The View never overflows its box: a host mounts it in one that
clips, and in a short pane the model and the scrolling part each keep a share. The layout is the
component's own scoped CSS, not Tailwind variants: a host loads every plugin's stylesheet, and a
later one's plain `flex-col` overrides an earlier one's `@3xl:flex-row`.

It uses no `dispatch` and no host route, so it works in any host that shows the result. That is
also why it does not edit: changing the script means building again, which is the tool's job. The
model edits the saved file and calls `presentBrep` with its `path`.

## The report

Every build returns what the solid is made of, so the model can check it against what it meant.
For the script above:

```
Built "Flanged hub": 80 x 80 x 30 mm, volume 57242.21 mm3, surface 16461.04 mm2, 1 solid.
Faces: 9 cylinder, 3 plane, 1 torus.
Edges: 20 circle, 9 line.
Operations:
  line 7: fillet(4) selected 1 of 9 edges, volume +450.76 mm3
  line 10: cut() x6 volume -1642.17 mm3
```

The checks exist because of what a trial of three parts showed (the parts are in `test/parts.ts`):

- **A selector that picks too much is not an error.** A chamfer meant for four hole rims,
  selected as "circles in this plane", also matched the arcs of the rounded corners and ran round
  the whole outline. The build succeeded. It shows in `selected` and in the face counts: sixteen
  cones where four countersinks make four.
- **A fillet that does not fit can return a broken solid.** `makeBaseBox(40, 20, 5).fillet(3)`
  returns a shape with a larger volume than the box. Each operation's result is checked with the
  kernel's own shape check, and the build stops with `INVALID_RESULT`.
- **The kernel's failures carry no message.** They are WebAssembly exceptions with no text and no
  stack. An error names the operation, its line, and what it had to fit in:
  `fillet(12) at line 5 failed: StdFail_NotDone: BRep_API: command not done. When it ran, it
selected 4 of 12 edges; the shortest selected edge is 5 mm; the solid is 40 x 20 x 5 mm.`
- **A boolean can do nothing.** A `cut` whose tool misses the solid, and pieces that are fused but
  do not touch, are warnings in the report.
- **A warning has to be where the model reads.** A train came back with three warnings below two
  dozen lines of operations, and the model called it done. Warnings are now the second thing in
  the message, each says what to do about it, and the result's instructions begin with them:
  correct each and build again, or tell the user about it.

- **A profile drawn wrong fails somewhere else.** `threePointsArc([x, y], [x, y])` (it takes
  distances from the pen; `threePointsArcTo` takes points) was "Standard_OutOfRange" with no
  line, and a profile that crossed itself extruded in silence and failed two steps later, in the
  export, as "[object WebAssembly.Exception]". The model took its script apart to find them. Now
  the first is refused where it is written, with the method to use, and an extrusion or
  revolution that is not a valid solid stops the build at its line.

The operations checked and recorded are `fillet`, `chamfer`, `shell`, `fuse`, `cut` and
`intersect`. The other methods of a pen, a drawing, a sketch and a shape are guarded: nothing is
recorded, and a kernel failure in one is reported with the call and its line. All of them are
wrapped on replicad's classes when the kernel loads, so a script needs nothing extra; the
wrappers call straight through outside a build. A host that uses replicad itself, from the same
copy, gets the wrapped methods.

An error result has no `data`, and `jsonData.error` is `{ code, message, line?, completed? }`:
`INVALID_ARGUMENT`, `SYNTAX_ERROR`, `SCRIPT_ERROR`, `OPERATION_FAILED`, `INVALID_RESULT` or
`TIMEOUT`. `completed` lists what the operations before the failure did.

## Not here yet

- **Editing in the View.** It would send the script back to the host to rebuild, over
  `dispatch`, which each host has to route.
- **A picture the model can look at.** The drawing sheet is SVG; a model that reads images needs
  it rasterised.
- **Isolation.** Each build could run in a worker, which would free the kernel's memory after it
  and keep the host's event loop free.
