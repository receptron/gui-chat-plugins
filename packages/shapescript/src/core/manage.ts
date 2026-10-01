// The `manageShapeScript` TOOL: the user's models in the public gallery on
// mulmoserver (https://server.mulmocast.com/shapes) — publish one, update or
// delete one of the user's own, fetch one, list the user's own.
//
// One tool with an `action`, as `manageCollection` is, rather than five: what a
// model reads is one description and one schema, and the host wires one
// handler. What a MODEL sees — name, description, schema, the document a post is
// — lives here so the two hosts cannot drift, exactly as `exportShapeScriptUsdz`
// does. What is deliberately NOT here is Firebase: the gallery is reached
// through a small `ShapeGalleryWriter` the host builds over its own remote-host
// session (the server signs into mulmoserver's Firebase AS THE USER — see
// docs/remote-host.md in MulmoClaude), so this entry stays browser-safe and
// the plugin declares no firebase dependency.
//
// The document mirrors mulmoserver's `shapes/{id}` exactly (its
// `src/firestore/shapeShape.ts`): the security rules there pin the key set
// with `hasOnly`, so a key added or dropped on one side is a refused write on
// the other. `SHAPE_POST_KEYS` is the pinned list; a test holds it to the
// rules' order.
//
// The script itself is NOT in the document (receptron/mulmoserver#266): it is
// a Storage object under the post, `text/plain`, and the document carries its
// id as `scriptId`. So a post is three writes — the script, the thumbnail,
// the document — through the same writer, in that order: the required upload
// first, so a failed one leaves nothing behind; the optional picture second,
// where its failure is a warning; and a refused document takes both objects
// back out.
import { disposeObject3D } from "../shapescript/dispose";
import { parseShapeScript } from "../shapescript/parser";
import { astToThreeJS } from "../shapescript/toThreeJS";
import { resolveShapeSource } from "../export/tool";
import type { ShapeScriptDispatchContext } from "./dispatch";
import { shapeArtifactPath } from "./paths";

export const MANAGE_TOOL_NAME = "manageShapeScript";

/** What one call does. `publish` and `update` write, `delete` removes, `get` and `getList` read. */
export const MANAGE_ACTIONS = [
  "publish",
  "update",
  "delete",
  "get",
  "getList",
] as const;
export type ManageShapeAction = (typeof MANAGE_ACTIONS)[number];

/** How many of the user's posts `getList` answers when the call does not say, and the most it will. */
export const GET_LIST_DEFAULT_LIMIT = 20;
export const GET_LIST_MAX_LIMIT = 100;

/** Where the gallery lives. A host may override it (a staging deploy). */
export const SHAPE_GALLERY_URL = "https://server.mulmocast.com";

/** The caps mulmoserver's rules enforce, mirrored so a post is refused here
 *  with a reason rather than there as a bare permission error. */
export const SHAPE_POST_LIMITS = {
  titleMax: 120,
  descriptionMax: 2000,
  /** In UTF-8 BYTES — the script is a Storage object and the gallery's Storage rule caps one
   *  at 10 MiB (`request.resource.size`); a script with Japanese comments is up to three bytes
   *  a character. This is the transport ceiling; what a phone can draw is the practical one. */
  scriptMax: 10 * 1024 * 1024,
  promptMax: 4000,
  authorNameMax: 80,
  keywordsMax: 10,
  keywordMax: 30,
  aiModelMax: 80,
} as const;

/** The one license a public post is granted under — mulmoserver's `src/config/shapeLicense.ts`.
 *  The document records it as `license`, and the server stamps `licenseAcceptedAt` when the
 *  owner first agrees; the rules accept no other value and never let a grant go again. */
export const SHAPE_LICENSE = "CC-BY-4.0";
export const SHAPE_LICENSE_LABEL = "CC BY 4.0";
export const SHAPE_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export type ShapeLicense = typeof SHAPE_LICENSE | null;

export const MANAGE_DESCRIPTION =
  "Manage the user's ShapeScript models in the public gallery at server.mulmocast.com/shapes, where anyone can view a model in 3D, read its source, download the USDZ and fork it. `action` says what to do. `publish` posts a new model — the same source as presentShapeScript, inline `script` or `path` to a saved .shape file, plus a `title` — and returns its URL. `update` changes a model the user already published, by `id` (the tail of its gallery URL), sending only the fields that change. `delete` removes one of the user's models by `id`. `get` fetches one post's details and its ShapeScript source by `id` — any published model, or the user's own draft — and with `save: true` also saves the source under artifacts/shapes/ where presentShapeScript can open it. `getList` lists the models the user has posted, drafts included, newest first. Every action runs under the user's own Google account — the app must be connected to Remote Host (signed in) first — and only the account that published a model can update or delete it. Publishing a public post, or making a draft or an unlicensed post public, licenses it under CC BY 4.0 and needs the user's explicit agreement, passed as `acceptLicense: true`; a draft needs none. A post's `license` field says whether its owner has granted that (CC-BY-4.0) or not (null: public posts from before the gallery asked). On publish and update a thumbnail is rendered and attached when the host can rasterise; the post still lands without one.";

export const MANAGE_PROMPT =
  "Use manageShapeScript for the gallery. `publish` and `update` make a model public under the user's name and `delete` removes one for good, so use those three ONLY when the user asks to publish, post, share, change or remove a model — never on your own initiative. `get` and `getList` only read, and are fine whenever they help: to find the id of a model the user wants to change, or to fetch a published model the user wants to see, fork or build on (`get` with `save: true` puts its source under artifacts/shapes/, where presentShapeScript opens it by `path`). Publishing a model publicly licenses it under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/): anyone may share and adapt it, commercially too, as long as they credit the author. Before publishing a public post — or making a draft public, or editing a public post that has no license yet — tell the user that in a sentence and ask whether they agree; pass `acceptLicense: true` only after they have said yes in this conversation, never on your own, and leave it out for a draft (`published: false`). Being public does not mean being licensed: a post whose `license` (from `get` / `getList`) is null was published before the gallery asked, and its owner has granted nothing — do not tell the user such a model may be reused, adapted or forked, and check `license` before saying so of any model that is not the user's own. Before publishing, make sure the model previews correctly (presentShapeScript / renderShapeScript) and give it a short title, a sentence of description and a few lowercase keywords someone would search for. Pass the user's original request as `prompt` so the post records how the model was made, and the model you are running as (its id, e.g. claude-opus-5) as `aiModel` when you know it. To change a model that is already in the gallery — a fix, a new version — `update` it by `id` rather than publishing a second copy, sending only the fields that change (a new `script` or `path`, a new `title`, …); the rest stay as they are. If the tool answers that Remote Host is not connected, tell the user to connect it (the Remote Host control in the app, Google sign-in) and offer to try again.";

/** The tool's JSON schema, in the shape both a gui-chat-protocol
 *  `ToolDefinition` (`parameters`) and an MCP tool (`inputSchema`) take. */
export const MANAGE_SCHEMA = {
  type: "object" as const,
  properties: {
    action: {
      type: "string",
      enum: [...MANAGE_ACTIONS],
      description:
        "What to do. publish: a new post (needs `title` and `script` or `path`). update: change the user's own post `id`, sending only the fields that change. delete: remove the user's own post `id`. get: one post's details and source by `id`. getList: the user's own posts, newest first.",
    },
    id: {
      type: "string",
      description:
        "The post's id — the tail of its gallery URL, or the id an earlier publish returned. Required for update, delete and get; not used by publish and getList.",
    },
    title: {
      type: "string",
      description: `publish and update: the model's title (1–${SHAPE_POST_LIMITS.titleMax} characters). Required for publish.`,
    },
    script: {
      type: "string",
      description:
        "publish and update: ShapeScript source. Provide either this or `path`, not both. Required for publish; for update, omit both to keep the model as it is.",
    },
    path: {
      type: "string",
      description:
        "publish and update: path to an existing .shape file — an `artifacts/shapes/...` path presentShapeScript saved, or any .shape the host can read. Provide either this or `script`, not both.",
    },
    description: {
      type: "string",
      description: `publish and update: what the model is, for the gallery page (up to ${SHAPE_POST_LIMITS.descriptionMax} characters). Optional; on update, "" clears it.`,
    },
    keywords: {
      type: "array",
      items: { type: "string" },
      description: `publish and update: up to ${SHAPE_POST_LIMITS.keywordsMax} short lowercase tags someone would search for. Optional.`,
    },
    prompt: {
      type: "string",
      description: `publish and update: the request the model was made from, recorded as its provenance (up to ${SHAPE_POST_LIMITS.promptMax} characters). Optional; on update, "" clears it.`,
    },
    aiModel: {
      type: "string",
      description: `publish and update: the AI model that wrote the script — the id you are running as, e.g. claude-opus-5 (up to ${SHAPE_POST_LIMITS.aiModelMax} characters). Optional; on update, "" clears it.`,
    },
    published: {
      type: "boolean",
      description:
        "publish and update: false makes the post a draft only the user can see in the gallery's My models. Default true on publish; unchanged on update.",
    },
    acceptLicense: {
      type: "boolean",
      description: `publish and update: true records that the user has explicitly agreed, in this conversation, to license the model under ${SHAPE_LICENSE_LABEL} (${SHAPE_LICENSE_URL}) — anyone may share and adapt it, commercially too, with credit to the author. Required to publish a public post, to make a draft public, and to edit a public post that has no license yet; not needed for a draft or for a post already licensed. Never pass it without asking the user first. The grant is permanent: it stays on the post through later edits and unpublishing.`,
    },
    save: {
      type: "boolean",
      description:
        "get: true also saves the fetched source as a new .shape file under artifacts/shapes/ and returns its path. Default false.",
    },
    limit: {
      type: "number",
      description: `getList: at most this many posts, newest first (1–${GET_LIST_MAX_LIMIT}). Default ${GET_LIST_DEFAULT_LIMIT}.`,
    },
  },
  // What each action needs beyond `action` differs (`title` and a source for publish, `id`
  // for update / delete / get); JSON Schema cannot say that, so the descriptions do and the
  // tool refuses a call that lacks it.
  required: ["action"],
};

/** The document a post is, minus the server-stamped times the host adds
 *  (`createdAt` / `updatedAt` must be `serverTimestamp()` — the rules refuse
 *  anything else — and `licenseAcceptedAt`, stamped the same way when `license`
 *  is set). Every key present with a value: the rules pin the set and
 *  Firestore rejects `undefined`. The script is `scriptId`, the Storage object
 *  `uploadScript` returned — never the text. */
export interface ShapePostDoc {
  uid: string;
  authorName: string;
  title: string;
  description: string;
  scriptId: string;
  /** "prompt" for what this tool posts; "photos" is a post the web editor made from pictures. */
  source: "prompt" | "photos";
  prompt: string;
  photoIds: string[];
  thumbnailId: string;
  forkedFrom: string | null;
  keywords: string[];
  /** The AI model that wrote the script; "" when not said. */
  aiModel: string;
  published: boolean;
  /** `SHAPE_LICENSE` once the owner has agreed to it; null for a draft, and for a post from
   *  before the gallery asked. The rules refuse a public write that changes or removes a grant. */
  license: ShapeLicense;
}

/** The key set mulmoserver's rules accept, in the rules' own order (`licenseAcceptedAt`, the
 *  server stamp beside `license`, is the host's, as the two times are). */
export const SHAPE_POST_KEYS = [
  "uid",
  "authorName",
  "title",
  "description",
  "scriptId",
  "source",
  "prompt",
  "photoIds",
  "thumbnailId",
  "forkedFrom",
  "keywords",
  "aiModel",
  "published",
  "license",
] as const;

/** One post as `get` and `getList` answer it: the document's readable fields plus its id,
 *  URL and the two server stamps as ISO strings. Never the object ids, which mean nothing
 *  outside the writer, and never the script — `get` carries that beside. */
export interface ShapePostSummary {
  id: string;
  url: string;
  title: string;
  description: string;
  keywords: string[];
  prompt: string;
  aiModel: string;
  published: boolean;
  source: ShapePostDoc["source"];
  forkedFrom: string | null;
  authorName: string;
  /** The license the owner granted, or null when none has been. */
  license: ShapeLicense;
  /** When the owner agreed, as an ISO string; "" when they have not. */
  licenseAcceptedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** What a host supplies: who is posting, and the reads and writes, over its own
 *  signed-in session — the Firestore document and the Storage objects under it. */
export interface ShapeGalleryWriter {
  /** The signed-in user's Firebase uid — the post's owner. */
  uid: string;
  /** The Google display name, as the gallery shows it. Empty is allowed. */
  authorName: string;
  /** Overrides `SHAPE_GALLERY_URL` for the returned link. */
  siteUrl?: string;
  /** Create `shapes/{id}` from `doc` plus the server timestamps — `createdAt`, `updatedAt`,
   *  and `licenseAcceptedAt` when (and only when) `doc.license` is set: the rules want the
   *  grant's stamp to be the server's, and refuse a stamp without a grant. */
  createPost: (id: string, doc: ShapePostDoc) => Promise<void>;
  /** The data of `shapes/{id}` as stored, or null when there is no such post (or the rules
   *  hide it — another account's draft reads as absent). The plugin coerces it; `createdAt`
   *  and `updatedAt` may stay whatever the host's SDK returns (a `Date`, or anything with
   *  `toDate()`). */
  readPost: (id: string) => Promise<Record<string, unknown> | null>;
  /** Merge `patch` into `shapes/{id}` with a server `updatedAt` — a field-level update
   *  (Firestore `updateDoc`), never a whole-document write: a field absent from the patch
   *  must keep what the document holds now. `createdAt` is not sent; the rules freeze it. A
   *  `license` in the patch is the owner's first agreement: the host adds `licenseAcceptedAt`
   *  as a server stamp beside it — unless the document turns out to be licensed already, in
   *  which case both are dropped, since the rules let a grant be made once and never moved.
   *  CONDITIONAL: the write applies only while the document still matches `expect` — the
   *  owner, the object ids and the published state the plugin read — and is refused (throw, with
   *  `POST_CHANGED_MESSAGE` or a cause of the host's own) when it no longer does: a
   *  transaction, so a concurrent edit that replaced the script cannot lose its objects. */
  updatePost: (
    id: string,
    patch: ShapePostPatch,
    expect: ShapePostExpect,
  ) => Promise<void>;
  /** Remove `shapes/{id}`. CONDITIONAL like `updatePost`: only while the document still
   *  matches `expect`, refused (throw, `POST_CHANGED_MESSAGE`) when it no longer does — a
   *  transaction — so an update that landed after the plugin's read cannot have its new
   *  objects orphaned by a delete that only knows the old ids. Answers the document AS
   *  DELETED — the data the transaction read — since the objects under the post are the
   *  plugin's to remove, through `deleteObject`, and it must remove that version's (a
   *  reference photo the web editor swapped in meanwhile is not in `expect`). */
  deletePost: (
    id: string,
    expect: ShapePostExpect,
  ) => Promise<Record<string, unknown>>;
  /** The posts of `uid` — drafts included, which the rules show the owner — newest first
   *  (`createdAt` descending), at most `limit`. Each as `readPost` answers it, with its id. */
  listPosts: (
    uid: string,
    limit: number,
  ) => Promise<Array<{ id: string; data: Record<string, unknown> }>>;
  /** The ShapeScript source of a post: the Storage object `scriptId` under `shapes/{ownerUid}/{id}/`.
   *  `ownerUid` is the POST's owner, not the session's — the rule opens the objects to anyone. */
  readScript: (
    ownerUid: string,
    id: string,
    scriptId: string,
  ) => Promise<string>;
  /** Store a PNG under the post and return the object id the document carries. */
  uploadThumbnail: (id: string, png: Uint8Array) => Promise<string>;
  /** Store the ShapeScript source under the post as `SHAPE_SCRIPT_CONTENT_TYPE` and return
   *  the object id the document carries as `scriptId`. */
  uploadScript: (id: string, script: string) => Promise<string>;
  /** Remove an object under the session user's post — a replaced thumbnail or script, one of a
   *  post that was never written, or every object of a deleted post. */
  deleteObject: (id: string, objectId: string) => Promise<void>;
}

export interface ManageShapeScriptContext extends ShapeScriptDispatchContext {
  /** null when the host has no signed-in session — the tool then says how to get one. */
  gallery: ShapeGalleryWriter | null;
  /** Rasterise one view of `script` to a PNG, or null where this host cannot
   *  (no headless browser — a Docker image, an install that skipped the
   *  Chromium download). Supplied from `@gui-chat-plugin/shapescript/render`.
   *  The picture is best effort because the gallery tolerates its absence: a
   *  card without one shows the model icon, and the post's owner can add one
   *  from the web editor. Optional, as the README says: a host that cannot
   *  rasterise at all leaves it out, and every post goes up without one. */
  renderThumbnail?: (script: string) => Promise<Uint8Array | null>;
  /** A fault that did not stop the call — a thumbnail that could not be made. */
  onWarning?: (message: string) => void;
}

/** What one call did. `message` is the sentence — or, for the two reads, the JSON — the agent
 *  reads; the rest is for a host that logs or links. */
export type ManageShapeResult =
  | {
      action: "publish" | "update";
      message: string;
      id: string;
      url: string;
      thumbnail: boolean;
    }
  | { action: "delete"; message: string; id: string; url: string }
  | {
      action: "get";
      message: string;
      id: string;
      url: string;
      post: ShapePostSummary;
      script: string;
      savedPath: string | null;
    }
  | { action: "getList"; message: string; posts: ShapePostSummary[] };

/** What a host uploads the script as; the gallery's Storage rule admits `text/plain.*`. */
export const SHAPE_SCRIPT_CONTENT_TYPE = "text/plain; charset=utf-8";

/** The header a host puts on every object it uploads under a post. Each has a random id and
 *  is never rewritten, so a browser — and the gallery's CDN, when it has one — may keep it. */
export const SHAPE_OBJECT_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** What `updatePost` must still find on the document for the write to apply: the read the
 *  plugin merged against. Object ids are minted per upload and never reused, so an equal
 *  pair means no other edit replaced the model in between. `published` is pinned too: whether
 *  the patch carries a grant was decided from it (CodeRabbit on #3180), so a publish or
 *  unpublish that landed meanwhile must refuse the write rather than license a draft. */
export interface ShapePostExpect {
  uid: string;
  scriptId: string;
  thumbnailId: string;
  published: boolean;
}

/** The precondition for an update or delete of `existing`, as the plugin read it. */
export const expectOf = (existing: ShapePostDoc): ShapePostExpect => ({
  uid: existing.uid,
  scriptId: existing.scriptId,
  thumbnailId: existing.thumbnailId,
  published: existing.published,
});

/** The refusal a host raises from `updatePost` when the post no longer matches `expect`. */
export const POST_CHANGED_MESSAGE =
  "The post changed while this update was being prepared (another edit replaced its model); nothing was written — read it again and retry.";

export const NOT_CONNECTED_MESSAGE =
  "Not connected to the gallery: it is reached under the user's Google account, which needs the app's Remote Host connected (sign in with Google in the Remote Host control), then try again.";

/** The refusal for a public write without the owner's agreement. */
export const LICENSE_REQUIRED_MESSAGE = `Publishing a post publicly licenses it under ${SHAPE_LICENSE_LABEL} (${SHAPE_LICENSE_URL}): anyone may share and adapt it, commercially too, with credit to the author. Ask the user whether they agree, and pass \`acceptLicense: true\` only once they have — or post it as a draft (\`published: false\`), which needs no agreement.`;

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const keywordOf = (entry: unknown): string =>
  typeof entry === "string"
    ? entry.trim().toLowerCase().slice(0, SHAPE_POST_LIMITS.keywordMax)
    : "";

/** Keywords as the gallery stores them: trimmed, lowercased, deduplicated,
 *  each cut to `keywordMax`, at most `keywordsMax`. The same rule as
 *  mulmoserver's `normalizeKeywords`, so a tag typed there and one sent from
 *  here can never be two spellings of one word. A comma-separated string is
 *  accepted too, since a model sometimes sends one. */
export function normalizeKeywords(raw: unknown): string[] {
  const entries = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const keywords = entries.map(keywordOf).filter((keyword) => keyword !== "");
  return [...new Set(keywords)].slice(0, SHAPE_POST_LIMITS.keywordsMax);
}

function requireLength(
  name: string,
  value: string,
  max: number,
  min = 0,
): string {
  if (value.length < min) throw new Error(`\`${name}\` is required`);
  if (value.length > max)
    throw new Error(
      `\`${name}\` is too long (${value.length} characters; the gallery allows ${max})`,
    );
  return value;
}

/** The script's limit is in UTF-8 bytes, measured as the Storage rule measures it. */
export function requireScriptBytes(value: string): string {
  if (value.length < 1) throw new Error("`script` is required");
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > SHAPE_POST_LIMITS.scriptMax)
    throw new Error(
      `\`script\` is too long (${bytes} bytes; the gallery allows ${SHAPE_POST_LIMITS.scriptMax})`,
    );
  return value;
}

/** The document for one post, built field by field so nothing the caller
 *  passed can reach Firestore uninvited. Throws on a limit the rules would
 *  refuse, naming the field. */
export function shapePostFrom(
  writer: Pick<ShapeGalleryWriter, "uid" | "authorName">,
  fields: {
    title: string;
    /** The object id `uploadScript` returned. */
    scriptId: string;
    description?: string | undefined;
    prompt?: string | undefined;
    keywords?: unknown;
    aiModel?: string | undefined;
    published?: boolean | undefined;
    thumbnailId?: string | undefined;
    license?: ShapeLicense | undefined;
  },
): ShapePostDoc {
  return {
    uid: writer.uid,
    authorName: writer.authorName.slice(0, SHAPE_POST_LIMITS.authorNameMax),
    title: requireLength(
      "title",
      fields.title.trim(),
      SHAPE_POST_LIMITS.titleMax,
      1,
    ),
    description: requireLength(
      "description",
      fields.description ?? "",
      SHAPE_POST_LIMITS.descriptionMax,
    ),
    scriptId: fields.scriptId,
    source: "prompt",
    prompt: requireLength(
      "prompt",
      fields.prompt ?? "",
      SHAPE_POST_LIMITS.promptMax,
    ),
    photoIds: [],
    thumbnailId: fields.thumbnailId ?? "",
    forkedFrom: null,
    keywords: normalizeKeywords(fields.keywords),
    aiModel: requireLength(
      "aiModel",
      (fields.aiModel ?? "").trim(),
      SHAPE_POST_LIMITS.aiModelMax,
    ),
    published: fields.published !== false,
    license: fields.license ?? null,
  };
}

/** The grant a write carries, mirroring the gallery's own editor: a public post needs the
 *  owner's agreement (`acceptLicense: true`) and records it; a draft records none even when
 *  agreement was offered — publishing later is when it is asked for; a post already licensed
 *  keeps its grant, which the rules would refuse to restate. Throws `LICENSE_REQUIRED_MESSAGE`
 *  for a public post without agreement — before anything is uploaded. */
export function licenseFor(
  published: boolean,
  acceptLicense: unknown,
  existing: ShapeLicense = null,
): ShapeLicense {
  if (existing === SHAPE_LICENSE) return existing;
  if (!published) return null;
  if (acceptLicense !== true) throw new Error(LICENSE_REQUIRED_MESSAGE);
  return SHAPE_LICENSE;
}

/** The gallery's address for one post. */
export function shapePostUrl(id: string, siteUrl = SHAPE_GALLERY_URL): string {
  const base = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  return `${base}/shapes/${id}`;
}

/** Build and drop the model, so a script the viewer cannot show is refused
 *  here with its diagnostic rather than published broken. */
function requireBuildable(script: string): void {
  disposeObject3D(astToThreeJS(parseShapeScript(script)));
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The thumbnail's object id, or "" when none could be made — a warning, not a
 *  failure, since the post is what the user asked for. */
async function thumbnailFor(
  context: ManageShapeScriptContext,
  gallery: ShapeGalleryWriter,
  id: string,
  script: string,
): Promise<string> {
  try {
    const png = context.renderThumbnail
      ? await context.renderThumbnail(script)
      : null;
    return png ? await gallery.uploadThumbnail(id, png) : "";
  } catch (error) {
    context.onWarning?.(`thumbnail skipped: ${messageOf(error)}`);
    return "";
  }
}

/** Write the post; if that fails, take the script and the thumbnail back out
 *  so a refused write does not leave objects nothing references. */
async function writePost(
  context: ManageShapeScriptContext,
  gallery: ShapeGalleryWriter,
  id: string,
  doc: ShapePostDoc,
): Promise<void> {
  try {
    await gallery.createPost(id, doc);
  } catch (error) {
    await discardObjects(context, gallery, id, [doc.scriptId, doc.thumbnailId]);
    throw error;
  }
}

const newPostId = (): string => globalThis.crypto.randomUUID();

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

/** An existing post as stored, coerced to the document shape: a post from before a key
 *  existed (`keywords`, `aiModel`, `description`) reads as its empty value, so the rewrite
 *  carries every key the rules pin. */
export function existingShapePost(data: Record<string, unknown>): ShapePostDoc {
  return {
    uid: stringOr(data.uid, ""),
    authorName: stringOr(data.authorName, ""),
    title: stringOr(data.title, ""),
    description: stringOr(data.description, ""),
    scriptId: stringOr(data.scriptId, ""),
    source: data.source === "photos" ? "photos" : "prompt",
    prompt: stringOr(data.prompt, ""),
    photoIds: Array.isArray(data.photoIds)
      ? data.photoIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    thumbnailId: stringOr(data.thumbnailId, ""),
    forkedFrom: typeof data.forkedFrom === "string" ? data.forkedFrom : null,
    keywords: normalizeKeywords(data.keywords),
    aiModel: stringOr(data.aiModel, ""),
    published: data.published !== false,
    license: data.license === SHAPE_LICENSE ? SHAPE_LICENSE : null,
  };
}

const hasToDate = (value: unknown): value is { toDate: () => Date } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { toDate?: unknown }).toDate === "function";

/** A server stamp as an ISO string, whatever the host's SDK handed over: a `Date`, a
 *  Firestore `Timestamp` (anything with `toDate()`), a string already, or "" for none. */
export function stampOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (hasToDate(value)) return stampOf(value.toDate());
  return typeof value === "string" ? value : "";
}

/** One stored post as the two reads answer it. */
export function shapePostSummary(
  id: string,
  data: Record<string, unknown>,
  siteUrl?: string,
): ShapePostSummary {
  const post = existingShapePost(data);
  return {
    id,
    url: shapePostUrl(id, siteUrl),
    title: post.title,
    description: post.description,
    keywords: post.keywords,
    prompt: post.prompt,
    aiModel: post.aiModel,
    published: post.published,
    source: post.source,
    forkedFrom: post.forkedFrom,
    authorName: post.authorName,
    license: post.license,
    licenseAcceptedAt: post.license ? stampOf(data.licenseAcceptedAt) : "",
    createdAt: stampOf(data.createdAt),
    updatedAt: stampOf(data.updatedAt),
  };
}

const noSuchPost = (id: string): string =>
  `No gallery post has the id "${id}" (or it is another account's draft, which only that account can see)`;

/** The post `id` names, when it exists and is the session user's own. Refused here with the
 *  reason — the rules would refuse the write too, but only as a bare permission error. */
async function requireOwnPost(
  gallery: ShapeGalleryWriter,
  id: string,
  verb: "update" | "delete",
): Promise<ShapePostDoc> {
  const data = await gallery.readPost(id);
  if (!data) throw new Error(noSuchPost(id));
  const existing = existingShapePost(data);
  if (existing.uid !== gallery.uid)
    throw new Error(
      `The post "${id}" was published by another account; only its publisher can ${verb} it`,
    );
  return existing;
}

/** The fields an update may send. PARTIAL on purpose: a field the caller did not give is not
 *  sent at all, so the document keeps whatever it holds NOW — not what a read a moment ago
 *  saw. Two clients editing one post cannot then put back each other's replaced objects. */
export type ShapePostPatch = Partial<
  Pick<
    ShapePostDoc,
    | "title"
    | "description"
    | "prompt"
    | "keywords"
    | "aiModel"
    | "published"
    | "scriptId"
    | "thumbnailId"
  >
> & {
  /** Present only for the owner's FIRST agreement: never null, never on a licensed post. */
  license?: typeof SHAPE_LICENSE;
};

const givenString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** The text fields the caller GAVE — an explicit "" included, which clears one. */
function givenFields(args: Record<string, unknown>): ShapePostPatch {
  return {
    ...(givenString(args.title) === undefined
      ? {}
      : { title: args.title as string }),
    ...(givenString(args.description) === undefined
      ? {}
      : { description: args.description as string }),
    ...(givenString(args.prompt) === undefined
      ? {}
      : { prompt: args.prompt as string }),
    ...(givenString(args.aiModel) === undefined
      ? {}
      : { aiModel: args.aiModel as string }),
    ...(args.keywords === undefined
      ? {}
      : { keywords: normalizeKeywords(args.keywords) }),
    ...(typeof args.published === "boolean"
      ? { published: args.published }
      : {}),
  };
}

/** The update for the user's own post: `doc` is the post as it will read, `patch` what is
 *  sent — only the fields the caller gave (an explicit "" clears one), plus the new object
 *  ids when the source changed, plus `license` when this edit is the owner's first agreement
 *  (a public post that had none needs it — `LICENSE_REQUIRED_MESSAGE` otherwise). Every value
 *  has passed the same limits as a new post, so a refusal is named here before anything is
 *  uploaded. `uid`, `authorName`, `source`, `photoIds` and `forkedFrom` are never the caller's. */
export function shapePostPatch(
  existing: ShapePostDoc,
  args: Record<string, unknown>,
  objects?: { scriptId: string; thumbnailId: string },
): { doc: ShapePostDoc; patch: ShapePostPatch } {
  const given = givenFields(args);
  const license = licenseFor(
    given.published ?? existing.published,
    args.acceptLicense,
    existing.license,
  );
  const checked = shapePostFrom(
    { uid: existing.uid, authorName: existing.authorName },
    { ...existing, ...given, ...objects, license },
  );
  const doc: ShapePostDoc = {
    ...checked,
    source: existing.source,
    photoIds: existing.photoIds,
    forkedFrom: existing.forkedFrom,
  };
  const patch: ShapePostPatch = {
    ...objects,
    ...(license && !existing.license ? { license } : {}),
  };
  for (const key of Object.keys(given) as Array<keyof ShapePostPatch>)
    Object.assign(patch, { [key]: doc[key] });
  return { doc, patch };
}

const hasSource = (args: Record<string, unknown>): boolean =>
  optionalString(args.script) !== undefined ||
  optionalString(args.path) !== undefined;

/** A checked script: resolved from `script` / `path`, within the Storage cap, and buildable. */
async function checkedScript(
  context: ManageShapeScriptContext,
  args: Record<string, unknown>,
): Promise<string> {
  const { script } = await resolveShapeSource(context, args);
  requireScriptBytes(script);
  requireBuildable(script);
  return script;
}

/** Upload the script, then its thumbnail, under `id`. The script first: it is required, so a
 *  failed upload must not have a thumbnail to orphan. */
async function uploadObjects(
  context: ManageShapeScriptContext,
  gallery: ShapeGalleryWriter,
  id: string,
  script: string,
) {
  const scriptId = await gallery.uploadScript(id, script);
  const thumbnailId = await thumbnailFor(context, gallery, id, script);
  return { scriptId, thumbnailId };
}

/** Best-effort removal of objects nothing references any more; each failure is a warning. */
async function discardObjects(
  context: ManageShapeScriptContext,
  gallery: ShapeGalleryWriter,
  id: string,
  objectIds: string[],
): Promise<void> {
  await Promise.all(
    objectIds
      .filter((objectId) => objectId !== "")
      .map((objectId) =>
        gallery
          .deleteObject(id, objectId)
          .catch((cause: unknown) =>
            context.onWarning?.(
              `orphaned object ${objectId}: ${messageOf(cause)}`,
            ),
          ),
      ),
  );
}

function writtenResult(
  action: "publish" | "update",
  doc: ShapePostDoc,
  id: string,
  gallery: ShapeGalleryWriter,
  state: string,
): ManageShapeResult {
  const url = shapePostUrl(id, gallery.siteUrl);
  const licensed = doc.license
    ? ` (licensed under ${SHAPE_LICENSE_LABEL})`
    : "";
  const picture = doc.thumbnailId
    ? ""
    : " No thumbnail could be attached; the gallery shows a placeholder until the user edits the post.";
  return {
    action,
    message: `${state}: "${doc.title}" is at ${url}${licensed}.${picture}`,
    id,
    url,
    thumbnail: doc.thumbnailId !== "",
  };
}

async function publishNewPost(
  context: ManageShapeScriptContext,
  gallery: ShapeGalleryWriter,
  args: Record<string, unknown>,
): Promise<ManageShapeResult> {
  const title = optionalString(args.title);
  if (!title) throw new Error("`title` is required");
  const script = await checkedScript(context, args);
  const published = args.published !== false;
  // The document is built first — with a placeholder id — so a limit, or a missing
  // agreement, is named before an upload.
  const post = shapePostFrom(gallery, {
    title,
    scriptId: "",
    description: optionalString(args.description),
    prompt: optionalString(args.prompt),
    keywords: args.keywords,
    aiModel: optionalString(args.aiModel),
    published,
    license: licenseFor(published, args.acceptLicense),
  });
  const id = newPostId();
  const doc: ShapePostDoc = {
    ...post,
    ...(await uploadObjects(context, gallery, id, script)),
  };
  await writePost(context, gallery, id, doc);
  return writtenResult(
    "publish",
    doc,
    id,
    gallery,
    doc.published
      ? "Published"
      : "Saved as a draft (only the user can see it, under My models)",
  );
}

/** Rewrite the user's own post `id`. A new source replaces the script object and the
 *  thumbnail; the replaced objects go once the document points at the new ones, and the new
 *  ones go if the document is refused — either way nothing is left that nothing references.
 *  The write is conditional on the post still carrying the object ids the read saw, so two
 *  edits racing on one post cannot orphan the winner's objects: the loser is refused with
 *  `POST_CHANGED_MESSAGE`, its uploads taken back out. */
async function updateExistingPost(
  context: ManageShapeScriptContext,
  gallery: ShapeGalleryWriter,
  id: string,
  args: Record<string, unknown>,
): Promise<ManageShapeResult> {
  const existing = await requireOwnPost(gallery, id, "update");
  const script = hasSource(args) ? await checkedScript(context, args) : null;
  // Limits are named before any upload: a first merge, without new objects, is the dry run.
  shapePostPatch(existing, args);
  const objects =
    script === null
      ? undefined
      : await uploadObjects(context, gallery, id, script);
  const { doc, patch } = shapePostPatch(existing, args, objects);
  try {
    await gallery.updatePost(id, patch, expectOf(existing));
  } catch (error) {
    if (objects)
      await discardObjects(context, gallery, id, [
        objects.scriptId,
        objects.thumbnailId,
      ]);
    throw error;
  }
  if (objects)
    await discardObjects(context, gallery, id, [
      existing.scriptId,
      existing.thumbnailId,
    ]);
  return writtenResult(
    "update",
    doc,
    id,
    gallery,
    doc.published
      ? "Updated"
      : "Updated as a draft (only the user can see it, under My models)",
  );
}

/** Remove the user's own post `id`: the document first, so the post is gone from the gallery
 *  at once, then every object under it — script, thumbnail, and the reference photos of a
 *  post the web editor made. The removal is conditional on the object ids the read saw, as
 *  an update is: an edit that replaced the model meanwhile is refused with
 *  `POST_CHANGED_MESSAGE` rather than deleted with its new objects left behind (Codex on
 *  #3161). An object that will not go is an orphan of random name that nothing links to, so
 *  that is a warning, not a failure. */
async function deleteOwnPost(
  context: ManageShapeScriptContext,
  gallery: ShapeGalleryWriter,
  id: string,
): Promise<ManageShapeResult> {
  const existing = await requireOwnPost(gallery, id, "delete");
  // The objects to remove are the DELETED document's, not the read's: `expect` pins the model,
  // not the reference photos, which the web editor may have swapped in between (CodeRabbit).
  const gone = existingShapePost(
    await gallery.deletePost(id, expectOf(existing)),
  );
  await discardObjects(context, gallery, id, [
    gone.scriptId,
    gone.thumbnailId,
    ...gone.photoIds,
  ]);
  const url = shapePostUrl(id, gallery.siteUrl);
  return {
    action: "delete",
    message: `Deleted: "${existing.title}" (${url}) is no longer in the gallery.`,
    id,
    url,
  };
}

/** The fetched source as a new file under artifacts/shapes/, named after the post. */
async function saveScript(
  context: ManageShapeScriptContext,
  title: string,
  script: string,
): Promise<string> {
  const { relPath, filePath } = shapeArtifactPath(title);
  await context.files.artifacts.write(relPath, script);
  return filePath;
}

/** One post — anyone's published one, or the user's own draft — with its source. */
async function getPost(
  context: ManageShapeScriptContext,
  gallery: ShapeGalleryWriter,
  id: string,
  args: Record<string, unknown>,
): Promise<ManageShapeResult> {
  const data = await gallery.readPost(id);
  if (!data) throw new Error(noSuchPost(id));
  const stored = existingShapePost(data);
  const post = shapePostSummary(id, data, gallery.siteUrl);
  const script = await gallery.readScript(stored.uid, id, stored.scriptId);
  const savedPath =
    args.save === true ? await saveScript(context, post.title, script) : null;
  return {
    action: "get",
    message: JSON.stringify({ post, script, savedPath }),
    id,
    url: post.url,
    post,
    script,
    savedPath,
  };
}

/** `limit` as a count in range; the default when not given, the nearest bound when outside. */
export function listLimitOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return GET_LIST_DEFAULT_LIMIT;
  return Math.min(GET_LIST_MAX_LIMIT, Math.max(1, Math.floor(value)));
}

/** The session user's own posts, drafts included, newest first. */
async function listOwnPosts(
  gallery: ShapeGalleryWriter,
  args: Record<string, unknown>,
): Promise<ManageShapeResult> {
  const rows = await gallery.listPosts(gallery.uid, listLimitOf(args.limit));
  const posts = rows.map((row) =>
    shapePostSummary(row.id, row.data, gallery.siteUrl),
  );
  return {
    action: "getList",
    message: JSON.stringify({ count: posts.length, posts }),
    posts,
  };
}

function actionOf(args: Record<string, unknown>): ManageShapeAction {
  const action = args.action;
  if (
    typeof action === "string" &&
    (MANAGE_ACTIONS as readonly string[]).includes(action)
  )
    return action as ManageShapeAction;
  throw new Error(`\`action\` must be one of ${MANAGE_ACTIONS.join(", ")}`);
}

function requireId(
  args: Record<string, unknown>,
  action: ManageShapeAction,
): string {
  const id = optionalString(args.id);
  if (!id)
    throw new Error(
      `\`id\` is required for ${action} — the tail of the post's gallery URL`,
    );
  return id.trim();
}

/**
 * Run one `manageShapeScript` call. Throws on a missing session, an unknown action, a
 * missing `id`, a missing or invalid source, a limit the gallery would refuse, and on
 * ShapeScript errors — the host's error path reports those to the model as it does for
 * `renderShapeScript`. Everything that can be refused is checked BEFORE anything is
 * uploaded or removed, so a refusal changes nothing. `update` and `delete` are the
 * session user's own posts only.
 */
export async function executeManageShapeScript(
  context: ManageShapeScriptContext,
  args: Record<string, unknown>,
): Promise<ManageShapeResult> {
  const gallery = context.gallery;
  if (!gallery) throw new Error(NOT_CONNECTED_MESSAGE);
  const action = actionOf(args);
  switch (action) {
    case "publish":
      return publishNewPost(context, gallery, args);
    case "update":
      return updateExistingPost(
        context,
        gallery,
        requireId(args, action),
        args,
      );
    case "delete":
      return deleteOwnPost(context, gallery, requireId(args, action));
    case "get":
      return getPost(context, gallery, requireId(args, action), args);
    case "getList":
      return listOwnPosts(gallery, args);
  }
}
