# Changelog

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
