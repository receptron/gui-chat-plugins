// What a plugin's build leaves to the consumer, and what its source imports —
// the two halves every "this dependency must not be bundled" test compares.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import typescript from "typescript";
import { loadConfigFromFile } from "vite";

export type External = string | RegExp;

/** Rollup's rule for a list of externals: a string matches exactly, a RegExp by test. */
export function isExternal(id: string, list: readonly External[]): boolean {
  return list.some((entry) =>
    typeof entry === "string" ? entry === id : entry.test(id),
  );
}

/** Every module specifier a source text names — static, re-export, side-effect,
 *  dynamic, `import type` — read by TypeScript's own scanner, so strings and
 *  comments never count. */
export function importSpecifiersIn(text: string): string[] {
  return typescript
    .preProcessFile(text, true, true)
    .importedFiles.map((file) => file.fileName);
}

/** Source files under `dir` whose name ends with one of `extensions`, `.d.ts` excluded. */
export function sourceFiles(
  dir: string,
  extensions: readonly string[],
): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, extensions);
    const wanted =
      extensions.some((extension) => entry.name.endsWith(extension)) &&
      !entry.name.endsWith(".d.ts");
    return wanted ? [path] : [];
  });
}

/** The `external` list of a package's `vite.config.ts`, loaded the way `vite build`
 *  loads it — the configs use `__dirname`, which only Vite's loader defines in an
 *  ESM package. */
export async function buildExternals(packageDir: string): Promise<External[]> {
  const loaded = await loadConfigFromFile(
    { command: "build", mode: "production" },
    join(packageDir, "vite.config.ts"),
    packageDir,
    "silent",
  );
  const external = loaded?.config.build?.rollupOptions?.external;
  if (!Array.isArray(external))
    throw new Error(
      `${packageDir}/vite.config.ts must declare build.rollupOptions.external as a list`,
    );
  return external.filter(
    (entry): entry is External =>
      typeof entry === "string" || entry instanceof RegExp,
  );
}
