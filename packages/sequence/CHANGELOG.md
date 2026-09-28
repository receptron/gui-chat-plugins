# Changelog

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
