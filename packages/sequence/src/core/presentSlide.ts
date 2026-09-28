// presentSlide: one slide of a spoken slideshow, a generated picture per
// slide. The model calls it once per slide, in order, and explains each slide
// when it appears. With the slide number and the total as arguments, the
// result says where the slideshow is (ToolResult.sequence), and the host can
// ask the model to go on (gui-chat-protocol's createSequenceKeeper).
//
// A slideshow is a presentation (the default: it goes on by itself) or a
// step-by-step guide (mode "steps": a how-to the user follows along with).
// A step waits for the user to say they're ready, is drawn with the previous
// step's picture as a reference so the object stays the same, and a step
// shown earlier ("go back to step 2") is shown again as it was, not redrawn.
//
// From MulmoChat and MulmoGlass, where this was split between the browser
// (the holds, showing a step again, dropping repeats) and the drawing host.
// Here it is one execute(), which runs wherever the host runs it; the state
// below lives there.
import type { SequenceStep, ToolResult } from "gui-chat-protocol";
import {
  SLIDE_ARGS_ERROR,
  parseSlideArgs,
  slideShownInstructions,
  type SlideArgs,
  type SlideData,
  type SlideMode,
  type Slideshow,
} from "./definitions";
import {
  drawPicture,
  imageOf,
  newSequenceId,
  samePicture,
  usableReferences,
  userSpokeSince,
  type SequenceContext,
} from "./host";
import { NOT_SAVED, SLIDESHOWS_DIR, updateRecord } from "./records";
import { createRepeatGuard } from "./repeatGuard";

/** Where the slideshow is after a slide was shown. */
export function slideSequenceStep({
  slide: step,
  totalSlides: total,
  mode,
}: SlideArgs): SequenceStep {
  if (mode === "steps") {
    return {
      step,
      total,
      kind: "guide",
      label: `Step ${step} of ${total}`,
      onShown: "explain it",
      nextCall: `call presentSlide for step ${step + 1} of ${total} with mode "steps"`,
      waitsForUser: true,
    };
  }
  return {
    step,
    total,
    kind: "slideshow",
    label: `Slide ${step} of ${total}`,
    onShown: "explain it",
    nextCall: `call presentSlide for slide ${step + 1} of ${total}`,
  };
}

// An identical slide asked for twice (Gemini Live) is shown once.
const repeats = createRepeatGuard();

// With the slideshow's ID: the same slide asked for in a new slideshow is
// drawn again, so that slideshow's record has it.
const slideKey = (
  slideshowId: string,
  { slide, totalSlides, title, imagePrompt }: SlideArgs,
) => JSON.stringify([slideshowId, slide, totalSlides, title, imagePrompt]);

// A slideshow as shown. Slides carry no ID, so a slideshow is known by its
// mode, its length and its first slide's title: slide 1 with another title,
// or another length, starts a new one. Its ID names the file it is saved in
// (artifacts/slideshows/<id>.json).
interface ShownSlideshow {
  id: string;
  mode: SlideMode;
  totalSlides: number;
  firstTitle: string;
  /** The slides shown so far, by number. */
  slides: Map<number, ToolResult>;
  /** The slide on the screen, or being made. */
  current: number;
  /** When the current slide appeared (ms since the epoch); Infinity while it
   *  is being drawn, so no later step of a guide passes until it has
   *  appeared and the user has spoken. */
  shownAt: number;
}

// The latest slideshow of each mode: a presentation shown in the middle of a
// guide (the user asked a question between steps) leaves the guide as it
// was, so "go back to step 2" still shows that step as it was, and the next
// step is still drawn from the one before it.
const latest: Record<SlideMode, ShownSlideshow | null> = {
  presentation: null,
  steps: null,
};

// The slideshow whose slide was shown last. An identical request is dropped
// as a repeat (Gemini Live) only while its slideshow is still the one shown;
// after the other mode's slideshow, it is a request to see the slide again.
let lastShown: ShownSlideshow | null = null;

function slideshowFor(slide: SlideArgs): ShownSlideshow {
  const shown = latest[slide.mode];
  const same =
    shown?.totalSlides === slide.totalSlides &&
    (slide.slide !== 1 || shown.firstTitle === slide.title);
  if (shown && same) return shown;
  const started: ShownSlideshow = {
    id: newSequenceId(),
    mode: slide.mode,
    totalSlides: slide.totalSlides,
    firstTitle: slide.slide === 1 ? slide.title : "",
    slides: new Map(),
    current: 0,
    shownAt: -Infinity,
  };
  latest[slide.mode] = started;
  return started;
}

/** A slide shown earlier, shown again as it was, at once. */
function showAgain(
  show: ShownSlideshow,
  slide: SlideArgs,
  earlier: ToolResult,
): ToolResult {
  show.current = slide.slide;
  show.shownAt = Date.now();
  lastShown = show;
  const noun = slide.mode === "steps" ? "step" : "slide";
  // A new result, with the host's own ID.
  const { uuid: _uuid, ...shownBefore } = earlier;
  return {
    ...shownBefore,
    message: `${noun} ${slide.slide} of ${slide.totalSlides} is on the screen again, as it was`,
    instructions: slideShownInstructions(slide),
    instructionsRequired: true,
    sequence: slideSequenceStep(slide),
  };
}

function slidePrompt(slide: SlideArgs, hasReference: boolean): string {
  if (slide.mode !== "steps") {
    // The title leads the prompt as a slide's title, not as a bare sentence:
    // a question title first ("What is Photosynthesis?. A bright, sunny
    // day…") made Gemini return no image (finish reason NO_IMAGE) 4 times in
    // 12; framed like this, 0 in 12.
    return slide.title
      ? `A presentation slide titled "${slide.title}". ${slide.imagePrompt}`
      : slide.imagePrompt;
  }
  const titled = slide.title ? `, "${slide.title}"` : "";
  return [
    `An instructional illustration of step ${slide.slide} of ${slide.totalSlides}${titled}. ${slide.imagePrompt}`,
    hasReference
      ? "The reference image is the previous step: keep the same objects, hands, tools and setting, and show what this step changes."
      : "",
    "Show the action clearly, with little or no text.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Draw a slide and save it in its slideshow's record. */
async function drawSlide(
  context: SequenceContext,
  show: ShownSlideshow,
  slide: SlideArgs,
): Promise<ToolResult> {
  const previous = show.slides.get(slide.slide - 1);
  const previousPath =
    slide.mode === "steps" ? imageOf(previous).imagePath : undefined;
  const references = previousPath
    ? await usableReferences(context, [previousPath])
    : [];
  const prompt = slidePrompt(slide, references.length > 0);
  const image = await drawPicture(context, prompt, references);
  const { imageData, imagePath } = imageOf(image);
  // A failure keeps the image host's message and instructions.
  if (!imageData) return { ...image, sequence: null };

  const slideshowId = show.id;
  const recorded = await updateRecord<Slideshow>(
    context.files?.artifacts,
    SLIDESHOWS_DIR,
    slideshowId,
    (saved) => {
      const slideshow = saved ?? {
        id: slideshowId,
        title: "",
        mode: slide.mode,
        totalSlides: slide.totalSlides,
        slides: {},
      };
      if (slide.slide === 1) slideshow.title = slide.title;
      slideshow.slides[String(slide.slide)] = {
        title: slide.title,
        imagePrompt: slide.imagePrompt,
        ...(imagePath && { imagePath }),
      };
      return slideshow;
    },
  );

  const data: SlideData = {
    imageData,
    ...(imagePath && { imagePath }),
    prompt,
    slideshowId,
    slide: slide.slide,
    totalSlides: slide.totalSlides,
    title: slide.title,
    mode: slide.mode,
  };
  const noun = slide.mode === "steps" ? "step" : "slide";
  return {
    data,
    title: slide.title || `Slide ${slide.slide}`,
    message: [
      `${noun} ${slide.slide} of ${slide.totalSlides} of slideshow "${slideshowId}" is on the screen`,
      imagePath ? `saved to ${imagePath}` : "",
      recorded ? "" : NOT_SAVED("slideshow"),
    ]
      .filter(Boolean)
      .join("; "),
    instructions: slideShownInstructions(slide),
    // A turn-based host takes a turn for it: the model explains the slide.
    instructionsRequired: true,
    sequence: slideSequenceStep(slide),
  };
}

export async function presentSlide(
  context: SequenceContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const slide = parseSlideArgs(args);
  if (!slide) return { message: SLIDE_ARGS_ERROR, sequence: null };
  const show = slideshowFor(slide);
  const guide = slide.mode === "steps";
  // A guide waits for the user. Gemini Live went on to the next step in the
  // reply that explained the current one, whatever the instructions said;
  // such a step is held back.
  if (
    guide &&
    slide.slide > show.current &&
    show.current > 0 &&
    !userSpokeSince(context, show.shownAt)
  ) {
    console.info(`[sequence] holding step ${slide.slide} for the user`);
    const state =
      show.shownAt === Infinity
        ? "is still being drawn"
        : "is still on the screen";
    return {
      // No instructions: they would start another reply, and the message
      // says what to do.
      message: `step ${slide.slide} was not shown: the user hasn't said they're ready yet, and step ${show.current} ${state}. Wait for them before calling presentSlide for step ${slide.slide}.`,
      cancelled: true,
    };
  }
  const earlier = guide ? show.slides.get(slide.slide) : undefined;
  if (earlier) {
    // What is on the screen, not the guide's last step: another tool's
    // result may have replaced it since.
    if (samePicture(context.currentResult, earlier)) {
      // It is on the screen; the model explains it again by itself.
      return {
        message: `step ${slide.slide} of ${slide.totalSlides} is already on the screen`,
        cancelled: true,
      };
    }
    // Going back (or forward again): the step as it was, at once.
    return showAgain(show, slide, earlier);
  }
  // Claimed before anything is awaited, and marked pending at once: a call
  // that arrives meanwhile sees this one (a repeat waits for it, a later
  // guide step is held).
  const claim = repeats.claim(slideKey(show.id, slide));
  if ("earlier" in claim) {
    if (!(await claim.earlier)) {
      // The identical call failed: this one tries, from the start.
      return presentSlide(context, args);
    }
    // A guide's step has replaced it since: shown again, as it was.
    const shownBefore = show.slides.get(slide.slide);
    if (shownBefore && lastShown !== show) {
      return showAgain(show, slide, shownBefore);
    }
    // Not shown again, and no instructions: the model goes on by itself.
    return {
      message: `slide ${slide.slide} of ${slide.totalSlides} is already on the screen`,
      cancelled: true,
    };
  }
  const { settle } = claim;
  // Pending while it is drawn: a later step asked for meanwhile is held.
  const before = { current: show.current, shownAt: show.shownAt };
  show.current = slide.slide;
  show.shownAt = Infinity;
  let shown = false;
  try {
    const image = await drawSlide(context, show, slide);
    shown = !!imageOf(image).imageData;
    if (shown) {
      show.slides.set(slide.slide, image);
      show.current = slide.slide;
      show.shownAt = Date.now();
      lastShown = show;
    }
    return image;
  } finally {
    // A failure may be tried again.
    settle(shown);
    if (!shown && show.current === slide.slide) {
      // The slide before it is still the one on the screen.
      show.current = before.current;
      show.shownAt = before.shownAt;
    }
  }
}
