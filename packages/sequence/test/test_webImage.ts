import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { presentSlide } from "../src/core/presentSlide";
import { parseSlideArgs } from "../src/core/definitions";
import {
  MAX_WEB_IMAGE_BYTES,
  fetchWebImage,
  pagePreviewImage,
} from "../src/core/webImage";
import { fakeHost, record } from "./fakeHost";

// The web, as the tests see it: a response per URL, and the URLs fetched.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
let web: Map<string, () => Response>;
let fetched: string[];
const realFetch = globalThis.fetch;

beforeEach(() => {
  web = new Map([
    ["https://example.com/tower.png", () => new Response(PNG)],
    [
      "https://example.com/page.html",
      () =>
        new Response("<html></html>", {
          headers: { "content-type": "image/png" },
        }),
    ],
    ["https://example.com/gone.png", () => new Response("", { status: 404 })],
  ]);
  fetched = [];
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    fetched.push(url);
    const respond = web.get(url);
    if (!respond) throw new TypeError("fetch failed");
    return respond();
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

let unique = 0;
const title = (name: string) => `${name} ${++unique}`;
const data = (result: { data?: unknown }) =>
  (result.data ?? {}) as Record<string, unknown>;

test("a picture slide's imageUrl is shown as it is, saved, and not drawn", async () => {
  const host = fakeHost();
  const name = title("Eiffel Tower");
  const result = await presentSlide(host.context(), {
    slide: 1,
    totalSlides: 3,
    title: name,
    imageUrl: "https://example.com/tower.png",
  });

  const { imageData, imagePath, imageUrl, slideshowId, prompt } = data(result);
  assert.equal(
    imageData,
    `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`,
  );
  assert.match(
    String(imagePath),
    /^artifacts\/images\/\d{4}\/\d{2}\/[0-9a-f]{16}\.png$/,
  );
  assert.ok(
    host.artifacts.files.has(String(imagePath).slice("artifacts/".length)),
  );
  assert.equal(imageUrl, "https://example.com/tower.png");
  assert.equal(prompt, name);
  assert.equal(host.calls.length, 0);
  assert.match(
    result.message,
    /its picture is from https:\/\/example\.com\/tower\.png/,
  );
  assert.deepEqual(
    record(host.artifacts, `slideshows/${slideshowId}.json`).slides,
    {
      "1": {
        title: name,
        imagePrompt: "",
        imagePath,
        imageUrl: "https://example.com/tower.png",
      },
    },
  );
});

test("a picture that can't be fetched is drawn from imagePrompt, and the model is told", async () => {
  const host = fakeHost();
  const result = await presentSlide(host.context(), {
    slide: 1,
    totalSlides: 3,
    title: title("Gone"),
    imagePrompt: "a lighthouse at dusk",
    imageUrl: "https://example.com/gone.png",
  });

  assert.equal(host.calls.length, 1);
  assert.match(String(data(result).imageData), /^data:image\/png;base64,\d+$/);
  assert.equal(data(result).imageUrl, undefined);
  assert.match(
    result.message,
    /the picture at https:\/\/example\.com\/gone\.png couldn't be shown \(the site answered 404\), so it was drawn instead/,
  );
});

test("a picture that can't be fetched, with nothing to draw, isn't shown and says why", async () => {
  const host = fakeHost();
  const result = await presentSlide(host.context(), {
    slide: 1,
    totalSlides: 3,
    title: title("Not a picture"),
    imageUrl: "https://example.com/page.html",
  });

  assert.equal(result.sequence, null);
  assert.equal(result.data, undefined);
  assert.equal(host.calls.length, 0);
  assert.match(result.message, /isn't a PNG, JPEG, GIF or WebP picture/);
  assert.match(result.message, /another imageUrl/);
});

test("a Markdown slide places the picture at imageUrl at {{image}}", async () => {
  const host = fakeHost();
  const result = await presentSlide(host.context(), {
    slide: 1,
    totalSlides: 3,
    title: title("Paris"),
    markdown: "# Paris\n\n![the Eiffel Tower]({{image}})\n\n- 330 m",
    imageUrl: "https://example.com/tower.png",
  });

  assert.equal(host.calls.length, 0);
  assert.match(String(data(result).html), /\{\{image\}\}/);
  assert.match(String(data(result).imageData), /^data:image\/png;base64,/);
  assert.equal(data(result).prompt, "the Eiffel Tower");
});

test("an HTML slide's picture at imageUrl that can't be fetched is drawn from its alt text", async () => {
  const host = fakeHost();
  const result = await presentSlide(host.context(), {
    slide: 1,
    totalSlides: 3,
    title: title("Harbour"),
    html: '<div><img src="{{image}}" alt="a harbour at dawn"></div>',
    imageUrl: "https://example.com/gone.png",
  });

  assert.equal(host.calls.length, 1);
  assert.match(host.calls[0]?.prompt ?? "", /a harbour at dawn/);
  assert.match(
    result.message,
    /couldn't be shown \(the site answered 404\), so it was drawn instead/,
  );
});

test("the next guide step is drawn from a step whose picture came from the web", async () => {
  const host = fakeHost();
  const name = title("Knot");
  const step1 = await presentSlide(host.context(), {
    slide: 1,
    totalSlides: 3,
    title: name,
    imageUrl: "https://example.com/tower.png",
    mode: "steps",
  });
  await presentSlide(
    host.context({ userSpokeAt: Date.now() + 1, currentResult: step1 }),
    {
      slide: 2,
      totalSlides: 3,
      title: `${name} 2`,
      imagePrompt: "tighten it",
      mode: "steps",
    },
  );
  assert.deepEqual(host.calls[0]?.references, [data(step1).imagePath]);
});

test("imageUrl is kept only where the slide has a picture", () => {
  const imageUrl = "https://example.com/tower.png";
  const base = { slide: 1, totalSlides: 2, title: "T", imageUrl };
  const of = (args: Record<string, unknown>) => {
    const parsed = parseSlideArgs({ ...base, ...args });
    assert.notEqual(typeof parsed, "string");
    return typeof parsed === "string" ? undefined : parsed.imageUrl;
  };
  assert.equal(of({}), imageUrl);
  assert.equal(of({ html: '<img src="{{image}}">' }), imageUrl);
  assert.equal(of({ html: "<p>no place</p>" }), undefined);
  assert.equal(
    of({ chart: { type: "bar", data: { labels: [], datasets: [] } } }),
    undefined,
  );
});

test("only https URLs to named public sites are fetched", async () => {
  for (const [url, reason] of [
    ["http://example.com/tower.png", /only https/],
    ["https://127.0.0.1/x.png", /IP address/],
    ["https://2130706433/x.png", /IP address/],
    ["https://[::1]/x.png", /IP address/],
    ["https://localhost/x.png", /local network/],
    ["https://intranet/x.png", /local network/],
    ["https://printer.local/x.png", /local network/],
    ["https://user:pw@example.com/x.png", /password/],
    ["file:///etc/passwd", /only https/],
    ["not a url", /isn't a URL/],
  ] as const) {
    const result = await fetchWebImage(url, undefined);
    assert.ok("error" in result, url);
    assert.match(result.error, reason, url);
  }
  assert.deepEqual(fetched, []);
});

test("a redirect is followed only to a URL that may be fetched too", async () => {
  const redirect = (location: string) => () =>
    new Response(null, { status: 302, headers: { location } });
  web.set("https://example.com/short", redirect("/tower.png"));
  web.set("https://example.com/inside", redirect("https://10.0.0.1/admin.png"));
  web.set("https://example.com/loop", redirect("https://example.com/loop"));

  assert.ok(
    "imageData" in
      (await fetchWebImage("https://example.com/short", undefined)),
  );
  const inside = await fetchWebImage("https://example.com/inside", undefined);
  assert.ok("error" in inside && /IP address/.test(inside.error));
  assert.ok(!fetched.includes("https://10.0.0.1/admin.png"));
  const loop = await fetchWebImage("https://example.com/loop", undefined);
  assert.ok("error" in loop && /redirects too many times/.test(loop.error));
});

test("a picture over the size limit isn't read", async () => {
  web.set(
    "https://example.com/huge.png",
    () =>
      new Response(PNG, {
        headers: { "content-length": String(MAX_WEB_IMAGE_BYTES + 1) },
      }),
  );
  const big = new Uint8Array(MAX_WEB_IMAGE_BYTES + 1);
  big.set(PNG);
  web.set("https://example.com/streamed.png", () => new Response(big));

  for (const url of [
    "https://example.com/huge.png",
    "https://example.com/streamed.png",
  ]) {
    const result = await fetchWebImage(url, undefined);
    assert.ok("error" in result && /larger than 5 MB/.test(result.error), url);
  }
});

test("a response that isn't read is cancelled", async () => {
  let cancelled = 0;
  const body = () =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled++;
      },
    });
  web.set(
    "https://example.com/moved",
    () =>
      new Response(body(), {
        status: 302,
        headers: { location: "/missing.png" },
      }),
  );
  web.set(
    "https://example.com/missing.png",
    () => new Response(body(), { status: 404 }),
  );
  web.set(
    "https://example.com/declared.png",
    () =>
      new Response(body(), {
        headers: { "content-length": String(MAX_WEB_IMAGE_BYTES + 1) },
      }),
  );

  await fetchWebImage("https://example.com/moved", undefined);
  assert.equal(cancelled, 2);
  await fetchWebImage("https://example.com/declared.png", undefined);
  assert.equal(cancelled, 3);
});

const page = (head: string) => () =>
  new Response(
    `<!doctype html><html><head>${head}</head><body></body></html>`,
    {
      headers: { "content-type": "text/html" },
    },
  );

test("a web page's address shows its preview picture (og:image)", async () => {
  // As Car and Driver writes it: an absolute address with &amp; in it.
  web.set(
    "https://example.com/article",
    page(
      '<meta property="og:image" content="https://cdn.example.com/hero.png?crop=1&amp;resize=1200" data-next-head/>',
    ),
  );
  web.set(
    "https://cdn.example.com/hero.png?crop=1&resize=1200",
    () => new Response(PNG),
  );
  const host = fakeHost();
  const result = await presentSlide(host.context(), {
    slide: 1,
    totalSlides: 2,
    title: title("Roadster"),
    imageUrl: "https://example.com/article",
  });

  assert.equal(host.calls.length, 0);
  assert.match(String(data(result).imageData), /^data:image\/png;base64,/);
  assert.equal(data(result).imageUrl, "https://example.com/article");
  assert.match(
    result.message,
    /its picture is the preview picture of https:\/\/example\.com\/article \(https:\/\/cdn\.example\.com\/hero\.png\?crop=1&resize=1200\)/,
  );
});

test("a page's preview picture is checked like any address, and a page in turn isn't followed", async () => {
  web.set(
    "https://example.com/inside",
    page('<meta property="og:image" content="https://10.0.0.1/x.png">'),
  );
  web.set(
    "https://example.com/pages",
    page('<meta property="og:image" content="https://example.com/article2">'),
  );
  web.set(
    "https://example.com/article2",
    page('<meta property="og:image" content="https://example.com/tower.png">'),
  );
  web.set("https://example.com/bare", page("<title>no preview</title>"));

  const inside = await fetchWebImage("https://example.com/inside", undefined);
  assert.ok(
    "error" in inside &&
      /preview picture, https:\/\/10\.0\.0\.1\/x\.png: .*IP address/.test(
        inside.error,
      ),
  );
  assert.ok(!fetched.includes("https://10.0.0.1/x.png"));

  const pages = await fetchWebImage("https://example.com/pages", undefined);
  assert.ok("error" in pages && /isn't a PNG/.test(pages.error));
  assert.ok(!fetched.includes("https://example.com/tower.png"));

  const bare = await fetchWebImage("https://example.com/bare", undefined);
  assert.ok(
    "error" in bare && /web page with a preview picture/.test(bare.error),
  );
});

test("a page's preview picture is read from its meta tags, however they are written", () => {
  const at = "https://example.com/news/story";
  assert.equal(
    pagePreviewImage(`<meta content='/img/a.jpg' property='og:image'>`, at),
    "https://example.com/img/a.jpg",
  );
  assert.equal(
    pagePreviewImage(
      `<meta name="twitter:image" content="https://x.example/t.jpg">`,
      at,
    ),
    "https://x.example/t.jpg",
  );
  assert.equal(
    pagePreviewImage(
      `<meta name="twitter:image" content="https://x.example/t.jpg"><META PROPERTY="OG:IMAGE" CONTENT="https://x.example/o.jpg">`,
      at,
    ),
    "https://x.example/o.jpg",
  );
  assert.equal(
    pagePreviewImage(`<meta property="og:title" content="T">`, at),
    null,
  );
});

test("an imageUrl on a slide with no place for a picture isn't fetched, and the model is told", async () => {
  // From MulmoChat: a page's address on an HTML slide without {{image}}.
  const host = fakeHost();
  const result = await presentSlide(host.context(), {
    slide: 1,
    totalSlides: 1,
    title: title("Official reveal shot"),
    imageUrl: "https://example.com/article",
    html: '<div class="w-full h-full">Roadster</div>',
  });

  assert.deepEqual(fetched, []);
  assert.equal(data(result).imageData, undefined);
  assert.match(
    result.message,
    /the picture at https:\/\/example\.com\/article isn't shown: the slide has no \{\{image\}\} for it/,
  );
});
