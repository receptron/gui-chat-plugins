# @gui-chat-plugin/shapescript

`presentShapeScript` — interactive 3D visualizations authored in the **ShapeScript** language.
The plugin ships its own ShapeScript parser / evaluator and a Three.js renderer (CSG via
`three-bvh-csg`), so a model is described as text and rendered in the chat canvas.

Ported from [`@gui-chat-plugin/present3d`](https://github.com/receptron/GUIChatPluginPresent3D)
(MIT, same authors). The tool is named `presentShapeScript` here — the upstream `present3D`
name, and the `Present3D*` type names, are renamed throughout.

Moved here from MulmoClaude in 8.0.0: it was `@mulmoclaude/shapescript-plugin` up to 7.1.0, with the
same code and tools. MulmoClaude and MulmoTerminal are its hosts today; MulmoChat and MulmoGlass
don't use it yet.

## What a host provides

Everything reaches the host through gui-chat-protocol's context. Beyond `files.artifacts`, three
things are optional extensions the protocol doesn't define: a host that has them passes them in,
and each tool says what happens without one.

|                                                       | Used for                                                                         | Without it                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `files.artifacts` (`FileOps`)                         | saving a new `script` under `artifacts/shapes/`, reading and editing it, exports | the model is shown but not saved (no `filePath`); `path` and the exports fail |
| `files.byPath` (`FileOps`, not in the protocol)       | a `path` to a `.shape` outside `artifacts/shapes/`                               | such a `path` is refused; `artifacts/shapes/…` paths still work               |
| `gallery` (`ShapeGalleryWriter`, `manageShapeScript`) | the public gallery on mulmoserver, over the host's signed-in session             | `manageShapeScript` throws `NOT_CONNECTED_MESSAGE`                            |
| `renderThumbnail` (`manageShapeScript`)               | a thumbnail for a gallery post, usually `renderShapeThumbnail` from `./render`   | the post lands without a picture                                              |

`./render` rasterises with Puppeteer's headless Chromium, an optional peer. A host without it gets
`RenderUnavailableError`, carrying the install hint, from `renderShapeScript`, and
`renderShapeThumbnail` answers `null`.

## Exports

| Entry         | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`           | `TOOL_NAME`, `TOOL_DEFINITION`, `executePresentShapeScript`, `pluginCore`, `samples`, `parseShapeScript`, `astToThreeJS`, `executeShapeScriptDispatch` + the `artifacts/shapes` path rules                                                                                                                                                                                                                                                                                                                                    |
| `.` (export)  | `shapeScriptToUsdz`, `sceneToUsdz`, `USDZ_MIME_TYPE`, `USDZ_EXTENSION`, and the **`exportShapeScriptUsdz`** tool (`executeExportShapeScriptUsdz`, `EXPORT_USDZ_*`); `shapeScriptToGlb` / `sceneToGlb` / `GLB_*` and `shapeScriptToStl` / `sceneToStl` / `STL_*` alongside; the printable STL and the **`exportShapeScriptStl`** tool (`shapeScriptToPrintableStl`, `executeExportShapeScriptStl`, `EXPORT_STL_*`). Browser-safe: none needs a canvas, so the View's download buttons and a host's MCP tool run the same code. |
| `./render`    | **server-only** — `renderShapeScriptSheet` and the render page. Rasterises a model to a PNG with Puppeteer's headless Chromium (an OPTIONAL peer); a host without one gets `RenderUnavailableError` carrying the install hint.                                                                                                                                                                                                                                                                                                |
| `./vue`       | the `ToolPlugin` (View + Preview + `SYSTEM_PROMPT`), plus everything on `.`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `./style.css` | the compiled component styles (Vite lib mode does not auto-inject them)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

```ts
import type { ToolContext } from "gui-chat-protocol";
import { executePresentShapeScript } from "@gui-chat-plugin/shapescript";

// The handler does not read the context; the host passes its own.
const context = {} as ToolContext;

const result = await executePresentShapeScript(context, {
  title: "Circular Pattern",
  script: `
define count 12
for i in 1 to count {
    define angle ((i / count) * 6.283)
    cube {
        position (cos(angle) * 3) 0 (sin(angle) * 3)
        color (i / count) 0.5 (1 - i / count)
        size 0.5
    }
}`,
});
```

## USDZ export

`exportShapeScriptUsdz` writes a model out as a USDZ archive (AR Quick Look on Apple devices, or
any USD viewer). A host wires it against the same `{ files: { artifacts, byPath? } }` context shape
`executeShapeScriptDispatch` takes — a full `FileOps`, or just `read` / `write` / `exists`
(`ShapeFileOps`) — no browser, no `node:*`:

```ts
import {
  executeExportShapeScriptUsdz,
  EXPORT_USDZ_TOOL_NAME,
  EXPORT_USDZ_DESCRIPTION,
  EXPORT_USDZ_SCHEMA,
  EXPORT_USDZ_PROMPT,
} from "@gui-chat-plugin/shapescript";

// register { name: EXPORT_USDZ_TOOL_NAME, description: EXPORT_USDZ_DESCRIPTION, inputSchema: EXPORT_USDZ_SCHEMA }
const { message, filePath } = await executeExportShapeScriptUsdz(
  { files: shapeFiles },
  args,
);
```

The file lands at `artifacts/shapes/<slug>-<epoch-ms>-<token>.usdz`. The View's **Download**
menu (USDZ item) builds the same archive in the browser with `shapeScriptToUsdz` and saves it locally.
USDZ units are metres, so `size 1` is one metre in AR.

The same menu also offers **GLB** (binary glTF, for the web and game engines; vertex colours
survive as `COLOR_0`) and **STL** (binary, geometry only, in world space, for slicers),
built the same way by `shapeScriptToGlb` and `shapeScriptToStl`. That STL is the model as displayed,
every part a separate shell; for printing, use the printable STL below.

## CSG engine: three-bvh-csg or manifold

The preview evaluates CSG blocks with three-bvh-csg by default. manifold, the engine the printable
STL export uses, can evaluate them instead: per conversion with `csgEngine: "manifold"`, or for
every conversion after one `await enableManifoldCsg()` (in the browser before the first View
renders, on the server before the first tool call — the conversion itself is synchronous, so
manifold has to be loaded first). A host that never opts in never loads manifold.

With manifold the result of every block is watertight, each face keeps its operand's material,
normals are carried through, and `stencil` repaints the first operand's surface; a block with an
operand manifold cannot take (an open or flat one) falls back to three-bvh-csg. On the shipped
models the renders differ from three-bvh-csg's in at most 0.12% of pixels, and manifold is two to
three times faster. A lattice inside a `union` previews with manifold (10 x 10 x 10 in about 8 s)
where three-bvh-csg is refused at the time limit. `scripts/compare-csg-engines.ts` repeats the
render comparison.

## Printable STL: `exportShapeScriptStl`

`exportShapeScriptStl` writes the model as **one watertight solid** for a slicer, through
[manifold](https://github.com/elalish/manifold) (`manifold-3d`, WebAssembly) instead of the
preview's CSG engine, whose output is not watertight:

- **Every top-level solid is merged**: parts placed side by side print as one object, without a
  `union` block. CSG blocks are evaluated by manifold too, in the order the preview evaluates
  them (`union`, `difference`, `intersection`, `xor`; `stencil` keeps its first operand's shape),
  wherever they occur — placed, stored with `define`, or returned by a function. A block whose
  result is empty is left out and reported; a model with nothing left is refused.
- **Print coordinates**: millimetres, Z up, resting on Z = 0. `unitScale` is millimetres per
  ShapeScript unit (default 1, so `cube` is a 1 mm cube).
- **Parts that are not closed solids** — a flat `circle`, a `fill`, an open path, text outlines —
  are skipped and listed, by `name` where they have one; a CSG block whose first operand is one
  of them is skipped too.

It answers the saved path and a printability report (`PrintReport`, also returned on its own by
`shapeScriptToPrintableStl`). For a 2 x 2 x 2 cube lattice — a strut on every cell edge, a joint
sphere on every node — at `unitScale` 10:

```
Size 23.5 x 23.5 x 23.5 mm, 1 body, genus 28, volume 1681.4 mm3, 9468 triangles.
81 part(s) merged, 0 skipped; 0 non-manifold edges.
```

Genus 28 is struts - nodes + 1 (54 - 27 + 1): the struts and joints are fused, not overlapping.

with a warning when parts only touch (non-manifold edges after merging vertices within 1e-5 mm,
as a slicer does), when parts were skipped, and when the result is more than one body.

manifold is loaded on first use with a dynamic `import()`, so a host that never exports a
printable STL never loads its WebAssembly. It is a dependency of this package, and it brings its
own (`@gltf-transform/*`, `commander`, … for its CAD tooling, which this package does not call).
Wire the tool like the USDZ one, with the same `{ files }` context and
`EXPORT_STL_TOOL_TIMEOUT_MS`.

**Lattices.** A lattice of hundreds of struts and joints is best written as loose parts, with
no `union` block: this export merges them into one solid (a 10 x 10 x 10 cube lattice — 3,630
struts and 1,331 joint spheres — exports as 1 body of genus 2,300 in about 9 s), while the
preview still evaluates a `union` with three-bvh-csg, which is too slow for hundreds of parts and
is refused at the time limit. The tool and the language prompt both tell the agent so.

Export time and file size grow with the triangle count, so a very large lattice is best written at
`detail 8`. Measured on a 20 x 20 x 20 cube lattice (26,460 struts, 9,261 joints; 1 body, genus
17,200, no non-manifold edges either way):

| `detail` | Time | STL    | Peak memory |
| -------- | ---- | ------ | ----------- |
| 12       | 54 s | 174 MB | 4.1 GB      |
| 8        | 32 s | 92 MB  | 2.7 GB      |
| 6        | 34 s | 131 MB | 3.0 GB      |

Below 8 the coarse struts and spheres intersect into more pieces, so the file grows and the export
is no faster. The union is done region by region (`spatialUnion`): manifold's WebAssembly build is
single-threaded, and a lattice's parts overlap only their neighbours.

The View's **Download → STL** still writes the displayed model (`shapeScriptToStl`); it does not
load manifold in the browser yet.

## The gallery: `manageShapeScript`

`manageShapeScript` is the user's models in the public gallery on mulmoserver
(server.mulmocast.com/shapes), one tool with an `action` — as `manageCollection` is:

| `action`  | Does                                                                                                 | Needs                                                             |
| --------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `publish` | Posts a new model and answers its URL.                                                               | `title`, `script` or `path`; `acceptLicense: true` unless a draft |
| `update`  | Changes the user's own post in place, sending only the fields given.                                 | `id`                                                              |
| `delete`  | Removes the user's own post and every object under it.                                               | `id`                                                              |
| `get`     | One post's readable fields and its ShapeScript source — anyone's published one, or the user's draft. | `id`; `save: true` writes a .shape                                |
| `getList` | The user's own posts, drafts included, newest first.                                                 | `limit` (default 20, at most 100)                                 |

The tool's contract — schema, description, the document a post is (`SHAPE_POST_KEYS`, which
mulmoserver's rules pin with `hasOnly`), the keyword normalisation — is the package's; Firebase is
not. A host supplies a `ShapeGalleryWriter` over its own signed-in session (the remote-host
session, which is the user's account on mulmoserver's Firebase) and a `renderThumbnail` —
`renderShapeThumbnail` from `./render`, which answers `null` where no headless browser is installed,
so a post still lands, without a picture:

```ts
import {
  executeManageShapeScript,
  MANAGE_TOOL_NAME,
  MANAGE_DESCRIPTION,
  MANAGE_SCHEMA,
  MANAGE_PROMPT,
} from "@gui-chat-plugin/shapescript";
import { renderShapeThumbnail } from "@gui-chat-plugin/shapescript/render";

// gallery: { uid, authorName,
//            createPost(id, doc), readPost(id), updatePost(id, patch, expect), deletePost(id, expect),
//            listPosts(uid, limit), readScript(ownerUid, id, scriptId),
//            uploadThumbnail(id, png), uploadScript(id, script), deleteObject(id, objectId) }
//          — every member required; null when not signed in
const result = await executeManageShapeScript(
  { files: shapeFiles, gallery, renderThumbnail: renderShapeThumbnail },
  args,
);
result.message; // the sentence (publish / update / delete) or the JSON (get / getList) the agent reads
```

`createPost` must add `createdAt` / `updatedAt` as `serverTimestamp()`; the rules refuse a client
clock. `deleteObject` is what takes an uploaded thumbnail back out when `createPost` is refused, so
no object is left that nothing references. With `gallery: null` the tool throws
`NOT_CONNECTED_MESSAGE`, which tells the user to connect Remote Host.

Publishing a post licenses it under **CC BY 4.0** (`SHAPE_LICENSE`, `SHAPE_LICENSE_URL`), as the
gallery's own editor asks before publishing. The tool asks the same way: publishing a public post,
making a draft public, or editing a public post that has no license yet needs `acceptLicense: true`
— the user's explicit agreement, which `MANAGE_PROMPT` tells the model to ask for and never to pass
on its own — and is refused with `LICENSE_REQUIRED_MESSAGE`, before any upload, without it. A draft
(`published: false`) needs none and records none. The document carries `license` (`"CC-BY-4.0"` or
`null`, a pinned key), and the host stamps `licenseAcceptedAt` as `serverTimestamp()` beside a
grant — in `createPost` when `doc.license` is set, in `updatePost` when the patch carries `license`
(the owner's first agreement; the plugin never sends it for a post already licensed). The rules let
a grant be made once and never moved or removed, so `updatePost` must drop both keys if the stored
document turns out to be licensed already; MulmoClaude's adapter does that inside its transaction.
`get` / `getList` answer `license` and `licenseAcceptedAt` (an ISO string, `""` when none). A
public post with `license: null` predates the gallery's asking and carries no grant; the prompt
tells the model not to present such a model as reusable.

This is a **breaking change of the `ShapeGalleryWriter` contract** (5.x → 6.0.0): a host built
against 5.x does not stamp `licenseAcceptedAt`, so with this plugin its `createPost` / `updatePost`
would send `license` without the stamp and the rules would refuse every public write. A host
takes 6.x only once its adapter stamps the grant.

`update` rewrites the user's own post `id` in place: `readPost` fetches it, the tool refuses it
unless its `uid` is the writer's (only the publisher may change a post; the gallery's rules say the
same, but without a reason), and `updatePost` merges a PATCH — only the fields the caller gave,
plus new object ids — with a server `updatedAt` and no `createdAt`, which the rules freeze. It must
be a field-level update (Firestore `updateDoc`), never a whole-document write, so a field not given
keeps what the document holds now rather than what the read saw; and it must be CONDITIONAL on
`expect` (owner, object ids and published state as read), refusing with `POST_CHANGED_MESSAGE` when the post changed
meanwhile — a `runTransaction` that re-reads, compares and updates — so two racing edits cannot
orphan each other's objects. A field given replaces the post's (an explicit `""` clears
`description` / `prompt` / `aiModel`), one omitted keeps it. A new `script` / `path` uploads a new
script object and thumbnail and removes the replaced ones once the document points at the new ids.

`delete` is the same owner check, then `deletePost` — the document first, so the post is gone at
once, and conditional on `expect` exactly as `updatePost` is (a transaction that re-reads, compares
and deletes), so an update that landed meanwhile keeps its post and its new objects. It answers the
document as deleted, and that version's objects are what `deleteObject` then removes — the script,
the thumbnail and any reference photos, a photo the web editor swapped in meanwhile included, since
`expect` pins the model and not the photos; an object that will not go is a warning, since nothing
links to it.

`get` and `getList` are reads: `readPost` / `listPosts` answer documents as stored (the server
stamps may stay whatever the SDK returns — a `Date`, or anything with `toDate()` — the tool turns
them into ISO strings), and `readScript` downloads the source from under the post's OWNER, which
need not be the session user: the Storage rule opens the objects to anyone. `readPost` must answer
`null`, not throw, for a document the rules hide (another account's draft), as it does for a wrong
id. `listPosts` is the gallery's own "My models" query — `uid == me`, `createdAt` descending — which
the rules admit and the composite index serves.

## ShapeScript language

- **Primitives**: `cube`, `sphere`, `icosphere`, `cylinder`, `cone`, `torus`, `circle`, `square`,
  `roundrect`, `polygon`
- **Properties**: `position X Y Z`, `orientation ROLL YAW PITCH` (alias `rotation`), `size X Y Z`,
  `detail`, `smoothing`, `name`
- **Materials** (as properties or scoped commands): `color`, `opacity`, `metallicity`, `roughness`,
  `glow`, `material NAME`; `texture` is accepted with a warning
- **CSG**: `union`, `difference`, `intersection`, `xor`, `stencil`
- **Builders**: `extrude`, `loft`, `lathe`, `fill`, `hull`
- **Variables & expressions**: `define`, arithmetic / comparison / boolean operators, `in`, ranges,
  parentheses, custom functions
- **Control flow**: `for … in …`, `if` / `else`, `switch` / `case`
- **Built-ins**: `round floor ceil abs sign sqrt pow min max`, `sin cos tan asin acos atan atan2`
  (radians), `dot cross length normalize sum`, `rgb hsb`, `join split trim`, `rnd`
- **Commands**: `detail N`, `seed N`, `smoothing N`, `background`, `print`, `assert`, and the relative
  `rotate` / `translate` / `scale`; `camera` / `light` blocks are skipped with a warning

A call is either C-like, with **no space** before its parenthesis (`sin(x)`; `sin (x)` is not a
call), or bare, as upstream: `max 0 (j - 1)`, `sqrt 9`, `sin pi / 2` — the function takes every
value after it, so parenthesise it inside a larger expression: `(sqrt 9) + (sqrt 16)`. Arguments are
a value list; commas (`max(0, j - 1)`) also work here but not in the upstream app. One statement per
line, as upstream: `define a 1 define b 2` on one line is a parse error naming the rule.

## Storage

A new `script` is saved to `artifacts/shapes/<slug>-<epoch-ms>.shape` and the
result names it as `data.filePath`; pass `path` instead of `script` to present a
source that already exists — a `.shape` this tool wrote, or any other on disk —
and it is rendered in place rather than copied. The two are mutually exclusive.
The View's source editor writes edits back to that same file (dispatch kinds
`loadShape` / `saveShape`), and refreshes from disk on open, so a model the agent
rewrote is what the user sees.

All file access goes through the host's generic gui-chat-protocol capability:
`files.artifacts` for `artifacts/shapes/**`, `files.byPath` for anything else.
A host that supplies neither keeps the pre-1.1 behaviour — the script travels
inside the tool result and nothing is written — rather than failing.

## Validation and errors

`executePresentShapeScript` checks arguments, parses the source, evaluates expressions,
and builds geometry headlessly before returning success. Temporary geometry is disposed.
Failures are returned as values, with **no `data` field**, so the host does not open a
broken visualization. The same diagnostic is available as `error` and `jsonData.error`
(the latter is included in the calling agent's tool response):

```ts
const result = await executePresentShapeScript(context, {
  title: "Example",
  script: "cube { size missing }",
});
if ("error" in result) {
  console.log(result.error.code, result.error.message);
  // EVALUATION_ERROR, "Undefined variable: missing"
}
```

Codes: `INVALID_ARGUMENT`, `PARSE_ERROR`, `EVALUATION_ERROR`, `LIMIT_EXCEEDED`.
Parse diagnostics include `line` and `column` when available. Invalid input does not
throw from the tool handler. Successful results retain their existing `{ title, data: { script } }`
contract. Validation executes the script, including geometry construction; the browser
constructs it again for display. The source editor also validates geometry before saving.

## Builders and additional expressions

```text
// Loft joins sections and caps the ends; hull forms a convex envelope.
loft {
    square
    translate 0 0 2
    circle
}
hull {
    cube { position -1 0 0 }
    cube { position 1 0 0 }
}
extrude { polygon { sides 5 } }
fill { square }
lathe path {
    point 0 0
    point 1 0
    curve 1.5 1
    point 1 2
    point 0 2
}

// Paths: absolute points, Bézier control points, a frame moved by rotate/translate/scale.
extrude path {
    point 0 0
    point 1 0
    point 1 1
    point 0 1
    point 0 0
}
fill path {
    for 0 to 8 {
        curve 0 1
        rotate 1 / 8
    }
}

// Stencil changes surface material without cutting away the first shape.
stencil {
    cube { color 1 0 0 }
    cube {
        position 0.5 0 0
        color 0 1 0
    }
}

define offsets ((1 2 3), (4 5 6))
cube { position offsets[0].x offsets[1].y offsets.count }

// Materials, as upstream: hex and named colours, alpha, PBR properties, bundles.
define brass material {
    color #d4a017
    metallicity 1
    roughness 0.3
}
material brass
sphere
cube {
    position 2
    color red 0.5      // red at 50% alpha
    glow orange * 0.3  // emissive
}

// Ranges, the `in` operator, custom functions and bare calls.
define steps 0 to 1 step 0.25
define ease(t) { t * t * (3 - 2 * t) }
for t in steps {
    if t in 0.25 to 0.75 {
        cube {
            position (t * 4) (ease t) 0
            size max 0.1 (t / 2)
        }
    }
}

// A rounded slab from two arcs, extruded; a bare path draws as a line.
extrude path {
    arc { angle -0.5 }
    point -0.5 0
    point 1.5 0
    arc {
        position 1 0
        orientation 0.5
        angle -0.5
    }
    curve 0 0.5
}
```

Also supported: `pi` (no `tau`, as upstream; write `2 * pi`), `true`, `false`, scientific notation, unary `+`,
short-circuit `and`/`or`, string literals, `join`/`split`/`trim`, tuple arguments to `min`/`max`,
zero-based tuple/string subscripts (negative from the end, or by name: `v["y"]`), `.count`, ordinal
members `.first` … `.tenth`, `.last`, `.allButFirst`, `.allButLast`, vector `.x/.y/.z/.w`, size
`.width/.height/.depth`, rotation `.roll/.yaw/.pitch`, color `.red/.green/.blue/.alpha` (or
`.r/.g/.b/.a`) and `.hue/.saturation/.brightness`, custom shape definitions with options (placed
and coloured through `position` / `orientation` / `size` / `color` / `material` on the call), and
`polygon { sides N }` (integer 3–256). Lathe samples curved profiles (drawn on either side of the
axis), and inline builder paths use the same parser as nested paths, including loops and
definitions. A `material` command inside a builder block applies to the builder's result, and
`size` on a builder or group scales it (an extrude's Z is its depth). `print` lines and the
commands that were skipped come back on the root group's `userData` (`sceneInfoOf(group)`) and in
the tool result message.

## Units and path semantics — same as upstream

Since 2.0.0 the plugin follows the [upstream ShapeScript](https://shapescript.info/mac/)
conventions, so a script written against the upstream docs renders the same here:

- `size` is the **diameter** of `sphere`, `cylinder`, `cone`, `circle`, `polygon` and `torus`
  (a bare `sphere` fits the unit cube) and the edge length of `cube` / `square`.
- `orientation` (alias `rotation`) and `rotate` take **half-turns** as `roll yaw pitch` —
  rotations about Z, Y and X applied in that order, `0.5` = 90°, positive clockwise (Euclid's
  sign). A lone value is a roll; four values are `angle x y z`. Trig _functions_ still use radians.
- Path `point` / `curve` coordinates are **absolute** in the path's frame; `rotate`, `translate`
  and `scale` inside a path move that frame for later points. `curve` is a quadratic Bézier
  **control point** — the outline passes through the neighbouring `point`s, and two `curve`s in
  a row get an implicit on-curve midpoint (eight in an octagon draw a circle). A path block may
  carry `position` / `orientation` / `size` of its own, which is how a `loft` section is placed in
  3D; `lathe` refuses a placed profile.
- `rnd` uses upstream's generator (`x = x · 1664525 + 1013904223 mod 2³²`, seed 0) and `seed N`
  reseeds it for the enclosing block only.
- **Scope** (2.1.0): a shape block, `group`, builder or custom block resets transforms and
  materials at its closing brace; `for` / `if` / `switch` bodies scope only symbols, so a
  `translate` inside a loop carries on after it, as upstream's scope rules say.
- A **bare `path`** draws as a line (2.1.0), as upstream; `fill` / `extrude` / `lathe` / `loft`
  make a surface or solid of it.
- `size 1 2` pads to `1 2 1` (Euclid's `Vector(size:)`), so `cylinder { size 1 2 }` is a
  cylinder of diameter 1 and height 2.
- `extrude` is centred on its profile plane, spanning ±depth/2 (2.1.0; it ran 0…depth
  before), and a lathe always faces outward whichever way its profile is drawn.

Deviations that remain: an _open_ path whose first or last point is a `curve` treats it as a
corner (upstream extrapolates a tangent), path points are 2D, nested sub-paths (holes) are not
supported, and `smoothing` is flat (0) or smooth rather than an angle threshold. The gap list
lives in [`plans/feat-shapescript-upstream-parity.md`](../../../plans/feat-shapescript-upstream-parity.md).

## Compatibility and limits

This is the plugin's documented modeling subset, **not complete compatibility with
upstream ShapeScript**.

Loft accepts ordered, closed planar sections with one perimeter each, resamples differing
vertex counts, interpolates linearly, and triangulates the end caps. Sections must enclose
a volume. Hull accepts geometry from child meshes and filled paths. Primitive profiles
for fill/extrude must lie in XY; holes, twisted extrusion (`twist`) and arbitrary 3D path
commands are not implemented. `extrude … along` sweeps a section along a path (mitred at
corners, capped at the ends of an open path); an open path extrudes to a two-sided wall, as
upstream. `minkowski { a b }` is the hull of two convex solids' vertex sums, and for a
non-convex operand the merged per-face hulls (overlapping shells, not a boolean union — fine to
draw, not to feed to another boolean); `inset(mesh d)` slides every vertex to where its faces'
offset planes meet. `text "Hello"` lays glyph outlines out as upstream does — left margin at
x = 0, first baseline at y = 0, one world unit per line, `size` scaling it, `wrapwidth` and
`linespacing` as options, values interpolated (`text "Bob has " apples " apples"`) — in a bundled
Helvetica-like face (Helvetiker; `font` is accepted and skipped with a warning, and a character
the face lacks draws as `?`). Bare `text` draws outlines; `fill` and `extrude` turn it into faces
and solids, holes included, and it is a value with `.bounds`. `import`, `svgpath`, `object` values
and paths as values are refused with a message naming the feature. Textures,
normal maps, `camera` and `light` blocks are accepted and skipped with a warning that the
tool result and the View both report. Unsupported commands and failed CSG operations return
errors instead of silently substituting different geometry. As with other polygonal CSG
engines, degenerate or self-intersecting inputs may fail.

The upstream project's own example scripts are test fixtures
(`test/fixtures/upstream-examples/`, MIT): all nine — Ball, Chessboard, Cog, Dodecahedron, Earth,
Fillet, Spirals, Spring and Train — render.

## Shapes as values, meshes and polygons

Since 2.2.0 a shape is a value, as upstream: `define ico icosphere { detail 0 }` keeps its mesh, `ico`
places it (with `position` / `orientation` / `size` on the call), and its members are readable —
`polygons` and `triangles` (each with `.center`, `.points`, `.bounds`), `bounds` (`.min` `.max`
`.center` `.size` `.width` `.height` `.depth`) and `volume`. The icosphere follows Euclid's
construction face for face, so scripts that index its faces (upstream's Dodecahedron) get the same
faces. `for v in … { expr }` and `if c { a } else { b }` are expressions, a function may build
shapes (`define face(data) { polygon { … } }`) and be called bare as a statement (`face data`), and
`mesh { … }` assembles the polygons its body produces — `polygon { color red … }` with one `point` per line
with 3D points, a tuple per point allowed — into one flat-shaded, vertex-coloured mesh. A value a
statement produces that is not a shape is an "unused value" error, as upstream. Paths as values and
`object` values remain unsupported.

`rnd` and `rand()` draw from a seeded generator (`randomSeed`, default
`DEFAULT_RANDOM_SEED` = 0, overridable in-script with `seed`) rather than `Math.random()`:
one script is evaluated twice — once on the server, which validates it, and again in the
browser, which renders it — and an unseeded generator lets those two runs take different
branches.

Conversion limits cover nodes (100,000), loop/path work (100,000 iterations), detail (3–256),
aggregate vertices (5,000,000, including CSG intermediates), and a coarse 30-second wall-clock
budget checked between nodes — it refuses to start the next node once the budget is spent, but
cannot interrupt one long boolean. Every one is overridable through `ConversionOptions`.

Measured, those ceilings bind in different places: a grid of 22,500 cubes is ~540k vertices and
converts in under 200 ms, 930 spheres at `detail 64` reach the vertex budget, and the wall clock
is in practice the CSG budget alone — 240k vertices of plain geometry take ~95 ms, while 100
boolean subtractions take 5.3 s. Remember the script is built TWICE, once on the server to
validate it and once in the browser to draw it, and that the browser's copy is what the user's
tab has to keep rendering.

## Scripts

```bash
yarn build      # vite build + d.ts emit
yarn typecheck  # vue-tsc --noEmit
yarn lint
yarn test       # node:test — tool execute + parser + Three.js conversion
```
