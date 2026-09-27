import { test } from "node:test";
import assert from "node:assert/strict";

import { defineStoryboard, presentPanel } from "../src/core/storyboard";
import { loadRecord, updateRecord, STORYBOARDS_DIR } from "../src/core/records";
import type { Storyboard } from "../src/core/definitions";
import { fakeHost, memoryFiles, record } from "./fakeHost";

const cast = {
  title: "Mia and Biscuit",
  style: "watercolor",
  totalPanels: 3,
  characters: [
    { name: "Mia", description: "a girl in a yellow raincoat" },
    { name: "Biscuit", description: "a tan puppy" },
  ],
};

const data = (result: { data?: unknown }) =>
  (result.data ?? {}) as Record<string, unknown>;

test("the cast is drawn and saved, and the story starts", async () => {
  const host = fakeHost();
  const result = await defineStoryboard(host.context(), cast);
  const id = String(data(result).storyboardId);
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(result.sequence?.step, 0);
  assert.equal(result.sequence?.label, 'The cast of "Mia and Biscuit"');
  assert.equal(result.instructionsRequired, true);
  const saved = record(host.artifacts, `storyboards/${id}.json`);
  assert.deepEqual(
    (saved.characters as { name: string; imagePath?: string }[]).map((c) => [
      c.name,
      !!c.imagePath,
    ]),
    [
      ["Mia", true],
      ["Biscuit", true],
    ],
  );
});

test("a panel is drawn with the sheets of the characters in it", async () => {
  const host = fakeHost();
  const castResult = await defineStoryboard(host.context(), cast);
  const storyboardId = String(data(castResult).storyboardId);
  const sheets = (data(castResult).characters as { imagePath: string }[]).map(
    (c) => c.imagePath,
  );

  const panel = await presentPanel(host.context(), {
    storyboardId,
    panel: 1,
    characters: ["Biscuit", "Nobody"],
    imagePrompt: "Biscuit splashes in a puddle",
    caption: "Splash!",
  });
  assert.deepEqual(host.calls.at(-1)?.references, [sheets[1]]);
  assert.match(
    host.calls.at(-1)?.prompt ?? "",
    /Biscuit is the character in reference image 1/,
  );
  assert.match(
    panel.message,
    /not in the cast, so drawn from the prompt alone: Nobody/,
  );
  assert.equal(panel.sequence?.label, "Panel 1 of 3");
  const saved = record(
    host.artifacts,
    `storyboards/${storyboardId}.json`,
  ) as unknown as Storyboard;
  assert.equal(saved.panels["1"]?.caption, "Splash!");
});

test("a panel with choices waits for the user's pick", async () => {
  const host = fakeHost();
  const storyboardId = String(
    data(await defineStoryboard(host.context(), cast)).storyboardId,
  );
  const spokeBefore = Date.now() - 1000;
  const withChoices = await presentPanel(
    host.context({ userSpokeAt: spokeBefore }),
    {
      storyboardId,
      panel: 1,
      characters: ["Mia"],
      imagePrompt: "a fork in the path",
      choices: ["the forest", "the river"],
    },
  );
  assert.equal(withChoices.sequence?.waitsForUser, true);
  assert.deepEqual(data(withChoices).choices, ["the forest", "the river"]);

  const next = {
    storyboardId,
    panel: 2,
    characters: ["Mia"],
    imagePrompt: "the forest",
  };
  const held = await presentPanel(
    host.context({ userSpokeAt: spokeBefore }),
    next,
  );
  assert.equal(held.cancelled, true);
  assert.match(held.message, /hasn't picked a choice yet/);

  const picked = await presentPanel(
    host.context({ userSpokeAt: Date.now() + 1 }),
    next,
  );
  assert.equal(data(picked).panel, 2);
  const saved = record(
    host.artifacts,
    `storyboards/${storyboardId}.json`,
  ) as unknown as Storyboard;
  assert.equal(saved.interactive, true);
});

test("no choices on the last panel", async () => {
  const host = fakeHost();
  const storyboardId = String(
    data(await defineStoryboard(host.context(), cast)).storyboardId,
  );
  const last = await presentPanel(host.context(), {
    storyboardId,
    panel: 3,
    characters: [],
    imagePrompt: "the end",
    choices: ["again", "stop"],
  });
  assert.equal(data(last).choices, undefined);
  assert.equal(last.sequence?.waitsForUser, undefined);
});

test("an unknown storyboard or a failed panel ends the sequence", async () => {
  const host = fakeHost();
  const unknown = await presentPanel(host.context(), {
    storyboardId: "0123456789ab",
    panel: 1,
    characters: [],
    imagePrompt: "x",
  });
  assert.equal(unknown.sequence, null);

  let failing = false;
  const flaky = fakeHost({ fail: () => failing });
  const storyboardId = String(
    data(await defineStoryboard(flaky.context(), cast)).storyboardId,
  );
  failing = true;
  const failed = await presentPanel(flaky.context(), {
    storyboardId,
    panel: 1,
    characters: ["Mia"],
    imagePrompt: "y",
  });
  assert.equal(failed.sequence, null);
});

test("two changes to one record at once keep both", async () => {
  const files = memoryFiles();
  const id = "abcdefabcdef";
  const empty: Storyboard = {
    id,
    title: "",
    style: "",
    totalPanels: 2,
    characters: [],
    interactive: false,
    panels: {},
  };
  const addPanel = (n: number) =>
    updateRecord<Storyboard>(files, STORYBOARDS_DIR, id, (saved) => {
      const latest = saved ?? structuredClone(empty);
      latest.panels[String(n)] = {
        caption: `${n}`,
        characters: [],
        imagePrompt: "",
      };
      return latest;
    });
  assert.deepEqual(await Promise.all([addPanel(1), addPanel(2)]), [true, true]);
  const saved = JSON.parse(
    files.files.get(`${STORYBOARDS_DIR}/${id}.json`) ?? "{}",
  ) as Storyboard;
  assert.deepEqual(Object.keys(saved.panels).sort(), ["1", "2"]);
});

test("a record ID that isn't one is refused", async () => {
  const files = memoryFiles();
  files.files.set("storyboards/../secret.json", "{}");
  assert.equal(await loadRecord(files, STORYBOARDS_DIR, "../secret"), null);
});

test("two identical panels asked for together are drawn once", async () => {
  const host = fakeHost();
  const storyboardId = String(
    data(await defineStoryboard(host.context(), cast)).storyboardId,
  );
  const drawnBefore = host.calls.length;
  const args = {
    storyboardId,
    panel: 1,
    characters: ["Mia"],
    imagePrompt: "z",
  };
  const [first, second] = await Promise.all([
    presentPanel(host.context(), args),
    presentPanel(host.context(), args),
  ]);
  assert.equal(host.calls.length - drawnBefore, 1);
  assert.equal(data(first).panel, 1);
  assert.equal(second.cancelled, true);
});

test("without files, a story still goes on, and says it isn't saved", async () => {
  const host = fakeHost();
  const noFiles = () => {
    const { files: _files, ...withoutFiles } = host.context();
    return withoutFiles;
  };
  const castResult = await defineStoryboard(noFiles(), cast);
  assert.match(castResult.message, /could not be saved/);
  const panel = await presentPanel(noFiles(), {
    storyboardId: String(data(castResult).storyboardId),
    panel: 1,
    characters: ["Mia"],
    imagePrompt: "w",
  });
  assert.equal(data(panel).panel, 1);
  assert.match(panel.message, /could not be saved/);
});
