// Which kind of path a caller-supplied `.shape` path is, for a host that
// offers the optional `files.byPath` capability (a source outside
// `artifacts/shapes/`). gui-chat-protocol does not define `byPath`, so this
// predicate is not upstream; it is the same rule as `classifyFilePath` in
// MulmoClaude's `@mulmoclaude/core/artifacts`, which presentDocument and
// presentHtml apply to their `path`, copied so this package imports nothing
// from a host. Change both together.

/** How a caller-supplied file path must be resolved. `null` = not a usable path. */
export type FilePathKind = "absolute" | "relative";

// `/x`, `C:\x` / `C:/x`, `\\server\share` (UNC), and the Windows root-relative
// `\dir\x` — which node's `path.resolve` on Windows sends to the drive root, so
// treating it as relative would mean the classification and the resolution
// disagreed about where the file is. Windows spellings are recognised on every
// platform: the value is produced by an LLM or a remote host, not by the local
// `path` module.
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;

/** True when `value` names a location that does not depend on a base directory.
 *  Exported so a URL builder and a path resolver cannot disagree about which
 *  values are rooted. */
export function isAbsoluteFilePathValue(value: string): boolean {
  // One leading backslash covers both the UNC `\\server\share` and the Windows
  // root-relative `\dir\x`.
  return (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    WINDOWS_DRIVE_RE.test(value)
  );
}

/**
 * Classify a caller-supplied path to a file the host may read and overwrite.
 *
 * Accepts one of `extensions` (compared case-insensitively) and rejects NUL
 * bytes and any `.` / `..` / empty segment — a relative path must be canonical
 * so it can be joined onto a root, and an absolute one must not climb, so
 * neither form can be re-pointed by traversal after the host has vetted it.
 * Returns `"absolute"` / `"relative"` so the host knows whether to resolve
 * against its workspace root, or `null` when the value is unusable.
 *
 * This is a LEXICAL check only. Existence, file-vs-directory, symlink
 * containment and any host policy about which roots are reachable stay with
 * the host, which is the only layer that can consult the filesystem.
 */
export function classifyFilePath(
  value: string,
  extensions: readonly string[],
): FilePathKind | null {
  if (!value || value.includes("\0")) return null;
  const lower = value.toLowerCase();
  if (!extensions.some((ext) => lower.endsWith(ext))) return null;
  const absolute = isAbsoluteFilePathValue(value);
  // Split on both separators: `..` must be refused however the value spells it.
  const segments = value.split(/[/\\]/);
  // A leading `/` (or drive / UNC prefix) makes the first segment empty by
  // construction — skip those, then require every remaining segment to be a
  // real name.
  const body = absolute
    ? segments.slice(segments.findIndex((segment) => segment.length > 0))
    : segments;
  if (body.length === 0) return null;
  if (
    body.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  )
    return null;
  return absolute ? "absolute" : "relative";
}
