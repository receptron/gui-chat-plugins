import type { FileOps, ToolContext, ToolPluginCore } from "gui-chat-protocol";
import { BrepError } from "../kernel/errors";
import { TOOL_DEFINITION } from "./definition";
import {
  SCRIPT_EXTENSION,
  newScriptRelPath,
  relPathsFor,
  scriptRelPathOf,
  workspacePathsFor,
} from "./paths";
import type {
  BrepDiagnostic,
  BrepFiles,
  PresentBrepArgs,
  PresentBrepData,
  PresentBrepResult,
} from "./types";

/** What the plugin takes from its host: `files.artifacts`, optional. Without
 *  it a model is built and checked and nothing is saved. */
export interface BrepExecuteContext extends ToolContext {
  files?: { artifacts: FileOps };
}

const BUILT_ACK =
  "Read the report against what you meant to build before telling the user it is done: the size, the face counts, and how many edges each fillet and chamfer selected. A selector that picked too many edges is not an error and shows only there. Check which side the user sees first (the message says): if the part has its back to them, turn it and build again. Then look at the drawing sheet if you can open it. Tell the user where the STEP and STL files are.";

/** Said in every result, not only in the guide: the guide's sentence about
 *  which way is front did not stop a second chair in MulmoChat from being
 *  built with its back at -Y. Here it arrives with the result the model is
 *  about to describe, and as a fact about THIS model it can check. */
const VIEW_NOTE =
  "\nShown to the user from -Y first (the 3D view and the Front drawing look from -Y toward +Y): whatever is at -Y faces them.";

const FAILED_ACK =
  "The model was not built. Correct the script using the diagnostic (the line, and what the operation had to work with) and call presentBrep again.";

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const invalid = (message: string): BrepError =>
  new BrepError("INVALID_ARGUMENT", message);

/** How many fresh names are tried before giving up: the token makes one
 *  collision unlikely, and several in a row mean something else is wrong. */
const MINT_ATTEMPTS = 5;

async function freshScriptRelPath(
  artifacts: FileOps,
  title: string,
): Promise<string> {
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    const relPath = newScriptRelPath(title);
    if (!(await artifacts.exists(relPath))) return relPath;
  }
  throw invalid(
    "Could not allocate a free path under artifacts/brep; try again with a different title",
  );
}

interface Source {
  script: string;
  /** Set for a `path` call: the script already has its place. */
  relPath?: string;
}

async function resolveSource(
  context: BrepExecuteContext,
  args: PresentBrepArgs,
): Promise<Source> {
  if (nonEmpty(args.path) && nonEmpty(args.script))
    throw invalid("Provide either `script` or `path`, not both");
  if (nonEmpty(args.path)) {
    const artifacts = context.files?.artifacts;
    if (!artifacts)
      throw invalid(
        "This host cannot open a script by path; pass the source as `script`",
      );
    const relPath = scriptRelPathOf(args.path);
    if (!relPath)
      throw invalid(
        `\`path\` must be a ${SCRIPT_EXTENSION} file under artifacts/brep/, without \`.\` or \`..\` segments`,
      );
    if (!(await artifacts.exists(relPath)))
      throw invalid(`No script exists at ${args.path}`);
    return { script: await artifacts.read(relPath), relPath };
  }
  if (!nonEmpty(args.script))
    throw invalid("A `script` or a `path` is required");
  return { script: args.script };
}

function diagnosticOf(cause: unknown): BrepDiagnostic {
  if (cause instanceof BrepError)
    return {
      code: cause.code,
      message: cause.message,
      ...(cause.line === undefined ? {} : { line: cause.line }),
      ...(cause.completed.length ? { completed: cause.completed } : {}),
    };
  // Not the script's doing: the kernel failed to load, or a write failed.
  return {
    code: "SCRIPT_ERROR",
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

function describeDiagnostic(error: BrepDiagnostic): string {
  const where = error.line === undefined ? "" : ` (line ${error.line})`;
  const before = error.completed?.length
    ? `\nBefore it:\n${error.completed.map((line) => `  ${line}`).join("\n")}`
    : "";
  return `presentBrep error${where}: ${error.message}${before}`;
}

export const presentBrep = async (
  context: BrepExecuteContext,
  args: PresentBrepArgs,
): Promise<PresentBrepResult> => {
  try {
    if (!isRecord(args))
      throw invalid("presentBrep takes an object with `script` or `path`");
    if (!nonEmpty(args.title)) throw invalid("A nonempty `title` is required");
    const host = context ?? {};
    const source = await resolveSource(host, args);

    // The kernel is loaded here, on the first build, not with the plugin.
    const { buildModel, formatReport } = await import("../kernel/index");
    const built = await buildModel(source.script);

    const artifacts = host.files?.artifacts;
    let files: BrepFiles | undefined;
    if (artifacts) {
      const relPath =
        source.relPath ?? (await freshScriptRelPath(artifacts, args.title));
      const rel = relPathsFor(relPath);
      // The script first: if an export fails to write, the source is kept.
      if (!source.relPath) await artifacts.write(rel.script, source.script);
      await artifacts.write(rel.step, built.step);
      await artifacts.write(rel.stl, built.stl);
      await artifacts.write(rel.views, built.views);
      files = workspacePathsFor(relPath);
    }

    const saved = files
      ? `\nSaved: ${files.script} (script), ${files.step}, ${files.stl}, ${files.views} (drawings).`
      : "\nNot saved: this host has no file layer.";
    const data: PresentBrepData = {
      script: source.script,
      report: built.report,
      mesh: built.mesh,
      ...(files ? { files } : {}),
    };
    return {
      message: `Built "${args.title}": ${formatReport(built.report)}${VIEW_NOTE}${saved}`,
      title: args.title,
      data,
      jsonData: { report: built.report, ...(files ? { files } : {}) },
      instructions: BUILT_ACK,
    };
  } catch (cause) {
    const error = diagnosticOf(cause);
    return {
      message: describeDiagnostic(error),
      error,
      jsonData: { error },
      instructions: FAILED_ACK,
    };
  }
};

export const pluginCore: ToolPluginCore<
  PresentBrepData,
  unknown,
  PresentBrepArgs
> = {
  toolDefinition: TOOL_DEFINITION,
  execute: presentBrep,
  generatingMessage: "Building the solid model...",
  waitingMessage:
    "Tell the user that the solid model is being built and will be shown shortly.",
  isEnabled: () => true,
};

export const executePresentBrep = presentBrep;
