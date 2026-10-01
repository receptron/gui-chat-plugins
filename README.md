# gui-chat-plugins

[GUI Chat Protocol](https://github.com/receptron/gui-chat-protocol) plugins that run in any
compliant host (MulmoChat, MulmoGlass, …), one npm package per plugin under `@gui-chat-plugin/`.

| Package                                                | Tools                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@gui-chat-plugin/sequence`](packages/sequence)       | `presentSlide`, `defineStoryboard`, `presentPanel`: slideshows, step-by-step guides and stories told in pictures                                                                                                                    |
| [`@gui-chat-plugin/shapescript`](packages/shapescript) | `presentShapeScript`, `renderShapeScript`, `exportShapeScriptUsdz`, `exportShapeScriptStl`, `manageShapeScript`: 3D models written in ShapeScript, exported as USDZ / GLB / STL (printable, through manifold), and a public gallery |
| [`@gui-chat-plugin/common`](packages/common)           | No tools: pure helpers the plugins share (artifact path builders)                                                                                                                                                                   |

Development: `yarn`, then `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`. Releases:
`yarn release <package>` (see [CLAUDE.md](CLAUDE.md)). MIT.
