# gui-chat-plugins

[GUI Chat Protocol](https://github.com/receptron/gui-chat-protocol) plugins that run in any
compliant host (MulmoChat, MulmoGlass, …), one npm package per plugin under `@gui-chat-plugin/`.

| Package                                          | Tools                                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`@gui-chat-plugin/sequence`](packages/sequence) | `presentSlide`, `defineStoryboard`, `presentPanel`: slideshows, step-by-step guides and stories told in pictures |

Development: `yarn`, then `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`. Releases:
`yarn release <package>` (see [CLAUDE.md](CLAUDE.md)). MIT.
