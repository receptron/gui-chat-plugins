// What the tools need from their host, all through gui-chat-protocol:
//
// - context.app.generateImage(prompt) and, for reference pictures,
//   context.app.editImages(prompt, imagePaths): the host's image backend,
//   which saves each picture as artifacts/images/… and says where
//   (data.imagePath). Without editImages, steps are drawn from the prompt
//   alone.
// - context.files.artifacts: the workspace's artifacts/ directory, for the
//   slideshow and storyboard records.
// - context.userSpokeAt: when the user last spoke, to hold a step that waits
//   for them. Absent: nothing is held.
// - context.currentResult: what is on the screen, to tell "show step 2
//   again" from a repeated call.
//
// MulmoChat runs execute() on its server and sends userSpokeAt and the
// current result with the request; MulmoGlass runs it in the page.
import type { FileOps, ToolContext, ToolResult } from "gui-chat-protocol";

/** The context execute() is called with. */
export type SequenceContext = ToolContext & {
  files?: { artifacts: FileOps };
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isToolResult = (value: unknown): value is ToolResult =>
  isRecord(value) && typeof value.message === "string";

/** The picture a result carries, and where it was saved. */
export function imageOf(result: ToolResult | null | undefined): {
  imageData?: string;
  imagePath?: string;
} {
  const data = isRecord(result?.data) ? result.data : {};
  return {
    ...(typeof data.imageData === "string" && { imageData: data.imageData }),
    ...(typeof data.imagePath === "string" && { imagePath: data.imagePath }),
  };
}

/** Whether two results show the same picture: by its saved path when both
 *  have one (a host may send the current result without its image data),
 *  else by the picture itself. */
export function samePicture(
  a: ToolResult | null | undefined,
  b: ToolResult | null | undefined,
): boolean {
  const first = imageOf(a);
  const second = imageOf(b);
  if (first.imagePath && second.imagePath) {
    return first.imagePath === second.imagePath;
  }
  return !!first.imageData && first.imageData === second.imageData;
}

/** When the user spoke after `time` (ms since the epoch). A host that doesn't
 *  say when the user spoke holds nothing. */
export const userSpokeSince = (
  context: SequenceContext,
  time: number,
): boolean => context.userSpokeAt === undefined || context.userSpokeAt > time;

export const newSequenceId = (): string =>
  crypto.randomUUID().replace(/-/g, "").slice(0, 12);

const ARTIFACTS_PREFIX = "artifacts/";

/** The saved pictures among `paths` that the host can draw from: under
 *  artifacts/, still there, and only when the host takes references. */
export async function usableReferences(
  context: SequenceContext,
  paths: readonly string[],
): Promise<string[]> {
  const files = context.files?.artifacts;
  if (!context.app?.["editImages"] || !files) return [];
  const usable: string[] = [];
  for (const path of paths) {
    if (!path.startsWith(ARTIFACTS_PREFIX)) continue;
    try {
      if (await files.exists(path.slice(ARTIFACTS_PREFIX.length))) {
        usable.push(path);
      }
    } catch {
      // A path the host refuses is not one to draw from.
    }
  }
  return usable;
}

/** A picture from the host: from `references` (saved paths) when there are
 *  any, else from the prompt alone. A failure is a result saying why. */
export async function drawPicture(
  context: SequenceContext,
  prompt: string,
  references: readonly string[] = [],
): Promise<ToolResult> {
  const app = context.app;
  const edit = app?.["editImages"];
  const generate = app?.["generateImage"];
  try {
    let drawn: unknown;
    if (references.length && edit) drawn = await edit(prompt, [...references]);
    else if (generate) drawn = await generate(prompt);
    else return { message: "image generation isn't available" };
    return isToolResult(drawn)
      ? drawn
      : { message: "image generation returned an unrecognized result" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { message: `image generation failed: ${reason}` };
  }
}
