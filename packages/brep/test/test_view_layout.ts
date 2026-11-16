// The View's layout rules, found in MulmoChat, which mounts a View in a box
// that clips (`overflow-hidden`), with 36 plugin stylesheets loaded:
//
// - the View fills that box and does not overflow it: the model at the height
//   the user drags it to, and everything else scrolling below;
// - none of it is a width-dependent Tailwind variant. `@3xl:flex-row` over
//   `flex-col` lost to the `flex-col` every later stylesheet declares again:
//   the model's box collapsed and the report ran over the script.
//
// Read from the source: there is no browser in these tests. The behaviour was
// checked in headless Chromium at several pane sizes, with MulmoChat's other
// stylesheets loaded after this package's. The arithmetic of the height is in
// `test_split.ts`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const view = readFileSync(
  join(import.meta.dirname, "..", "src", "vue", "View.vue"),
  "utf8",
);
const template = /<template>([\s\S]*)<\/template>/.exec(view)?.[1] ?? "";
const style = /<style scoped>([\s\S]*)<\/style>/.exec(view)?.[1] ?? "";

/** The declarations of the first rule for `selector`. */
const rule = (selector: string): string => {
  const body = new RegExp(`\\${selector} \\{([^}]*)\\}`).exec(style)?.[1];
  assert.ok(body, `no rule for ${selector}`);
  return body;
};

/** The opening tag that carries `name` among its classes. */
const tag = (name: string): string => {
  const found = new RegExp(`<\\w+[^>]*class="${name}[ "][^>]*>`).exec(template);
  assert.ok(found, `${name} is not in the template`);
  return found[0];
};

describe("the View's layout", () => {
  it("is this component's own CSS, which no utility class outranks", () => {
    assert.ok(style, "View.vue has no <style scoped> block");
    assert.doesNotMatch(style, /@layer/);
    for (const name of ["brep-view", "brep-model", "brep-bar", "brep-below"])
      tag(name);
  });

  it("uses no width-dependent Tailwind variant", () => {
    const variants = template.match(/(?<=[\s"'])@?\w+:[\w[@-]/g) ?? [];
    // `hover:` outranks a plain class by its pseudo-class and is safe.
    assert.deepEqual(
      variants.filter((variant) => !variant.startsWith("hover:")),
      [],
    );
  });

  it("fills the host's box and overflows nowhere but below the bar", () => {
    const root = rule(".brep-view");
    assert.match(root, /height: 100%/);
    assert.match(root, /overflow: hidden/);
    assert.match(root, /flex-direction: column/);
  });

  it("scrolls what is below the bar, in the height that is left", () => {
    const below = rule(".brep-below");
    assert.match(below, /overflow-y: auto/);
    assert.match(below, /min-height: 0/);
    assert.match(below, /flex: 1 1 0%/);
    // The report and the script are inside it.
    const inside = template.slice(template.indexOf('class="brep-below"'));
    assert.match(inside, /data-testid="brep-report"/);
    assert.match(inside, /data-testid="brep-script"/);
  });

  it("gives the model the user's height, which a flex column cannot shrink", () => {
    assert.match(rule(".brep-model"), /flex: none/);
    assert.match(tag("brep-model"), /:style="\{ height: `\$\{height\}px` \}"/);
  });

  it("has a bar that drags by pointer and moves by key", () => {
    const bar = tag("brep-bar");
    for (const handler of [
      "@pointerdown",
      "@pointermove",
      "@pointerup",
      "@keydown",
    ])
      assert.ok(bar.includes(handler), `the bar has no ${handler}`);
    assert.match(bar, /role="separator"/);
    assert.match(bar, /tabindex="0"/);
    assert.match(rule(".brep-bar"), /touch-action: none/);
    assert.match(rule(".brep-bar"), /flex: none/);
  });

  it("fits a standard view again when its box changes size", () => {
    // The first fit is made before the box has a size, with an aspect of 1:
    // in a narrow pane the model was cut off until a view button was pressed.
    const resize = /function resize\(\): void \{([\s\S]*?)\n\}/.exec(view)?.[1];
    assert.ok(resize, "View.vue has no resize()");
    assert.match(
      resize,
      /if \(activeView\.value\) lookFrom\(activeView\.value\)/,
    );
  });
});
