import { test } from "node:test";
import assert from "node:assert/strict";

import { presentSlide } from "../src/core/presentSlide";
import { createHash } from "node:crypto";
import {
  PAGE_SCRIPT_HASH,
  SLIDE_CSS_ANIMATIONS_FINISHED,
  neutralizeSlideHtml,
  slideHtmlDocument,
} from "../src/core/slideHtml";
import { slideShownInstructions } from "../src/core/definitions";
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
  assert.match(neither.message, /either an imagePrompt or html/);
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
