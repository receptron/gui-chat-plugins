// The helpers that replaced the package's non-null assertions: each answers
// the value where the assertion held, and throws where it would not have.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { at, defined, triangleOf } from "../src/shapescript/at";

describe("at", () => {
  it("answers the entry at a bounded index, of arrays, tuples and typed arrays", () => {
    assert.equal(at(["a", "b"], 1), "b");
    assert.equal(at(new Float32Array([1.5, 2.5]), 0), 1.5);
    assert.equal(at([0, false, ""], 0), 0);
    assert.equal(at([0, false, ""], 1), false);
  });
  it("throws a RangeError naming the index instead of answering undefined", () => {
    assert.throws(() => at([1, 2, 3], 3), {
      name: "RangeError",
      message: "Index 3 is outside 0..2",
    });
    assert.throws(() => at([], 0), RangeError);
  });
});

describe("defined", () => {
  it("answers a present value, falsy ones included", () => {
    assert.equal(defined(0, "zero"), 0);
    assert.equal(defined("", "empty"), "");
  });
  it("throws naming what is missing", () => {
    assert.throws(() => defined(undefined, "the bounding box"), {
      message: "Internal error: the bounding box is missing",
    });
    assert.throws(() => defined(null, "the glyph"), /the glyph is missing/);
  });
});

describe("triangleOf", () => {
  it("takes the first three entries, and throws on fewer", () => {
    assert.deepEqual(triangleOf([4, 5, 6, 7]), [4, 5, 6]);
    assert.throws(() => triangleOf([1, 2]), RangeError);
  });
});
