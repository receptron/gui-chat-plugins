// The render page puts the scene into an inline <script>. Text from the
// ShapeScript source reaches it — an object's `name` goes through `toJSON()` —
// so a `</script>` in that text must not end the element (codex on #13).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildRenderPage,
  FRAMING_SOURCE,
  scriptJson,
} from "../src/render/page";
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

type Framing = (
  radius: number,
  zoom: number,
  aspect: number,
) => { distance: number; halfHeight: number };

/** The page's own framing function, evaluated from the same source. */
const framing = new Function(`${FRAMING_SOURCE}; return framing;`)() as Framing;

/** Project the sphere's silhouette edge along both screen axes, from a camera
 *  built as the page builds it, and answer the largest |NDC| reached. */
function largestNdc(
  projection: "perspective" | "orthographic",
  width: number,
  height: number,
): number {
  const radius = 1;
  const aspect = width / height;
  const { distance, halfHeight } = framing(radius, 1, aspect);
  const camera =
    projection === "orthographic"
      ? new THREE.OrthographicCamera(
          -halfHeight * aspect,
          halfHeight * aspect,
          halfHeight,
          -halfHeight,
          0.01,
          distance + radius * 10,
        )
      : new THREE.PerspectiveCamera(35, aspect, 0.01, distance + radius * 10);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  // The silhouette of a sphere seen from `distance`: the tangent points are
  // the widest the sphere reaches on screen. For the orthographic camera the
  // equator is.
  const tangent =
    projection === "orthographic"
      ? radius
      : (radius * Math.sqrt(distance ** 2 - radius ** 2)) / distance;
  const depth = projection === "orthographic" ? 0 : radius ** 2 / distance;
  let largest = 0;
  for (const [x, y] of [
    [tangent, 0],
    [-tangent, 0],
    [0, tangent],
    [0, -tangent],
  ] as const) {
    const ndc = new THREE.Vector3(x, y, depth).project(camera);
    largest = Math.max(largest, Math.abs(ndc.x), Math.abs(ndc.y));
  }
  return largest;
}

describe("framing (#17)", () => {
  for (const projection of ["perspective", "orthographic"] as const) {
    it(`frames a portrait tile as tightly as a square one, and no tighter (${projection})`, () => {
      // The square tile is the reference: its framing is unchanged, and at
      // zoom 1 a perspective camera lets the bounding sphere just touch the
      // edge (~1.04; the sphere is larger than any model inside it).
      const square = largestNdc(projection, 480, 480);
      assert.ok(square < 1.05, `square reaches ${square.toFixed(3)}`);
      for (const [width, height] of [
        [160, 900],
        [480, 640],
        [900, 160],
      ] as const) {
        const reach = largestNdc(projection, width, height);
        assert.ok(
          reach <= square + 1e-9,
          `${projection} ${width}x${height}: the model reaches ${reach.toFixed(3)} of the frame, the square tile ${square.toFixed(3)}`,
        );
      }
    });
  }

  it("leaves square and landscape tiles framed as before", () => {
    for (const aspect of [1, 900 / 160]) {
      assert.deepEqual(framing(2, 1, aspect), {
        distance: 2 * 3.2,
        halfHeight: 2 * 1.3,
      });
    }
    assert.deepEqual(framing(2, 2, 1), { distance: 3.2, halfHeight: 1.3 });
  });

  it("is the framing the page uses", () => {
    const html = pageFor("cube");
    assert.ok(html.includes(FRAMING_SOURCE));
    assert.match(html, /framing\(radius, config\.zoom, aspect\)/);
  });
});
