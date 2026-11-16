// The page entry (`./vue`) must not reach the kernel. A host bundles that
// entry for the browser: one import of `core/plugin` from it would put
// `node:vm` and a 22 MB WebAssembly loader in the host's page bundle.
//
// The walk follows every import and re-export that survives compilation
// (`import type` does not) from `src/vue/index.ts`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import typescript from "typescript";

const SRC = join(import.meta.dirname, "..", "src");

/** The TypeScript of a file: a `.vue` file's script block, a `.ts` file whole. */
function scriptOf(file: string): string {
  const text = readFileSync(file, "utf8");
  if (!file.endsWith(".vue")) return text;
  return /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(text)?.[1] ?? "";
}

/** Module specifiers a file still imports at run time. */
function runtimeImports(file: string): string[] {
  const source = typescript.createSourceFile(
    file,
    scriptOf(file),
    typescript.ScriptTarget.Latest,
  );
  const found: string[] = [];
  const visit = (node: typescript.Node): void => {
    if (typescript.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes =
        clause?.isTypeOnly ||
        (clause !== undefined &&
          clause.name === undefined &&
          bindings !== undefined &&
          typescript.isNamedImports(bindings) &&
          bindings.elements.every((element) => element.isTypeOnly));
      if (!onlyTypes && typescript.isStringLiteral(node.moduleSpecifier))
        found.push(node.moduleSpecifier.text);
    } else if (
      typescript.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      typescript.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      typescript.isCallExpression(node) &&
      node.expression.kind === typescript.SyntaxKind.ImportKeyword
    ) {
      const [argument] = node.arguments;
      if (argument && typescript.isStringLiteral(argument))
        found.push(argument.text);
    }
    typescript.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function resolveLocal(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  return [base, `${base}.ts`, join(base, "index.ts")].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
}

/** Every source file and package the entry reaches at run time. */
function reach(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  for (let file = queue.pop(); file; file = queue.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of runtimeImports(file)) {
      if (!specifier.startsWith(".")) packages.add(specifier);
      else if (!specifier.endsWith(".css")) {
        const target = resolveLocal(file, specifier);
        assert.ok(target, `${specifier} from ${file} does not resolve`);
        queue.push(target);
      }
    }
  }
  return {
    files: [...files].map((file) => relative(SRC, file).split("\\").join("/")),
    packages: [...packages],
  };
}

describe("the page entry", () => {
  const { files, packages } = reach(join(SRC, "vue", "index.ts"));

  it("is walked through the View to the mesh decoder", () => {
    for (const expected of ["vue/View.vue", "vue/scene.ts", "core/mesh.ts"])
      assert.ok(files.includes(expected), `the walk never reached ${expected}`);
  });

  it("reaches no kernel module and not the executor", () => {
    assert.deepEqual(
      files.filter(
        (file) => file.startsWith("kernel/") || file === "core/plugin.ts",
      ),
      [],
    );
  });

  it("imports only what a page has", () => {
    assert.deepEqual(packages.sort(), [
      "gui-chat-protocol/vue",
      "three",
      "three/examples/jsm/controls/OrbitControls.js",
      "vue",
    ]);
  });

  it("is not what the Node entry is: that one does reach the kernel", () => {
    const node = reach(join(SRC, "index.ts"));
    assert.ok(node.files.includes("kernel/script.ts"));
    assert.ok(node.packages.includes("node:vm"));
  });
});
