// What a build can fail with, and how a thrown value becomes a sentence.
//
// The kernel throws `WebAssembly.Exception`: no `message`, no `stack`. Left
// alone it reaches the model as "[object WebAssembly.Exception]", which says
// neither what failed nor where. `describeThrown` asks the kernel for the
// exception's class and text; the operation wrappers (`record.ts`) add the
// operation, its line and the sizes involved.

import type { OpenCascadeInstance } from "replicad-opencascadejs";

export type BrepErrorCode =
  /** The arguments, or a `path` this plugin does not own. */
  | "INVALID_ARGUMENT"
  /** The script does not compile. */
  | "SYNTAX_ERROR"
  /** The script threw, or `main` is missing or returned something unusable. */
  | "SCRIPT_ERROR"
  /** A modelling operation failed in the kernel. */
  | "OPERATION_FAILED"
  /** An operation returned, but its result is not a valid solid. */
  | "INVALID_RESULT"
  /** The script ran past the time limit. */
  | "TIMEOUT";

export class BrepError extends Error {
  readonly code: BrepErrorCode;
  /** 1-based line of the script, where one is known. */
  readonly line: number | undefined;
  /** What the operations before the failure did, as the report lists them:
   *  set by the build, for an error raised while the script ran. */
  completed: string[] = [];

  constructor(code: BrepErrorCode, message: string, line?: number) {
    super(message);
    this.name = "BrepError";
    this.code = code;
    this.line = line;
  }
}

/** The name the script is compiled under: what its frames carry in a stack. */
export const SCRIPT_FILENAME = "brep-model-script.js";

const SCRIPT_FRAME = /brep-model-script\.js:(\d+)/;

/** The script line a stack passes through, innermost first: for a helper
 *  defined in the script, the line inside the helper. */
export function scriptLineOf(stack: string | undefined): number | undefined {
  const match = stack ? SCRIPT_FRAME.exec(stack) : null;
  return match?.[1] ? Number(match[1]) : undefined;
}

/** The script line this call was made from. */
export function currentScriptLine(): number | undefined {
  return scriptLineOf(new Error().stack);
}

const isKernelException = (thrown: unknown): thrown is WebAssembly.Exception =>
  typeof WebAssembly !== "undefined" &&
  "Exception" in WebAssembly &&
  thrown instanceof WebAssembly.Exception;

/** A thrown value as text: the kernel's exception class and message for a
 *  WebAssembly exception, the message for an Error. */
export function describeThrown(
  oc: OpenCascadeInstance,
  thrown: unknown,
): string {
  if (isKernelException(thrown)) {
    try {
      const [type, message] = oc.getExceptionMessage(thrown);
      return message ? `${type}: ${message}` : type;
    } catch {
      return "the kernel raised an exception it could not describe";
    }
  }
  if (thrown instanceof Error) return thrown.message;
  return String(thrown);
}
