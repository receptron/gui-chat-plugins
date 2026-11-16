// The kernel, loaded once: replicad over OpenCascade's WebAssembly build.
//
// Both are imported dynamically, on the first build, so listing the tool costs
// nothing. The kernel writes progress to stdout on a STEP export ("Statistics
// on Transfer…"); a host that speaks a protocol over stdout (an MCP server on
// stdio) would have that mixed into its messages, so `print` and `printErr`
// are swallowed.

import type { OpenCascadeInstance } from "replicad-opencascadejs";
import { instrument } from "./record";

export type Replicad = typeof import("replicad");

export interface Kernel {
  oc: OpenCascadeInstance;
  replicad: Replicad;
}

let loading: Promise<Kernel> | undefined;

async function load(): Promise<Kernel> {
  const [replicad, { default: init }] = await Promise.all([
    import("replicad"),
    import("replicad-opencascadejs"),
  ]);
  const oc = await init({ print: () => {}, printErr: () => {} });
  replicad.setOC(oc);
  const kernel = { oc, replicad };
  instrument(kernel);
  return kernel;
}

/** The kernel, loading it on the first call. A failed load is not kept: the
 *  next call tries again, so a missing dependency installed later is found. */
export function loadKernel(): Promise<Kernel> {
  loading ??= load().catch((cause: unknown) => {
    loading = undefined;
    throw cause;
  });
  return loading;
}
