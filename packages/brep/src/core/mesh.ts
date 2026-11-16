// The model as a View draws it: triangles for the faces, line segments for
// the edges, packed small enough to travel in a tool result.
//
// A View cannot run the kernel, so the mesh is made where the model is built
// and carried in `result.data`. As JSON numbers the enclosure in the tests is
// 640 kB; here it is about 110 kB: positions are 16-bit steps across the
// bounding box (under 0.002 mm on a 100 mm part, and this mesh is for looking
// at: the STL and STEP files are the model), normals are signed bytes, and
// everything is base64.
//
// Pure and browser-safe: Node encodes, the View decodes. Typed arrays are
// read in the platform's byte order, which is little-endian on every platform
// a host runs on.

export interface BrepMesh {
  /** The corners of the box the positions and edges are quantised in, mm. */
  min: [number, number, number];
  max: [number, number, number];
  /** base64 of Uint16 x y z per vertex. */
  positions: string;
  /** base64 of Int8 x y z per vertex. */
  normals: string;
  /** base64 of Uint16 per index, or Uint32 when `wideIndices`. */
  indices: string;
  /** Set when the mesh has more than 65 535 vertices. */
  wideIndices?: true;
  /** base64 of Uint16 x y z per point, two points per segment. */
  edges: string;
}

/** What the kernel hands over: flat arrays of numbers. */
export interface RawMesh {
  vertices: ArrayLike<number>;
  normals: ArrayLike<number>;
  triangles: ArrayLike<number>;
  /** x y z per point, two points per segment. */
  lines: ArrayLike<number>;
}

export interface DecodedMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  edges: Float32Array;
}

const STEPS = 65535;
const CHUNK = 0x8000;

function toBase64(view: ArrayBufferView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  return btoa(binary);
}

function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

type Triple = [number, number, number];

function boundsOf(...arrays: ArrayLike<number>[]): {
  min: Triple;
  max: Triple;
} {
  const min: Triple = [Infinity, Infinity, Infinity];
  const max: Triple = [-Infinity, -Infinity, -Infinity];
  for (const values of arrays)
    for (let i = 0; i < values.length; i++) {
      const axis = (i % 3) as 0 | 1 | 2;
      const value = values[i] ?? 0;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  for (const axis of [0, 1, 2] as const)
    if (!Number.isFinite(min[axis])) {
      min[axis] = 0;
      max[axis] = 0;
    }
  return { min, max };
}

function quantise(
  values: ArrayLike<number>,
  min: Triple,
  max: Triple,
): Uint16Array {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const axis = (i % 3) as 0 | 1 | 2;
    const span = max[axis] - min[axis];
    out[i] =
      span > 0
        ? Math.round((((values[i] ?? 0) - min[axis]) / span) * STEPS)
        : 0;
  }
  return out;
}

function restore(steps: Uint16Array, min: Triple, max: Triple): Float32Array {
  const out = new Float32Array(steps.length);
  for (let i = 0; i < steps.length; i++) {
    const axis = (i % 3) as 0 | 1 | 2;
    out[i] = min[axis] + ((steps[i] ?? 0) / STEPS) * (max[axis] - min[axis]);
  }
  return out;
}

export function encodeMesh(raw: RawMesh): BrepMesh {
  const { min, max } = boundsOf(raw.vertices, raw.lines);
  const normals = new Int8Array(raw.normals.length);
  for (let i = 0; i < normals.length; i++)
    normals[i] = Math.max(
      -127,
      Math.min(127, Math.round((raw.normals[i] ?? 0) * 127)),
    );
  const wide = raw.vertices.length / 3 > STEPS;
  const indices = wide
    ? Uint32Array.from(raw.triangles)
    : Uint16Array.from(raw.triangles);
  return {
    min,
    max,
    positions: toBase64(quantise(raw.vertices, min, max)),
    normals: toBase64(normals),
    indices: toBase64(indices),
    ...(wide ? { wideIndices: true as const } : {}),
    edges: toBase64(quantise(raw.lines, min, max)),
  };
}

export function decodeMesh(mesh: BrepMesh): DecodedMesh {
  const bytes = new Int8Array(fromBase64(mesh.normals));
  const normals = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) normals[i] = (bytes[i] ?? 0) / 127;
  const indexBuffer = fromBase64(mesh.indices);
  return {
    positions: restore(
      new Uint16Array(fromBase64(mesh.positions)),
      mesh.min,
      mesh.max,
    ),
    normals,
    indices: mesh.wideIndices
      ? new Uint32Array(indexBuffer)
      : new Uint16Array(indexBuffer),
    edges: restore(new Uint16Array(fromBase64(mesh.edges)), mesh.min, mesh.max),
  };
}

const isTriple = (value: unknown): value is Triple =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((item) => typeof item === "number" && Number.isFinite(item));

/** True for a mesh a View can decode: a result kept from an earlier version,
 *  or one a host rewrote, is data like any other. */
export function isBrepMesh(value: unknown): value is BrepMesh {
  if (typeof value !== "object" || value === null) return false;
  const mesh = value as Record<string, unknown>;
  return (
    isTriple(mesh.min) &&
    isTriple(mesh.max) &&
    typeof mesh.positions === "string" &&
    typeof mesh.normals === "string" &&
    typeof mesh.indices === "string" &&
    typeof mesh.edges === "string"
  );
}
