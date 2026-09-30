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
