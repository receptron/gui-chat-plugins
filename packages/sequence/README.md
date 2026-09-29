# @gui-chat-plugin/sequence

Tools that show things one step at a time, as pictures, for
[GUI Chat Protocol](https://github.com/receptron/gui-chat-protocol) hosts:

| Tool               | Shows                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presentSlide`     | One slide of a spoken slideshow (mode `"presentation"`), or one step of a step-by-step guide the user follows along with (mode `"steps"`): a generated picture, or a slide in HTML |
| `defineStoryboard` | A story's cast: a reference sheet for each recurring character                                                                                                                     |
| `presentPanel`     | One panel of the story, with its characters drawn as in their sheets; an interactive story offers choices                                                                          |

From MulmoChat and MulmoGlass, tested there by voice on OpenAI Realtime, Gemini Live and Grok, and
in text chat.

## Using it in a host

```ts
import { plugins } from "@gui-chat-plugin/sequence/vue"; // presentSlide, defineStoryboard, presentPanel
import "@gui-chat-plugin/sequence/style.css";
```

The core entry (`@gui-chat-plugin/sequence`) has the same tools without Views, for a host that runs
`execute()` on a server, plus the record types and `loadRecord`, `SLIDESHOWS_DIR` and
`STORYBOARDS_DIR` for tools that read the records (MulmoChat's makeMovie).

### What `execute()` needs from its context

|                                      | Used for                                                                                       | Without it                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `app.generateImage(prompt)`          | every picture                                                                                  | "image generation isn't available"                                                  |
| `app.editImages(prompt, imagePaths)` | a panel drawn from its characters' sheets, a guide step drawn from the step before             | drawn from the prompt alone                                                         |
| `files.artifacts` (`FileOps`)        | the records, and checking that a reference picture is still there                              | records are kept in memory only (the results say they weren't saved); no references |
| `userSpokeAt`                        | holding a guide's next step, or a story's next panel after a choice, until the user has spoken | nothing is held                                                                     |
| `conversationId`                     | keeping each conversation's slideshows, holds and repeats apart                                | one conversation                                                                    |
| `currentResult`                      | telling "show step 2 again" (it isn't on the screen) from a repeated call (it is)              | a step asked for again is shown again                                               |

`generateImage` and `editImages` are gui-chat-protocol's `context.app` conventions: they save each
picture as `artifacts/images/…` and return its path in `data.imagePath`. `currentResult` is compared
by `data.imagePath` when it has one, so a host that runs `execute()` on a server can send the
current result without its picture.

### Keeping a sequence going

Every shown step's result carries `sequence` (gui-chat-protocol 2.1): where the sequence is, or
`null` when a step couldn't be shown. A host that wires gui-chat-protocol's `createSequenceKeeper`
asks the model to go on when it ends a reply mid-slideshow, and passes `keeper.userSpokeAt()` as
`context.userSpokeAt`. Without it the tools still work: each step asks for the next in its
instructions, which models usually follow.

Step results also set `instructionsRequired`, so a turn-based host (text chat) takes a turn for the
model to explain the step.

### State

The holds, the repeat guard and each slideshow's shown steps are kept in memory where `execute()`
runs, per conversation (`context.conversationId`, gui-chat-protocol 2.2): a host that runs
`execute()` for several browser tabs or sessions in one process sets it, so they don't mix. A host
that doesn't has one conversation. The 50 most recently used conversations are kept. Calls may
overlap (a host that runs `execute()` on a server gets them as concurrent requests): a call is
claimed before anything is awaited, so an identical one waits for it and a later step is held while
it is drawn.

## HTML slides

A slide is a generated picture (`imagePrompt`) or HTML (`html`), the model's choice per slide: a
picture for a scene or an object, HTML for words, numbers, lists, comparisons and diagrams, which
picture models draw badly. The model writes the inside of `<body>` for a 1280x720 canvas, with
Tailwind CSS classes, and animates it with [MulmoCast](https://github.com/receptron/mulmocast-cli)'s
declarative `data-animation` attributes: `animate` (`data-opacity`, `data-translate-x/y`,
`data-scale`, `data-rotate`, `data-width`/`data-height`), `counter` and `typewriter`, each with
`data-start` and `data-end` in seconds and an optional `data-easing`. A movie made from the slide
(an `html_tailwind` beat with `animation: true`) moves the same way. The page plays them with its
own player (MIT; MulmoCast is AGPL), measured against MulmoCast's: the same values at the same
times. An animation without `data-end` runs to the end of the beat in a movie, and for
`SLIDE_AUTO_END_SECONDS` (8) here. CSS animations and transitions don't play: each is shown at its
end. MulmoCast would hold them at their first frame (an element faded in with `@keyframes` stays
transparent), so a host making a movie adds `SLIDE_CSS_ANIMATIONS_FINISHED` (a `<style>`'s rules)
to the HTML it passes on. The slide's own scripts don't run.

`slideHtmlDocument(html)` (core entry) makes the page: Tailwind's browser build from jsDelivr (one
version, checked by its hash), the animation player, and a Content Security Policy that lets it send
nothing out: `connect-src 'none'`; images, media and fonts only from `data:`/`blob:` URLs and
Google Fonts; and no script but the page's own and Tailwind's, so nothing can navigate the frame to
a URL carrying the page (a sandbox allows that, and CSP can't forbid it). The slide's `<meta>`,
`<base>` and `<link>` tags are made plain text (a refresh would navigate), and a link doesn't
navigate when clicked. The View shows it in an iframe with `sandbox="allow-scripts"` and no
`allow-same-origin`, so the page can't reach the host's pages, storage or cookies, scaled to fit. Tailwind is loaded from the network: offline, the slide
appears unstyled.

A host that sends `currentResult` by its saved picture's path only (as MulmoChat does) can't tell
that an HTML step is on the screen; a guide step asked for again is then shown again.

## Records

Saved through `files.artifacts`, with their pictures' paths:

- `slideshows/<id>.json`: `{ id, title, mode, totalSlides, slides: { "1": { title, imagePrompt, imagePath } } }`; an HTML slide has `html`, an `imagePrompt` of `""` and no `imagePath`
- `storyboards/<id>.json`: `{ id, title, style, totalPanels, interactive, characters: [{ name, description, imagePath }], panels: { "1": { caption, characters, imagePrompt, imagePath, choices } } }`

IDs are 12 hex digits. The results name them, so a later tool call can refer to a slideshow or a
story (MulmoChat's makeMovie makes a narrated movie from one).

## License

MIT
