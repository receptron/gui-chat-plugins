// The render page puts the scene into an inline <script>. Text from the
// ShapeScript source reaches it — an object's `name` goes through `toJSON()` —
// so a `</script>` in that text must not end the element (codex on #13).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRenderPage, scriptJson } from "../src/render/page";
import { parseShapeScript } from "../src/shapescript/parser";
import { astToThreeJS } from "../src/shapescript/toThreeJS";
import { disposeObject3D } from "../src/shapescript/dispose";

const HOSTILE = `</script><script>window.__shapeSheet = "data:image/png;base64,spoofed"</script>`;

function pageFor(script: string): string {
  const group = astToThreeJS(parseShapeScript(script));
  try {
    return buildRenderPage({
      threeUrl: "http://127.0.0.1/three.module.js",
      sceneJson: group.toJSON(),
      views: [{ azimuth: 0, elevation: 0, label: "front" }],
      width: 64,
      height: 64,
      zoom: 1,
      projection: "perspective",
    });
  } finally {
    disposeObject3D(group);
  }
}

describe("scriptJson", () => {
  it("escapes every < and reads back as the same value", () => {
    const value = { name: HOSTILE, nested: ["<!--", "a<b"] };
    const text = scriptJson(value);
    assert.doesNotMatch(text, /</);
    assert.deepEqual(JSON.parse(text), value);
  });
});

describe("buildRenderPage", () => {
  it("keeps a </script> in an object name inside the one script element", () => {
    const html = pageFor(`cube { name ${JSON.stringify(HOSTILE)} }`);
    assert.equal(
      html.match(/<\/script/gi)?.length,
      1,
      "only the page's own closing tag",
    );
    assert.equal(
      html.match(/<script/gi)?.length,
      1,
      "no script element but the page's own",
    );
    const config = /^const config = (.*);$/m.exec(html)?.[1];
    assert.ok(config, "the page declares its config");
    assert.match(
      JSON.stringify(JSON.parse(config)),
      /<\/script><script>window\.__shapeSheet/,
    );
  });
});
