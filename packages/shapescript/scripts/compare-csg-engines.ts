// Render every shipped model that uses CSG with both engines and report how
// far the pictures differ — the check the manifold proposal asks for before
// the preview's default engine changes. Needs Puppeteer's Chromium.
//
//   npx tsx scripts/compare-csg-engines.ts
//
// For each model: the share of pixels whose colour differs by more than
// `TOLERANCE` (0-255 per channel) between the two renders, over a 2 x 2 sheet
// of views.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { renderShapeScriptSheet } from "../src/render/renderer";
import { samples } from "../src/core/samples";

const TOLERANCE = 24;
const VIEWS = [
  { azimuth: 30, elevation: 25, label: "front" },
  { azimuth: 210, elevation: 25, label: "back" },
  { azimuth: 120, elevation: 60, label: "above" },
  { azimuth: 300, elevation: -20, label: "below" },
];
const FIXTURES = join(
  import.meta.dirname,
  "..",
  "test",
  "fixtures",
  "upstream-examples",
);
const USES_CSG = /^\s*(union|difference|intersection|xor|stencil)\b/m;

function models(): [string, string][] {
  const upstream = ["Ball", "Chessboard", "Cog", "Train"].map(
    (name): [string, string] => [
      name,
      readFileSync(join(FIXTURES, `${name}.shape`), "utf8"),
    ],
  );
  const shipped = samples
    .map((sample): [string, string] => [
      `sample: ${String(sample.args.title)}`,
      String(sample.args.script),
    ])
    .filter(([, script]) => USES_CSG.test(script));
  return [...upstream, ...shipped];
}

/** The sheet as a data URL (the renderer answers bare base64). */
async function render(
  script: string,
  engine: "three-bvh-csg" | "manifold",
): Promise<string> {
  return (
    "data:image/png;base64," +
    (await renderShapeScriptSheet({
      script,
      views: VIEWS,
      width: 320,
      height: 320,
      zoom: 1,
      projection: "perspective",
      csgEngine: engine,
    }))
  );
}

/** In-page code, as text: tsx would wrap a function passed to evaluate() in
 *  helpers (`__name`) the page does not have. */
const COMPARE_IN_PAGE = `async ([left, right, tolerance]) => {
  const load = (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
  const pixels = (image) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  };
  const [p, q] = (await Promise.all([load(left), load(right)])).map(pixels);
  let differing = 0;
  for (let i = 0; i < p.length; i += 4) {
    const delta = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
    if (delta > tolerance) differing++;
  }
  return differing / (p.length / 4);
}`;

/** Share of pixels differing by more than TOLERANCE, computed in a browser. */
async function difference(a: string, b: string): Promise<number> {
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    const share: unknown = await page.evaluate(
      `(${COMPARE_IN_PAGE})(${JSON.stringify([a, b, TOLERANCE])})`,
    );
    if (typeof share !== "number")
      throw new Error("comparison did not answer a number");
    return share;
  } finally {
    await browser.close();
  }
}

// The floor: the same engine rendered twice should differ by ~0%.
const [first] = models();
if (first) {
  const noise = await difference(
    await render(first[1], "three-bvh-csg"),
    await render(first[1], "three-bvh-csg"),
  );
  console.log(
    `${"control: same engine twice".padEnd(28)} ${(noise * 100).toFixed(2)}% of pixels differ`,
  );
}
for (const [name, script] of models()) {
  const [bvh, manifold] = [
    await render(script, "three-bvh-csg"),
    await render(script, "manifold"),
  ];
  const share = await difference(bvh, manifold);
  console.log(
    `${name.padEnd(28)} ${(share * 100).toFixed(2)}% of pixels differ`,
  );
}
