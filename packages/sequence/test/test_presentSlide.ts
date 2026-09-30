import { test } from "node:test";
import assert from "node:assert/strict";

import { presentSlide } from "../src/core/presentSlide";
import { createHash } from "node:crypto";
import {
  PAGE_SCRIPT_HASH,
  SLIDE_CSS_ANIMATIONS_FINISHED,
  SLIDE_FIT_SCRIPT,
  neutralizeSlideHtml,
  slideHtmlDocument,
} from "../src/core/slideHtml";
import {
  PRESENT_SLIDE_DEFINITION,
  slideShownInstructions,
} from "../src/core/definitions";
import { chartSlideDocument } from "../src/core/chartSlide";
import {
  markdownFontSize,
  spaceFunctionNames,
} from "../src/core/markdownSlide";
import { fakeHost, record } from "./fakeHost";

// The tools keep state per process, as a host keeps them running: each test
// uses slideshows of its own (a length or a title no other test uses).
let unique = 0;
const title = (name: string) => `${name} ${++unique}`;

const slideArgs = (
  slide: number,
  totalSlides: number,
  firstTitle: string,
  extra: Record<string, unknown> = {},
) => ({
  slide,
  totalSlides,
  title: slide === 1 ? firstTitle : `${firstTitle}: part ${slide}`,
  imagePrompt: `picture of ${firstTitle} ${slide}`,
  ...extra,
});

const data = (result: { data?: unknown }) =>
  (result.data ?? {}) as Record<string, unknown>;

test("a slide is drawn, saved in its slideshow and says where it is", async () => {
  const host = fakeHost();
  const name = title("Photosynthesis");
  const result = await presentSlide(host.context(), slideArgs(1, 3, name));

  const { slideshowId, imagePath } = data(result);
  assert.match(String(slideshowId), /^[0-9a-f]{12}$/);
  assert.equal(result.instructionsRequired, true);
  assert.deepEqual(result.sequence, {
    step: 1,
    total: 3,
    kind: "slideshow",
    label: "Slide 1 of 3",
    onShown: "explain it",
    nextCall: "call presentSlide for slide 2 of 3",
  });
  assert.deepEqual(record(host.artifacts, `slideshows/${slideshowId}.json`), {
    id: slideshowId,
    title: name,
    mode: "presentation",
    totalSlides: 3,
    slides: {
      "1": { title: name, imagePrompt: `picture of ${name} 1`, imagePath },
    },
  });
});

test("an identical slide asked for again right away is dropped", async () => {
  const host = fakeHost();
  const args = slideArgs(1, 3, title("Twice"));
  const first = await presentSlide(host.context(), args);
  const again = await presentSlide(
    host.context({ currentResult: first }),
    args,
  );
  assert.equal(again.cancelled, true);
  assert.equal(again.sequence, undefined);
  assert.equal(host.calls.length, 1);
});

test("a slide that couldn't be drawn ends the sequence and saves nothing", async () => {
  const host = fakeHost({ fail: () => true });
  const result = await presentSlide(
    host.context(),
    slideArgs(1, 3, title("Refused")),
  );
  assert.equal(result.sequence, null);
  assert.equal(result.message, "image generation failed: refused");
  assert.equal(
    [...host.artifacts.files.keys()].some((k) => k.startsWith("slideshows/")),
    false,
  );
});

test("wrong arguments end the sequence", async () => {
  const result = await presentSlide(fakeHost().context(), { slide: 0 });
  assert.equal(result.sequence, null);
});

test("a guide step waits for the user, and is drawn from the step before", async () => {
  const host = fakeHost();
  const name = title("Paper plane");
  const steps = (slide: number) => slideArgs(slide, 4, name, { mode: "steps" });
  const spokeBefore = Date.now() - 1000;

  const step1 = await presentSlide(
    host.context({ userSpokeAt: spokeBefore }),
    steps(1),
  );
  assert.equal(step1.sequence?.waitsForUser, true);

  // Asked for before the user spoke since step 1 appeared: held.
  const held = await presentSlide(
    host.context({ userSpokeAt: spokeBefore, currentResult: step1 }),
    steps(2),
  );
  assert.equal(held.cancelled, true);
  assert.match(held.message, /hasn't said they're ready/);
  assert.equal(host.calls.length, 1);

  // The user said "next": drawn, with step 1's picture as its reference.
  const step2 = await presentSlide(
    host.context({ userSpokeAt: Date.now() + 1, currentResult: step1 }),
    steps(2),
  );
  assert.equal(data(step2).slide, 2);
  assert.deepEqual(host.calls[1]?.references, [data(step1).imagePath]);
  assert.match(
    host.calls[1]?.prompt ?? "",
    /reference image is the previous step/,
  );
});

test("going back shows a guide step as it was, without drawing it", async () => {
  const host = fakeHost();
  const name = title("Origami");
  const steps = (slide: number) => slideArgs(slide, 5, name, { mode: "steps" });
  const step1 = await presentSlide(host.context(), steps(1));
  const step2 = await presentSlide(
    host.context({ currentResult: step1 }),
    steps(2),
  );

  // Step 1 isn't on the screen: shown again as it was.
  const back = await presentSlide(
    host.context({ currentResult: step2 }),
    steps(1),
  );
  assert.match(back.message, /on the screen again, as it was/);
  assert.equal(data(back).imagePath, data(step1).imagePath);
  assert.equal(back.uuid, undefined);
  assert.equal(host.calls.length, 2);

  // It is on the screen, compared by its saved path (a host may send the
  // current result without the picture's data).
  const onScreen = await presentSlide(
    host.context({
      currentResult: {
        message: "",
        data: { imagePath: data(step1).imagePath },
      },
    }),
    steps(1),
  );
  assert.equal(onScreen.cancelled, true);
});

test("a presentation in the middle of a guide leaves the guide as it was", async () => {
  const host = fakeHost();
  const guideName = title("Knots");
  const steps = (slide: number) =>
    slideArgs(slide, 6, guideName, { mode: "steps" });
  const step1 = await presentSlide(host.context(), steps(1));
  const aside = await presentSlide(
    host.context({ currentResult: step1 }),
    slideArgs(1, 2, title("Why knots hold")),
  );

  const back = await presentSlide(
    host.context({ currentResult: aside }),
    steps(1),
  );
  assert.match(back.message, /again, as it was/);
  assert.equal(data(back).slideshowId, data(step1).slideshowId);

  // The next step is still drawn from step 1.
  await presentSlide(host.context({ currentResult: back }), steps(2));
  assert.deepEqual(host.calls.at(-1)?.references, [data(step1).imagePath]);
});

test("a presentation slide asked for again after a guide step comes back", async () => {
  const host = fakeHost();
  const pres = slideArgs(1, 7, title("Lift"));
  const slide1 = await presentSlide(host.context(), pres);
  const step = await presentSlide(
    host.context({ currentResult: slide1 }),
    slideArgs(1, 8, title("Fold"), { mode: "steps" }),
  );

  const again = await presentSlide(host.context({ currentResult: step }), pres);
  assert.match(again.message, /slide 1 of 7 is on the screen again, as it was/);
  assert.equal(data(again).imagePath, data(slide1).imagePath);
  assert.equal(host.calls.length, 2);
});

test("without editImages, a step is drawn from the prompt alone", async () => {
  const host = fakeHost({ editImages: false });
  const name = title("No refs");
  const steps = (slide: number) => slideArgs(slide, 9, name, { mode: "steps" });
  const step1 = await presentSlide(host.context(), steps(1));
  await presentSlide(host.context({ currentResult: step1 }), steps(2));
  assert.deepEqual(host.calls[1]?.references, []);
  assert.doesNotMatch(host.calls[1]?.prompt ?? "", /reference image/);
});

test("a host that doesn't say when the user spoke holds nothing", async () => {
  const host = fakeHost();
  const name = title("Unknown speech");
  const steps = (slide: number) =>
    slideArgs(slide, 10, name, { mode: "steps" });
  const step1 = await presentSlide(host.context(), steps(1));
  const step2 = await presentSlide(
    host.context({ currentResult: step1 }),
    steps(2),
  );
  assert.equal(data(step2).slide, 2);
});

test("two identical slides asked for together are drawn once", async () => {
  const host = fakeHost();
  const args = slideArgs(1, 11, title("Together"));
  const [first, second] = await Promise.all([
    presentSlide(host.context(), args),
    presentSlide(host.context(), args),
  ]);
  assert.equal(host.calls.length, 1);
  assert.equal(data(first).slide, 1);
  assert.equal(second.cancelled, true);
});

test("a guide step asked for while the one before is drawn is held", async () => {
  const host = fakeHost();
  const name = title("Overlap");
  const steps = (slide: number) =>
    slideArgs(slide, 12, name, { mode: "steps" });
  const [step1, step2] = await Promise.all([
    presentSlide(host.context({ userSpokeAt: 0 }), steps(1)),
    presentSlide(host.context({ userSpokeAt: 0 }), steps(2)),
  ]);
  assert.equal(data(step1).slide, 1);
  assert.equal(step2.cancelled, true);
  assert.match(step2.message, /step 1 is still being drawn/);
  assert.equal(host.calls.length, 1);
});

test("when the first of two identical calls fails, the second tries", async () => {
  let failures = 1;
  const host = fakeHost({ fail: () => failures-- > 0 });
  const args = slideArgs(1, 13, title("Retry"));
  const [first, second] = await Promise.all([
    presentSlide(host.context(), args),
    presentSlide(host.context(), args),
  ]);
  assert.equal(first.sequence, null);
  assert.equal(data(second).slide, 1);
  assert.equal(host.calls.length, 2);
});

test("two conversations' slideshows don't mix", async () => {
  const host = fakeHost();
  const a = (extra = {}) => host.context({ conversationId: "tab-a", ...extra });
  const b = (extra = {}) => host.context({ conversationId: "tab-b", ...extra });
  // Tab A starts a presentation, then tab B starts another of the same
  // length: A's next slide still belongs to A's slideshow.
  const a1 = await presentSlide(a(), slideArgs(1, 14, title("Tab A")));
  const b1 = await presentSlide(b(), slideArgs(1, 14, title("Tab B")));
  const a2 = await presentSlide(
    a({ currentResult: a1 }),
    slideArgs(2, 14, "Tab A"),
  );
  assert.notEqual(data(a1).slideshowId, data(b1).slideshowId);
  assert.equal(data(a2).slideshowId, data(a1).slideshowId);
});

test("the same slide in two conversations is drawn for each", async () => {
  const host = fakeHost();
  const args = slideArgs(1, 15, title("Shared"));
  await presentSlide(host.context({ conversationId: "one" }), args);
  const other = await presentSlide(
    host.context({ conversationId: "two" }),
    args,
  );
  assert.equal(other.cancelled, undefined);
  assert.equal(host.calls.length, 2);
});

test("old conversations are dropped past the limit", async () => {
  const host = fakeHost();
  const name = title("Evicted");
  const args = slideArgs(1, 16, name);
  const drawsOf = () =>
    host.calls.filter((c) => c.prompt.includes(`picture of ${name} 1`)).length;
  await presentSlide(host.context({ conversationId: "first" }), args);
  for (let i = 0; i < 50; i++) {
    await presentSlide(
      host.context({ conversationId: `other-${i}` }),
      slideArgs(1, 17, title("Other")),
    );
  }
  // "first" was dropped, so its slide is drawn again, for a new slideshow.
  const again = await presentSlide(
    host.context({ conversationId: "first" }),
    args,
  );
  assert.equal(again.cancelled, undefined);
  assert.equal(drawsOf(), 2);
});

// --- HTML slides ---------------------------------------------------------------

const htmlSlide = (slide: number, totalSlides: number, firstTitle: string) => ({
  slide,
  totalSlides,
  title: slide === 1 ? firstTitle : `${firstTitle}: part ${slide}`,
  html: `<div class="w-full h-full animate-fade-up">${firstTitle} ${slide}</div>`,
});

test("an HTML slide is shown and saved without drawing anything", async () => {
  const host = fakeHost();
  const name = title("Timeline");
  const args = htmlSlide(1, 21, name);
  const result = await presentSlide(host.context(), args);

  assert.equal(host.calls.length, 0);
  const { slideshowId, html, imageData, imagePath } = data(result);
  assert.equal(html, args.html);
  assert.equal(imageData, undefined);
  assert.equal(imagePath, undefined);
  assert.match(
    result.message,
    /slide 1 of 21 of slideshow "[0-9a-f]{12}" is on the screen/,
  );
  assert.equal(result.instructionsRequired, true);
  assert.equal(result.sequence?.step, 1);
  assert.deepEqual(record(host.artifacts, `slideshows/${slideshowId}.json`), {
    id: slideshowId,
    title: name,
    mode: "presentation",
    totalSlides: 21,
    slides: { "1": { title: name, imagePrompt: "", html: args.html } },
  });
});

test("a slideshow mixes pictures and HTML slides", async () => {
  const host = fakeHost();
  const name = title("Mixed");
  const first = await presentSlide(host.context(), slideArgs(1, 22, name));
  const second = await presentSlide(
    host.context({ currentResult: first }),
    htmlSlide(2, 22, name),
  );
  assert.equal(data(second).slideshowId, data(first).slideshowId);
  assert.equal(host.calls.length, 1);
  const saved = record(
    host.artifacts,
    `slideshows/${data(first).slideshowId}.json`,
  );
  assert.deepEqual(Object.keys(saved.slides as object), ["1", "2"]);
});

test("html wins over an imagePrompt sent with it", async () => {
  const host = fakeHost();
  const result = await presentSlide(host.context(), {
    ...htmlSlide(1, 23, title("Both")),
    imagePrompt: "a picture too",
  });
  assert.equal(host.calls.length, 0);
  assert.equal(data(result).prompt, "");
  assert.ok(data(result).html);
});

test("a slide with neither an imagePrompt nor html, or too much html, ends the sequence", async () => {
  const host = fakeHost();
  const neither = await presentSlide(host.context(), {
    slide: 1,
    totalSlides: 2,
    title: title("Empty"),
    html: "  ",
  });
  assert.match(neither.message, /one of imagePrompt, html, markdown or chart/);
  assert.equal(neither.sequence, null);

  const long = await presentSlide(host.context(), {
    ...htmlSlide(1, 2, title("Long")),
    html: "x".repeat(60_001),
  });
  assert.match(long.message, /too long/);
  assert.equal(long.sequence, null);
  assert.equal(host.calls.length, 0);
});

test("an HTML guide step on the screen isn't shown again; off it, it comes back as it was", async () => {
  const host = fakeHost();
  const name = title("Stretch");
  const step = (slide: number) => ({
    ...htmlSlide(slide, 24, name),
    mode: "steps",
  });
  const step1 = await presentSlide(host.context(), step(1));
  const step2 = await presentSlide(
    host.context({ currentResult: step1, userSpokeAt: Date.now() + 1 }),
    step(2),
  );
  assert.equal(data(step2).html, step(2).html);

  const onScreen = await presentSlide(
    host.context({ currentResult: step1 }),
    step(1),
  );
  assert.equal(onScreen.cancelled, true);

  const back = await presentSlide(
    host.context({ currentResult: step2 }),
    step(1),
  );
  assert.match(back.message, /on the screen again, as it was/);
  assert.equal(data(back).html, step(1).html);
  assert.equal(host.calls.length, 0);
});

test("a picture step after an HTML step is drawn without a reference", async () => {
  const host = fakeHost();
  const name = title("Origami");
  const step1 = await presentSlide(host.context(), {
    ...htmlSlide(1, 25, name),
    mode: "steps",
  });
  await presentSlide(
    host.context({ currentResult: step1, userSpokeAt: Date.now() + 1 }),
    slideArgs(2, 25, name, { mode: "steps" }),
  );
  assert.deepEqual(host.calls.at(-1)?.references, []);
});

test("an HTML slide's page loads Tailwind, plays data-animation and has a policy that stops it sending anything", () => {
  const page = slideHtmlDocument('<div class="animate-pop">Hi</div>');
  // MulmoCast's data-animation attributes; CSS animations shown at their
  // end, by the rules a host adds to a movie's HTML.
  assert.match(page, /querySelectorAll\("\[data-animation\]"\)/);
  assert.ok(page.includes(SLIDE_CSS_ANIMATIONS_FINISHED));
  assert.match(
    SLIDE_CSS_ANIMATIONS_FINISHED,
    /animation-duration: 0s !important/,
  );
  assert.match(
    page,
    /@tailwindcss\/browser@4\.\d+\.\d+\/dist\/index\.global\.js" integrity="sha384-/,
  );
  assert.match(page, /connect-src 'none'/);
  assert.match(page, /img-src data: blob:/);
  // No script but the page's own (by its hash) and Tailwind's file: a
  // slide's script could navigate the frame to a URL carrying the slide.
  const scripts = page.match(/script-src ([^;"]*)/)?.[1] ?? "";
  assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval/);
  assert.equal(scripts.split(" ").length, 2);
  // Links, image-map areas included, don't navigate; Tailwind doesn't hold
  // the body back.
  assert.match(page, /closest\("a, area"\)\) event\.preventDefault\(\)/);
  assert.match(page, /<script defer src="https:\/\/cdn\.jsdelivr\.net/);
  assert.match(
    page,
    /<body[^>]*>\n<div class="animate-pop">Hi<\/div>\n<\/body>/,
  );
});

test("the page's own script is the one its hash allows", () => {
  const page = slideHtmlDocument("");
  const own = page.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  const hash = createHash("sha256").update(own).digest("base64");
  assert.equal(PAGE_SCRIPT_HASH, `sha256-${hash}`);
  assert.ok(page.includes(`'${PAGE_SCRIPT_HASH}'`));
});

test("a slide's meta, base and link tags are plain text", () => {
  const html = neutralizeSlideHtml(
    '<META http-equiv="refresh" content="0;url=https://x.example/"><base href="https://x.example/"><link rel="prefetch" href="https://x.example/"><me<meta>ta http-equiv="refresh"><metadata-card>ok</metadata-card>',
  );
  assert.doesNotMatch(html, /<(meta|base|link)\b/i);
  assert.match(html, /&lt;META http-equiv/);
  assert.match(html, /<metadata-card>ok<\/metadata-card>/);
});

test("a slide can't make a declarative shadow root, where a link would escape the guard", () => {
  const html = neutralizeSlideHtml(
    '<div><template shadowrootmode="closed"><a href="https://x.example/">go</a></template></div><div><template SHADOWROOTMODE="open" shadowrootclonable></template></div>',
  );
  assert.doesNotMatch(html, /(^|[\s<"'])shadowroot/i);
  assert.match(html, /<a href="https:\/\/x\.example\/">go<\/a>/);
});

test("a slide's instructions ask for its subject, not a line about the slide", () => {
  // OpenAI's voice models, asked only to "explain it", said "Let's start with
  // the big picture" or "This first slide is about…" and went on.
  const args = {
    title: "Waves",
    imagePrompt: "a wave",
    mode: "presentation" as const,
  };
  for (const slide of [1, 3]) {
    const text = slideShownInstructions({ ...args, slide, totalSlides: 3 });
    assert.match(text, /Begin with the content itself, never with the slide/);
    assert.match(text, /"This slide is about…"/);
  }
  const step = slideShownInstructions({
    ...args,
    mode: "steps",
    slide: 1,
    totalSlides: 3,
  });
  assert.match(step, /Say what to do in this step, directly/);
});

// --- Markdown and chart slides -------------------------------------------------

const markdownSlide = (
  slide: number,
  totalSlides: number,
  firstTitle: string,
  markdown: string,
) => ({
  slide,
  totalSlides,
  title: slide === 1 ? firstTitle : `${firstTitle}: part ${slide}`,
  markdown,
});

test("a Markdown slide is made into HTML, with its math as MathML, and saved with its text", async () => {
  const host = fakeHost();
  const name = title("Euler");
  const markdown =
    "# Euler's identity\n\nThe most beautiful equation, $e^{i\\pi} + 1 = 0$:\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n- **one** item";
  const result = await presentSlide(
    host.context(),
    markdownSlide(1, 31, name, markdown),
  );

  assert.equal(host.calls.length, 0);
  const { slideshowId, html, prompt } = data(result);
  assert.equal(prompt, "");
  assert.equal(data(result).markdown, markdown);
  const page = String(html);
  assert.match(page, /<h1>Euler&#39;s identity<\/h1>/);
  assert.match(page, /<strong>one<\/strong>/);
  // Inline math, and the display equation in a block of its own.
  assert.match(page, /<math[^>]*><semantics><mrow><msup><mi>e<\/mi>/);
  assert.match(
    page,
    /<div class="math-display"><span class="katex"><math[^>]*display="block"/,
  );
  assert.match(page, /<mfrac>/);
  // No KaTeX HTML, which would need its stylesheet and fonts.
  assert.doesNotMatch(page, /katex-html/);
  // The box the page fits to the slide.
  assert.match(
    page,
    /<div class="slide-md" data-fit style="font-size: \d+px">/,
  );
  assert.deepEqual(record(host.artifacts, `slideshows/${slideshowId}.json`), {
    id: slideshowId,
    title: name,
    mode: "presentation",
    totalSlides: 31,
    slides: { "1": { title: name, imagePrompt: "", html, markdown } },
  });
});

test("money and an escaped dollar aren't math; $$…$$ in a line is a displayed equation", async () => {
  const host = fakeHost();
  const result = await presentSlide(
    host.context(),
    markdownSlide(
      1,
      32,
      title("Prices"),
      "It costs $5 and $10 (or $5-$10), or \\$20 $ 30 $.\n\nIn a line: $$a^2$$",
    ),
  );
  const page = String(data(result).html);
  assert.match(
    page,
    /It costs \$5 and \$10 \(or \$5-\$10\), or \$20 \$ 30 \$\./,
  );
  assert.equal(page.match(/<math/g)?.length, 1);
  assert.match(page, /<math[^>]*display="block"/);
});

test("TeX that KaTeX can't read is shown as written", async () => {
  const host = fakeHost();
  const result = await presentSlide(
    host.context(),
    markdownSlide(1, 33, title("Broken"), "Oops: $\\frac{1}{<x$"),
  );
  const page = String(data(result).html);
  assert.match(page, /<code class="math-error">\\frac\{1\}\{&lt;x<\/code>/);
});

test("a function name gets TeX's thin spaces, which Chrome's MathML doesn't add", async () => {
  const host = fakeHost();
  const result = await presentSlide(
    host.context(),
    markdownSlide(1, 40, title("Log"), "$n \\log n$ and $\\sin x$"),
  );
  const page = String(data(result).html);
  assert.match(
    page,
    /<mi>n<\/mi><mspace width="0.1667em"><\/mspace><mi>log<\/mi><mo lspace="0" rspace="0.1667em">\u2061<\/mo><mi>n<\/mi>/,
  );
  // Nothing before it at the start of a formula.
  assert.match(page, /<mrow><mi>sin<\/mi><mo lspace="0"/);
  assert.equal(spaceFunctionNames("<mi>x</mi>"), "<mi>x</mi>");
});

test("the more a Markdown slide says, the smaller it starts", () => {
  const short = markdownFontSize("# Title\n\nOne line");
  const long = markdownFontSize(
    Array.from({ length: 14 }, (_, i) => `- item ${i}`).join("\n"),
  );
  assert.ok(short > long);
});

const barChart = {
  type: "bar",
  data: {
    labels: ["2023", "2024"],
    datasets: [{ label: "Sales", data: [3, 5], backgroundColor: "#2563eb" }],
  },
};

test("a chart slide is shown and saved with its configuration, drawing nothing", async () => {
  const host = fakeHost();
  const name = title("Sales");
  const result = await presentSlide(host.context(), {
    slide: 1,
    totalSlides: 34,
    title: name,
    chart: barChart,
  });
  assert.equal(host.calls.length, 0);
  const { slideshowId, chart, html, prompt } = data(result);
  assert.deepEqual(chart, barChart);
  assert.equal(html, undefined);
  assert.equal(prompt, "");
  assert.equal(result.instructionsRequired, true);
  assert.deepEqual(record(host.artifacts, `slideshows/${slideshowId}.json`), {
    id: slideshowId,
    title: name,
    mode: "presentation",
    totalSlides: 34,
    slides: { "1": { title: name, imagePrompt: "", chart: barChart } },
  });
});

test("a chart sent as JSON text is read; one Chart.js can't draw ends the sequence", async () => {
  const host = fakeHost();
  const asText = await presentSlide(host.context(), {
    slide: 1,
    totalSlides: 35,
    title: title("Text"),
    chart: JSON.stringify(barChart),
  });
  assert.deepEqual(data(asText).chart, barChart);

  for (const chart of [
    { ...barChart, type: "sankey" },
    { type: "bar" },
    { ...barChart, options: "big" },
    "{not json",
  ]) {
    const refused = await presentSlide(host.context(), {
      slide: 1,
      totalSlides: 36,
      title: title("Bad"),
      chart,
    });
    assert.match(refused.message, /must be a Chart\.js configuration/);
    assert.equal(refused.sequence, null);
  }
  assert.equal(host.calls.length, 0);
});

test("a slide is one kind: html, then markdown, then chart, then a picture", async () => {
  const host = fakeHost();
  const all = {
    slide: 1,
    title: title("All"),
    imagePrompt: "a picture",
    html: "<div>html</div>",
    markdown: "# markdown",
    chart: barChart,
  };
  const html = data(
    await presentSlide(host.context(), { ...all, totalSlides: 37 }),
  );
  assert.equal(html.html, all.html);
  assert.equal(html.markdown, undefined);
  assert.equal(html.chart, undefined);

  const md = data(
    await presentSlide(host.context(), { ...all, html: "", totalSlides: 38 }),
  );
  assert.equal(md.markdown, all.markdown);
  assert.equal(md.chart, undefined);

  const chart = data(
    await presentSlide(host.context(), {
      ...all,
      html: "",
      markdown: " ",
      totalSlides: 39,
    }),
  );
  assert.deepEqual(chart.chart, barChart);
  assert.equal(host.calls.length, 0);
});

test("a chart page runs only its own script and Chart.js, and its data can't end its data block", () => {
  const page = chartSlideDocument('Sales <b>"up"</b>', {
    type: "bar",
    data: { labels: ["</script><script>alert(1)</script>"], datasets: [] },
  });
  const own = page.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  const hash = createHash("sha256").update(own).digest("base64");
  assert.ok(page.includes(`'sha256-${hash}'`));
  const scripts = page.match(/script-src ([^;"]*)/)?.[1] ?? "";
  assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval/);
  assert.equal(scripts.split(" ").length, 2);
  assert.match(page, /connect-src 'none'/);
  assert.match(page, /<h1>Sales &lt;b&gt;&quot;up&quot;&lt;\/b&gt;<\/h1>/);
  const block =
    page.match(
      /<script type="application\/json" id="chart-config">([\s\S]*?)<\/script>/,
    )?.[1] ?? "";
  assert.doesNotMatch(block, /</);
  assert.deepEqual(JSON.parse(block).data.labels, [
    "</script><script>alert(1)</script>",
  ]);
});

test("$$…$$ within a paragraph, or in code, doesn't break the paragraph", async () => {
  const host = fakeHost();
  const result = await presentSlide(
    host.context(),
    markdownSlide(
      1,
      41,
      title("Inline"),
      "A displayed formula $$x$$ in a line.\n\nCode: `$$x$$` here.\n\n  $$y$$\n\nafter",
    ),
  );
  const page = String(data(result).html);
  assert.match(
    page,
    /<p>A displayed formula <span class="katex"><math[^>]*display="block"/,
  );
  assert.match(page, /<\/math><\/span> in a line\.<\/p>/);
  assert.match(page, /<code>\$\$x\$\$<\/code>/);
  // An indented one on a line of its own is still a displayed equation.
  assert.match(page, /<div class="math-display">/);
});

test("a chart slide counts as shown: a repeat is dropped, and a guide's next step waits", async () => {
  const host = fakeHost();
  const name = title("Chart steps");
  const step = (slide: number) => ({
    slide,
    totalSlides: 42,
    title: slide === 1 ? name : `${name}: part ${slide}`,
    chart: { ...barChart, data: { ...barChart.data, labels: [String(slide)] } },
    mode: "steps",
  });
  const step1 = await presentSlide(host.context({ userSpokeAt: 0 }), step(1));
  assert.ok(data(step1).chart);

  const onScreen = await presentSlide(
    host.context({ currentResult: step1, userSpokeAt: 0 }),
    step(1),
  );
  assert.equal(onScreen.cancelled, true);

  const held = await presentSlide(
    host.context({ currentResult: step1, userSpokeAt: 0 }),
    step(2),
  );
  assert.equal(held.cancelled, true);
  assert.match(held.message, /hasn't said they're ready/);

  const presentation = {
    slide: 1,
    totalSlides: 43,
    title: title("Chart twice"),
    chart: barChart,
  };
  const first = await presentSlide(host.context(), presentation);
  const again = await presentSlide(
    host.context({ currentResult: first }),
    presentation,
  );
  assert.equal(again.cancelled, true);
});

test("the chart argument is advertised as JSON text", () => {
  const properties = (
    PRESENT_SLIDE_DEFINITION.parameters as {
      properties: Record<string, { type: string }>;
    }
  ).properties;
  assert.equal(properties.chart?.type, "string");
});

test("a movie's page fits a Markdown slide as the View's page does", async () => {
  // The same fitting function in both.
  const fit =
    SLIDE_FIT_SCRIPT.match(/const fit = (\(\) => \{[\s\S]*?\n {2}\});/)?.[1] ??
    "";
  assert.ok(fit.includes('querySelectorAll("[data-fit]")'));
  assert.ok(slideHtmlDocument("").includes(`const fit = ${fit};`));
  assert.match(SLIDE_FIT_SCRIPT, /addEventListener\("load", fit\)/);
  // The box keeps its size where the body is a flex column (MulmoCast's
  // page), so its text is fitted to the slide, not to a shrunken box.
  const host = fakeHost();
  const result = await presentSlide(
    host.context(),
    markdownSlide(1, 44, title("Flex"), "# Hi"),
  );
  assert.match(String(data(result).html), /\.slide-md \{[^}]*flex-shrink: 0;/);
});
