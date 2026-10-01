// The tools' definitions, the prompts that tell the model when to use them,
// the argument checks, the instructions a shown step carries, and the shapes
// of the records saved in artifacts/slideshows/ and artifacts/storyboards/.
// From MulmoChat (server/plugins/sequenceTools.ts) and MulmoGlass.
import type { ToolDefinition } from "gui-chat-protocol";
import { SLIDE_CHART_TYPES, type SlideChart } from "./chartSlide";
import { MAX_SLIDE_HTML, SLIDE_HEIGHT, SLIDE_WIDTH } from "./slideHtml";

export const PRESENT_SLIDE = "presentSlide";
export const DEFINE_STORYBOARD = "defineStoryboard";
export const PRESENT_PANEL = "presentPanel";

export const MAX_CHARACTERS = 4;
export const MAX_PANELS = 12;
export const MAX_CHOICES = 3;

/** A slideshow's or storyboard's ID: 12 hex digits, also its file name. */
export const SEQUENCE_ID = /^[0-9a-f]{12}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const sameName = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

const isWholeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

// --- presentSlide ------------------------------------------------------------

export type SlideMode = "presentation" | "steps";

export interface SlideArgs {
  slide: number;
  totalSlides: number;
  title: string;
  /** The picture's prompt; "" for a slide that isn't a picture. */
  imagePrompt: string;
  /** An HTML slide's body. */
  html?: string;
  /** A Markdown slide's text, with TeX math. */
  markdown?: string;
  /** A chart slide's Chart.js configuration. */
  chart?: SlideChart;
  mode: SlideMode;
}

export const SLIDE_ARGS_ERROR =
  "presentSlide needs slide and totalSlides (whole numbers, slide from 1 to totalSlides), and one of imagePrompt, html, markdown or chart";

export const SLIDE_HTML_TOO_LONG = `presentSlide's slide is too long: keep its html, markdown or chart under ${MAX_SLIDE_HTML} characters`;

export const SLIDE_CHART_INVALID = `presentSlide's chart must be a Chart.js configuration: an object with type (${SLIDE_CHART_TYPES.join(", ")}), data ({ labels, datasets }) and optionally options`;

/** A chart argument as a Chart.js configuration, or null. Some models send
 *  an object argument as its JSON. */
function parseChart(value: unknown): SlideChart | null {
  let chart = value;
  if (typeof chart === "string") {
    try {
      chart = JSON.parse(chart);
    } catch {
      return null;
    }
  }
  if (!isRecord(chart) || !isRecord(chart.data)) return null;
  const type = chart.type;
  if (!SLIDE_CHART_TYPES.some((known) => known === type)) return null;
  if (chart.options !== undefined && !isRecord(chart.options)) return null;
  return chart as SlideChart;
}

/** The slide arguments, or what is wrong with them (said to the model). A
 *  slide is one kind: html first, then markdown, then chart, then a
 *  picture, whatever else was sent with it. */
export function parseSlideArgs(
  args: Record<string, unknown>,
): SlideArgs | string {
  const { slide, totalSlides, title, imagePrompt } = args;
  const html = text(args.html);
  const markdown = html ? "" : text(args.markdown);
  const hasChart =
    !html && !markdown && args.chart !== undefined && args.chart !== null;
  if (
    !isWholeNumber(slide) ||
    !isWholeNumber(totalSlides) ||
    slide < 1 ||
    totalSlides < slide ||
    (!html && !markdown && !hasChart && !text(imagePrompt))
  ) {
    return SLIDE_ARGS_ERROR;
  }
  const chart = hasChart ? parseChart(args.chart) : null;
  if (hasChart && !chart) return SLIDE_CHART_INVALID;
  const size = Math.max(
    html.length,
    markdown.length,
    chart ? JSON.stringify(chart).length : 0,
  );
  if (size > MAX_SLIDE_HTML) return SLIDE_HTML_TOO_LONG;
  const picture = !html && !markdown && !chart;
  return {
    slide,
    totalSlides,
    title: typeof title === "string" ? title : "",
    imagePrompt: picture ? String(imagePrompt) : "",
    ...(html && { html }),
    ...(markdown && { markdown }),
    ...(chart && { chart }),
    mode: args.mode === "steps" ? "steps" : "presentation",
  };
}

// How to explain a slide: the subject, not the slide. Asked only to
// "explain it", OpenAI's voice models said a line about the slide ("Let's
// start with the big picture, then we'll move on") and went on to the next,
// and the user heard "This first slide is about quantum theory" rather than
// "Quantum theory is…". Asked for "at least two sentences", Grok said two
// on every slide, whatever was on it: one or two of a slide's eight points,
// then the next slide replaced it. So: everything on it.
const NARRATE_SUBJECT =
  'teach its subject as a presenter speaking to the audience, and cover everything on it: every section, point and number, in order, each in a sentence or more. The slide is replaced by the next one as soon as you stop talking, so a point you leave out is never explained. Begin with the content itself, never with the slide or your plan: no "This slide is about…", "The first slide shows…", "Let\'s unpack this one", "Next, I\'ll…". A line about the slide is not an explanation.';

/** What the model does once a slide is on the screen. */
export const slideShownInstructions = ({
  slide,
  totalSlides,
  title,
  mode,
}: SlideArgs): string => {
  const titled = title ? ` ("${title}")` : "";
  if (mode === "steps") {
    const label = `Step ${slide} of ${totalSlides}${titled}`;
    return slide < totalSlides
      ? `${label} is now on the screen. Say what to do in this step, directly ("Crack two eggs into a bowl…", not "This step is about eggs"), then stop and wait while the user does it. When they say they're ready (next, done, go on), call presentSlide for step ${slide + 1} with mode "steps". If they ask to go back or to see a step again, call presentSlide for that step.`
      : `${label}, the last one, is now on the screen. Say what to do, directly, then wrap up the guide once the user is done.`;
  }
  const label = `Slide ${slide} of ${totalSlides}${titled}`;
  // The explanation is a reply of its own, and the host's sequence keeper
  // asks for the next slide when it ends. Asked to explain the slide and
  // call the next one in the same reply, voice models announced the call
  // instead of explaining: Grok said the slide's first sentence, word for
  // word, and OpenAI's Realtime a preamble ("I'll walk through the figures,
  // then move on"), and the next slide replaced this one unexplained. With
  // no call to make, OpenAI explained every slide in 6 slideshows of 6.
  // The "stop" clause is for when the host missed
  // the user's speech (Gemini can report it too late): the model heard it.
  return slide < totalSlides
    ? `${label} is now on the screen. Explain it: ${NARRATE_SUBJECT} This reply is only the explanation: don't call presentSlide in it. When you have finished, you will be asked for slide ${slide + 1}. If the user has asked you to stop, or asked something else, since the slideshow began, answer them instead of going on.`
    : `${label}, the last one, is now on the screen. Explain it: ${NARRATE_SUBJECT} Then wrap up the slideshow.`;
};

/** A slideshow as saved in artifacts/slideshows/<id>.json. */
export interface Slideshow {
  id: string;
  /** The first slide's title. */
  title: string;
  mode: SlideMode;
  totalSlides: number;
  slides: Record<
    string,
    {
      title: string;
      /** "" for a slide that isn't a picture. */
      imagePrompt: string;
      imagePath?: string;
      /** An HTML slide's body (slideHtmlDocument makes it a page); for a
       *  Markdown slide, the HTML made of it. */
      html?: string;
      /** A Markdown slide's text, as the model wrote it. */
      markdown?: string;
      /** A chart slide's Chart.js configuration (chartSlideDocument). */
      chart?: SlideChart;
    }
  >;
}

/** A shown slide's result data: a picture, an HTML slide's body (a
 *  Markdown slide's included, with its markdown), or a chart. */
export interface SlideData {
  imageData?: string;
  imagePath?: string;
  html?: string;
  markdown?: string;
  chart?: SlideChart;
  /** The picture's prompt; "" for a slide that isn't a picture. */
  prompt: string;
  slideshowId: string;
  slide: number;
  totalSlides: number;
  title: string;
  mode: SlideMode;
}

const SLIDE_HTML_DESCRIPTION = [
  `For an HTML slide, instead of imagePrompt: the slide's content, the inside of <body> only (no <html>, <head> or <body> tags), for a ${SLIDE_WIDTH}x${SLIDE_HEIGHT} px canvas, which it should fill (start with a <div class="w-full h-full ...">). Style it with Tailwind CSS v4 classes, which are loaded for you: a clear layout, a large title (text-6xl or so), few words in large type, a color scheme, and inline SVG or emoji for icons and diagrams. There is no network: no <img> from URLs, no links to follow.`,
  `Animate it so it builds up as you explain it, with MulmoCast's data-animation attributes (the same ones make it move in a movie of the slideshow): data-animation="animate" with data-opacity="0,1", data-translate-x, data-translate-y (px), data-scale, data-rotate (deg), data-width or data-height ("0,80,%"), each "from,to"; data-animation="counter" with data-from, data-to, data-decimals, data-prefix, data-suffix; data-animation="typewriter" (its text, or data-text). Give every one data-start and data-end in seconds, and optionally data-easing (linear, easeIn, easeOut, easeInOut); stagger the parts with later data-start values so they appear one after another over a few seconds (for example 0, 0.6, 1.2). Set the first frame inline too (style="opacity:0" on an element that fades in).`,
  `CSS animations, transitions and scripts don't play: animate only with data-animation. A <style> for layout is allowed (and Google Fonts by @import).`,
].join(" ");

const SLIDE_MARKDOWN_DESCRIPTION =
  "For a Markdown slide, instead of imagePrompt: the slide in Markdown (GitHub's: headings, lists, bold, tables, code), with math in TeX between $...$ inline or $$...$$ for a displayed equation (on lines of its own). Start with a # heading, and keep it to what fits on one slide: a heading and a few lines, a list or an equation or two. Write a dollar sign that isn't math as \\$.";

const SLIDE_CHART_DESCRIPTION = `For a chart slide, instead of imagePrompt (for numbers: real figures you have, never a picture of a chart): a Chart.js configuration as JSON text, {"type": ..., "data": ...}: { type, data: { labels, datasets: [{ label, data, backgroundColor }] }, options }. type is one of ${SLIDE_CHART_TYPES.join(", ")}. It is drawn under the slide's title, so leave out options.plugins.title; give the datasets colors, and the axes titles (options.scales.x.title) when their units aren't obvious. JSON values only: no functions.`;

export const PRESENT_SLIDE_PROMPT: string =
  'When the user asks for a slideshow (or to explain something with slides), plan four to six slides (more when the subject or your instructions need them), then show them one at a time with presentSlide: slide 1 first, and each next slide only after you have explained the one on the screen. Explain the subject, not the slides: say what the slide teaches, not that a slide is about it, and explain everything on a slide before showing the next; put on a slide only what you will explain. Go on to the last slide without asking whether to continue. A slide is a generated picture (imagePrompt), a chart (chart), a text slide in Markdown (markdown) or a designed slide in HTML (html): use a picture for a scene, an object or a place; a chart for numbers to compare, a trend or proportions; Markdown for equations and formulas (TeX math), definitions, short lists and small tables; and HTML for designed layouts, comparisons, timelines and diagrams. A picture model draws words, numbers and math badly, so they go on the other kinds; a slideshow can mix them. Numbers go on a chart slide: when you have figures (from a search, a document or the user: revenue, market share, growth, prices, counts over time), show them in a chart with those exact values, labelled with their units and the year or period, and say where they come from. Figures over time, shares of a whole or values side by side are a chart, not a list or table on a Markdown or HTML slide. Never make a chart, graph or table a picture (imagePrompt): a picture of a chart has made-up bars and no real numbers. A slideshow about a business, a market or a comparison of companies has its figures on chart slides, not only in text. Never invent figures; with none to show, leave the chart out. A slide holds only its subject, never notes about your work (what you searched for, that a search succeeded). When the user asks for HTML slides (slides in HTML, an HTML presentation), this is the tool: make them HTML slides with presentSlide, one call per slide, not one HTML page. When the user wants to be shown how to do something they will do along with you (cooking, folding, fixing, an exercise), make it a step-by-step guide instead: mode "steps", one slide per step, and after each step wait for the user to say they are ready. Use generateImage for a single picture, not for slides.';

export const PRESENT_SLIDE_DEFINITION: ToolDefinition = {
  type: "function",
  name: PRESENT_SLIDE,
  prompt: PRESENT_SLIDE_PROMPT,
  description:
    'Show one slide of a slideshow, full screen: a picture generated from imagePrompt, a chart (chart), a slide written in Markdown with TeX math (markdown), or a slide written in HTML (html). Give one of the four. Call it once per slide, in order, starting with slide 1. With mode "steps" it is a step-by-step guide: one slide per step, and the next step waits for the user.',
  parameters: {
    type: "object",
    properties: {
      slide: {
        type: "integer",
        description: "This slide's number, starting at 1.",
      },
      totalSlides: {
        type: "integer",
        description:
          "How many slides the slideshow has. Keep it the same for every slide.",
      },
      title: { type: "string", description: "The slide's title." },
      imagePrompt: {
        type: "string",
        description:
          "For a picture slide: the picture, a clear illustration of its point, with the title as its only large text. Be concrete. Never a chart, graph, table, dashboard, infographic, key figures or anything with numbers: those are chart, Markdown or HTML slides. For a step, show the action: hands, tools and the object. Leave it out for a chart, Markdown or HTML slide.",
      },
      html: {
        type: "string",
        description: SLIDE_HTML_DESCRIPTION,
      },
      markdown: {
        type: "string",
        description: SLIDE_MARKDOWN_DESCRIPTION,
      },
      // JSON text, not an object: an object without properties, which a
      // Chart.js configuration is here, Gemini Live used for 2 charts in 4
      // asked for (drawing the others in HTML), JSON text for 3 in 3. An
      // object is still read (parseChart).
      chart: {
        type: "string",
        description: SLIDE_CHART_DESCRIPTION,
      },
      mode: {
        type: "string",
        enum: ["presentation", "steps"],
        description:
          '"presentation" (the default) goes on by itself; "steps" is a how-to the user does along with you, and waits for them after each step. Keep it the same for every slide.',
      },
    },
    required: ["slide", "totalSlides", "title"],
  },
};

// --- defineStoryboard --------------------------------------------------------

export interface Character {
  name: string;
  description: string;
  /** Its reference sheet, when one was made and saved. */
  imagePath?: string;
}

export interface Panel {
  caption: string;
  characters: string[];
  imagePrompt: string;
  imagePath?: string;
  /** In an interactive story, what the user chose between after it. */
  choices?: string[];
}

/** A storyboard as saved in artifacts/storyboards/<id>.json. It maps onto a
 *  MulmoScript: each character (name and sheet) an entry in
 *  imageParams.images, each panel a beat, a panel's characters its
 *  imageNames. */
export interface Storyboard {
  id: string;
  title: string;
  style: string;
  totalPanels: number;
  characters: Character[];
  /** The user chooses what happens at some panels; the panels saved are the
   *  path the story took. */
  interactive: boolean;
  panels: Record<string, Panel>;
}

export interface StoryboardArgs {
  title: string;
  style: string;
  totalPanels: number;
  characters: Character[];
  interactive: boolean;
}

/** The arguments, or what is wrong with them (said to the model). */
export function parseStoryboardArgs(
  args: Record<string, unknown>,
): StoryboardArgs | string {
  const { totalPanels } = args;
  if (
    !isWholeNumber(totalPanels) ||
    totalPanels < 1 ||
    totalPanels > MAX_PANELS
  ) {
    return `totalPanels must be a whole number from 1 to ${MAX_PANELS}`;
  }
  const characters: Character[] = [];
  for (const item of Array.isArray(args.characters) ? args.characters : []) {
    const name = isRecord(item) ? text(item.name) : "";
    const description = isRecord(item) ? text(item.description) : "";
    if (!name || !description) {
      return "every character needs a name and a description";
    }
    if (characters.some((c) => sameName(c.name, name))) {
      return `two characters are named ${name}`;
    }
    characters.push({ name, description });
  }
  if (characters.length < 1 || characters.length > MAX_CHARACTERS) {
    return `a storyboard has 1 to ${MAX_CHARACTERS} characters`;
  }
  return {
    title: text(args.title),
    style: text(args.style),
    totalPanels,
    characters,
    interactive: args.interactive === true,
  };
}

export const castShownInstructions = ({ title, id }: Storyboard): string =>
  `The cast of "${title}" is now on the screen. Introduce the characters briefly, then, in this same reply and without waiting for the user, call presentPanel for panel 1 with storyboardId "${id}". If the user has asked you to stop, or asked something else, answer them instead of going on.`;

/** The cast's result data. */
export interface CastData {
  storyboardId: string;
  title: string;
  totalPanels: number;
  /** The first sheet, for the preview. */
  imageData?: string;
  characters: { name: string; imageData?: string; imagePath?: string }[];
}

// --- presentPanel ------------------------------------------------------------

export interface PanelArgs {
  storyboardId: string;
  panel: number;
  characters: string[];
  imagePrompt: string;
  caption: string;
  choices: string[];
}

export const PANEL_ARGS_ERROR =
  "presentPanel needs a storyboardId, a panel number (from 1) and an imagePrompt";

export function parsePanelArgs(
  args: Record<string, unknown>,
): PanelArgs | null {
  const { panel } = args;
  const storyboardId = text(args.storyboardId);
  const imagePrompt = text(args.imagePrompt);
  if (!storyboardId || !imagePrompt || !isWholeNumber(panel) || panel < 1) {
    return null;
  }
  const strings = (value: unknown) =>
    (Array.isArray(value) ? value : []).map(text).filter(Boolean);
  return {
    storyboardId,
    panel,
    characters: strings(args.characters),
    imagePrompt,
    caption: text(args.caption),
    choices: strings(args.choices).slice(0, MAX_CHOICES),
  };
}

export function panelShownInstructions(
  storyboard: Pick<Storyboard, "id" | "totalPanels">,
  panel: number,
  choices: string[],
): string {
  const { id, totalPanels } = storyboard;
  if (choices.length) {
    const listed = choices.map((choice, i) => `${i + 1}. ${choice}`).join(" ");
    return `Panel ${panel} of ${totalPanels} is now on the screen, with the user's choices: ${listed} Tell this part of the story, then read the choices out and ask the user which one they pick, and wait for their answer. Then call presentPanel for panel ${panel + 1} with storyboardId "${id}", going on the way they chose.`;
  }
  return panel < totalPanels
    ? `Panel ${panel} of ${totalPanels} is now on the screen. Tell this part of the story, then, in this same reply and without waiting for the user, call presentPanel for panel ${panel + 1} with storyboardId "${id}". If the user has asked you to stop, or asked something else, since the story began, answer them instead of going on.`
    : `Panel ${panel} of ${totalPanels}, the last one, is now on the screen. Tell this part of the story, then bring it to an end.`;
}

/** A shown panel's result data. */
export interface PanelData {
  imageData: string;
  imagePath?: string;
  prompt: string;
  storyboardId: string;
  panel: number;
  totalPanels: number;
  caption: string;
  choices?: string[];
}

export const STORYBOARD_PROMPT =
  "When the user asks for a story, a picture book, a comic or a storyboard, tell it in pictures: first call defineStoryboard with the art style and the characters who appear more than once (it draws a reference sheet for each, so they look the same in every panel), then show the panels one at a time with presentPanel, naming the characters in each, and tell each part of the story when its panel appears. Go on to the last panel without asking whether to continue, unless the story is interactive. When the user wants to decide what happens (an adventure, a story for a child who wants to choose), set interactive, and give two or three choices on two or three of the panels: the story waits there for the user's pick and goes on their way; it still ends at the last panel whichever way it goes. Use presentSlide to explain a topic, not to tell a story.";

export const DEFINE_STORYBOARD_DEFINITION: ToolDefinition = {
  type: "function",
  name: DEFINE_STORYBOARD,
  prompt: STORYBOARD_PROMPT,
  description:
    "Start a story told in pictures: set its art style and draw a reference sheet for each recurring character, shown as the cast. Then call presentPanel for each panel, in order.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "The story's title." },
      style: {
        type: "string",
        description:
          "The art style of every picture, in one sentence (for example: soft watercolor, children's picture book).",
      },
      totalPanels: {
        type: "integer",
        description: `How many panels the story has, at most ${MAX_PANELS}; four to eight is usual.`,
      },
      interactive: {
        type: "boolean",
        description:
          "The user chooses what happens: panels can offer choices, and the story waits for the pick.",
      },
      characters: {
        type: "array",
        description: `The characters who appear in more than one panel, 1 to ${MAX_CHARACTERS}.`,
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "A short name, used in presentPanel.",
            },
            description: {
              type: "string",
              description:
                "How they look: age, build, face, hair, clothes and colors. Be concrete: it is drawn once and reused in every panel.",
            },
          },
          required: ["name", "description"],
        },
      },
    },
    required: ["title", "style", "totalPanels", "characters"],
  },
};

export const PRESENT_PANEL_DEFINITION: ToolDefinition = {
  type: "function",
  name: PRESENT_PANEL,
  description:
    "Show one panel of a storyboard made with defineStoryboard: a picture of the scene with its characters drawn as in their reference sheets, and a caption. Call it once per panel, in order, starting with panel 1.",
  parameters: {
    type: "object",
    properties: {
      storyboardId: {
        type: "string",
        description: "The storyboardId defineStoryboard returned.",
      },
      panel: {
        type: "integer",
        description: "This panel's number, starting at 1.",
      },
      characters: {
        type: "array",
        items: { type: "string" },
        description:
          "The names (as in defineStoryboard) of the characters in this panel.",
      },
      imagePrompt: {
        type: "string",
        description:
          "What the panel shows: the setting, what happens, expressions and the camera angle. Refer to characters by name; don't describe their looks again.",
      },
      caption: {
        type: "string",
        description: "One short line shown under the picture.",
      },
      choices: {
        type: "array",
        items: { type: "string" },
        description:
          "Only in an interactive story, and not on the last panel: two or three short options for what happens next. The story waits for the user's pick.",
      },
    },
    required: ["storyboardId", "panel", "characters", "imagePrompt"],
  },
};
