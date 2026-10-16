// A picture from the web (presentSlide's imageUrl): fetched by execute() and
// shown as a data: URL, so the slide's policy (img-src data: blob:) stays as
// it is and the slide still can't send anything out in an image URL.
//
// execute() runs wherever the host runs it. In MulmoGlass that is the page,
// where a site that doesn't allow CORS can't be read. In MulmoChat it is the
// server, which then fetches a URL the model chose, and the model may have
// read a page written to steer it: only https, no IP addresses, no local
// names, every redirect checked the same way, a timeout and a size limit,
// and only bytes that are a PNG, JPEG, GIF or WebP picture. A public name
// that resolves to a private address isn't caught (that needs DNS, which a
// page can't do); what comes back from it is shown only if it is a picture.
//
// Saved as the host's own pictures are (MulmoChat's imageStore):
// artifacts/images/<YYYY>/<MM>/<16 hex>.<ext>, so a movie of the slideshow,
// or the next guide step drawn from it, can use it.
import type { FileOps } from "gui-chat-protocol";

export const WEB_IMAGE_TIMEOUT_MS = 10_000;
export const MAX_WEB_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const IMAGES_DIR = "images";
const ARTIFACTS_PREFIX = "artifacts/";

/** Why a URL isn't one to fetch, or null when it is. */
export function webImageUrlProblem(url: URL): string | null {
  if (url.protocol !== "https:") return "only https URLs are fetched";
  if (url.username || url.password)
    return "a URL with a password isn't fetched";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // The URL parser writes every IPv4 form (2130706433, 0x7f.1) as a dotted
  // quad, and an IPv6 address in brackets. A picture's URL names its site.
  if (host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return "a URL with an IP address isn't fetched";
  }
  if (
    !host.includes(".") ||
    /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)
  ) {
    return "a URL on a local network isn't fetched";
  }
  return null;
}

const startsWith = (bytes: Uint8Array, prefix: number[], at = 0) =>
  prefix.every((byte, i) => bytes[at + i] === byte);

/** The picture's type and file extension from its first bytes: the server's
 *  Content-Type isn't trusted. */
export function webImageType(
  bytes: Uint8Array,
): { mime: string; extension: string } | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", extension: "png" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { mime: "image/gif", extension: "gif" };
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { mime: "image/webp", extension: "webp" };
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** The body, or null past the size limit (read no further). */
async function readLimited(response: Response): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_WEB_IMAGE_BYTES) return null;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > MAX_WEB_IMAGE_BYTES ? null : bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_WEB_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** The response at `address`, following redirects only to URLs that may be
 *  fetched too. */
async function fetchChecked(
  address: string,
  signal: AbortSignal,
): Promise<Response | string> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "it isn't a URL";
  }
  for (let hops = 0; ; hops++) {
    const problem = webImageUrlProblem(url);
    if (problem) return problem;
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    // A browser doesn't show a redirect's target (an opaque redirect): it
    // follows it itself. There, the page fetches what an <img> would.
    if (response.type === "opaqueredirect") {
      return fetch(url, {
        signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    }
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return response;
    }
    if (hops >= MAX_REDIRECTS) return "it redirects too many times";
    url = new URL(location, url);
  }
}

/** A picture from the web, saved under artifacts/images/ when the host has
 *  files, or why it couldn't be fetched. */
export async function fetchWebImage(
  address: string,
  artifacts: FileOps | undefined,
): Promise<{ imageData: string; imagePath?: string } | { error: string }> {
  let bytes: Uint8Array | null;
  try {
    const response = await fetchChecked(
      address,
      AbortSignal.timeout(WEB_IMAGE_TIMEOUT_MS),
    );
    if (typeof response === "string") return { error: response };
    if (!response.ok) return { error: `the site answered ${response.status}` };
    bytes = await readLimited(response);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // A browser says only "Failed to fetch" when the site doesn't allow CORS.
    return { error: `it couldn't be fetched (${reason})` };
  }
  if (!bytes) {
    return {
      error: `it is larger than ${MAX_WEB_IMAGE_BYTES / 1024 / 1024} MB`,
    };
  }
  const type = webImageType(bytes);
  if (!type) return { error: "it isn't a PNG, JPEG, GIF or WebP picture" };
  const imageData = `data:${type.mime};base64,${toBase64(bytes)}`;
  if (!artifacts) return { imageData };
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const rel = `${IMAGES_DIR}/${now.getUTCFullYear()}/${month}/${id}.${type.extension}`;
  try {
    await artifacts.write(rel, bytes);
    return { imageData, imagePath: `${ARTIFACTS_PREFIX}${rel}` };
  } catch {
    // Shown, just not saved.
    return { imageData };
  }
}
