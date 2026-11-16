// The exports travel in the tool result, packed, for the View's download
// buttons. What comes out must be the bytes that went in: a STEP or STL file
// one byte off is a broken part.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pack, unpack } from "../src/core/packed";

describe("a packed file", () => {
  it("unpacks to the bytes it was packed from", async () => {
    // Every byte value, more than once and past one base64 chunk.
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) % 256);
    const unpacked = Buffer.from(await unpack(await pack(bytes)));
    // Not `deepEqual`: a mismatch would print 100 000 numbers, twice.
    assert.ok(unpacked.equals(bytes));
  });

  it("carries text as UTF-8", async () => {
    const text = "ISO-10303-21;\n/* 椅子 — ø8 */\nEND-ISO-10303-21;\n";
    const bytes = await unpack(await pack(text));
    assert.equal(new TextDecoder().decode(bytes), text);
  });

  it("is plain base64, smaller than repetitive input", async () => {
    const packed = await pack(
      "#1=CARTESIAN_POINT('',(0.,0.,0.));\n".repeat(2000),
    );
    assert.match(packed, /^[A-Za-z0-9+/]+=*$/);
    assert.ok(packed.length < 5000, `${packed.length} characters`);
  });

  it("carries an empty file", async () => {
    assert.equal((await unpack(await pack(""))).length, 0);
  });

  it("rejects text it did not make", async () => {
    await assert.rejects(unpack(btoa("not gzip at all")));
  });
});
