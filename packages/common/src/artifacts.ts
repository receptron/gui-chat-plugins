// Artifact-path builders for plugins that write under the host's shared
// `files.artifacts` area. Browser-safe by design: no node:path / no
// node:crypto, so it bundles into both a plugin's core entry (which may run on
// a server) and its Vue entry.
//
// These are POSIX artifact *wire paths* — stored in JSON and used as the
// generic `files.artifacts` FileOps keys — so they must ALWAYS join with `/`
// regardless of host OS. `path.join` would emit `\` on Windows and corrupt
// them; `path.posix.join` would drag in node:path and break the browser
// bundle. So already-sanitised segments are joined with `/` directly.

const MAX_SLUG_LEN = 120;

/** The workspace directory every artifact lives under (`<workspace>/artifacts`). */
export const ARTIFACTS_ROOT = "artifacts";

/**
 * Lowercase-ASCII slug for a throwaway, timestamped artifact filename. Empty,
 * whitespace-only, and non-ASCII-only titles fall back to `fallback`. Capped at
 * 120 chars so a long LLM title can't blow the filesystem's NAME_MAX.
 *
 * Leading/trailing hyphens are stripped with a linear scan rather than a regex
 * like `/^-+|-+$/` — CodeQL flags the trailing-anchor form as polynomial
 * backtracking on the attacker-influenced (LLM-provided) title. Strip → cap →
 * strip so a cut at the 120-char boundary can't re-expose a trailing hyphen.
 */
export function slugifyArtifact(
  title: string | undefined,
  fallback: string,
): string {
  if (!title) return fallback;
  const collapsed = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "-") start += 1;
  while (end > start && collapsed[end - 1] === "-") end -= 1;
  if (end - start > MAX_SLUG_LEN) end = start + MAX_SLUG_LEN;
  while (end > start && collapsed[end - 1] === "-") end -= 1;
  return collapsed.slice(start, end) || fallback;
}

/** UTC `YYYY/MM` partition (matches the host's #764 artifact sharding). UTC —
 *  not local — so a workspace synced across timezones stays in one bucket. */
export function yearMonthUtc(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}/${month}`;
}

export interface ArtifactRelPathParams {
  /** Artifact-kind directory under the artifacts root (e.g. `charts`, `html`, `stories`). */
  dir: string;
  /** Human title the slug is derived from; empty/non-ASCII falls back to `fallback`. */
  title: string | undefined;
  /** File extension INCLUDING the leading dot (e.g. `.html`, `.chart.json`). */
  ext: string;
  /** Slug used when `title` yields nothing (e.g. `chart`, `page`, `story`). */
  fallback: string;
  now?: Date;
  /** Include the `YYYY/MM` partition segment. Default true; stories opt out. */
  partitioned?: boolean;
  /** Extra token appended after the timestamp, for callers that cannot accept a
   *  same-millisecond collision (see the note on `buildArtifactRelPath`). */
  suffix?: string;
}

/**
 * FileOps-relative artifact path: `<dir>[/YYYY/MM]/<slug>-<epochMs>[-<suffix>]<ext>`.
 * This is what `files.artifacts.write` takes; prefix it with
 * `toWorkspaceArtifactPath` for the workspace-relative form shown to the LLM.
 *
 * `<epochMs>` alone separates paths built at different times, but NOT two calls
 * with the same title inside one millisecond — those produce the same name, and
 * the second write silently replaces the first artifact. Pass `suffix` (a short
 * random token, as `shapeArtifactPath` does) wherever concurrent callers can
 * share a title.
 */
export function buildArtifactRelPath(params: ArtifactRelPathParams): string {
  const {
    dir,
    title,
    ext,
    fallback,
    now = new Date(),
    partitioned = true,
    suffix,
  } = params;
  const stamp = suffix ? `${now.getTime()}-${suffix}` : `${now.getTime()}`;
  const fileName = `${slugifyArtifact(title, fallback)}-${stamp}${ext}`;
  const segments = partitioned
    ? [dir, yearMonthUtc(now), fileName]
    : [dir, fileName];
  return segments.join("/");
}

/** Prefix a FileOps-relative artifact path with the workspace `artifacts/` root. */
export function toWorkspaceArtifactPath(relPath: string): string {
  return `${ARTIFACTS_ROOT}/${relPath}`;
}

/**
 * True when any `/` or `\`-separated segment of `value` is empty (`//`,
 * leading/trailing slash), `.`, or `..`. The lexical traversal / non-canonical
 * guard every artifact path check shares — so a workspace-escape judgement
 * can't drift between plugins.
 *
 * Both separators, matching `classifyFilePath`: an artifact path is minted from
 * a slug and so never contains a backslash, while `node:path` on Windows treats
 * one as a separator. Splitting on `/` alone accepted
 * `artifacts/shapes/..\..\secrets.shape` — canonical to this check, traversal
 * to `path.join` (codex on #3056).
 */
export function hasUnsafePathSegment(value: string): boolean {
  return value
    .split(/[/\\]/)
    .some((seg) => seg === "" || seg === "." || seg === "..");
}
