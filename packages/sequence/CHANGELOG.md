# Changelog

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
