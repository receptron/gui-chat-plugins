// Running a model's script.
//
// The script is JavaScript in replicad Studio's form: `replicad` is in scope,
// and it defines `main()`, which returns the solid. It is compiled as a
// function body, so `import` and `export` are syntax errors, reported with
// what to write instead.
//
// THIS IS NOT A SANDBOX. The script runs in the host's process and realm (a
// separate realm breaks replicad, which tells arrays from objects with
// `instanceof`), and can reach everything the host's own code can. It is for
// hosts whose model can already run code on the machine. The time limit stops
// a script that loops; it is not a defence.

import { Script, compileFunction } from "node:vm";
import type { AnyShape, Shape3D } from "replicad";
import {
  BrepError,
  SCRIPT_FILENAME,
  describeThrown,
  scriptLineOf,
} from "./errors";
import type { Kernel } from "./load";

/** A solid `main` returned, with the name it was given, if any. */
export interface ModelPart {
  shape: Shape3D;
  name?: string;
}

const MODULE_HINT =
  " A model script is not a module: write `const { draw, makeCylinder } = replicad;` in place of an import, and define `main` without `export`.";

type Main = () => unknown;

function compile(script: string): (replicad: unknown) => Main | undefined {
  try {
    return compileFunction(
      `${script}\n;return typeof main === "function" ? main : undefined;`,
      ["replicad"],
      { filename: SCRIPT_FILENAME },
    ) as (replicad: unknown) => Main | undefined;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const stack = cause instanceof Error ? cause.stack : undefined;
    const moduleSyntax = /\b(import|export)\b/.test(message);
    throw new BrepError(
      "SYNTAX_ERROR",
      `${message}.${moduleSyntax ? MODULE_HINT : ""}`,
      scriptLineOf(stack),
    );
  }
}

let runs = 0;

/** Call `run` under V8's time limit, which a plain function call cannot
 *  have: it is reached through a global a one-line Script calls. */
function withTimeLimit<T>(run: () => T, timeoutMs: number): T {
  const name = `__guiChatPluginBrepRun${++runs}`;
  const globals = globalThis as Record<string, unknown>;
  globals[name] = run;
  try {
    return new Script(`globalThis[${JSON.stringify(name)}]()`).runInThisContext(
      { timeout: timeoutMs },
    ) as T;
  } finally {
    Reflect.deleteProperty(globals, name);
  }
}

/** What `value` resolves to, or a timeout after `remainingMs`. */
async function settled(value: unknown, remainingMs: number): Promise<unknown> {
  if (!(value instanceof Promise)) return value;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT" }),
      Math.max(remainingMs, 0),
    );
  });
  try {
    return await Promise.race([value, limit]);
  } finally {
    clearTimeout(timer);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const className = (value: unknown): string =>
  isRecord(value) ? (value.constructor?.name ?? "an object") : typeof value;

/** One returned item as a part: a 3D shape, or `{ shape, name }`. */
function toPart(kernel: Kernel, item: unknown): ModelPart {
  const named = isRecord(item) && "shape" in item;
  const shape = named ? item.shape : item;
  const name = named && typeof item.name === "string" ? item.name : undefined;
  const is3D =
    isRecord(shape) &&
    "wrapped" in shape &&
    kernel.replicad.isShape3D(shape as unknown as AnyShape);
  if (!is3D)
    throw new BrepError(
      "SCRIPT_ERROR",
      `main() must return a solid, an array of solids, or { shape, name } objects; it returned ${className(shape)}. A drawing or sketch has to be extruded or revolved first.`,
    );
  return { shape: shape as unknown as Shape3D, ...(name ? { name } : {}) };
}

/** Run the script and return the parts `main` built. Throws `BrepError`. */
export async function runScript(
  kernel: Kernel,
  script: string,
  timeoutMs: number,
): Promise<ModelPart[]> {
  const define = compile(script);
  let returned: unknown;
  try {
    const started = Date.now();
    const result = withTimeLimit(() => {
      const main = define(kernel.replicad);
      if (!main)
        throw new BrepError(
          "SCRIPT_ERROR",
          "The script must define a function named `main` that returns the solid.",
        );
      return main();
    }, timeoutMs);
    // An `async main` has returned by now, with a promise V8's limit no
    // longer covers. One that never settles would hold the build queue, and
    // every build after it, for good.
    returned = await settled(result, timeoutMs - (Date.now() - started));
  } catch (cause) {
    if (cause instanceof BrepError) throw cause;
    if (isRecord(cause) && cause.code === "ERR_SCRIPT_EXECUTION_TIMEOUT")
      throw new BrepError(
        "TIMEOUT",
        `The script ran for more than ${timeoutMs / 1000} s and was stopped.`,
      );
    throw new BrepError(
      "SCRIPT_ERROR",
      describeThrown(kernel.oc, cause),
      scriptLineOf(cause instanceof Error ? cause.stack : undefined),
    );
  }
  const items = Array.isArray(returned) ? returned : [returned];
  if (items.length === 0)
    throw new BrepError("SCRIPT_ERROR", "main() returned an empty array.");
  return items.map((item) => toPart(kernel, item));
}
