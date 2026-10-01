// Which three specifiers the build leaves to the consumer. Exactly the bare
// `three` must be external: bundling it again gives a host that draws with its
// own three a second copy, and externalising `three-bvh-csg` (no `exports`, so
// Node loads its UMD build, which requires three.cjs) splits three in Node.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildExternals,
  importSpecifiersIn,
  isExternal,
  sourceFiles,
} from "./pluginExternals";

const PACKAGE_DIR = join(import.meta.dirname, "..");

function threeSpecifiersInSource(): string[] {
  const found = sourceFiles(join(PACKAGE_DIR, "src"), [".ts", ".vue"]).flatMap(
    (file) =>
      importSpecifiersIn(readFileSync(file, "utf8")).filter((specifier) =>
        specifier.startsWith("three"),
      ),
  );
  return [...new Set(found)].sort();
}

describe("build externals", () => {
  it("leaves the bare three to the consumer", async () => {
    assert.equal(isExternal("three", await buildExternals(PACKAGE_DIR)), true);
  });

  it("bundles every other three specifier the source imports", async () => {
    const list = await buildExternals(PACKAGE_DIR);
    const specifiers = threeSpecifiersInSource();
    assert.ok(
      specifiers.includes("three-bvh-csg"),
      "the scan must see the CSG helper, or this test checks nothing",
    );
    assert.ok(
      specifiers.some((specifier) => specifier.startsWith("three/examples/")),
      "the scan must see a three/examples module, or this test checks nothing",
    );
    const wronglyExternal = specifiers.filter(
      (specifier) => specifier !== "three" && isExternal(specifier, list),
    );
    assert.deepEqual(wronglyExternal, []);
  });

  it("bundles three-mesh-bvh, which the source never names but the CSG helper imports", async () => {
    assert.equal(
      isExternal("three-mesh-bvh", await buildExternals(PACKAGE_DIR)),
      false,
    );
  });
});
