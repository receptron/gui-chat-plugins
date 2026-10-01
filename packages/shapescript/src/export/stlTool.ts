// The `exportShapeScriptStl` TOOL: a model as one printable solid, for a
// slicer, with a report of what the slicer will find. Wired like
// `exportShapeScriptUsdz`: the source and the output go through the generic
// gui-chat-protocol `files` capability, so a host registers it with the SAME
// `{ files }` context it built for `executeShapeScriptDispatch`.

import type { ShapeScriptDispatchContext } from "../core/dispatch";
import { stlArtifactPath } from "../core/paths";
import { DEFAULT_MAX_DURATION_MS } from "../shapescript/toThreeJS";
import { shapeScriptToPrintableStl, type PrintReport } from "./printable";
import { resolveShapeSource } from "./tool";

export const EXPORT_STL_TOOL_NAME = "exportShapeScriptStl";

/** Milliseconds a host must allow this tool: the conversion may use its whole
 *  budget, and the manifold union and the write come after it. */
export const EXPORT_STL_TOOL_TIMEOUT_MS = DEFAULT_MAX_DURATION_MS + 60_000;

export const EXPORT_STL_DESCRIPTION =
  "Export a ShapeScript model as a binary STL for 3D printing and save it under artifacts/shapes/. Every top-level solid is merged into one watertight solid (no `union` needed), written in millimetres, Z up, resting on Z = 0. `unitScale` is millimetres per ShapeScript unit (default 1, so `cube` is a 1 mm cube). Parts that are not closed solids (a flat circle, fill, open path, text outline) are skipped and listed. Returns the saved path and a printability report: size in mm, parts merged and skipped, bodies, genus, volume, non-manifold edges and warnings. Takes the same source as presentShapeScript: inline `script`, or `path` to a saved .shape file.";

export const EXPORT_STL_PROMPT =
  "Use exportShapeScriptStl when the user wants to 3D-print a model or needs an STL for a slicer. Ask what size they want if it matters, and pass `unitScale` (mm per ShapeScript unit) rather than rewriting the script. Relay the report's warnings: non-manifold edges mean parts only touch and should overlap, more than one body means loose pieces, skipped parts are flat or open and will not print. Fix the model and export again when the user wants a clean print.";

export const EXPORT_STL_SCHEMA = {
  type: "object" as const,
  properties: {
    script: {
      type: "string",
      description:
        "ShapeScript source to export. Provide either this or `path`, not both.",
    },
    path: {
      type: "string",
      description:
        "Path to an existing .shape file to export (e.g. one presentShapeScript saved under artifacts/shapes/).",
    },
    title: {
      type: "string",
      description:
        "Name for the exported file; it is slugified into the filename. Defaults to the .shape file's own name when `path` is given.",
    },
    unitScale: {
      type: "number",
      description: "Millimetres per ShapeScript unit. Default 1.",
    },
  },
  required: [] as string[],
};

export interface ExportStlResult {
  message: string;
  /** Workspace-relative, `artifacts/shapes/<slug>-<epoch>-<token>.stl`. */
  filePath: string;
  bytes: number;
  report: PrintReport;
}

function unitScaleOf(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(
      "`unitScale` must be a positive number of millimetres per unit",
    );
  return value;
}

const millimetres = (value: number): string =>
  Number(value.toFixed(2)).toString();

/** The report as the sentences the agent reads. */
export function describePrintReport(report: PrintReport): string {
  const [x, y, z] = report.sizeMm.map(millimetres);
  const lines = [
    `Size ${x} x ${y} x ${z} mm, ${report.bodies} ${report.bodies === 1 ? "body" : "bodies"}, genus ${report.genus}, volume ${millimetres(report.volumeMm3)} mm3, ${report.triangles} triangles.`,
    `${report.parts} part(s) merged, ${report.skipped.length} skipped; ${report.nonManifoldEdges} non-manifold edges.`,
  ];
  for (const warning of report.warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

/** Run one `exportShapeScriptStl` call. Throws on a missing or invalid source,
 *  on ShapeScript errors, and when no part is a closed solid. */
export async function executeExportShapeScriptStl(
  context: ShapeScriptDispatchContext,
  args: Record<string, unknown>,
): Promise<ExportStlResult> {
  const unitScale = unitScaleOf(args.unitScale);
  const { script, title } = await resolveShapeSource(context, args);
  const { stl, report } = await shapeScriptToPrintableStl(
    script,
    unitScale === undefined ? {} : { unitScale },
  );
  const { relPath, filePath } = stlArtifactPath(title);
  await context.files.artifacts.write(relPath, stl);
  return {
    message: `Saved STL to ${filePath} (${stl.byteLength} bytes).\n${describePrintReport(report)}`,
    filePath,
    bytes: stl.byteLength,
    report,
  };
}
