import { test } from "node:test";
import assert from "node:assert/strict";

import { presentSlide } from "../src/core/presentSlide";
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
