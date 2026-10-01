// The View's ordering rules for its file-backed source, against a fake host
// whose writes complete when the test says so (gui-chat-plugins#15, #16).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resultKey, SourceSync } from "../src/vue/sourceSync";

/** A promise the test settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A host whose `saveShape` records each write's start and the file's final
 *  content, and finishes only when released. */
function fakeHost() {
  const started: string[] = [];
  let disk = "";
  const pending: Array<{
    script: string;
    done: ReturnType<typeof deferred<undefined>>;
  }> = [];
  return {
    started,
    disk: () => disk,
    save(script: string): Promise<void> {
      started.push(script);
      const done = deferred<undefined>();
      pending.push({ script, done });
      return done.promise.then(() => {
        disk = script;
      });
    },
    /** Complete the write of `script`, if it has started. */
    finish(script: string, error?: Error): void {
      const write = pending.find((entry) => entry.script === script);
      assert.ok(write, `the write of ${script} has not started`);
      if (error) write.done.reject(error);
      else write.done.resolve(undefined);
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("SourceSync.enqueue (#15)", () => {
  it("does not start a save until the previous one has finished", async () => {
    const host = fakeHost();
    const sync = new SourceSync();
    const first = sync.enqueue(() => host.save("A"));
    const second = sync.enqueue(() => host.save("B"));
    await tick();
    assert.deepEqual(host.started, ["A"]);
    host.finish("A");
    await first;
    await tick();
    assert.deepEqual(host.started, ["A", "B"]);
    host.finish("B");
    await second;
    // The later Apply's script is what is left on disk.
    assert.equal(host.disk(), "B");
  });

  it("starts the next save after a failed one", async () => {
    const host = fakeHost();
    const sync = new SourceSync();
    const first = sync.enqueue(() => host.save("A"));
    const second = sync.enqueue(() => host.save("B"));
    await tick();
    host.finish("A", new Error("disk full"));
    await assert.rejects(first, /disk full/);
    await tick();
    host.finish("B");
    await second;
    assert.equal(host.disk(), "B");
  });
});

describe("SourceSync.isCurrent (#16)", () => {
  it("is current until another operation starts or the source is superseded", () => {
    const sync = new SourceSync();
    const ticket = sync.begin("model-1");
    assert.equal(sync.isCurrent(ticket, "model-1"), true);
    sync.begin("model-1");
    assert.equal(sync.isCurrent(ticket, "model-1"), false);
    const edited = sync.begin("model-1");
    sync.supersede();
    assert.equal(sync.isCurrent(edited, "model-1"), false);
  });

  it("is not current once the View shows another result", () => {
    const sync = new SourceSync();
    const ticket = sync.begin("model-1");
    // Even with nothing else started, a reply for model-1 must not land on model-2.
    assert.equal(sync.isCurrent(ticket, "model-2"), false);
  });

  it("drops a load that resolves after the selection changed", async () => {
    const sync = new SourceSync();
    let shown = "model-1";
    const read = deferred<string>();
    const emitted: string[] = [];
    const refresh = (async () => {
      const ticket = sync.begin(shown);
      const script = await read.promise;
      if (sync.isCurrent(ticket, shown)) emitted.push(script);
    })();
    shown = "model-2";
    sync.supersede();
    read.resolve("model-1's script");
    await refresh;
    assert.deepEqual(emitted, []);
  });
});

describe("resultKey", () => {
  it("is the uuid, else the file the result is backed by", () => {
    assert.equal(
      resultKey({ uuid: "u1", data: { filePath: "a.shape" } }),
      "u1",
    );
    assert.equal(resultKey({ data: { filePath: "a.shape" } }), "a.shape");
    assert.equal(resultKey({}), "");
  });
});
