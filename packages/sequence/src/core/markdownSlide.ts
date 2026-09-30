// A Markdown slide: the model writes the slide in Markdown, with TeX math
// between $…$ (inline) or $$…$$ (display), and it is made into an HTML
// slide here, shown and saved like one: the View's page (slideHtmlDocument)
// and a movie made from the slideshow (an html_tailwind beat) need nothing of
// their own. Math is MathML (KaTeX's mathml output), which browsers draw with
// no stylesheet or font to load, so it works offline and in a movie as on the
// screen. The typography is the <style> the slide carries.
//
// A string, not the DOM: the core entry runs wherever the host runs
// execute(), a server included. marked and KaTeX are imported when a
// Markdown slide is made, so a host that never makes one doesn't load them.
import type { TokenizerAndRendererExtension } from "marked";
import { SLIDE_HEIGHT, SLIDE_WIDTH, escapeHtml } from "./slideHtml";

/** The class of a Markdown slide's box, which its style is scoped to. */
const BOX = "slide-md";

// Em-based, so the box's font size scales it all, and the page shrinks that
// until the slide fits (data-fit in slideHtml's page script).
const STYLE = `
.${BOX} { box-sizing: border-box; width: ${SLIDE_WIDTH}px; height: ${SLIDE_HEIGHT}px; padding: 56px 80px; overflow: hidden; display: flex; flex-direction: column; justify-content: center; gap: 0.5em; background: #ffffff; color: #0f172a; font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.35; }
.${BOX} > * { margin: 0; }
.${BOX} h1 { font-size: 1.9em; font-weight: 800; color: #1e3a8a; line-height: 1.15; }
.${BOX} h2 { font-size: 1.5em; font-weight: 700; color: #1e40af; line-height: 1.2; }
.${BOX} h3 { font-size: 1.2em; font-weight: 700; color: #334155; }
.${BOX} ul, .${BOX} ol { padding-left: 1.3em; display: flex; flex-direction: column; gap: 0.3em; }
.${BOX} ul { list-style: disc; }
.${BOX} ol { list-style: decimal; }
.${BOX} li > ul, .${BOX} li > ol { margin-top: 0.3em; font-size: 0.9em; }
.${BOX} li::marker { color: #2563eb; }
.${BOX} strong { font-weight: 700; color: #1e3a8a; }
.${BOX} em { font-style: italic; }
.${BOX} a { color: #2563eb; text-decoration: underline; }
.${BOX} code { font-family: ui-monospace, monospace; font-size: 0.85em; background: #f1f5f9; border-radius: 0.2em; padding: 0.05em 0.3em; }
.${BOX} pre { background: #0f172a; color: #e2e8f0; border-radius: 0.4em; padding: 0.6em 0.8em; font-size: 0.75em; overflow: hidden; }
.${BOX} pre code { background: none; padding: 0; color: inherit; }
.${BOX} blockquote { border-left: 0.2em solid #93c5fd; padding-left: 0.8em; color: #475569; font-style: italic; }
.${BOX} table { border-collapse: collapse; font-size: 0.85em; align-self: flex-start; }
.${BOX} th, .${BOX} td { border: 1px solid #cbd5e1; padding: 0.25em 0.7em; text-align: left; }
.${BOX} th { background: #eff6ff; font-weight: 700; }
.${BOX} hr { border: 0; border-top: 2px solid #e2e8f0; }
.${BOX} img { max-width: 100%; max-height: 60%; }
.${BOX} .math-display { display: block; text-align: center; font-size: 1.15em; }
.${BOX} math { font-family: "Latin Modern Math", "STIX Two Math", "Cambria Math", math; }
.${BOX} mtd { padding: 0.1em 0.4em; }
.${BOX} mtd:first-child { padding-left: 0; }
.${BOX} mtd:last-child { padding-right: 0; }
.${BOX} .math-error { color: #b91c1c; font-family: ui-monospace, monospace; }`;

/** The box's first font size, in px, from how much the slide says: a few
 *  lines are large, many smaller. The page shrinks it further when the slide
 *  still doesn't fit; a movie, which doesn't run the page's script, has this
 *  one. */
export function markdownFontSize(markdown: string): number {
  const lines = markdown.split("\n").filter((line) => line.trim()).length;
  const chars = markdown.length;
  if (lines <= 5 && chars <= 250) return 40;
  if (lines <= 8 && chars <= 450) return 34;
  if (lines <= 12 && chars <= 700) return 28;
  return 24;
}

// $$…$$ (and \[…\]) on lines of their own, a display equation.
const BLOCK_MATH = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)/;
// $…$ (and \(…\)) within a line. A dollar starts math only before a
// non-space and ends it only after one, not before a digit: "$5 and $10"
// stays money. $$…$$ within a line is a display equation too.
const INLINE_MATH =
  /^(?:\$\$(.+?)\$\$|\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)|\\\((.+?)\\\))/;

type RenderMath = (tex: string, display: boolean) => string;

function mathExtensions(render: RenderMath): TokenizerAndRendererExtension[] {
  return [
    {
      name: "blockMath",
      level: "block",
      start: (src) => src.match(/(?<!\\)\$\$|\\\[/)?.index,
      tokenizer(src) {
        const match = BLOCK_MATH.exec(src);
        if (!match) return undefined;
        return {
          type: "blockMath",
          raw: match[0],
          text: (match[1] ?? match[2] ?? "").trim(),
        };
      },
      renderer: (token) =>
        `<div class="math-display">${render(String(token.text), true)}</div>\n`,
    },
    {
      name: "inlineMath",
      level: "inline",
      start: (src) => src.match(/(?<!\\)\$|\\\(/)?.index,
      tokenizer(src) {
        const match = INLINE_MATH.exec(src);
        if (!match) return undefined;
        return {
          type: "inlineMath",
          raw: match[0],
          text: (match[1] ?? match[2] ?? match[3] ?? "").trim(),
          display: match[1] !== undefined,
        };
      },
      renderer: (token) => render(String(token.text), token.display === true),
    },
  ];
}

// A function name (\log, \sin, \lim, \operatorname): KaTeX's MathML marks
// it with a function application (U+2061) and leaves its spacing to the
// browser, which Chrome doesn't add: "n \log n" read "nlogn". TeX's thin
// space after it, and before it after a variable, a number or a group.
const FUNCTION_NAME =
  /(<\/mi>|<\/mn>|<\/mrow>|<mo[^>]*>[)\]]<\/mo>)?(<mi(?: mathvariant="normal")?>[A-Za-z]{2,}<\/mi>)<mo>\u2061<\/mo>/g;
const THIN_SPACE = '<mspace width="0.1667em"></mspace>';

/** KaTeX's MathML, spaced as TeX spaces it where Chrome doesn't. */
export const spaceFunctionNames = (mathml: string): string =>
  mathml.replace(
    FUNCTION_NAME,
    (_, before: string | undefined, name: string) =>
      `${before ? before + THIN_SPACE : ""}${name}<mo lspace="0" rspace="0.1667em">\u2061</mo>`,
  );

/** A Markdown slide's HTML: the body of an HTML slide. */
export async function markdownSlideHtml(markdown: string): Promise<string> {
  const [{ Marked }, { default: katex }] = await Promise.all([
    import("marked"),
    import("katex"),
  ]);
  const render: RenderMath = (tex, display) => {
    try {
      return spaceFunctionNames(
        katex.renderToString(tex, {
          output: "mathml",
          displayMode: display,
          throwOnError: true,
        }),
      );
    } catch {
      // Shown as the model wrote it, marked, rather than as KaTeX's error.
      return `<code class="math-error">${escapeHtml(tex)}</code>`;
    }
  };
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({ extensions: mathExtensions(render) });
  const body = await marked.parse(markdown);
  return `<style>${STYLE}</style>
<div class="${BOX}" data-fit style="font-size: ${markdownFontSize(markdown)}px">
${body}</div>`;
}
