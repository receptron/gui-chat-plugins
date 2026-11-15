// One build, start to finish: run the script, check and measure what it made,
// and produce the files. This module and everything under it is loaded on the
// first build, not when the tool is listed.

import { BrepError, describeThrown } from "./errors";
import { loadKernel } from "./load";
import type { BrepMesh } from "../core/mesh";
import { toDisplayMesh, toStep, toStl, toViewsSvg } from "./output";
import { startRecording, stopRecording } from "./record";
import {
  buildReport,
  formatOperations,
  formatReport,
  wholeOf,
  type ModelReport,
} from "./report";
import { runScript } from "./script";

export { BrepError } from "./errors";
export type { BrepErrorCode } from "./errors";
export type { ModelReport, OperationSummary, PartReport } from "./report";
export { formatReport };

export interface BuiltModel {
  report: ModelReport;
  step: Uint8Array;
  stl: Uint8Array;
  /** A sheet of four line drawings, as SVG. */
  views: string;
  /** The model as a View draws it. */
  mesh: BrepMesh;
}

/** A model's script usually builds in under a second; a minute is a script
 *  that loops, or a model far past what this is for. */
export const DEFAULT_TIMEOUT_MS = 60_000;

export interface BuildOptions {
  timeoutMs?: number;
}

/** Builds run one at a time: the operation checks record into the one build
 *  in progress, and the kernel is single-threaded anyway. */
let queue: Promise<unknown> = Promise.resolve();

async function build(
  script: string,
  options: BuildOptions,
): Promise<BuiltModel> {
  const kernel = await loadKernel();
  const recorder = startRecording();
  try {
    const parts = await runScript(
      kernel,
      script,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    try {
      const whole = wholeOf(kernel, parts);
      const report = buildReport(kernel, parts, whole, recorder);
      // Before the STL, which meshes finer: see `toDisplayMesh`.
      const mesh = toDisplayMesh(whole);
      return {
        report,
        mesh,
        step: await toStep(kernel, parts),
        stl: await toStl(whole),
        views: toViewsSvg(kernel, whole),
      };
    } catch (cause) {
      if (cause instanceof BrepError) throw cause;
      // The script ran; what it returned cannot be measured, meshed or
      // exported. Without this the model is told "[object
      // WebAssembly.Exception]".
      throw new BrepError(
        "INVALID_RESULT",
        `The script ran, but what main() returned could not be measured or exported: ${describeThrown(kernel.oc, cause)}. That is a shape which is not a valid solid: look at the last operations, and at any profile that may cross itself.`,
      );
    }
  } catch (cause) {
    if (cause instanceof BrepError)
      cause.completed = formatOperations(recorder.operations);
    throw cause;
  } finally {
    stopRecording();
  }
}

/** Build the model a script describes. Throws `BrepError` for anything the
 *  script's author can correct. */
export function buildModel(
  script: string,
  options: BuildOptions = {},
): Promise<BuiltModel> {
  const result = queue.then(() => build(script, options));
  queue = result.catch(() => undefined);
  return result;
}

export const isBrepError = (value: unknown): value is BrepError =>
  value instanceof BrepError;
