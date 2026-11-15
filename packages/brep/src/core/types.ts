import type { ToolResult } from "gui-chat-protocol";
import type { BrepErrorCode, ModelReport } from "../kernel/index";
import type { BrepMesh } from "./mesh";

export type { BrepErrorCode, ModelReport };

/** Args the model passes. `script` builds a new model and saves it; `path`
 *  rebuilds one that is already saved (after an edit to the file). Only
 *  `title` is `required` in the schema, which cannot say "one or the other";
 *  the executor does. */
export interface PresentBrepArgs {
  title: string;
  script?: string;
  path?: string;
}

/** Workspace-relative paths of what a build wrote. */
export interface BrepFiles {
  /** The script: `artifacts/brep/<name>.replicad.js`. */
  script: string;
  step: string;
  stl: string;
  /** The sheet of line drawings, SVG. */
  views: string;
}

/** What a View draws from. The mesh is here, packed, because a View cannot
 *  run the kernel and a host owes it no way to read a file. */
export interface PresentBrepData {
  script: string;
  report: ModelReport;
  mesh: BrepMesh;
  /** Absent on a host with no file layer: the model was built and checked,
   *  and nothing was saved. */
  files?: BrepFiles;
}

export interface BrepDiagnostic {
  code: BrepErrorCode;
  message: string;
  /** 1-based line of the script. */
  line?: number;
  /** What the operations before the failure did. */
  completed?: string[];
}

export type PresentBrepBuiltResult = ToolResult<
  PresentBrepData,
  { report: ModelReport; files?: BrepFiles }
> & { data: PresentBrepData };

/** An error carries no `data`: nothing to draw. `jsonData` goes back to the
 *  model. */
export type PresentBrepErrorResult = ToolResult<
  never,
  { error: BrepDiagnostic }
> & { data?: never; error: BrepDiagnostic };

export type PresentBrepResult = PresentBrepBuiltResult | PresentBrepErrorResult;
