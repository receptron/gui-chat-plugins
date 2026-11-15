# Changelog

## 0.1.0

- First release: `presentBrep` builds a solid model from a replicad script with the OpenCascade
  kernel, in Node. It returns a check report (size, volume, faces and edges by kind, and what each
  fillet, chamfer and shell selected) and writes the script, a STEP file, a binary STL and a sheet
  of line drawings under `artifacts/brep/`.
- A View on `./vue`: the model in 3D with its edges, four standard views, the report, the saved
  files' paths and the script. The mesh it draws travels in the tool result, so the page never
  loads the kernel.
  The model is on top at a height the user sets by dragging the bar under it; the report, the
  files and the script scroll below, so nothing is cut off or overlaps in a short pane. That
  layout is the component's own CSS: as Tailwind variants it was overridden by the other plugins'
  stylesheets in MulmoChat.
- The guide, the system prompt and every result say which side the user sees first (-Y): chairs
  built in MulmoChat had their backs to the viewer, the second one after the guide alone said so.
