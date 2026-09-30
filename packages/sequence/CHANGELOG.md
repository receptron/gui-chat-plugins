# Changelog

## 0.5.2

- **The model explains the whole slide before the next one.** Grok Voice said one or two
  sentences a slide and went on: asked for "at least two sentences", it said two, whatever the
  slide held, and asked to call the next slide "in this same reply", it often said only the
  slide's first sentence, word for word, before the call. The slide was replaced half explained.
  The instructions now ask it to cover every section, point and number, say that the next slide
  replaces this one as soon as it stops talking, and that the call is the last thing in the reply.
  Checked on Grok Voice with a Tesla vs Waymo robotaxi slideshow: one-sentence slides went from
  10 in 21 to none in 20. The prompt also asks for slides that hold only what the model will say.

## 0.5.1

- **Markdown slides fit in movies too.** A dense Markdown slide shrank to fit in the View, whose page
  runs the fitting, but a movie made from it (MulmoChat's makeMovie: an `html_tailwind` beat) cut
  it off at the top and bottom. `SLIDE_FIT_SCRIPT` is the same fitting, for the host to give the
  movie's page (MulmoCast's html_tailwind beat takes it as its `script`). The Markdown slide's box
  no longer shrinks as a flex item: MulmoCast's page makes the body a flex column, where it did,
  and its text was fitted into the shrunken box, much too small. Checked in a MulmoChat movie: a
  14-item slide with a formula on every line fits, its title and last line in view.

## 0.5.0

- **Chart slides**: `presentSlide` takes `chart`, a Chart.js configuration (`{ type, data,
options }`, as MulmoCast's chart beats take it), for numbers to compare, a trend or proportions.
  The View draws it under the slide's title on a sandboxed page of its own
  (`chartSlideDocument`), with the same kind of policy as an HTML slide's: Chart.js from jsDelivr,
  checked by its hash, and the configuration as data. Chart.js's own types only
  (`SLIDE_CHART_TYPES`). The parameter is JSON text: as an object without properties, Gemini
  Live used it for 2 charts in 4 asked for, drawing the others in HTML; as JSON text, 3 in 3. An
  object is read too.
- **Markdown slides with TeX math**: `presentSlide` takes `markdown`, with math between `$…$` or
  `$$…$$`, for equations, definitions, short lists and small tables. `execute()` makes it an HTML
  slide (`markdownSlideHtml`), so Views and movies show it as one; the record and the result keep
  the text too, in `markdown`. Math is MathML, drawn by the browser with nothing to load, with the
  thin spaces around function names and the matrix column gaps Chrome's MathML leaves out. The
  slide's type shrinks until it fits. New dependencies: marked and KaTeX, imported only when a
  Markdown slide is made.
- The prompt tells the model which kind a slide should be: a picture for a scene, a chart for
  numbers, Markdown for math and text, HTML for designed layouts and diagrams.
- An HTML slide's page shrinks a box marked `data-fit` until it fits (its script's hash changed).

## 0.4.1

- **Slides are explained, not announced.** Asked only to "explain" the slide on the screen, OpenAI's
  voice models often said a line about the slide ("Let's start with the big picture, then we'll
  move on", "This first slide is about quantum theory") and went on to the next. After each slide,
  the model is now told to teach its subject in at least two sentences, beginning with the content
  itself, never with the slide or its plan; a guide step says what to do, directly. In MulmoGlass
  (mock images), OpenAI began 9 of 10 slide explanations with their content, against 3 of 7
  before; Gemini and Grok already did, and still do.

## 0.4.0

- **HTML slides animate with MulmoCast's `data-animation` attributes**, not CSS: `animate`
  (opacity, translate, scale, rotate, width, height), `counter` and `typewriter`, with `data-start`
  and `data-end` in seconds. A movie made from the slides (MulmoChat's makeMovie: an `html_tailwind`
  beat with `animation: true`) now moves as the View does; MulmoCast pauses CSS animations, so the
  0.3 slides' `animate-fade-up` and the like didn't move there. The page plays them with its own
  player, written for this package (MIT; MulmoCast is AGPL) and checked against MulmoCast's
  renderer: 56 of 56 sampled values equal. CSS animations and transitions don't play; each is
  shown at its end, so an element faded in with the model's own `@keyframes` is seen rather than
  held transparent. `SLIDE_CSS_ANIMATIONS_FINISHED` is those rules, for a host to add to the HTML
  it gives MulmoCast, which would hold such an element at its first frame.
- Breaking: `SLIDE_ANIMATIONS` (the `animate-*` classes) is gone; `SLIDE_ANIMATION_KINDS`,
  `SLIDE_AUTO_END_SECONDS` and `SLIDE_CSS_ANIMATIONS_FINISHED` are new.

## 0.3.1

- **"HTML slides" go to presentSlide**: the prompt says that when the user asks for HTML slides,
  presentSlide is the tool, one HTML slide per call, not one HTML page. OpenAI Realtime, asked to
  "explain this article in HTML slides", wrote a single presentHtml page with its own slide
  navigation (found in MulmoChat). With this and the hosts' presentHtml prompt, 6 of 6 runs in
  MulmoChat and 3 of 3 in MulmoGlass made presentSlide HTML slides.

## 0.3.0

- **HTML slides**: `presentSlide` takes `html` instead of `imagePrompt` for a slide designed in HTML
  (words, numbers, lists, comparisons, diagrams), styled with Tailwind CSS v4 and animated, so it
  builds up while the model explains it. The model picks per slide; a slideshow can mix them. The
  View shows it at 1280x720, scaled to fit, in a sandboxed iframe (`sandbox="allow-scripts"`, no
  network: `connect-src 'none'`, images from `data:`/`blob:` only; the slide's own scripts, event
  handlers, `<meta>` refreshes and links don't run, since they could navigate the frame to a URL
  carrying the slide). Nothing is drawn, so it needs
  no image backend. `slideHtmlDocument(html)` makes the page, for a host that shows one elsewhere.
  Records and results carry `html`; `imagePrompt` is `""` and `imagePath` absent for these slides.

## 0.2.0

- **State per conversation**: the slideshow in progress, the steps and panels waiting for the
  user, and the repeat guard are kept per `context.conversationId` (gui-chat-protocol 2.2), the 50
  most recently used. A host that runs `execute()` on a server for several browser tabs mixed them:
  one tab's slide was filed under the other tab's slideshow (found in the review of
  receptron/MulmoChat#232). Needs gui-chat-protocol ^2.2.0.

## 0.1.0

First release: `presentSlide`, `defineStoryboard` and `presentPanel`, from MulmoChat and
MulmoGlass, as one host-agnostic package. Results carry gui-chat-protocol 2.1's `sequence`; the
holds read `context.userSpokeAt`; references are drawn with `context.app.editImages`.
