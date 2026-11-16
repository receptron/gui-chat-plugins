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

import type { AnyShape, Edge, Shape3D } from "replicad";
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** What an operation is called with, and the selection its record reports.
 *
 * The selection is noted WHILE the operation runs, by standing between it
 * and the script's selector. The selector was once run here first, for the
 * record; one that keeps state then answered differently when the operation
 * asked, and the solid was built from other edges than plain replicad picks.
 */
interface Prepared {
  args: unknown[];
  selection: Selection;
}

type Finder = Record<string, unknown>;

/** Note an edge the operation keeps. */
function noteEdge(kernel: Kernel, selection: Selection, edge: Edge): void {
  selection.selected = (selection.selected ?? 0) + 1;
  const length = round(kernel.replicad.measureLength(edge));
  selection.shortest = Math.min(selection.shortest ?? length, length);
}

/** An edge finder whose `shouldKeep`, which a fillet asks once for each
 *  edge, notes the edges it keeps. */
function watchEdgeFinder<T>(
  kernel: Kernel,
  selection: Selection,
  finder: T,
): T {
  if (!isRecord(finder) || typeof finder.shouldKeep !== "function")
    return finder;
  const shouldKeep = finder.shouldKeep as (edge: Edge) => unknown;
  selection.selected = 0;
  (finder as Finder).shouldKeep = (edge: Edge) => {
    const keep = shouldKeep.call(finder, edge);
    if (keep) noteEdge(kernel, selection, edge);
    return keep;
  };
  return finder;
}

/** A face finder whose `find`, which a shell calls once, notes how many
 *  faces it found. */
function watchFaceFinder<T>(selection: Selection, finder: T): T {
  if (!isRecord(finder) || typeof finder.find !== "function") return finder;
  const find = finder.find as (...args: unknown[]) => unknown;
  (finder as Finder).find = (...args: unknown[]) => {
    const found = find.apply(finder, args);
    if (Array.isArray(found)) selection.selected = found.length;
    return found;
  };
  return finder;
}

type FinderFunction = (finder: unknown, shape: unknown) => unknown;

/** A `fillet` / `chamfer` call, read the way replicad reads it: a radius
 *  with an optional filter, a `{ filter, radius }` object, or a function
 *  from edge to radius. */
function prepareEdges(
  kernel: Kernel,
  shape: Shape3D,
  args: unknown[],
): Prepared {
  const [config, filter, ...others] = args;
  const all = shape.edges;
  const selection: Selection = { available: all.length };
  if (typeof config === "function") {
    const radiusOf = config as (edge: Edge) => unknown;
    selection.selected = 0;
    const counted = (edge: Edge): unknown => {
      const radius = radiusOf(edge);
      // No radius, or a radius of 0, leaves the edge.
      if (radius) noteEdge(kernel, selection, edge);
      return radius;
    };
    return { args: [counted, filter, ...others], selection };
  }
  if (isRecord(config) && "filter" in config) {
    if (typeof config.radius === "number") selection.size = config.radius;
    watchEdgeFinder(kernel, selection, config.filter);
    return { args, selection };
  }
  if (typeof config === "number") selection.size = config;
  if (typeof filter === "function") {
    const select = filter as FinderFunction;
    const watched: FinderFunction = (finder, solid) =>
      watchEdgeFinder(kernel, selection, select(finder, solid));
    return { args: [config, watched, ...others], selection };
  }
  // No selector: every edge, and nothing of the script's to call.
  const lengths = all.map((edge) => kernel.replicad.measureLength(edge));
  selection.selected = all.length;
  if (lengths.length) selection.shortest = round(Math.min(...lengths));
  return { args, selection };
}

/** A `shell` call: `(thickness, finder)` or `({ filter, thickness })`. */
function prepareFaces(
  _kernel: Kernel,
  shape: Shape3D,
  args: unknown[],
): Prepared {
  const [first, second, ...others] = args;
  const selection: Selection = { selected: 0, available: shape.faces.length };
  if (isRecord(first) && "filter" in first) {
    if (typeof first.thickness === "number") selection.size = first.thickness;
    watchFaceFinder(selection, first.filter);
    return { args, selection };
  }
  if (typeof first === "number") selection.size = first;
  if (typeof second === "function") {
    const select = second as FinderFunction;
    const watched: FinderFunction = (finder, solid) =>
      watchFaceFinder(selection, select(finder, solid));
    return { args: [first, watched, ...others], selection };
  }
  return { args, selection };
}

const prepareNothing = (
  _kernel: Kernel,
  _shape: Shape3D,
  args: unknown[],
): Prepared => ({ args, selection: {} });

const PREPARE: Record<
  OperationName,
  (kernel: Kernel, shape: Shape3D, args: unknown[]) => Prepared
> = {
  fillet: prepareEdges,
  chamfer: prepareEdges,
  shell: prepareFaces,
  fuse: prepareNothing,
  cut: prepareNothing,
  intersect: prepareNothing,
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
    let prepared: Prepared = { args, selection: {} };
    try {
      prepared = PREPARE[op](kernel, this, args);
    } catch {
      // Nothing to report of the selection; the operation runs as written.
    }
    const { selection } = prepared;
    const volumeBefore = volumeOf(kernel, this);
    let result: unknown;
    depth += 1;
    try {
      result = original.apply(this, prepared.args);
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

/** A call as the script wrote it, short: `threePointsArc([-1400, 3000], [0, 3620])`. */
function formatCall(name: string, args: unknown[]): string {
  const one = (value: unknown): string => {
    if (typeof value === "number") return `${round(value, 3)}`;
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "function") return "fn";
    if (Array.isArray(value)) return `[${value.map(one).join(", ")}]`;
    if (isRecord(value)) return "{...}";
    return String(value);
  };
  const text = args.map(one).join(", ");
  return `${name}(${text.length > 80 ? `${text.slice(0, 77)}...` : text})`;
}

/** Sketch methods whose result is a solid: checked as the six operations'
 *  results are. A profile that crosses itself extrudes without complaint. */
const SOLID_MAKERS = new Set(["extrude", "revolve", "loftWith", "sweepSketch"]);

/** Everything else a script calls on a pen, a drawing, a sketch or a shape.
 *
 * Not recorded: there is nothing to say about a `lineTo` that worked. It is
 * here for the ones that fail. In MulmoChat `threePointsArc([x, y], [x, y])`
 * came back as "Standard_OutOfRange" with no line, and an extrusion of a
 * profile that crossed itself as "[object WebAssembly.Exception]" from the
 * export, two steps later. The model took its script apart to find them and
 * stopped at the piece that built.
 */
function guard(
  kernel: Kernel,
  name: string,
  original: Method,
  /** The method that takes points where this one takes distances from the
   *  pen: `threePointsArcTo` for `threePointsArc`. */
  absolute?: string,
): Method {
  return function guarded(this: Shape3D, ...args: unknown[]): unknown {
    if (!active || depth > 0) return original.apply(this, args);
    if (absolute && Array.isArray(args[0])) {
      const line = currentScriptLine();
      throw new BrepError(
        "SCRIPT_ERROR",
        `${formatCall(name, args)}${line === undefined ? "" : ` at line ${line}`}: ${name} takes numbers, distances from where the pen is. For points, as here, use ${absolute}.`,
        line,
      );
    }
    let result: unknown;
    depth += 1;
    try {
      result = original.apply(this, args);
    } catch (cause) {
      // An Error has its own message and line; the kernel's has neither.
      if (cause instanceof Error) throw cause;
      const line = currentScriptLine();
      throw new BrepError(
        "OPERATION_FAILED",
        `${formatCall(name, args)}${line === undefined ? "" : ` at line ${line}`} failed: ${describeThrown(kernel.oc, cause)}.`,
        line,
      );
    } finally {
      depth -= 1;
    }
    if (
      SOLID_MAKERS.has(name) &&
      isRecord(result) &&
      "wrapped" in result &&
      !isValidShape(kernel, result as unknown as AnyShape)
    ) {
      const line = currentScriptLine();
      throw new BrepError(
        "INVALID_RESULT",
        `${formatCall(name, args)}${line === undefined ? "" : ` at line ${line}`} returned a shape that is not a valid solid, ${formatSize(sizeOf(result as unknown as AnyShape))}. Its profile probably crosses itself: check each point, and that an arc given numbers (threePointsArc) was meant as distances from the pen, not as points (threePointsArcTo).`,
        line,
      );
    }
    return result;
  };
}

/** The classes whose methods are guarded, by their names in replicad. */
const GUARDED = [
  "BaseSketcher2d",
  "DrawingPen",
  "Sketcher",
  "Drawing",
  "Blueprint",
  "Blueprints",
  "CompoundBlueprint",
  "Sketch",
  "Sketches",
  "CompoundSketch",
  "Shape",
  "_3DShape",
];

function guardClass(kernel: Kernel, prototype: Record<string, unknown>): void {
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === "constructor" || name.startsWith("_")) continue;
    if ((OPERATIONS as string[]).includes(name)) continue;
    // A getter (`boundingBox`, `edges`) is not a call: leave it.
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (typeof descriptor?.value !== "function") continue;
    const twin = `${name}To`;
    prototype[name] = guard(
      kernel,
      name,
      descriptor.value as Method,
      typeof prototype[twin] === "function" ? twin : undefined,
    );
  }
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
  const classes = kernel.replicad as unknown as Record<
    string,
    { prototype?: Record<string, unknown> } | undefined
  >;
  for (const name of GUARDED) {
    const guarded = classes[name]?.prototype;
    if (guarded) guardClass(kernel, guarded);
  }
}
