# @gui-chat-plugin/common

Pure helpers shared by the `@gui-chat-plugin/*` packages. Browser-safe: nothing touches the DOM or
a `node:*` builtin, so a plugin can use them in its core entry (which may run on a server) and in
its Vue entry alike. Its only dependency is `gui-chat-protocol` (`^2.3.0`), a peer, as in every
package here.

## Artifact paths

For a plugin that writes under the host's shared `files.artifacts` area. The directory's name is
`ARTIFACTS_ROOT` from `gui-chat-protocol`; these build the paths under it.

| Export                         | Does                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `slugifyArtifact(title, fb)`   | Lowercase-ASCII slug, capped at 120 chars; `fb` when the title yields nothing             |
| `yearMonthUtc(now?)`           | The UTC `YYYY/MM` partition                                                               |
| `buildArtifactRelPath(params)` | `<dir>[/YYYY/MM]/<slug>-<epochMs>[-<suffix>]<ext>`, the key `files.artifacts.write` takes |
| `toWorkspaceArtifactPath(rel)` | Prefixes `artifacts/`, the workspace-relative form a tool reports to the model            |
| `hasUnsafePathSegment(value)`  | True when a `/`- or `\`-separated segment is empty, `.` or `..` (the traversal guard)     |

A plugin lists this package under `dependencies`: the helpers keep no state, so a second copy
nested under a plugin is harmless.
