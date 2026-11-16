// The height of the 3D view: the user drags the bar under it, and whatever
// they ask for, both the model and the part that scrolls stay on screen. In
// MulmoChat a short window left one of them with no room at all.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SHARE,
  MIN_BELOW,
  MIN_MODEL,
  modelHeight,
} from "../src/vue/split";

describe("the model's height", () => {
  it("is a share of the pane until the user moves the bar", () => {
    assert.equal(modelHeight(null, 1000), 1000 * DEFAULT_SHARE);
  });

  it("is what the user asked for, when it fits", () => {
    assert.equal(modelHeight(250, 800), 250);
  });

  it("leaves room below, however far down the bar is dragged", () => {
    assert.equal(modelHeight(5000, 800), 800 - MIN_BELOW);
  });

  it("keeps the model, however far up the bar is dragged", () => {
    assert.equal(modelHeight(-40, 800), MIN_MODEL);
    assert.equal(modelHeight(0, 800), MIN_MODEL);
  });

  it("follows a pane that got shorter than the height it was given", () => {
    assert.equal(modelHeight(600, 400), 400 - MIN_BELOW);
  });

  it("halves a pane too short for both, so neither disappears", () => {
    const available = MIN_MODEL + MIN_BELOW - 40;
    assert.equal(modelHeight(null, available), available / 2);
    assert.equal(modelHeight(600, available), available / 2);
  });

  it("never exceeds the pane", () => {
    for (const available of [1, 50, 167, 168, 169, 300, 2000])
      for (const wanted of [null, -1, 0, 100, 1e6]) {
        const height = modelHeight(wanted, available);
        assert.ok(height > 0, `${wanted} in ${available}: ${height}`);
        assert.ok(height < available || available === 1);
      }
  });

  it("is nothing before the pane has been measured", () => {
    assert.equal(modelHeight(null, 0), 0);
    assert.equal(modelHeight(300, -12), 0);
    assert.equal(modelHeight(300, Number.NaN), 0);
  });

  it("ignores a height that is not a number", () => {
    assert.equal(modelHeight(Number.NaN, 1000), 1000 * DEFAULT_SHARE);
  });
});
