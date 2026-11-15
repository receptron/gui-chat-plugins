// How tall the 3D view is: the View is the model on top, a bar the user
// drags, and everything else (report, files, script) scrolling below it.
//
// Pure, so it is tested without a browser.

/** The least the model keeps, px. */
export const MIN_MODEL = 96;
/** The least left below the bar, px: enough to see there is something to
 *  scroll. */
export const MIN_BELOW = 72;
/** The model's share of the height until the user has dragged the bar. */
export const DEFAULT_SHARE = 0.6;
/** One arrow-key press on the bar, px. */
export const KEY_STEP = 24;

/** The model's height, px.
 *
 * `wanted` is where the user left the bar, or null before they touched it;
 * `available` is what the model and the part below it have to share (the
 * View's height less its header and the bar).
 *
 * The result always fits: in a pane too short for both minimums the two halve
 * what there is, so neither the model nor the scrolling part ever disappears.
 */
export function modelHeight(wanted: number | null, available: number): number {
  if (!Number.isFinite(available) || available <= 0) return 0;
  if (available < MIN_MODEL + MIN_BELOW) return Math.round(available / 2);
  const height =
    wanted === null || !Number.isFinite(wanted)
      ? available * DEFAULT_SHARE
      : wanted;
  return Math.round(
    Math.min(Math.max(height, MIN_MODEL), available - MIN_BELOW),
  );
}

/** Where the user's height is kept between results: a View is mounted anew
 *  for each one, and the bar should stay where it was put. */
export const STORAGE_KEY = "@gui-chat-plugin/brep:modelHeight";

/** The stored height, or null: storage can be missing, blocked or hold
 *  anything. */
export function readStoredHeight(): number | null {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function storeHeight(height: number): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(Math.round(height)));
  } catch {
    // Not kept; the bar still works for this View.
  }
}
