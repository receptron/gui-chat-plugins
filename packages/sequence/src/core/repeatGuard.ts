// Gemini Live sometimes calls the next step twice: once in the reply it
// starts by itself after the tool output, once in the reply the instructions
// start. The two calls are identical, so a step asked for in the last minute
// with the same arguments is not made again; a later "show slide 2 again" is
// outside the minute. A repeat that arrives while the first is still being
// made waits for it: it may yet fail.
const DUPLICATE_WINDOW_MS = 60_000;

/**
 * A request claimed: either this call makes it (`settle` says whether it was
 * shown), or an identical one made in the last minute does (`earlier`
 * resolves to whether that one was shown).
 */
export type Claim =
  { settle: (shown: boolean) => void } | { earlier: Promise<boolean> };

/** Drops a repeat of a request made in the last minute. */
export function createRepeatGuard() {
  const recent = new Map<string, { at: number; shown: Promise<boolean> }>();

  /**
   * Claim a request, synchronously: checking and reserving it happen in one
   * step, so two identical calls that arrive together can't both make it
   * (checking, awaiting, then reserving let both through). A failed request
   * gives up its claim, so a later call may try again.
   */
  const claim = (key: string): Claim => {
    const now = Date.now();
    for (const [k, entry] of recent) {
      if (now - entry.at > DUPLICATE_WINDOW_MS) recent.delete(k);
    }
    const earlier = recent.get(key);
    if (earlier) return { earlier: earlier.shown };
    let settleShown: (shown: boolean) => void = () => undefined;
    const shown = new Promise<boolean>((resolve) => (settleShown = resolve));
    recent.set(key, { at: now, shown });
    return {
      settle: (wasShown) => {
        if (!wasShown && recent.get(key)?.shown === shown) recent.delete(key);
        settleShown(wasShown);
      },
    };
  };

  return { claim };
}
