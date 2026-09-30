# CLAUDE.md — gui-chat-plugins

[GUI Chat Protocol](https://github.com/receptron/gui-chat-protocol) plugins, one npm package per
plugin under `@gui-chat-plugin/`, in `packages/<name>/`. MIT. The hosts that use them are MulmoChat
(`../../chat`) and MulmoGlass (`../../MulmoGlass`); a change here has to keep working in both.

`packages/common` is the one package that is not a plugin: no tools and no Views, only pure,
browser-safe helpers the plugins share. It depends only on `gui-chat-protocol` (a peer), and a
plugin lists it under `dependencies`.

## Commands

- `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build` — every package (in dependency order);
  CI runs them on Node 22/24 × ubuntu/windows/macos, plus `prettier --check`.
- **CI checks only what a pull request affects** (`scripts/affected.mjs`): the packages it changed
  and the ones that depend on them are built, typechecked and tested, and the workspace packages
  they depend on are built too. A change outside `packages/` that isn't a root doc (the lockfile,
  root config, the workflow, the script) checks every package, as do a push to main, the Monday
  run and a manual run. Lint and prettier always check the whole repo. To see what a branch
  affects: `node scripts/affected.mjs list origin/main`. Dependencies are read from each
  `package.json`, so a package that imports another workspace package must list it there, or a
  change to that package won't check it.
- `yarn release <package>` — publishes one package and pushes its `<package>-v<version>` tag
  (`scripts/release.sh`). The maintainer runs it after the PR that bumps the version and adds the
  package's `CHANGELOG.md` entry is merged. Don't publish from an agent.

## Rules

- **A plugin reaches its host only through gui-chat-protocol**: `context.app` (the documented
  conventions, `generateImage` and `editImages`, checked before use), `context.files.artifacts`,
  `context.userSpokeAt`, `context.currentResult`, and what it returns. No host imports, no
  `fetch` to a host route. Each package's README says what it needs and what happens without it.
- **`execute()` runs wherever the host runs it**: MulmoChat runs it on its server
  (`runOnServer`), MulmoGlass in the page. So the core entry (`.`) must not touch the DOM, and
  the Vue entry (`./vue`) only adds Views. Times are `Date.now()`, not `performance.now()`: they
  cross from browser to server.
- **Test with a fake host** (`test/fakeHost.ts`), then in the apps by voice. The unit tests cover
  what was found in the apps' testing and reviews; break a behaviour and check its test fails
  before trusting it.
- **Keep changes to MulmoClaude to a minimum**: its CI takes a long time. Nothing here should need
  one.
- A package's Views use Tailwind classes; the build compiles them into its `dist/style.css`, which
  both apps load for every `@gui-chat-plugin/*` package.
