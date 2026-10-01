// The `manageShapeScript` tool, against a fake gallery writer. What is pinned
// here is the CONTRACT with mulmoserver: the document's key set (its rules
// refuse any other), that the script is a Storage object the document points
// at rather than a field (receptron/mulmoserver#266), the keyword
// normalisation both sides share, that nothing is written when the host has
// no session, that a refusal leaves no object behind — and, per action, what
// each reads, writes and removes.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FileOps } from "gui-chat-protocol";
import {
  executeManageShapeScript,
  existingShapePost,
  listLimitOf,
  normalizeShapeKeywords,
  shapePostFrom,
  shapePostSummary,
  shapePostUrl,
  stampOf,
  GET_LIST_DEFAULT_LIMIT,
  GET_LIST_MAX_LIMIT,
  licenseFor,
  LICENSE_REQUIRED_MESSAGE,
  MANAGE_ACTIONS,
  MANAGE_SCHEMA,
  MANAGE_TOOL_NAME,
  NOT_CONNECTED_MESSAGE,
  POST_CHANGED_MESSAGE,
  requireScriptBytes,
  SHAPE_LICENSE,
  SHAPE_LICENSE_URL,
  SHAPE_POST_KEYS,
  SHAPE_POST_LIMITS,
  SHAPE_SCRIPT_CONTENT_TYPE,
  type ManageShapeScriptContext,
  type ShapeGalleryWriter,
  type ShapePostDoc,
  type ShapePostPatch,
} from "../src/core/index";

const CUBE = "cube { size 1 }";
const CUBE_2 = "cube { size 2 }";

function memoryFiles(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const missing = (name: string) => (): never => {
    throw new Error(`FileOps.${name} is not part of this double`);
  };
  const files = {
    read: async (rel: string) => {
      const value = store.get(rel);
      if (value === undefined) throw new Error(`ENOENT: ${rel}`);
      return value;
    },
    write: async (rel: string, content: string | Uint8Array) => {
      store.set(
        rel,
        typeof content === "string"
          ? content
          : new TextDecoder().decode(content),
      );
    },
    exists: async (rel: string) => store.has(rel),
    list: missing("list"),
    delete: missing("delete"),
    mkdir: missing("mkdir"),
    stat: missing("stat"),
  } as unknown as FileOps;
  return { files, store };
}

/** A writer that records what it was asked to do. `createPost` may be replaced
 *  to simulate a refused write. Posts are stamped in the order they are created,
 *  so `listPosts` can answer newest first as Firestore's query does. */
function fakeGallery(
  createPost?: ShapeGalleryWriter["createPost"],
  siteUrl?: string,
) {
  const posts = new Map<string, ShapePostDoc>();
  const stamps = new Map<string, Date>();
  const uploads: Array<{ id: string; bytes: number }> = [];
  const scripts: Array<{ id: string; script: string }> = [];
  const deleted: Array<{ id: string; objectId: string }> = [];
  const patches: ShapePostPatch[] = [];
  const scriptReads: Array<{ ownerUid: string; id: string; scriptId: string }> =
    [];
  // The host adds `licenseAcceptedAt` beside a grant, as it adds the two times.
  const withStamps = (id: string, stored: ShapePostDoc) => ({
    ...stored,
    ...(stored.license ? { licenseAcceptedAt: stamps.get(id) } : {}),
    createdAt: stamps.get(id),
    updatedAt: stamps.get(id),
  });
  const writer: ShapeGalleryWriter = {
    uid: "u-alice",
    authorName: "Alice",
    ...(siteUrl === undefined ? {} : { siteUrl }),
    createPost:
      createPost ??
      (async (id, doc) => {
        posts.set(id, doc);
        stamps.set(id, new Date(Date.UTC(2026, 8, 1 + stamps.size)));
      }),
    // The rules hide another account's draft: it reads as absent, as a wrong id does.
    readPost: async (id) => {
      const stored = posts.get(id);
      return stored && (stored.published || stored.uid === writer.uid)
        ? withStamps(id, stored)
        : null;
    },
    // Field-level, as Firestore's updateDoc is (a field absent from the patch is untouched),
    // and conditional, as the host's transaction is: refused unless the post still matches.
    updatePost: async (id, patch, expect) => {
      const stored = posts.get(id);
      if (
        !stored ||
        stored.uid !== expect.uid ||
        stored.scriptId !== expect.scriptId ||
        stored.thumbnailId !== expect.thumbnailId ||
        stored.published !== expect.published
      ) {
        throw new Error(POST_CHANGED_MESSAGE);
      }
      patches.push(patch);
      posts.set(id, { ...stored, ...patch });
    },
    // Conditional, as the host's transaction is: refused unless the post still matches.
    deletePost: async (id, expect) => {
      const stored = posts.get(id);
      if (
        !stored ||
        stored.uid !== expect.uid ||
        stored.scriptId !== expect.scriptId ||
        stored.thumbnailId !== expect.thumbnailId ||
        stored.published !== expect.published
      ) {
        throw new Error(POST_CHANGED_MESSAGE);
      }
      posts.delete(id);
      return withStamps(id, stored);
    },
    listPosts: async (uid, limit) =>
      [...posts.entries()]
        .filter(([, stored]) => stored.uid === uid)
        .sort(([a], [b]) => stamps.get(b)!.getTime() - stamps.get(a)!.getTime())
        .slice(0, limit)
        .map(([id, stored]) => ({ id, data: withStamps(id, stored) })),
    readScript: async (ownerUid, id, scriptId) => {
      scriptReads.push({ ownerUid, id, scriptId });
      const entry = scripts[Number(scriptId.replace("script-", "")) - 1];
      if (!entry || entry.id !== id)
        throw new Error(`no object ${scriptId} under ${id}`);
      return entry.script;
    },
    uploadThumbnail: async (id, png) => {
      uploads.push({ id, bytes: png.byteLength });
      return `obj-${uploads.length}`;
    },
    uploadScript: async (id, script) => {
      scripts.push({ id, script });
      return `script-${scripts.length}`;
    },
    deleteObject: async (id, objectId) => {
      deleted.push({ id, objectId });
    },
  };
  return { writer, posts, uploads, scripts, deleted, patches, scriptReads };
}

const noThumbnail = async (): Promise<Uint8Array | null> => null;
const onePixel = async (): Promise<Uint8Array | null> =>
  new Uint8Array([1, 2, 3]);

function contextFor(
  gallery: ShapeGalleryWriter | null,
  renderThumbnail = noThumbnail,
  files: FileOps = memoryFiles().files,
): ManageShapeScriptContext {
  return { files: { artifacts: files }, gallery, renderThumbnail };
}

const publish = (
  context: ManageShapeScriptContext,
  args: Record<string, unknown>,
) => executeManageShapeScript(context, { action: "publish", ...args });
/** A public post, with the agreement the gallery asks for one. */
const publishAgreed = (
  context: ManageShapeScriptContext,
  args: Record<string, unknown>,
) => publish(context, { acceptLicense: true, ...args });
const update = (
  context: ManageShapeScriptContext,
  args: Record<string, unknown>,
) => executeManageShapeScript(context, { action: "update", ...args });

/** A gallery with one of Alice's posts in it, and what it was posted as. */
async function seeded(files?: FileOps) {
  const gallery = fakeGallery();
  const context = contextFor(gallery.writer, onePixel, files);
  const first = await publishAgreed(context, {
    title: "Lamp",
    script: CUBE,
    description: "v1",
    keywords: ["lamp"],
    aiModel: "claude-opus-5",
  });
  return {
    ...gallery,
    context,
    id: first.action === "publish" ? first.id : "",
  };
}

describe("manageShapeScript tool", () => {
  it("exposes its name and takes an `action`; everything else is per action", () => {
    assert.equal(MANAGE_TOOL_NAME, "manageShapeScript");
    assert.deepEqual(MANAGE_ACTIONS, [
      "publish",
      "update",
      "delete",
      "get",
      "getList",
    ]);
    assert.deepEqual(MANAGE_SCHEMA.properties.action.enum, [...MANAGE_ACTIONS]);
    assert.deepEqual(Object.keys(MANAGE_SCHEMA.properties), [
      "action",
      "id",
      "title",
      "script",
      "path",
      "description",
      "keywords",
      "prompt",
      "aiModel",
      "published",
      "acceptLicense",
      "save",
      "limit",
    ]);
    // What each action needs beyond `action` the tool checks; the schema cannot.
    assert.deepEqual(MANAGE_SCHEMA.required, ["action"]);
  });

  it("refuses a missing or unknown action, and an update / delete / get without `id`, touching nothing", async () => {
    const { writer, posts, scripts } = fakeGallery();
    const context = contextFor(writer);
    await assert.rejects(
      executeManageShapeScript(context, { title: "Lamp", script: CUBE }),
      /`action` must be one of publish, update, delete, get, getList/,
    );
    await assert.rejects(
      executeManageShapeScript(context, { action: "remove", id: "x" }),
      /`action` must be one of/,
    );
    for (const action of ["update", "delete", "get"]) {
      await assert.rejects(
        executeManageShapeScript(context, { action, script: CUBE }),
        new RegExp(`\`id\` is required for ${action}`),
      );
    }
    assert.equal(posts.size, 0);
    assert.deepEqual(scripts, []);
  });

  // mulmoserver's rules pin the key set with hasOnly: this list IS the contract.
  it("writes exactly the keys mulmoserver's rules accept, every one present, and never the script text", () => {
    const doc = shapePostFrom(
      { uid: "u", authorName: "A" },
      { title: "Lamp", scriptId: "script-1" },
    );
    assert.deepEqual(Object.keys(doc), [...SHAPE_POST_KEYS]);
    for (const [key, value] of Object.entries(doc))
      assert.notEqual(value, undefined, `${key} must not be undefined`);
    // Key ABSENCE: the rule's hasOnly refuses a `script` key with any value.
    assert.equal(Object.hasOwn(doc, "script"), false);
    assert.deepEqual(
      { ...doc },
      {
        uid: "u",
        authorName: "A",
        title: "Lamp",
        description: "",
        scriptId: "script-1",
        source: "prompt",
        prompt: "",
        photoIds: [],
        thumbnailId: "",
        forkedFrom: null,
        keywords: [],
        aiModel: "",
        published: true,
        license: null,
      },
    );
  });

  it("normalises keywords the way the gallery does, from a list or a comma string", () => {
    assert.deepEqual(
      normalizeShapeKeywords([
        " Lamp",
        "lamp",
        "DESK ",
        "",
        42,
        "x".repeat(40),
      ]),
      ["lamp", "desk", "x".repeat(SHAPE_POST_LIMITS.keywordMax)],
    );
    assert.deepEqual(normalizeShapeKeywords("lamp, Desk lamp ,, wood"), [
      "lamp",
      "desk lamp",
      "wood",
    ]);
    assert.equal(
      normalizeShapeKeywords(Array.from({ length: 14 }, (_, i) => `k${i}`))
        .length,
      SHAPE_POST_LIMITS.keywordsMax,
    );
    assert.deepEqual(normalizeShapeKeywords(undefined), []);
  });

  it("refuses what the rules would refuse, naming the field", () => {
    const writer = { uid: "u", authorName: "A" };
    assert.throws(
      () => shapePostFrom(writer, { title: "  ", scriptId: "s" }),
      /`title` is required/,
    );
    assert.throws(
      () => shapePostFrom(writer, { title: "x".repeat(121), scriptId: "s" }),
      /`title` is too long/,
    );
    assert.throws(
      () =>
        shapePostFrom(writer, {
          title: "t",
          scriptId: "s",
          description: "d".repeat(2001),
        }),
      /`description` is too long/,
    );
    assert.equal(
      shapePostFrom(
        { uid: "u", authorName: "n".repeat(100) },
        { title: "t", scriptId: "s" },
      ).authorName.length,
      SHAPE_POST_LIMITS.authorNameMax,
    );
    assert.throws(
      () =>
        shapePostFrom(writer, {
          title: "t",
          scriptId: "s",
          aiModel: "m".repeat(81),
        }),
      /`aiModel` is too long/,
    );
    assert.equal(
      shapePostFrom(writer, {
        title: "t",
        scriptId: "s",
        aiModel: " claude-opus-5 ",
      }).aiModel,
      "claude-opus-5",
    );
  });

  // The script cap is the gallery's STORAGE rule — 10 MiB in UTF-8 bytes — since the script is
  // an object, not a document field. Three-byte characters are over it although the character
  // count is well under; the cap itself, in ASCII, is not.
  it("measures the script in UTF-8 bytes against the Storage rule's 10 MiB", () => {
    assert.equal(SHAPE_POST_LIMITS.scriptMax, 10 * 1024 * 1024);
    assert.equal(SHAPE_SCRIPT_CONTENT_TYPE, "text/plain; charset=utf-8");
    assert.throws(() => requireScriptBytes(""), /`script` is required/);
    assert.throws(
      () =>
        requireScriptBytes(
          "あ".repeat(Math.ceil(SHAPE_POST_LIMITS.scriptMax / 3)),
        ),
      /`script` is too long \(\d+ bytes; the gallery allows 10485760\)/,
    );
    assert.equal(
      requireScriptBytes("x".repeat(SHAPE_POST_LIMITS.scriptMax)).length,
      SHAPE_POST_LIMITS.scriptMax,
    );
  });

  it("does nothing without a session — reads included — and says how to get one", async () => {
    for (const args of [
      { action: "publish", title: "Lamp", script: CUBE },
      { action: "get", id: "x" },
      { action: "getList" },
    ]) {
      await assert.rejects(
        executeManageShapeScript(contextFor(null), args),
        new RegExp(NOT_CONNECTED_MESSAGE.slice(0, 30)),
      );
    }
  });

  describe("publish", () => {
    it("publishes an inline script as a Storage object, with its thumbnail, and answers the model's URL", async () => {
      const { writer, posts, uploads, scripts } = fakeGallery();
      const result = await publishAgreed(contextFor(writer, onePixel), {
        title: "Tiny Cube",
        script: CUBE,
        description: "A cube",
        keywords: ["Cube", "test"],
        prompt: "make a cube",
        aiModel: "claude-opus-5",
      });
      assert.equal(result.action, "publish");
      if (result.action !== "publish") return;
      assert.equal(posts.size, 1);
      const [id, doc] = [...posts.entries()][0]!;
      assert.equal(result.id, id);
      assert.equal(result.url, shapePostUrl(id));
      assert.match(
        result.url,
        /^https:\/\/server\.mulmocast\.com\/shapes\/[0-9a-f-]{36}$/,
      );
      assert.equal(result.thumbnail, true);
      assert.deepEqual(uploads, [{ id, bytes: 3 }]);
      assert.deepEqual(scripts, [{ id, script: CUBE }]);
      assert.equal(doc.thumbnailId, "obj-1");
      assert.equal(doc.scriptId, "script-1");
      assert.equal(Object.hasOwn(doc, "script"), false);
      assert.deepEqual(doc.keywords, ["cube", "test"]);
      assert.equal(doc.prompt, "make a cube");
      assert.equal(doc.aiModel, "claude-opus-5");
      assert.equal(doc.published, true);
      assert.equal(doc.license, SHAPE_LICENSE);
      assert.match(
        result.message,
        /^Published: "Tiny Cube" is at https:.*\(licensed under CC BY 4\.0\)\./,
      );
      assert.doesNotMatch(result.message, /No thumbnail/);
    });

    it("publishes an existing artifact by path, as a draft, where no browser can render", async () => {
      const { writer, posts, scripts } = fakeGallery(
        undefined,
        "https://staging.example/",
      );
      const artifacts = memoryFiles({
        "shapes/lamp-1-aaaaaaaa.shape": CUBE,
      }).files;
      const result = await publish(contextFor(writer, noThumbnail, artifacts), {
        title: "Lamp",
        path: "artifacts/shapes/lamp-1-aaaaaaaa.shape",
        published: false,
      });
      if (result.action !== "publish") return assert.fail(result.action);
      const doc = [...posts.values()][0]!;
      assert.equal(scripts[0]?.script, CUBE);
      assert.equal(doc.scriptId, "script-1");
      assert.equal(doc.published, false);
      assert.equal(result.thumbnail, false);
      assert.equal(result.url, `https://staging.example/shapes/${result.id}`);
      assert.match(result.message, /^Saved as a draft/);
      assert.match(result.message, /No thumbnail could be attached/);
    });

    it("posts without a picture when the host passes no renderThumbnail at all", async () => {
      const { writer, posts, uploads } = fakeGallery();
      const { files } = memoryFiles();
      const context: ManageShapeScriptContext = {
        files: { artifacts: files },
        gallery: writer,
      };
      const result = await publishAgreed(context, {
        title: "Lamp",
        script: CUBE,
      });
      assert.equal(posts.size, 1);
      assert.equal(result.action === "publish" && result.thumbnail, false);
      assert.equal([...posts.values()][0]?.thumbnailId, "");
      assert.deepEqual(uploads, []);
    });

    it("posts without a picture when the thumbnail fails, and says so as a warning", async () => {
      const { writer, posts } = fakeGallery();
      const warnings: string[] = [];
      const failing = async (): Promise<Uint8Array | null> => {
        throw new Error("no GPU");
      };
      const result = await publishAgreed(
        { ...contextFor(writer, failing), onWarning: (m) => warnings.push(m) },
        { title: "Lamp", script: CUBE },
      );
      assert.equal(posts.size, 1);
      assert.equal(result.action === "publish" && result.thumbnail, false);
      assert.deepEqual(warnings, ["thumbnail skipped: no GPU"]);
    });

    it("refuses a script that will not build, or a post over a limit, before anything is uploaded or written", async () => {
      const { writer, posts, uploads, scripts } = fakeGallery();
      const context = contextFor(writer, onePixel);
      await assert.rejects(
        publishAgreed(context, { title: "Bad", script: "loft { square }" }),
        /cross-sections/,
      );
      await assert.rejects(
        publishAgreed(context, { title: "x".repeat(121), script: CUBE }),
        /`title` is too long/,
      );
      await assert.rejects(
        publishAgreed(context, { script: CUBE }),
        /`title` is required/,
      );
      await assert.rejects(
        publishAgreed(context, {
          title: "t",
          script: CUBE,
          path: "artifacts/shapes/x.shape",
        }),
        /not both/,
      );
      await assert.rejects(
        publishAgreed(context, {
          title: "t",
          script: "x".repeat(SHAPE_POST_LIMITS.scriptMax + 1),
        }),
        /`script` is too long/,
      );
      assert.equal(posts.size, 0);
      assert.deepEqual(uploads, []);
      assert.deepEqual(scripts, []);
    });

    // The script goes up before the thumbnail: it is the required one, so its failure must find
    // nothing already uploaded to orphan.
    it("uploads the script before the thumbnail, so a failed script upload leaves nothing behind", async () => {
      const { writer, posts, uploads, deleted } = fakeGallery();
      writer.uploadScript = async () => {
        throw new Error("quota");
      };
      await assert.rejects(
        publishAgreed(contextFor(writer, onePixel), {
          title: "Lamp",
          script: CUBE,
        }),
        /quota/,
      );
      assert.equal(posts.size, 0);
      assert.deepEqual(uploads, []);
      assert.deepEqual(deleted, []);
    });

    it("takes the script and the thumbnail back out when the post itself is refused", async () => {
      const { writer, uploads, deleted } = fakeGallery(async () => {
        throw new Error("permission-denied");
      });
      await assert.rejects(
        publishAgreed(contextFor(writer, onePixel), {
          title: "Lamp",
          script: CUBE,
        }),
        /permission-denied/,
      );
      assert.equal(uploads.length, 1);
      const id = uploads[0]!.id;
      assert.deepEqual(deleted, [
        { id, objectId: "script-1" },
        { id, objectId: "obj-1" },
      ]);
    });

    // mulmoserver's editor asks the owner to agree to CC BY 4.0 before a public post; so does
    // the tool, and it refuses — before an upload — rather than posting under a license the
    // user never saw. A draft is not public and needs none.
    it("refuses a public post without the user's agreement, before anything is uploaded, and says what to ask", async () => {
      const { writer, posts, uploads, scripts } = fakeGallery();
      const context = contextFor(writer, onePixel);
      await assert.rejects(
        publish(context, { title: "Lamp", script: CUBE }),
        new RegExp(LICENSE_REQUIRED_MESSAGE.slice(0, 40)),
      );
      await assert.rejects(
        publish(context, { title: "Lamp", script: CUBE, acceptLicense: "yes" }),
        /acceptLicense/,
      );
      assert.match(
        LICENSE_REQUIRED_MESSAGE,
        new RegExp(SHAPE_LICENSE_URL.replaceAll(".", "\\.")),
      );
      assert.equal(posts.size, 0);
      assert.deepEqual(uploads, []);
      assert.deepEqual(scripts, []);
    });

    it("saves a draft without agreement, and records no grant for one even when agreement is offered", async () => {
      const { writer, posts } = fakeGallery();
      const context = contextFor(writer);
      await publish(context, { title: "One", script: CUBE, published: false });
      await publish(context, {
        title: "Two",
        script: CUBE,
        published: false,
        acceptLicense: true,
      });
      assert.deepEqual(
        [...posts.values()].map((doc) => doc.license),
        [null, null],
      );
    });

    it("grants the one license the gallery knows, only for a public post the user agreed to", () => {
      assert.equal(SHAPE_LICENSE, "CC-BY-4.0");
      assert.equal(licenseFor(true, true), SHAPE_LICENSE);
      assert.equal(licenseFor(false, true), null);
      assert.equal(licenseFor(false, undefined), null);
      assert.throws(
        () => licenseFor(true, undefined),
        new RegExp(LICENSE_REQUIRED_MESSAGE.slice(0, 40)),
      );
      assert.throws(
        () => licenseFor(true, "true"),
        new RegExp(LICENSE_REQUIRED_MESSAGE.slice(0, 40)),
      );
      // A grant already made stands, agreement or not: the rules let it be made once.
      assert.equal(licenseFor(true, undefined, SHAPE_LICENSE), SHAPE_LICENSE);
      assert.equal(licenseFor(false, undefined, SHAPE_LICENSE), SHAPE_LICENSE);
    });
  });

  // A post already in the gallery is rewritten in place — by its publisher only.
  describe("update", () => {
    it("coerces a stored document, filling keys a post from before they existed lacks", () => {
      const post = existingShapePost({
        uid: "u",
        authorName: "A",
        title: "Old",
        scriptId: "s",
        source: "photos",
        photoIds: ["p1", 2],
        forkedFrom: "f",
        published: true,
        createdAt: "t",
      });
      assert.deepEqual(Object.keys(post), [...SHAPE_POST_KEYS]);
      assert.equal(post.description, "");
      assert.deepEqual(post.keywords, []);
      assert.equal(post.aiModel, "");
      assert.equal(post.source, "photos");
      assert.deepEqual(post.photoIds, ["p1"]);
      assert.equal(post.forkedFrom, "f");
      // A post from before the gallery asked for a license has none; only the one value counts.
      assert.equal(post.license, null);
      assert.equal(existingShapePost({ license: "CC0" }).license, null);
      assert.equal(
        existingShapePost({ license: "CC-BY-4.0" }).license,
        SHAPE_LICENSE,
      );
    });

    it("replaces the script and thumbnail, keeps every field not given, and answers the same URL", async () => {
      const { context, posts, scripts, uploads, deleted, id } = await seeded();
      const result = await update(context, { id, script: CUBE_2 });
      if (result.action !== "update") return assert.fail(result.action);
      assert.equal(result.id, id);
      assert.equal(result.url, shapePostUrl(id));
      assert.match(result.message, /^Updated: "Lamp" is at https:/);
      assert.equal(posts.size, 1);
      const doc = posts.get(id)!;
      assert.deepEqual(
        scripts.map((entry) => entry.script),
        [CUBE, CUBE_2],
      );
      assert.equal(doc.scriptId, "script-2");
      assert.equal(doc.thumbnailId, "obj-2");
      assert.equal(uploads.length, 2);
      assert.equal(doc.title, "Lamp");
      assert.equal(doc.description, "v1");
      assert.deepEqual(doc.keywords, ["lamp"]);
      assert.equal(doc.aiModel, "claude-opus-5");
      assert.equal(doc.uid, "u-alice");
      // The replaced objects are gone, and only they.
      assert.deepEqual(deleted, [
        { id, objectId: "script-1" },
        { id, objectId: "obj-1" },
      ]);
    });

    // Codex on #3158: a whole-document rewrite from a read taken a moment ago would put back
    // whatever another client changed in between — a replaced (and deleted) script object
    // included. So the patch carries only what this call changes.
    it("sends only the fields given and the new object ids, never the whole snapshot", async () => {
      const { context, patches, id } = await seeded();
      await update(context, { id, script: CUBE_2 });
      assert.deepEqual(patches.at(-1), {
        scriptId: "script-2",
        thumbnailId: "obj-2",
      });
      await update(context, {
        id,
        title: "Desk lamp",
        keywords: ["Desk", "lamp"],
      });
      assert.deepEqual(patches.at(-1), {
        title: "Desk lamp",
        keywords: ["desk", "lamp"],
      });
    });

    it("clears an optional text field with an explicit empty string, and keeps it when omitted", async () => {
      const { context, posts, patches, id } = await seeded();
      await update(context, { id, description: "", aiModel: "" });
      assert.deepEqual(patches.at(-1), { description: "", aiModel: "" });
      assert.equal(posts.get(id)!.description, "");
      assert.equal(posts.get(id)!.aiModel, "");
      await update(context, { id, title: "Lamp 2" });
      assert.equal(posts.get(id)!.description, "");
      // An empty title is not a clear: the gallery requires one.
      await assert.rejects(
        update(context, { id, title: "" }),
        /`title` is required/,
      );
    });

    it("updates the metadata alone — no source given keeps the script and thumbnail", async () => {
      const { context, posts, scripts, deleted, id } = await seeded();
      const result = await update(context, {
        id,
        title: "Desk lamp",
        keywords: ["lamp", "desk"],
        published: false,
      });
      const doc = posts.get(id)!;
      assert.equal(scripts.length, 1);
      assert.deepEqual(deleted, []);
      assert.equal(doc.scriptId, "script-1");
      assert.equal(doc.thumbnailId, "obj-1");
      assert.equal(doc.title, "Desk lamp");
      assert.deepEqual(doc.keywords, ["lamp", "desk"]);
      assert.equal(doc.published, false);
      assert.equal(doc.description, "v1");
      assert.match(result.message, /^Updated as a draft/);
    });

    // The grant is made once, by the owner, and the rules refuse a public write that restates,
    // moves or removes it — so an edit of a licensed post never sends `license`, and only an
    // unlicensed post going (or staying) public needs the user's agreement.
    it("never sends the license of a licensed post again — edits and unpublishing keep it", async () => {
      const { context, posts, patches, id } = await seeded();
      await update(context, { id, title: "Lamp 2" });
      await update(context, { id, published: false });
      await update(context, { id, published: true, acceptLicense: true });
      for (const patch of patches)
        assert.equal(
          Object.hasOwn(patch, "license"),
          false,
          JSON.stringify(patch),
        );
      assert.equal(posts.get(id)!.license, SHAPE_LICENSE);
    });

    it("makes a draft public only with the user's agreement, and sends the grant with that one write", async () => {
      const { writer, posts, patches } = fakeGallery();
      const context = contextFor(writer);
      const draft = await publish(context, {
        title: "Draft",
        script: CUBE,
        published: false,
      });
      const id = draft.action === "publish" ? draft.id : "";
      await assert.rejects(
        update(context, { id, published: true }),
        new RegExp(LICENSE_REQUIRED_MESSAGE.slice(0, 40)),
      );
      assert.deepEqual(patches, []);
      // Still a draft: an edit that leaves it one needs no agreement and grants nothing.
      await update(context, { id, title: "Draft 2" });
      assert.deepEqual(patches.at(-1), { title: "Draft 2" });
      assert.equal(posts.get(id)!.license, null);
      await update(context, { id, published: true, acceptLicense: true });
      assert.deepEqual(patches.at(-1), {
        license: SHAPE_LICENSE,
        published: true,
      });
      assert.equal(posts.get(id)!.license, SHAPE_LICENSE);
    });

    // A post from before the gallery asked (or one an older client published): public, but
    // with no grant on record. Editing it while public is the moment the gallery's own editor
    // asks, and so does the tool; unpublishing it needs nothing.
    it("asks for agreement before editing a public post that has no license yet, and grants it then", async () => {
      const { context, writer, posts, patches, scripts, id } = await seeded();
      posts.set(id, { ...posts.get(id)!, license: null });
      await assert.rejects(
        update(context, { id, script: CUBE_2 }),
        new RegExp(LICENSE_REQUIRED_MESSAGE.slice(0, 40)),
      );
      assert.equal(scripts.length, 1);
      await update(context, { id, published: false });
      assert.deepEqual(patches.at(-1), { published: false });
      assert.equal(posts.get(id)!.license, null);
      await update(context, {
        id,
        published: true,
        title: "Lamp 2",
        acceptLicense: true,
      });
      assert.deepEqual(patches.at(-1), {
        license: SHAPE_LICENSE,
        title: "Lamp 2",
        published: true,
      });
      assert.equal(posts.get(id)!.license, SHAPE_LICENSE);
      // Another account's post is refused as such before any license question.
      writer.uid = "u-bob";
      await assert.rejects(
        update(context, { id, title: "Mine now" }),
        /published by another account/,
      );
    });

    it("refuses an id that is not a post, and one published by another account, before anything is uploaded", async () => {
      const { context, writer, posts, scripts, id } = await seeded();
      await assert.rejects(
        update(context, { id: "no-such-post", script: CUBE_2 }),
        /No gallery post has the id "no-such-post"/,
      );
      writer.uid = "u-bob";
      await assert.rejects(
        update(context, { id, script: CUBE_2 }),
        /published by another account; only its publisher can update it/,
      );
      assert.equal(scripts.length, 1);
      assert.equal(posts.get(id)!.scriptId, "script-1");
    });

    it("refuses a broken script or an over-limit field before anything is uploaded", async () => {
      const { context, scripts, uploads, id } = await seeded();
      await assert.rejects(
        update(context, { id, script: "loft { square }" }),
        /cross-sections/,
      );
      await assert.rejects(
        update(context, { id, title: "x".repeat(121) }),
        /`title` is too long/,
      );
      assert.equal(scripts.length, 1);
      assert.equal(uploads.length, 1);
    });

    it("takes the new objects back out when the rewrite is refused, and leaves the old post intact", async () => {
      const { context, writer, posts, deleted, id } = await seeded();
      writer.updatePost = async () => {
        throw new Error("permission-denied");
      };
      await assert.rejects(
        update(context, { id, script: CUBE_2 }),
        /permission-denied/,
      );
      assert.deepEqual(deleted, [
        { id, objectId: "script-2" },
        { id, objectId: "obj-2" },
      ]);
      assert.equal(posts.get(id)!.scriptId, "script-1");
    });

    // CodeRabbit on #3158: two edits racing on one post. The write is conditional on the
    // object ids the read saw, so the second to land is refused and takes its uploads back
    // out — the first's objects stay referenced, nothing is orphaned.
    it("refuses an update whose read is stale — another edit replaced the model — and takes its uploads back out", async () => {
      const { context, writer, posts, deleted, id } = await seeded();
      const slowRead = writer.readPost;
      writer.readPost = async (postId) => {
        const snapshot = await slowRead(postId);
        // Another client's edit lands between this read and the write.
        posts.set(id, {
          ...posts.get(id)!,
          scriptId: "script-other",
          thumbnailId: "obj-other",
        });
        return snapshot;
      };
      await assert.rejects(
        update(context, { id, script: CUBE_2 }),
        new RegExp(POST_CHANGED_MESSAGE.slice(0, 40)),
      );
      assert.deepEqual(deleted, [
        { id, objectId: "script-2" },
        { id, objectId: "obj-2" },
      ]);
      assert.equal(posts.get(id)!.scriptId, "script-other");
    });

    // CodeRabbit on #3180: whether the patch carries a grant was decided from the read's
    // `published`. An unpublish landing in between would otherwise have the grant written onto
    // a draft, which records none — so the published state is part of the precondition.
    it("refuses a granting update when the post was unpublished meanwhile, so no draft is licensed", async () => {
      const { context, writer, posts, patches, id } = await seeded();
      posts.set(id, { ...posts.get(id)!, license: null });
      const slowRead = writer.readPost;
      writer.readPost = async (postId) => {
        const snapshot = await slowRead(postId);
        posts.set(id, { ...posts.get(id)!, published: false });
        return snapshot;
      };
      await assert.rejects(
        update(context, { id, title: "Lamp 2", acceptLicense: true }),
        new RegExp(POST_CHANGED_MESSAGE.slice(0, 40)),
      );
      assert.deepEqual(patches, []);
      assert.equal(posts.get(id)!.license, null);
    });
  });

  describe("delete", () => {
    it("removes the user's own post, then every object under it — the reference photos of a web-editor post included", async () => {
      const { context, posts, deleted, id } = await seeded();
      posts.set(id, { ...posts.get(id)!, photoIds: ["p-1", "p-2"] });
      const result = await executeManageShapeScript(context, {
        action: "delete",
        id,
      });
      assert.equal(result.action, "delete");
      assert.equal(
        result.message,
        `Deleted: "Lamp" (${shapePostUrl(id)}) is no longer in the gallery.`,
      );
      assert.equal(posts.size, 0);
      assert.deepEqual(deleted, [
        { id, objectId: "script-1" },
        { id, objectId: "obj-1" },
        { id, objectId: "p-1" },
        { id, objectId: "p-2" },
      ]);
    });

    it("refuses a missing post and another account's post, removing nothing", async () => {
      const { context, writer, posts, deleted, id } = await seeded();
      await assert.rejects(
        executeManageShapeScript(context, {
          action: "delete",
          id: "no-such-post",
        }),
        /No gallery post has the id "no-such-post"/,
      );
      writer.uid = "u-bob";
      await assert.rejects(
        executeManageShapeScript(context, { action: "delete", id }),
        /published by another account; only its publisher can delete it/,
      );
      assert.equal(posts.size, 1);
      assert.deepEqual(deleted, []);
    });

    // Codex on #3161: an update landing between the read and the delete has new objects the
    // read does not know. The delete is conditional on the ids read, so it is refused instead,
    // and the post — with its new objects — stays.
    it("refuses a delete whose read is stale — another edit replaced the model — and removes nothing", async () => {
      const { context, writer, posts, deleted, id } = await seeded();
      const slowRead = writer.readPost;
      writer.readPost = async (postId) => {
        const snapshot = await slowRead(postId);
        posts.set(id, {
          ...posts.get(id)!,
          scriptId: "script-other",
          thumbnailId: "obj-other",
        });
        return snapshot;
      };
      await assert.rejects(
        executeManageShapeScript(context, { action: "delete", id }),
        new RegExp(POST_CHANGED_MESSAGE.slice(0, 40)),
      );
      assert.equal(posts.get(id)!.scriptId, "script-other");
      assert.deepEqual(deleted, []);
    });

    // CodeRabbit on #3161: `expect` pins the model, not the reference photos. A photo the web
    // editor swapped in between the read and the delete is on the deleted document, and that
    // is the version whose objects go.
    it("removes the objects of the document as deleted — a reference photo swapped in meanwhile included", async () => {
      const { context, writer, posts, deleted, id } = await seeded();
      posts.set(id, { ...posts.get(id)!, photoIds: ["p-old"] });
      const slowRead = writer.readPost;
      writer.readPost = async (postId) => {
        const snapshot = await slowRead(postId);
        posts.set(id, { ...posts.get(id)!, photoIds: ["p-new"] });
        return snapshot;
      };
      await executeManageShapeScript(context, { action: "delete", id });
      assert.deepEqual(
        deleted.map((entry) => entry.objectId),
        ["script-1", "obj-1", "p-new"],
      );
    });

    // The document goes first so the post is gone from the gallery even if an object will not:
    // an orphan of random name that nothing links to is a warning, not a failure.
    it("reports an object that would not go as a warning, once the document is gone", async () => {
      const { context, writer, posts, id } = await seeded();
      const warnings: string[] = [];
      writer.deleteObject = async () => {
        throw new Error("gone already");
      };
      await executeManageShapeScript(
        { ...context, onWarning: (m) => warnings.push(m) },
        { action: "delete", id },
      );
      assert.equal(posts.size, 0);
      assert.deepEqual(warnings, [
        "orphaned object script-1: gone already",
        "orphaned object obj-1: gone already",
      ]);
    });
  });

  describe("get", () => {
    it("answers a post's readable fields, its server stamps as ISO strings, and its source — never the object ids", async () => {
      const { context, scriptReads, id } = await seeded();
      const result = await executeManageShapeScript(context, {
        action: "get",
        id,
      });
      if (result.action !== "get") return assert.fail(result.action);
      assert.equal(result.id, id);
      assert.equal(result.url, shapePostUrl(id));
      assert.equal(result.script, CUBE);
      assert.equal(result.savedPath, null);
      assert.deepEqual(result.post, {
        id,
        url: shapePostUrl(id),
        title: "Lamp",
        description: "v1",
        keywords: ["lamp"],
        prompt: "",
        aiModel: "claude-opus-5",
        published: true,
        source: "prompt",
        forkedFrom: null,
        authorName: "Alice",
        license: SHAPE_LICENSE,
        licenseAcceptedAt: "2026-09-01T00:00:00.000Z",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      });
      assert.deepEqual(scriptReads, [
        { ownerUid: "u-alice", id, scriptId: "script-1" },
      ]);
      // The agent reads the JSON.
      assert.deepEqual(JSON.parse(result.message), {
        post: result.post,
        script: CUBE,
        savedPath: null,
      });
      assert.equal(Object.hasOwn(result.post, "scriptId"), false);
      assert.equal(Object.hasOwn(result.post, "thumbnailId"), false);
    });

    it("reads another account's published post — from under that account, where its objects live — but not its draft", async () => {
      const { context, writer, posts, scriptReads, id } = await seeded();
      writer.uid = "u-bob";
      const result = await executeManageShapeScript(context, {
        action: "get",
        id,
      });
      assert.equal(result.action === "get" && result.script, CUBE);
      assert.deepEqual(scriptReads, [
        { ownerUid: "u-alice", id, scriptId: "script-1" },
      ]);
      posts.set(id, { ...posts.get(id)!, published: false });
      await assert.rejects(
        executeManageShapeScript(context, { action: "get", id }),
        /No gallery post has the id .* another account's draft/,
      );
    });

    it("saves the source under artifacts/shapes/ when asked, named after the post, and returns the path", async () => {
      const { files, store } = memoryFiles();
      const { context, id } = await seeded(files);
      const result = await executeManageShapeScript(context, {
        action: "get",
        id,
        save: true,
      });
      if (result.action !== "get") return assert.fail(result.action);
      assert.match(
        result.savedPath ?? "",
        /^artifacts\/shapes\/lamp-\d+-[0-9a-f]{8}\.shape$/,
      );
      assert.equal(
        store.get(result.savedPath!.replace(/^artifacts\//, "")),
        CUBE,
      );
      assert.equal(JSON.parse(result.message).savedPath, result.savedPath);
    });

    it("turns whatever stamp the host's SDK hands over into an ISO string", () => {
      const date = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
      assert.equal(stampOf(date), "2026-01-02T03:04:05.000Z");
      assert.equal(stampOf({ toDate: () => date }), "2026-01-02T03:04:05.000Z");
      assert.equal(stampOf("2026-01-02"), "2026-01-02");
      assert.equal(stampOf(undefined), "");
      assert.equal(
        shapePostSummary(
          "p",
          { title: "T", createdAt: date },
          "https://staging.example",
        ).url,
        "https://staging.example/shapes/p",
      );
    });
  });

  describe("getList", () => {
    it("lists the user's own posts, drafts included, newest first, and no one else's", async () => {
      const { context, writer, id } = await seeded();
      await publish(context, {
        title: "Draft",
        script: CUBE_2,
        published: false,
      });
      const third = await publishAgreed(context, {
        title: "Newest",
        script: CUBE,
      });
      writer.uid = "u-bob";
      await publishAgreed(context, { title: "Bob's", script: CUBE });
      writer.uid = "u-alice";
      const result = await executeManageShapeScript(context, {
        action: "getList",
      });
      if (result.action !== "getList") return assert.fail(result.action);
      assert.deepEqual(
        result.posts.map((post) => [post.title, post.published]),
        [
          ["Newest", true],
          ["Draft", false],
          ["Lamp", true],
        ],
      );
      assert.equal(
        result.posts[0]!.id,
        third.action === "publish" ? third.id : "",
      );
      assert.equal(result.posts[2]!.id, id);
      assert.equal(result.posts[0]!.url, shapePostUrl(result.posts[0]!.id));
      const parsed = JSON.parse(result.message);
      assert.equal(parsed.count, 3);
      assert.deepEqual(parsed.posts, result.posts);
    });

    it("answers at most `limit` posts, defaulting and clamping the count", async () => {
      const { context } = await seeded();
      await publishAgreed(context, { title: "Two", script: CUBE });
      await publishAgreed(context, { title: "Three", script: CUBE });
      const result = await executeManageShapeScript(context, {
        action: "getList",
        limit: 2,
      });
      assert.deepEqual(
        result.action === "getList"
          ? result.posts.map((post) => post.title)
          : [],
        ["Three", "Two"],
      );
      assert.equal(listLimitOf(undefined), GET_LIST_DEFAULT_LIMIT);
      assert.equal(listLimitOf("5"), GET_LIST_DEFAULT_LIMIT);
      assert.equal(listLimitOf(0), 1);
      assert.equal(listLimitOf(2.9), 2);
      assert.equal(listLimitOf(10_000), GET_LIST_MAX_LIMIT);
    });
  });
});
