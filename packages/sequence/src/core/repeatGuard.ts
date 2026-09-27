// Gemini Live sometimes calls the next step twice: once in the reply it
// starts by itself after the tool output, once in the reply the instructions
// start. The two calls are identical, so a step asked for in the last minute
// with the same arguments is not made again; a later "show slide 2 again" is
// outside the minute. A repeat that arrives while the first is still being
// made waits for it: it may yet fail.
const DUPLICATE_WINDOW_MS = 60_000;

/** Drops a repeat of a request made in the last minute. */
export function createRepeatGuard() {
  const recent = new Map<string, { at: number; shown: Promise<boolean> }>();

  /** Whether an identical recent request showed its picture. */
  const alreadyShown = async (key: string): Promise<boolean> => {
    const now = Date.now();
    for (const [k, entry] of recent) {
      if (now - entry.at > DUPLICATE_WINDOW_MS) recent.delete(k);
    }
    const earlier = recent.get(key);
    return !!earlier && (await earlier.shown);
  };

  /** Start a request; call the result with whether it was shown. A failed
   *  one may be tried again. */
  const begin = (key: string): ((shown: boolean) => void) => {
    let settle: (shown: boolean) => void = () => undefined;
    const shown = new Promise<boolean>((resolve) => (settle = resolve));
    recent.set(key, { at: Date.now(), shown });
    return (wasShown) => {
      if (!wasShown && recent.get(key)?.shown === shown) recent.delete(key);
      settle(wasShown);
    };
  };

  return { alreadyShown, begin };
}
