// The checks around each modelling operation.
//
// A script is plain replicad, so the checks cannot be functions the script
// has to remember to call: `fillet`, `chamfer`, `shell`, `fuse`, `cut` and
// `intersect` on replicad's 3D shapes are wrapped, once, when the kernel
// loads. Outside a build the wrappers call straight through.
//
// What each wrapper is for, from the trial this package started from:
//
// - **What a selector picked.** `chamfer(1, e => e.ofCurveType("CIRCLE")
//   .inPlane("XY", 5))` was meant for four hole rims; it also matched the arcs
//   of the rounded corners, and the chamfer ran round the whole outline.
//   Nothing failed. The record says "selected 12 of 49 edges".
// - **A failure with its operation.** A fillet too large for its edge throws a
//   WebAssembly exception with no message and no stack. The wrapper names the
//   operation, its line, the radius and the sizes it has to fit in.
// - **A result that is not a solid.** `makeBaseBox(40, 20, 5).fillet(3)`
//   returns, with a volume LARGER than the box it rounded. The kernel's own
//   shape check catches it, and the build stops there.
// - **A boolean that did nothing.** A `cut` whose tool misses the solid
//   returns the solid unchanged: a hole that is not there.

import type { AnyShape, Edge, Face, Shape3D } from "replicad";
import { BrepError, currentScriptLine, describeThrown } from "./errors";
import type { Kernel } from "./load";

export type OperationName =
  "fillet" | "chamfer" | "shell" | "fuse" | "cut" | "intersect";

export interface OperationRecord {
  op: OperationName;
  /** 1-based script line of the call. */
  line?: number;
  /** The radius, chamfer distance or wall thickness, when it is one number. */
  size?: number;
  /** Edges (fillet, chamfer) or faces (shell) the selector picked. */
  selected?: number;
  /** How many edges or faces the solid had to pick from. */
  available?: number;
  /** mm³ before and after; NaN where the shape has no volume to measure. */
  volumeBefore: number;
  volumeAfter: number;
}

export interface Recorder {
  operations: OperationRecord[];
  warnings: string[];
}

/** The build in progress. One at a time: `buildModel` serialises builds. */
let active: Recorder | undefined;
/** Wrapped operations in flight, so one called from inside another (the
 *  kernel's own use of a boolean) is not recorded as the script's. */
let depth = 0;

export function startRecording(): Recorder {
  active = { operations: [], warnings: [] };
  depth = 0;
  return active;
}

export function stopRecording(): void {
  active = undefined;
  depth = 0;
}

const round = (value: number, digits = 2): number =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : value;

/** Volume in mm³, or NaN for a shape that has none to measure. */
export function volumeOf(kernel: Kernel, shape: unknown): number {
  try {
    return kernel.replicad.measureVolume(shape as Shape3D);
  } catch {
    return Number.NaN;
  }
}

/** The kernel's own check of a shape: topology and geometry. */
export function isValidShape(kernel: Kernel, shape: AnyShape): boolean {
  const analyzer = new kernel.oc.BRepCheck_Analyzer(shape.wrapped, true);
  try {
    // The no-argument overload: the validity of the whole shape.
    return (analyzer.IsValid as unknown as () => boolean).call(analyzer);
  } finally {
    analyzer.delete();
  }
}

/** `40 x 20 x 5 mm` */
export function sizeOf(shape: AnyShape): [number, number, number] {
  const box = shape.boundingBox;
  return [round(box.width), round(box.height), round(box.depth)];
}

const formatSize = (size: readonly number[]): string =>
  `${size.join(" x ")} mm`;

interface Selection {
  size?: number;
  selected?: number;
  available?: number;
  /** Length of the shortest selected edge, mm. */
  shortest?: number;
}

type FinderFunction<F> = (finder: F, shape: AnyShape) => F;
interface Finds<T> {
  find(shape: AnyShape): T[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The edges a `fillet` / `chamfer` call picks, read from its arguments the
 *  way replicad reads them: a radius with an optional filter, a
 *  `{ filter, radius }` object, or a function from edge to radius. */
function edgeSelection(
  kernel: Kernel,
  shape: Shape3D,
  args: unknown[],
): Selection {
  const [config, filter] = args;
  const all = shape.edges;
  let edges: Edge[] = all;
  let size: unknown = config;
  if (typeof config === "function") {
    const radiusOf = config as (edge: Edge) => unknown;
    edges = all.filter((edge) => radiusOf(edge) != null);
    size = undefined;
  } else if (isRecord(config) && "filter" in config) {
    edges = (config.filter as Finds<Edge>).find(shape);
    size = config.radius;
  } else if (typeof filter === "function") {
    const finder = new kernel.replicad.EdgeFinder();
    edges = (filter as FinderFunction<Finds<Edge>>)(finder, shape).find(shape);
  }
  const lengths = edges.map((edge) => kernel.replicad.measureLength(edge));
  return {
    ...(typeof size === "number" ? { size } : {}),
    selected: edges.length,
    available: all.length,
    ...(lengths.length ? { shortest: round(Math.min(...lengths)) } : {}),
  };
}

/** The faces a `shell` call opens: `(thickness, finder)` or
 *  `({ filter, thickness })`. */
function faceSelection(
  kernel: Kernel,
  shape: Shape3D,
  args: unknown[],
): Selection {
  const [first, second] = args;
  const all = shape.faces;
  let faces: Face[] = [];
  let size: unknown = first;
  if (isRecord(first) && "filter" in first) {
    faces = (first.filter as Finds<Face>).find(shape);
    size = first.thickness;
  } else if (typeof second === "function") {
    const finder = new kernel.replicad.FaceFinder();
    faces = (second as FinderFunction<Finds<Face>>)(finder, shape).find(shape);
  }
  return {
    ...(typeof size === "number" ? { size } : {}),
    selected: faces.length,
    available: all.length,
  };
}

const noSelection = (): Selection => ({});

const SELECTORS: Record<
  OperationName,
  (kernel: Kernel, shape: Shape3D, args: unknown[]) => Selection
> = {
  fillet: edgeSelection,
  chamfer: edgeSelection,
  shell: faceSelection,
  fuse: noSelection,
  cut: noSelection,
  intersect: noSelection,
};

const PICKED: Partial<Record<OperationName, string>> = {
  fillet: "edges",
  chamfer: "edges",
  shell: "faces",
};

/** `fillet(3) at line 12` */
function callName(
  op: OperationName,
  selection: Selection,
  line?: number,
): string {
  const size = selection.size === undefined ? "" : `${selection.size}`;
  return `${op}(${size})${line === undefined ? "" : ` at line ${line}`}`;
}

/** What a failed or invalid operation had to work with: the reader's way to
 *  see that a radius does not fit. */
function circumstances(
  op: OperationName,
  selection: Selection,
  shape: Shape3D,
): string {
  const parts: string[] = [];
  const what = PICKED[op];
  if (what && selection.selected !== undefined)
    parts.push(
      `it selected ${selection.selected} of ${selection.available} ${what}`,
    );
  if (selection.shortest !== undefined)
    parts.push(`the shortest selected edge is ${selection.shortest} mm`);
  parts.push(`the solid is ${formatSize(sizeOf(shape))}`);
  return parts.join("; ");
}

const HINTS: Partial<Record<OperationName, string>> = {
  fillet:
    "A fillet fails when its radius does not fit: larger than a neighbouring face is wide, or meeting another fillet. Use a smaller radius, or select fewer edges.",
  chamfer:
    "A chamfer fails when its distance does not fit on a neighbouring face. Use a smaller distance, or select fewer edges.",
  shell:
    "A shell fails when an inside corner would get a radius of zero or less: every outside fillet must be larger than the wall thickness. Fillet with a larger radius, use a thinner wall, or shell before filleting.",
};

/** Relative change below which a boolean counts as having done nothing. */
const UNCHANGED = 1e-9;

function noteNoOp(recorder: Recorder, record: OperationRecord): void {
  const { op, volumeBefore: before, volumeAfter: after } = record;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return;
  const where = record.line === undefined ? "" : ` at line ${record.line}`;
  if (op === "cut" && Math.abs(before - after) <= UNCHANGED * before)
    recorder.warnings.push(
      `cut${where} removed nothing: the tool does not overlap the solid.`,
    );
  if (op === "intersect" && after <= UNCHANGED * before)
    recorder.warnings.push(
      `intersect${where} left nothing: the two shapes do not overlap.`,
    );
}

type Method = (this: Shape3D, ...args: unknown[]) => unknown;

function wrap(kernel: Kernel, op: OperationName, original: Method): Method {
  return function wrapped(this: Shape3D, ...args: unknown[]): unknown {
    const recorder = active;
    if (!recorder || depth > 0) return original.apply(this, args);
    const line = currentScriptLine();
    // Read the selection BEFORE the operation: a throwing selector is the
    // script's own error and is reported as one, by the call below.
    let selection: Selection = {};
    try {
      selection = SELECTORS[op](kernel, this, args);
    } catch {
      // Leave it to the operation, which runs the same selector.
    }
    const volumeBefore = volumeOf(kernel, this);
    let result: unknown;
    depth += 1;
    try {
      result = original.apply(this, args);
    } catch (cause) {
      if (cause instanceof BrepError) throw cause;
      // Nothing selected is a selector to correct, not a size to reduce.
      const hint = selection.selected === 0 ? undefined : HINTS[op];
      throw new BrepError(
        "OPERATION_FAILED",
        `${callName(op, selection, line)} failed: ${describeThrown(kernel.oc, cause)}. ` +
          `When it ran, ${circumstances(op, selection, this)}.` +
          (hint ? ` ${hint}` : ""),
        line,
      );
    } finally {
      depth -= 1;
    }
    const volumeAfter = volumeOf(kernel, result);
    if (isRecord(result) && "wrapped" in result) {
      if (!isValidShape(kernel, result as unknown as AnyShape)) {
        const hint = HINTS[op];
        throw new BrepError(
          "INVALID_RESULT",
          `${callName(op, selection, line)} returned a shape that is not a valid solid ` +
            `(volume ${round(volumeBefore)} -> ${round(volumeAfter)} mm3). ` +
            `When it ran, ${circumstances(op, selection, this)}.` +
            (hint ? ` ${hint}` : ""),
          line,
        );
      }
    }
    const record: OperationRecord = {
      op,
      ...(line === undefined ? {} : { line }),
      ...(selection.size === undefined ? {} : { size: selection.size }),
      ...(selection.selected === undefined
        ? {}
        : { selected: selection.selected }),
      ...(selection.available === undefined
        ? {}
        : { available: selection.available }),
      volumeBefore,
      volumeAfter,
    };
    recorder.operations.push(record);
    noteNoOp(recorder, record);
    return result;
  };
}

const OPERATIONS: OperationName[] = [
  "fillet",
  "chamfer",
  "shell",
  "fuse",
  "cut",
  "intersect",
];

const INSTRUMENTED = Symbol.for("@gui-chat-plugin/brep:instrumented");

/** Wrap the operations on replicad's 3D shape class. Once per copy of
 *  replicad: a second call finds the mark and leaves the wrappers alone. */
export function instrument(kernel: Kernel): void {
  const prototype = kernel.replicad._3DShape.prototype as unknown as Record<
    string | symbol,
    unknown
  >;
  if (prototype[INSTRUMENTED]) return;
  prototype[INSTRUMENTED] = true;
  for (const op of OPERATIONS) {
    const original = prototype[op];
    if (typeof original === "function")
      prototype[op] = wrap(kernel, op, original as Method);
  }
}
