// A chart slide: the model gives a Chart.js configuration (type, data,
// options), as MulmoCast's chart beats take it, and the View shows it on a
// page of its own (chartSlideDocument), under the slide's title: Chart.js
// draws it, growing into place as the model starts explaining it. A movie
// made from the slideshow can use it as it is (a MulmoCast chart beat's
// chartData).
//
// A string, not the DOM: the core entry runs wherever the host runs
// execute(), a server included.
import { SLIDE_HEIGHT, SLIDE_WIDTH, escapeHtml } from "./slideHtml";

/** The chart types a slide can have: Chart.js's own, with no plugin. */
export const SLIDE_CHART_TYPES = [
  "bar",
  "line",
  "pie",
  "doughnut",
  "radar",
  "polarArea",
  "scatter",
  "bubble",
] as const;

/** A Chart.js configuration: `type`, `data` and optionally `options`. */
export type SlideChart = Record<string, unknown> & {
  type: (typeof SLIDE_CHART_TYPES)[number];
  data: Record<string, unknown>;
};

// Chart.js's UMD build, one version, checked by its hash: the policy below
// allows this file only.
const CHART_JS =
  "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js";
const CHART_JS_INTEGRITY =
  "sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ";

// The page's own script: draws the chart from the configuration in the
// page's data block, sized to the space under the title and in the slide's
// type sizes. The configuration is data (JSON): it can't carry a function,
// so it can't run anything. Without Chart.js (offline), or with a
// configuration Chart.js refuses, the page says so.
const CHART_PAGE_SCRIPT = `
(() => {
  const fail = (why) => {
    document.getElementById("chart-error").textContent = why;
    document.documentElement.classList.add("failed");
  };
  addEventListener("DOMContentLoaded", () => {
    if (!window.Chart) return fail("The chart couldn't be drawn: Chart.js didn't load.");
    let config;
    try {
      config = JSON.parse(document.getElementById("chart-config").textContent);
    } catch {
      return fail("The chart couldn't be drawn: its configuration isn't valid.");
    }
    Chart.defaults.font.size = 22;
    Chart.defaults.color = "#334155";
    Chart.defaults.animation.duration = 1200;
    config.options = { ...config.options, responsive: true, maintainAspectRatio: false };
    try {
      new Chart(document.getElementById("chart"), config);
    } catch (error) {
      fail("The chart couldn't be drawn: " + (error && error.message ? error.message : error));
    }
  });
})();`;

/** CHART_PAGE_SCRIPT's hash, which the policy allows (checked by a test). */
export const CHART_PAGE_SCRIPT_HASH =
  "sha256-TfZZxJX+yWgzYLy7zqsMa85OJEaC+zNLIpKLDZVnUqA=";

// As an HTML slide's policy (slideHtml.ts): nothing goes out, and no script
// runs but the page's own and Chart.js. The page has no model-written HTML:
// the title is text, the configuration data.
const CHART_CSP = [
  "default-src 'none'",
  `script-src '${CHART_PAGE_SCRIPT_HASH}' ${CHART_JS}`,
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

const STYLE = `
html, body { margin: 0; width: ${SLIDE_WIDTH}px; height: ${SLIDE_HEIGHT}px; overflow: hidden; background: #ffffff; color: #0f172a; font-family: ui-sans-serif, system-ui, sans-serif; }
body { box-sizing: border-box; padding: 40px 64px 48px; display: flex; flex-direction: column; gap: 24px; }
h1 { margin: 0; font-size: 52px; font-weight: 800; color: #1e3a8a; line-height: 1.15; text-align: center; }
.chart { position: relative; flex: 1; min-height: 0; }
#chart-error { display: none; margin: auto; font-size: 28px; color: #b91c1c; }
.failed .chart { display: none; }
.failed #chart-error { display: block; }`;

/** JSON that can sit in a <script> data block: no "<", so no "</script>"
 *  and no "<!--" can end it early. */
export const scriptSafeJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c");

/** The page a chart slide is shown as. */
export function chartSlideDocument(title: string, chart: SlideChart): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CHART_CSP}">
<style>${STYLE}</style>
<script>${CHART_PAGE_SCRIPT}</script>
<script defer src="${CHART_JS}" integrity="${CHART_JS_INTEGRITY}" crossorigin="anonymous"></script>
<script type="application/json" id="chart-config">${scriptSafeJson(chart)}</script>
</head>
<body>
${title ? `<h1>${escapeHtml(title)}</h1>` : ""}
<div class="chart"><canvas id="chart"></canvas></div>
<p id="chart-error"></p>
</body>
</html>`;
}
