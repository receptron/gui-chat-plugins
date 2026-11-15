// A file's bytes, packed to travel in a tool result: gzip, then base64.
//
// The View offers the exports as downloads, and a host owes a View no way to
// read a file, so they travel in `result.data` beside the mesh. A chair's
// STEP, STL and drawings are about 800 kB as written and about 220 kB like
// this.
//
// `CompressionStream` and `DecompressionStream` are in Node 18+ and in every
// current browser, so this one file serves the build (Node) and the View.

const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function through(
  bytes: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Text (as UTF-8) or bytes, gzipped and base64-encoded. */
export async function pack(content: string | Uint8Array): Promise<string> {
  const bytes =
    typeof content === "string"
      ? new TextEncoder().encode(content)
      : new Uint8Array(content);
  return toBase64(await through(bytes, new CompressionStream("gzip")));
}

/** The bytes `pack` was given. Rejects for text that `pack` did not make. */
export function unpack(packed: string): Promise<Uint8Array<ArrayBuffer>> {
  return through(fromBase64(packed), new DecompressionStream("gzip"));
}
