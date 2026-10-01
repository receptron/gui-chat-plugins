# Changelog

## 8.1.0

- **`exportShapeScriptStl`: a printable STL.** The model as one watertight solid for a slicer,
  through manifold (`manifold-3d`, WebAssembly) rather than the preview's CSG engine, whose output
  slicers reject as non-manifold. Every top-level solid is merged (no `union` needed), CSG blocks
  are evaluated by manifold in the preview's order wherever they occur (placed, stored with
  `define`, returned by a function), and the file is in millimetres, Z up, resting
  on Z = 0 (`unitScale`: mm per unit, default 1). The answer carries a report: size, parts merged
  and skipped (flat or open parts, by name), bodies, genus, volume, non-manifold edges after a
  slicer-style merge, and warnings. `shapeScriptToPrintableStl` is the same without the tool.
  manifold is a new dependency, loaded on first use. The View's Download -> STL is unchanged.
  A 10 x 10 x 10 cube lattice (3,630 struts, 1,331 joint spheres) exports as 1 body of genus
  2,300 with no non-manifold edges in about 9 s, as loose parts or inside a `union`. Sealed
  hollows are reported as `cavities`, not as extra bodies; lines and text outlines as skipped.
- **Faster, lighter printable export for large lattices.** The union is done region by region
  (manifold's WebAssembly build is single-threaded, and a lattice's parts overlap only their
  neighbours), parts go to manifold without a separate three.js vertex merge, the report's
  vertex-merge check uses typed arrays, and inputs are freed once merged. A 20 x 20 x 20 cube
  lattice (35,721 parts) went from 124 s and 4.8 GB to 53 s and 4.0 GB at `detail 12`, and 31 s
  and 2.7 GB at `detail 8`; the 10 x 10 x 10 one from 8.6 s to 6.6 s. Same bodies, genus and
  volume.
- **Lattice guidance for the agent**: the language prompt and the tool's prompt say to write a
  model of hundreds of parts without a `union` block — the STL export merges them, and the
  preview cannot evaluate such a union in time — to make parts overlap where they join, and to
  use `detail 8` for thousands of parts (below 8 the parts intersect into more pieces and the
  export gets no faster).
- **A large `union` no longer runs into the vertex ceiling.** A CSG block charged every
  intermediate result and kept them all, so a union of n parts cost about n^2 vertices; it now
  holds and charges only the latest. The time limit is also checked before each boolean, so a
  big block is refused at the limit rather than running for minutes.
- **Nested `for` expressions share one iteration budget** (#14): each loop alone was capped, so
  nesting could ask for 10^10 values. The time limit is checked inside them too.
- **Tuple `=` and `<>` compare recursively** (#19): nested tuples compared only their first
  components, and string tuples threw.
- **`cylinder`, `cone`, `circle` and `polygon` use every `size` component** (#18):
  `cylinder { size 1 2 3 }` was 1 x 2 x 1.
- **Portrait render tiles fit the model** (#17): the camera was framed by the height only, and a
  160 x 900 tile cropped the model to a fifth of its width. Square and landscape tiles are
  unchanged.
- **The source editor's saves are queued** (#15), so a second Apply cannot leave the older script
  on disk; **a reply for a result no longer shown is dropped** (#16).
- **No non-null assertions**, and no lint exemption for this package. Indexing the code has
  already bounded goes through `at()`, which throws rather than passing `undefined` on.

## 8.0.0

- **Moved from MulmoClaude**, where it was `@mulmoclaude/shapescript-plugin` up to 7.1.0. The code,
  the tools (`presentShapeScript`, `renderShapeScript`, `exportShapeScriptUsdz`,
  `manageShapeScript`) and the entries (`.`, `./vue`, `./render`, `./style.css`) are the same; the
  package name is what changes, so a host swaps its imports from `@mulmoclaude/shapescript-plugin`
  to `@gui-chat-plugin/shapescript`.
- **Nothing is imported from MulmoClaude.** The artifact path helpers come from
  `@gui-chat-plugin/common` (a dependency) and `ARTIFACTS_ROOT` from `gui-chat-protocol`, whose peer
  range is now `^2.3.0`. The `@mulmoclaude/core` peer is gone. The check a `path` outside
  `artifacts/shapes/` goes through (`files.byPath`) is a local copy of MulmoClaude's
  `classifyFilePath`, since the protocol doesn't define `byPath`.
- The README says what a host provides, and what each tool does without it.
- **Fixed: a script could inject markup into the render page.** `./render` put the scene into an
  inline `<script>` with `JSON.stringify`, which leaves `</script>` alone, so an object `name` or
  `print` text holding it ended the element and the rest ran in the headless browser — able to
  replace the PNG. The page now escapes `<` in everything it interpolates (`scriptJson`). 7.1.0
  has this bug.
- **`@types/three` is a dependency**, not a dev dependency: the published declarations import from
  `three`, which ships no types of its own, so a TypeScript consumer without its own `@types/three`
  got TS7016 with `skipLibCheck` off. 7.1.0 has this too.
- **`renderThumbnail` is optional** in `manageShapeScript`'s context, as a capability a host may not
  have; without it every post goes up without a picture. Before, a host had to pass a function
  that answered `null`.
