// Where a model's files live: `artifacts/brep/`, flat, the script and its
// exports side by side under one name. No `node:*` here: the paths are the
// host's `files.artifacts` keys, joined with `/` on every OS.

import { ARTIFACTS_ROOT } from "gui-chat-protocol";
import {
  buildArtifactRelPath,
  hasUnsafePathSegment,
  toWorkspaceArtifactPath,
} from "@gui-chat-plugin/common";
import type { BrepFiles } from "./types";

const BREP_DIR = "brep";

/** A model's script. Not `.brep`, which is OpenCascade's own file format. */
export const SCRIPT_EXTENSION = ".replicad.js";

const EXPORT_EXTENSIONS = {
  step: ".step",
  stl: ".stl",
  views: ".svg",
} as const;

function randomToken(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** A fresh path for a new script, relative to the artifacts root. The token
 *  is what makes it fresh: two calls with one title in one millisecond would
 *  otherwise mint the same name, and the second write replace the first. */
export function newScriptRelPath(
  title: string | undefined,
  now: Date = new Date(),
  token: string = randomToken(),
): string {
  return buildArtifactRelPath({
    dir: BREP_DIR,
    title,
    ext: SCRIPT_EXTENSION,
    fallback: "model",
    now,
    partitioned: false,
    suffix: token,
  });
}

/** `artifacts/brep/x.replicad.js` -> `brep/x.replicad.js`, or undefined for a
 *  path that is not one of this plugin's scripts: outside `artifacts/brep/`,
 *  another extension, or with a `.` / `..` / empty segment. */
export function scriptRelPathOf(filePath: string): string | undefined {
  const prefix = `${ARTIFACTS_ROOT}/${BREP_DIR}/`;
  if (!filePath.startsWith(prefix)) return undefined;
  if (!filePath.endsWith(SCRIPT_EXTENSION)) return undefined;
  if (hasUnsafePathSegment(filePath)) return undefined;
  if (filePath.length === prefix.length + SCRIPT_EXTENSION.length)
    return undefined;
  return filePath.slice(ARTIFACTS_ROOT.length + 1);
}

/** The script's path and its exports', relative to the artifacts root. */
export function relPathsFor(scriptRelPath: string): BrepFiles {
  const stem = scriptRelPath.slice(0, -SCRIPT_EXTENSION.length);
  return {
    script: scriptRelPath,
    step: `${stem}${EXPORT_EXTENSIONS.step}`,
    stl: `${stem}${EXPORT_EXTENSIONS.stl}`,
    views: `${stem}${EXPORT_EXTENSIONS.views}`,
  };
}

/** The same four paths as the user and the model see them. */
export function workspacePathsFor(scriptRelPath: string): BrepFiles {
  const rel = relPathsFor(scriptRelPath);
  return {
    script: toWorkspaceArtifactPath(rel.script),
    step: toWorkspaceArtifactPath(rel.step),
    stl: toWorkspaceArtifactPath(rel.stl),
    views: toWorkspaceArtifactPath(rel.views),
  };
}
