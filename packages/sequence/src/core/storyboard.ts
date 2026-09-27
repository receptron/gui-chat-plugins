// defineStoryboard and presentPanel: a story told in pictures, with
// characters who look the same in every panel.
//
// defineStoryboard draws a reference sheet for each character and shows the
// cast; presentPanel then draws one panel at a time with the sheets of the
// characters in it as reference images (context.app.editImages), which kept a
// character's face, hair and clothes on Gemini, OpenAI and xAI alike (a
// description repeated in every prompt did not). Panels go on like slides
// (ToolResult.sequence); a panel with choices waits for the user's pick.
// From MulmoChat and MulmoGlass.
import type { SequenceStep, ToolResult } from "gui-chat-protocol";
import {
  PANEL_ARGS_ERROR,
  castShownInstructions,
  panelShownInstructions,
  parsePanelArgs,
  parseStoryboardArgs,
  sameName,
  type CastData,
  type Character,
  type PanelArgs,
  type PanelData,
  type Storyboard,
} from "./definitions";
import {
  drawPicture,
  imageOf,
  newSequenceId,
  usableReferences,
  userSpokeSince,
  type SequenceContext,
} from "./host";
import {
  NOT_SAVED,
  STORYBOARDS_DIR,
  loadRecord,
  updateRecord,
} from "./records";
import { createRepeatGuard } from "./repeatGuard";

/** Where the story is after its cast was shown. */
const castSequenceStep = ({
  id,
  title,
  totalPanels,
}: Storyboard): SequenceStep => ({
  step: 0,
  total: totalPanels,
  kind: "story",
  label: `The cast of "${title}"`,
  onShown: "introduce the characters",
  nextCall: `call presentPanel for panel 1 of ${totalPanels} with storyboardId "${id}"`,
});

/** Where the story is after a panel was shown. */
const panelSequenceStep = (
  { id, totalPanels }: Storyboard,
  panel: number,
  choices: string[],
): SequenceStep => ({
  step: panel,
  total: totalPanels,
  kind: "story",
  label: `Panel ${panel} of ${totalPanels}`,
  onShown: "tell that part of the story",
  nextCall: `call presentPanel for panel ${panel + 1} of ${totalPanels} with storyboardId "${id}"`,
  // A panel with choices waits for the user's pick.
  ...(choices.length > 0 && { waitsForUser: true }),
});

// --- defineStoryboard ----------------------------------------------------------

// A prompt that starts with the storyboard's style, when it has one.
const styled = (style: string, prompt: string) =>
  style ? `${style}. ${prompt}` : prompt;

const sheetPrompt = (style: string, { name, description }: Character) =>
  styled(
    style,
    `Character reference sheet of ${name}: ${description}. Full body, front, side and back views, on a plain white background. No text or labels.`,
  );

export async function defineStoryboard(
  context: SequenceContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parseStoryboardArgs(args);
  if (typeof parsed === "string") return { message: parsed, sequence: null };

  const results = await Promise.all(
    parsed.characters.map((character) =>
      drawPicture(context, sheetPrompt(parsed.style, character)),
    ),
  );
  const drawn = results.map(imageOf);
  const firstFailure = results.find((_, i) => !drawn[i]?.imageData);
  if (drawn.every(({ imageData }) => !imageData) && firstFailure) {
    // Nothing to show: the image host's reason, and its instructions.
    return {
      ...firstFailure,
      message: `the character sheets couldn't be made: ${firstFailure.message}`,
      sequence: null,
    };
  }

  const storyboard: Storyboard = {
    id: newSequenceId(),
    ...parsed,
    characters: parsed.characters.map((character, i) => {
      const imagePath = drawn[i]?.imagePath;
      return { ...character, ...(imagePath && { imagePath }) };
    }),
    panels: {},
  };
  const recorded = await updateRecord<Storyboard>(
    context.files?.artifacts,
    STORYBOARDS_DIR,
    storyboard.id,
    () => storyboard,
  );

  const saved = storyboard.characters
    .filter((c) => c.imagePath)
    .map((c) => `${c.name}: ${c.imagePath}`);
  const missing = parsed.characters
    .map(({ name }, i) =>
      drawn[i]?.imageData ? null : `${name} (${results[i]?.message ?? ""})`,
    )
    .filter((line): line is string => !!line);
  const firstSheet = drawn.find((d) => d.imageData)?.imageData;
  const data: CastData = {
    storyboardId: storyboard.id,
    title: storyboard.title,
    totalPanels: storyboard.totalPanels,
    ...(firstSheet && { imageData: firstSheet }),
    characters: storyboard.characters.map(({ name, imagePath }, i) => {
      const imageData = drawn[i]?.imageData;
      return {
        name,
        ...(imageData && { imageData }),
        ...(imagePath && { imagePath }),
      };
    }),
  };
  return {
    data,
    title: storyboard.title,
    message: [
      `storyboard "${storyboard.id}" is ready with ${storyboard.totalPanels} panels; the cast is on the screen`,
      saved.length ? `character sheets saved to ${saved.join(", ")}` : "",
      missing.length
        ? `no sheet for ${missing.join("; ")}: they will be drawn from their description`
        : "",
      recorded ? "" : NOT_SAVED("storyboard"),
    ]
      .filter(Boolean)
      .join("; "),
    instructions: castShownInstructions(storyboard),
    instructionsRequired: true,
    sequence: castSequenceStep(storyboard),
  };
}

// --- presentPanel --------------------------------------------------------------

/** The prompt for a panel: the style, the scene, and who is who. */
function panelPrompt(
  storyboard: Storyboard,
  args: PanelArgs,
  cast: { character: Character; hasSheet: boolean }[],
): string {
  const lines = [
    styled(
      storyboard.style,
      `Panel ${args.panel} of ${storyboard.totalPanels} of the illustrated story "${storyboard.title}". ${args.imagePrompt}`,
    ),
  ];
  let reference = 0;
  const who = cast.map(({ character, hasSheet }) =>
    hasSheet
      ? `${character.name} is the character in reference image ${++reference}`
      : `${character.name}: ${character.description}`,
  );
  if (who.length) lines.push(`${who.join(". ")}.`);
  if (reference) {
    lines.push(
      "Draw each character exactly as in their reference image: the same face, hair, clothes and colors. Use the reference images only for how the characters look, not for their pose or the background.",
    );
  }
  lines.push("No captions, speech bubbles or other text in the picture.");
  return lines.join(" ");
}

/** Draw a panel and save it in its storyboard's record. */
async function drawPanel(
  context: SequenceContext,
  storyboard: Storyboard,
  parsed: PanelArgs,
): Promise<ToolResult> {
  const unknown: string[] = [];
  const cast: { character: Character; sheet: string | null }[] = [];
  for (const name of parsed.characters) {
    const character = storyboard.characters.find((c) => sameName(c.name, name));
    if (!character) unknown.push(name);
    else if (!cast.some((c) => c.character === character)) {
      const [sheet] = character.imagePath
        ? await usableReferences(context, [character.imagePath])
        : [];
      cast.push({ character, sheet: sheet ?? null });
    }
  }
  const references = cast
    .map(({ sheet }) => sheet)
    .filter((sheet): sheet is string => !!sheet);
  const prompt = panelPrompt(
    storyboard,
    parsed,
    cast.map(({ character, sheet }) => ({ character, hasSheet: !!sheet })),
  );
  const image = await drawPicture(context, prompt, references);
  const { imageData, imagePath } = imageOf(image);
  // A failure keeps the image host's message and instructions.
  if (!imageData) return { ...image, sequence: null };

  // Choices make the story interactive, whether or not defineStoryboard
  // said so (Gemini Live gave choices without it); none on the last panel.
  const choices =
    parsed.panel < storyboard.totalPanels && parsed.choices.length >= 2
      ? parsed.choices
      : [];
  const recorded = await updateRecord<Storyboard>(
    context.files?.artifacts,
    STORYBOARDS_DIR,
    storyboard.id,
    (saved) => {
      const latest = saved ?? storyboard;
      if (choices.length) latest.interactive = true;
      latest.panels[String(parsed.panel)] = {
        caption: parsed.caption,
        characters: cast.map(({ character }) => character.name),
        imagePrompt: parsed.imagePrompt,
        ...(imagePath && { imagePath }),
        ...(choices.length && { choices }),
      };
      return latest;
    },
  );

  const data: PanelData = {
    imageData,
    ...(imagePath && { imagePath }),
    prompt,
    storyboardId: storyboard.id,
    panel: parsed.panel,
    totalPanels: storyboard.totalPanels,
    caption: parsed.caption,
    ...(choices.length && { choices }),
  };
  return {
    data,
    title: parsed.caption || `Panel ${parsed.panel}`,
    message: [
      `panel ${parsed.panel} of ${storyboard.totalPanels} is on the screen`,
      imagePath ? `saved to ${imagePath}` : "",
      unknown.length
        ? `not in the cast, so drawn from the prompt alone: ${unknown.join(", ")}`
        : "",
      recorded ? "" : NOT_SAVED("storyboard"),
    ]
      .filter(Boolean)
      .join("; "),
    instructions: panelShownInstructions(storyboard, parsed.panel, choices),
    instructionsRequired: true,
    sequence: panelSequenceStep(storyboard, parsed.panel, choices),
  };
}

// An identical panel asked for twice (Gemini Live) is shown once.
const repeats = createRepeatGuard();

// The panel waiting for the user's choice, by storyboard, and when it
// appeared. Grok sometimes went on to the next panel in the reply that read
// the choices out; such a panel is held back until the user speaks. A panel
// being drawn is here too, with shownAt Infinity: its choices aren't known
// yet, so a later panel waits for it.
const awaitingChoice = new Map<string, { panel: number; shownAt: number }>();

export async function presentPanel(
  context: SequenceContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parsePanelArgs(args);
  if (!parsed) return { message: PANEL_ARGS_ERROR, sequence: null };
  const storyboard = await loadRecord<Storyboard>(
    context.files?.artifacts,
    STORYBOARDS_DIR,
    parsed.storyboardId,
  );
  if (!storyboard) {
    return {
      message: `there is no storyboard "${parsed.storyboardId}"; call defineStoryboard first`,
      sequence: null,
    };
  }
  if (parsed.panel > storyboard.totalPanels) {
    return {
      message: `storyboard "${storyboard.id}" has ${storyboard.totalPanels} panels`,
      sequence: null,
    };
  }
  const { storyboardId, panel } = parsed;

  const waiting = awaitingChoice.get(storyboardId);
  if (
    waiting &&
    panel > waiting.panel &&
    !userSpokeSince(context, waiting.shownAt)
  ) {
    console.info(`[sequence] holding panel ${panel} for the user`);
    // No instructions: they would start another reply.
    return {
      message:
        waiting.shownAt === Infinity
          ? `panel ${panel} was not shown: panel ${waiting.panel} is still being drawn. Wait for it before going on.`
          : `panel ${panel} was not shown: the user hasn't picked a choice yet, and panel ${waiting.panel} is still on the screen. Wait for their answer.`,
      cancelled: true,
    };
  }

  const key = JSON.stringify(parsed);
  if (await repeats.alreadyShown(key)) {
    // Not shown again, and no instructions: the model goes on by itself.
    return {
      message: `panel ${panel} of ${storyboard.totalPanels} is already on the screen`,
      cancelled: true,
    };
  }
  const settle = repeats.begin(key);
  const pending = { panel, shownAt: Infinity };
  const before = awaitingChoice.get(storyboardId);
  awaitingChoice.set(storyboardId, pending);
  // Whether this panel is still the latest one asked for.
  const latest = () => awaitingChoice.get(storyboardId) === pending;

  let shown = false;
  try {
    const image = await drawPanel(context, storyboard, parsed);
    shown = !!imageOf(image).imageData;
    const data = image.data as PanelData | undefined;
    if (shown && latest()) {
      if (data?.choices?.length) {
        awaitingChoice.set(storyboardId, { panel, shownAt: Date.now() });
      } else {
        awaitingChoice.delete(storyboardId);
      }
    }
    return image;
  } finally {
    settle(shown);
    // The panel before it is still the one waiting, if one was.
    if (!shown && latest()) {
      if (before) awaitingChoice.set(storyboardId, before);
      else awaitingChoice.delete(storyboardId);
    }
  }
}
