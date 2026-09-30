// An HTML slide: the model writes the slide's body, laid out for a 1280x720
// canvas with Tailwind classes, and the View shows it in a sandboxed iframe
// as the page slideHtmlDocument() makes of it. The page loads Tailwind's
// browser build, which compiles the classes the slide uses as it loads, and
// plays MulmoCast's data-animation attributes, so a slide builds itself up
// while the model explains it, and does the same in a movie made from it
// (an html_tailwind beat with animation: true). The model's HTML has no
// scripts, and CSS animations don't play: they're shown at their end.
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

/** The data-animation kinds a slide can use: MulmoCast's (its html_tailwind
 *  beats with `animation: true`), so a slide animates the same in a movie
 *  made from it. MulmoCast also has stagger, codeReveal, blink, coverZoom and
 *  coverPan; not these. */
export const SLIDE_ANIMATION_KINDS = [
  "animate",
  "counter",
  "typewriter",
] as const;

/** How long an animation without data-end runs here, in seconds. In a movie
 *  it runs to the end of its beat, which the narration decides and the View
 *  doesn't know. */
export const SLIDE_AUTO_END_SECONDS = 8;

// The page's own script, in two parts.
//
// Showing the slide: the body is hidden until Tailwind has compiled the
// slide's classes, so it doesn't flash unstyled, and its animations start
// when it appears; shown anyway after a second: a slide without Tailwind
// (offline) is better than none, which is why Tailwind is deferred: a stalled
// CDN would otherwise hold the body back. A link (an <a>, or an image map's
// <area>) doesn't navigate: the slide isn't a page to leave, and the frame
// going to a URL would send what the URL carries.
//
// Playing its animations: MulmoCast's declarative data-animation attributes,
// as MulmoCast's movie renderer plays them (written for this package, which
// is MIT; MulmoCast is AGPL), measured against it: times in seconds, values
// "from,to" or "from,to,unit", linear unless data-easing says easeIn, easeOut
// or easeInOut; transforms in the order translateX, translateY, scale,
// rotate, rotateX, rotateY, rotateZ; a counter rounds to data-decimals; a
// typewriter shows its share of the text. The first frame is set before the
// slide appears, so an element that fades in isn't seen first.
// window.__slideSeek(seconds) shows the slide at a time (for tests).
//
// Fitting it: a box with data-fit (a Markdown slide's) whose text overflows
// it has its font size lowered until it fits, before the slide appears.
const PAGE_SCRIPT = `
(() => {
  const EASE = {
    linear: (t) => t,
    easeIn: (t) => t * t,
    easeOut: (t) => 1 - (1 - t) * (1 - t),
    easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  };
  const AUTO_END = ${SLIDE_AUTO_END_SECONDS};
  const TRANSFORMS = [
    ["data-translate-x", "translateX", "px"],
    ["data-translate-y", "translateY", "px"],
    ["data-scale", "scale", ""],
    ["data-rotate", "rotate", "deg"],
    ["data-rotate-x", "rotateX", "deg"],
    ["data-rotate-y", "rotateY", "deg"],
    ["data-rotate-z", "rotateZ", "deg"],
  ];
  const STYLES = [
    ["data-opacity", "opacity", ""],
    ["data-width", "width", "px"],
    ["data-height", "height", "px"],
  ];
  const number = (value, fallback) => {
    const n = Number(value);
    return value !== null && value.trim() !== "" && Number.isFinite(n) ? n : fallback;
  };
  const range = (value, unit) => {
    if (value === null) return null;
    const parts = value.split(",").map((part) => part.trim());
    const from = Number(parts[0]);
    const to = Number(parts[1]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return { from, to, unit: parts[2] || unit };
  };
  const ranges = (el, table) =>
    table
      .map(([attr, name, unit]) => [name, range(el.getAttribute(attr), unit)])
      .filter(([, r]) => r);
  let entries = [];
  const collect = () => {
    entries = [...document.querySelectorAll("[data-animation]")].map((el) => {
      const kind = el.getAttribute("data-animation");
      const end = el.getAttribute("data-end");
      const entry = {
        el,
        kind,
        start: number(el.getAttribute("data-start"), 0),
        end: end === null || end.trim() === "auto" ? null : number(end, null),
        ease: EASE[el.getAttribute("data-easing")] || EASE.linear,
      };
      if (kind === "animate") {
        entry.transforms = ranges(el, TRANSFORMS);
        entry.styles = ranges(el, STYLES);
      } else if (kind === "counter") {
        entry.from = number(el.getAttribute("data-from"), 0);
        entry.to = number(el.getAttribute("data-to"), 0);
        entry.decimals = Math.max(0, Math.round(number(el.getAttribute("data-decimals"), 0)));
        entry.prefix = el.getAttribute("data-prefix") || "";
        entry.suffix = el.getAttribute("data-suffix") || "";
      } else if (kind === "typewriter") {
        entry.text = el.getAttribute("data-text") ?? el.textContent;
      } else {
        return null;
      }
      return entry;
    }).filter(Boolean);
  };
  const seek = (t) => {
    for (const e of entries) {
      const end = e.end ?? AUTO_END;
      const span = end - e.start;
      const p = span > 0 ? Math.min(1, Math.max(0, (t - e.start) / span)) : t >= e.start ? 1 : 0;
      const k = e.ease(p);
      const at = (r) => r.from + (r.to - r.from) * k;
      if (e.kind === "animate") {
        if (e.transforms.length) {
          e.el.style.transform = e.transforms.map(([name, r]) => name + "(" + at(r) + r.unit + ")").join(" ");
        }
        for (const [name, r] of e.styles) e.el.style[name] = at(r) + r.unit;
      } else if (e.kind === "counter") {
        e.el.textContent = e.prefix + (e.from + (e.to - e.from) * k).toFixed(e.decimals) + e.suffix;
      } else {
        e.el.textContent = e.text.slice(0, Math.floor(e.text.length * k));
      }
    }
  };
  window.__slideSeek = seek;
  const fit = () => {
    for (const el of document.querySelectorAll("[data-fit]")) {
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (size > 12 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
        size -= 1;
        el.style.fontSize = size + "px";
      }
    }
  };
  const play = () => {
    const last = Math.max(0, ...entries.map((e) => e.end ?? AUTO_END));
    const begun = performance.now();
    const tick = (now) => {
      const t = (now - begun) / 1000;
      seek(t);
      if (t <= last) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  // Collected once the body is parsed: at DOMContentLoaded, or earlier when
  // the fallback shows the slide while a slow Tailwind still holds
  // DOMContentLoaded back (the body is parsed by then: readyState is
  // "interactive" before deferred scripts run). Played once both are done.
  let collected = false;
  let shown = false;
  const init = () => {
    if (collected || document.readyState === "loading") return;
    collected = true;
    collect();
    seek(0);
    if (shown) play();
  };
  const show = () => {
    if (shown) return;
    init();
    fit();
    shown = true;
    document.documentElement.classList.add("ready");
    if (collected) play();
  };
  const ready = () => requestAnimationFrame(() => requestAnimationFrame(show));
  const check = () =>
    document.querySelector("style:not([type]):not(#slide-base)") ? ready() : setTimeout(check, 30);
  addEventListener("DOMContentLoaded", () => {
    init();
    check();
  });
  setTimeout(show, 1000);
  addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a, area")) event.preventDefault();
  }, true);
})();`;

/** PAGE_SCRIPT's hash, which the policy allows (checked by a test). */
export const PAGE_SCRIPT_HASH =
  "sha256-bNBxv6ehYc2PHOgmTReFSYsrxiGvq6aqqg9m5RwS7Lc=";

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

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/** Text as HTML text or an attribute's value. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ENTITIES[c] ?? c);

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

/** CSS rules that stop a slide's CSS animations and transitions, which the
 *  slide isn't to use (it animates with data-animation), showing each at its
 *  end: an element the model faded in with its own @keyframes is seen, not
 *  held at its first, transparent frame. MulmoCast pauses CSS animations at
 *  that frame, so a host that makes a movie of the slide adds these to the
 *  HTML it passes on (a zero-length animation is at its end even paused). */
export const SLIDE_CSS_ANIMATIONS_FINISHED =
  "*, *::before, *::after { animation-play-state: paused !important; animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; animation-fill-mode: both !important; transition: none !important; }";

const BASE_STYLE = `
html, body { margin: 0; width: ${SLIDE_WIDTH}px; height: ${SLIDE_HEIGHT}px; overflow: hidden; }
html:not(.ready) body { visibility: hidden; }
${SLIDE_CSS_ANIMATIONS_FINISHED}`;

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
</head>
<body class="bg-white text-slate-900 font-sans antialiased">
${neutralizeSlideHtml(html)}
</body>
</html>`;
}
