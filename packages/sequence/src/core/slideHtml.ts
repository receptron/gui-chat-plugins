// An HTML slide: the model writes the slide's body, laid out for a 1280x720
// canvas with Tailwind classes, and the View shows it in a sandboxed iframe
// as the page slideHtmlDocument() makes of it. The page loads Tailwind's
// browser build, which compiles the classes the slide uses as it loads, and
// defines a few entrance animations as Tailwind utilities (animate-fade-up,
// …), so a slide can build itself up while the model explains it. The
// model's HTML has no scripts: the animations are CSS.
//
// A string, not the DOM: the core entry runs wherever the host runs
// execute(), a server included.

export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;

/** The most HTML a slide may have, in characters. */
export const MAX_SLIDE_HTML = 60_000;

// Tailwind's browser build, one version (the one the package builds with),
// checked by its hash: the policy below allows this file only.
const TAILWIND =
  "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3/dist/index.global.js";
const TAILWIND_INTEGRITY =
  "sha384-2ql948lIdLcGEE0/qxNiudyTjgauA3RDJERu5xW75kFCvSl5a9odyQYCb6tEjnmB";

/** The animations every slide has, as `animate-<name>` classes. They keep
 *  their first frame while delayed (fill mode both), so an element with a
 *  delay stays hidden until its turn. */
export const SLIDE_ANIMATIONS = [
  "fade-in",
  "fade-up",
  "fade-down",
  "slide-in-left",
  "slide-in-right",
  "zoom-in",
  "pop",
  "draw",
] as const;

const THEME = `
@theme {
  --animate-fade-in: fade-in 0.8s ease-out both;
  --animate-fade-up: fade-up 0.8s ease-out both;
  --animate-fade-down: fade-down 0.8s ease-out both;
  --animate-slide-in-left: slide-in-left 0.8s ease-out both;
  --animate-slide-in-right: slide-in-right 0.8s ease-out both;
  --animate-zoom-in: zoom-in 0.8s ease-out both;
  --animate-pop: pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  --animate-draw: draw 1.5s ease-in-out both;
  @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
  @keyframes fade-up { from { opacity: 0; transform: translateY(40px) } to { opacity: 1; transform: none } }
  @keyframes fade-down { from { opacity: 0; transform: translateY(-40px) } to { opacity: 1; transform: none } }
  @keyframes slide-in-left { from { opacity: 0; transform: translateX(-80px) } to { opacity: 1; transform: none } }
  @keyframes slide-in-right { from { opacity: 0; transform: translateX(80px) } to { opacity: 1; transform: none } }
  @keyframes zoom-in { from { opacity: 0; transform: scale(0.8) } to { opacity: 1; transform: none } }
  @keyframes pop { from { opacity: 0; transform: scale(0.5) } to { opacity: 1; transform: none } }
  @keyframes draw { from { stroke-dashoffset: var(--draw-length, 1000) } to { stroke-dashoffset: 0 } }
}`;

// The page's own script. The body is hidden until Tailwind has compiled the
// slide's classes, so it doesn't flash unstyled, and animations start when it
// appears; shown anyway after a second: a slide without Tailwind (offline) is
// better than none, which is why Tailwind is deferred: a stalled CDN would
// otherwise hold the body back. A link (an <a>, or an image map's <area>)
// doesn't navigate: the slide isn't a page to leave, and the frame going to a
// URL would send what the URL carries.
const PAGE_SCRIPT = `
(() => {
  const show = () => document.documentElement.classList.add("ready");
  const ready = () => requestAnimationFrame(() => requestAnimationFrame(show));
  const check = () =>
    document.querySelector("style:not([type]):not(#slide-base)") ? ready() : setTimeout(check, 30);
  addEventListener("DOMContentLoaded", check);
  setTimeout(show, 1000);
  addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a, area")) event.preventDefault();
  }, true);
})();`;

/** PAGE_SCRIPT's hash, which the policy allows (checked by a test). */
export const PAGE_SCRIPT_HASH =
  "sha256-MZyL5rvWmIVxl3WUuDU5BqzPJGR2/fV/YPh01MNyUoM=";

// The slide is model-written, and the model may have read a page written to
// steer it. The View's iframe is sandbox="allow-scripts" without
// allow-same-origin, so the page has an opaque origin and can't reach the
// host's pages, storage or cookies, submit a form or open a window. This
// policy stops it sending anything out: no fetch; images, media and fonts only
// from data:/blob: URLs and Google Fonts (with any https: source, the slide
// could go out in an image URL); and no script but the page's own and
// Tailwind's, so nothing can navigate the frame to a URL carrying the page
// (the sandbox allows a frame to navigate itself, and CSP can't forbid it).
// No inline script, no event handler attribute, no javascript: URL.
const SLIDE_CSP = [
  "default-src 'none'",
  `script-src '${PAGE_SCRIPT_HASH}' ${TAILWIND}`,
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** The slide's HTML, made safe to show:
 *  - the tags that act on the page from outside the body are plain text:
 *    <meta> (a refresh navigates the frame, a policy of its own), <base> and
 *    <link> (prefetches). No tag can be rebuilt by the replacement, which only
 *    adds "&lt;".
 *  - no declarative shadow root (<template shadowrootmode>, the only way to
 *    make one without a script): a click inside one reaches the page's link
 *    guard retargeted to its host, so a link there would navigate. Every
 *    "shadowroot" is renamed, which leaves no attribute that makes one.
 *    Everything stays in the light DOM, where the guard sees it. */
export const neutralizeSlideHtml = (html: string): string =>
  html
    .replace(/<(?=(meta|base|link)\b)/gi, "&lt;")
    .replace(/shadowroot/gi, "data-no-shadow-root");

const BASE_STYLE = `
html, body { margin: 0; width: ${SLIDE_WIDTH}px; height: ${SLIDE_HEIGHT}px; overflow: hidden; }
html:not(.ready) body { visibility: hidden; }
html:not(.ready) body * { animation-play-state: paused !important; }`;

/** The page an HTML slide is shown as. */
export function slideHtmlDocument(html: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SLIDE_CSP}">
<style id="slide-base">${BASE_STYLE}</style>
<script>${PAGE_SCRIPT}</script>
<script defer src="${TAILWIND}" integrity="${TAILWIND_INTEGRITY}" crossorigin="anonymous"></script>
<style type="text/tailwindcss">${THEME}</style>
</head>
<body class="bg-white text-slate-900 font-sans antialiased">
${neutralizeSlideHtml(html)}
</body>
</html>`;
}
