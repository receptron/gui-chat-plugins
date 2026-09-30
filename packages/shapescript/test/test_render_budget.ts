// The render's timeout budget.
//
// Nothing here starts a browser: these are the numbers a HOST sizes its transport from, and the
// bug they come from is arithmetic rather than rendering. `page.goto` was the one phase left on
// Puppeteer's own 30 s default while launch and rasterisation had explicit budgets, and on a
// loaded CI runner the page load did not always finish inside it — about 40% of one host's
// Windows runs, and a required pull-request check (receptron/mulmoterminal#2095).
import test from "node:test";
import assert from "node:assert/strict";
import {
  LAUNCH_TIMEOUT_MS,
  NAVIGATION_TIMEOUT_MS,
  RENDER_TIMEOUT_MS,
  RENDER_BUDGET_MS,
} from "../src/render/renderer";

/** What Puppeteer uses when a call is given no timeout. Named here because it is the value this
 *  change exists to stop inheriting, not because the package should ever depend on it. */
const PUPPETEER_DEFAULT_TIMEOUT_MS = 30_000;

test("the budget covers every phase one render waits on", () => {
  // A phase missing from this sum is a host transport sized to less than the work it waits for,
  // which aborts a call that was about to succeed — the reason RENDER_BUDGET_MS exists at all.
  assert.equal(
    RENDER_BUDGET_MS,
    LAUNCH_TIMEOUT_MS + NAVIGATION_TIMEOUT_MS + RENDER_TIMEOUT_MS,
  );
});

test("every phase has a real duration", () => {
  for (const [name, ms] of Object.entries({
    LAUNCH_TIMEOUT_MS,
    NAVIGATION_TIMEOUT_MS,
    RENDER_TIMEOUT_MS,
  })) {
    assert.ok(
      Number.isFinite(ms) && ms > 0,
      `${name} is not a duration: ${ms}`,
    );
  }
});

test("the page load is given more than the default it used to inherit", () => {
  // Not the exact value — that is a judgement call and belongs in the source. What must hold is
  // that the phase which timed out is no longer bounded by the default that timed it out.
  assert.ok(
    NAVIGATION_TIMEOUT_MS > PUPPETEER_DEFAULT_TIMEOUT_MS,
    `the page load is bounded by ${NAVIGATION_TIMEOUT_MS}ms, which is not more than Puppeteer's default`,
  );
});
