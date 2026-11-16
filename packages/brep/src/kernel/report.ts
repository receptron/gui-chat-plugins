// What a finished model is made of, in numbers the model's author can check
// against what it meant to build: the size, the volume, the faces and edges by
// kind, and what each operation did.
//
// The face counts are the cheapest check there is. A part with four
// countersunk holes has four cones; sixteen means a chamfer went somewhere it
// was not meant to.

import type { AnyShape, Shape3D } from "replicad";
import type { Kernel } from "./load";
import {
  isValidShape,
  sizeOf,
  volumeOf,
  type OperationName,
  type OperationRecord,
  type Recorder,
} from "./record";
import type { ModelPart } from "./script";

/** One line of the report: the calls one script line made, added up. A loop
 *  that cuts six holes is one entry with `count: 6`. */
export interface OperationSummary {
  op: OperationName;
  line?: number;
  count: number;
  size?: number;
  /** Edges or faces picked, over all the calls. */
  selected?: number;
  /** Edges or faces the solid had at the first call. */
  available?: number;
  /** mm³ added (positive) or removed, over all the calls. */
  volumeChange?: number;
}

export interface PartReport {
  name?: string;
  volume: number;
  size: [number, number, number];
}

export interface ModelReport {
  /** mm³. */
  volume: number;
  /** mm², the whole surface. */
  area: number;
  /** Bounding box, mm: X, Y, Z. */
  size: [number, number, number];
  /** Bounding box corners, mm. */
  bounds: [[number, number, number], [number, number, number]];
  /** Separate solids. More than one in a single part means pieces that do
   *  not touch. */
  solids: number;
  /** Faces by surface kind: `{ plane: 6, cylinder: 9, cone: 5, torus: 1 }`. */
  faces: Record<string, number>;
  /** Edges by curve kind: `{ line: 21, circle: 25 }`. */
  edges: Record<string, number>;
  operations: OperationSummary[];
  warnings: string[];
  /** Present when `main` returned more than one part. */
  parts?: PartReport[];
}

const round = (value: number, digits = 2): number =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : value;

/** `CYLINDRE` -> `cylinder`, `BSPLINE_SURFACE` -> `bspline surface`. */
const kindName = (geomType: string): string =>
  geomType === "CYLINDRE"
    ? "cylinder"
    : geomType.toLowerCase().replace(/_/g, " ");

function countKinds(items: { geomType: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    let kind = "other";
    try {
      kind = kindName(item.geomType);
    } catch {
      // A degenerate face or edge the kernel cannot classify.
    }
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

function summarise(records: OperationRecord[]): OperationSummary[] {
  const summaries: OperationSummary[] = [];
  const byKey = new Map<string, OperationSummary>();
  const changes = new Map<OperationSummary, number>();
  for (const record of records) {
    const key = `${record.op}:${record.line ?? "?"}:${record.size ?? ""}`;
    let summary = byKey.get(key);
    if (!summary) {
      summary = {
        op: record.op,
        ...(record.line === undefined ? {} : { line: record.line }),
        count: 0,
        ...(record.size === undefined ? {} : { size: record.size }),
        ...(record.available === undefined
          ? {}
          : { available: record.available }),
      };
      byKey.set(key, summary);
      summaries.push(summary);
      changes.set(summary, 0);
    }
    summary.count += 1;
    if (record.selected !== undefined)
      summary.selected = (summary.selected ?? 0) + record.selected;
    const change = record.volumeAfter - record.volumeBefore;
    changes.set(summary, (changes.get(summary) ?? 0) + change);
  }
  for (const summary of summaries) {
    const change = changes.get(summary);
    if (change !== undefined && Number.isFinite(change))
      summary.volumeChange = round(change);
  }
  return summaries;
}

/** How many separate solids a shape is.
 *
 * `iterTopo` yields the kernel's own handles, which nothing frees: unlike
 * replicad's shapes they are not registered for finalization, and the kernel
 * lives as long as the host. Deleted once the count is taken, and only then:
 * the iterator compares each new solid with those it has already yielded.
 */
function countSolids(kernel: Kernel, shape: AnyShape): number {
  const solids = [...kernel.replicad.iterTopo(shape.wrapped, "solid")];
  for (const solid of solids) solid.delete();
  return solids.length;
}

function areaOf(kernel: Kernel, shape: Shape3D): number {
  try {
    return kernel.replicad.measureArea(shape);
  } catch {
    return Number.NaN;
  }
}

/** The whole model as one shape: the part itself, or a compound of them. */
export function wholeOf(kernel: Kernel, parts: ModelPart[]): Shape3D {
  const [first] = parts;
  if (parts.length === 1 && first) return first.shape;
  // Clones: `makeCompound` deletes the shapes it is given, and the parts are
  // still measured and exported one by one.
  return kernel.replicad.makeCompound(
    parts.map((part) => part.shape.clone()),
  ) as Shape3D;
}

export function buildReport(
  kernel: Kernel,
  parts: ModelPart[],
  whole: Shape3D,
  recorder: Recorder,
): ModelReport {
  const warnings = [...recorder.warnings];
  parts.forEach((part, index) => {
    const label = part.name ?? (parts.length > 1 ? `part ${index + 1}` : "");
    const subject = label ? `"${label}"` : "The model";
    if (!isValidShape(kernel, part.shape))
      warnings.push(`${subject} is not a valid solid.`);
    const solids = countSolids(kernel, part.shape);
    if (solids > 1)
      warnings.push(
        `${subject} is ${solids} separate solids: pieces that were fused do not touch. If it is one piece, make them overlap and build again; if they are separate on purpose, tell the user it is ${solids} loose pieces.`,
      );
    if (solids === 0)
      warnings.push(`${subject} is not a solid: it has no enclosed volume.`);
  });
  const box = whole.boundingBox.bounds;
  const corner = (
    point: readonly [number, number, number],
  ): [number, number, number] => [
    round(point[0], 3),
    round(point[1], 3),
    round(point[2], 3),
  ];
  return {
    volume: round(volumeOf(kernel, whole)),
    area: round(areaOf(kernel, whole)),
    size: sizeOf(whole),
    bounds: [corner(box[0]), corner(box[1])],
    solids: countSolids(kernel, whole),
    faces: countKinds(whole.faces),
    edges: countKinds(whole.edges),
    operations: summarise(recorder.operations),
    warnings,
    ...(parts.length > 1
      ? {
          parts: parts.map((part) => ({
            ...(part.name ? { name: part.name } : {}),
            volume: round(volumeOf(kernel, part.shape)),
            size: sizeOf(part.shape),
          })),
        }
      : {}),
  };
}

const PICKED: Partial<Record<OperationName, string>> = {
  fillet: "edges",
  chamfer: "edges",
  shell: "faces",
};

const formatKinds = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(", ");

const signed = (value: number): string => `${value > 0 ? "+" : ""}${value} mm3`;

function formatOperation(operation: OperationSummary): string {
  const where = operation.line === undefined ? "" : `line ${operation.line}: `;
  const size = operation.size === undefined ? "" : `${operation.size}`;
  const times = operation.count > 1 ? ` x${operation.count}` : "";
  const what = PICKED[operation.op];
  const picked =
    what && operation.selected !== undefined
      ? ` selected ${operation.selected}${operation.count === 1 && operation.available !== undefined ? ` of ${operation.available}` : ""} ${what},`
      : "";
  const change =
    operation.volumeChange === undefined
      ? ""
      : ` volume ${signed(operation.volumeChange)}`;
  return `  ${where}${operation.op}(${size})${times}${picked}${change}`;
}

/** The operations a build got through, one line each: what an error result
 *  shows of the work before the failure. */
export const formatOperations = (records: OperationRecord[]): string[] =>
  summarise(records).map((operation) => formatOperation(operation).trim());

/** The report as the text the model reads. */
export function formatReport(report: ModelReport): string {
  const lines = [
    `${report.size.join(" x ")} mm, volume ${report.volume} mm3, surface ${report.area} mm2, ${report.solids} solid${report.solids === 1 ? "" : "s"}.`,
  ];
  // First, as in the View: after two dozen lines of operations a model in
  // MulmoChat read past three warnings and told the user the train was done.
  if (report.warnings.length)
    lines.push(
      `Warnings (${report.warnings.length}):`,
      ...report.warnings.map((w) => `  ${w}`),
    );
  lines.push(
    `Faces: ${formatKinds(report.faces)}.`,
    `Edges: ${formatKinds(report.edges)}.`,
  );
  if (report.parts)
    lines.push(
      "Parts: " +
        report.parts
          .map(
            (part, index) =>
              `${part.name ?? `part ${index + 1}`} ${part.size.join(" x ")} mm, ${part.volume} mm3`,
          )
          .join("; ") +
        ".",
    );
  if (report.operations.length)
    lines.push("Operations:", ...report.operations.map(formatOperation));
  return lines.join("\n");
}
