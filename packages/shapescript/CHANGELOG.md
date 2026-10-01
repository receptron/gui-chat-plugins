# Changelog

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
