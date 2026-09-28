#!/usr/bin/env bash
# Publishes one package to npm and tags it: `yarn release <package>`, where
# <package> is its directory under packages/ (for example `sequence`).
#
# Stops before publishing unless everything a release needs is true: on main,
# nothing uncommitted, level with origin/main, the version not on npm yet, a
# CHANGELOG.md entry for it, logged in to npm, and the same checks CI runs pass
# on a fresh build. Then it shows what would be published and asks. The tag is
# <package>-v<version> (sequence-v0.1.0).
#
# If the version is on npm but its tag is missing (a release stopped after
# publishing), it offers to tag the commit npm says was published.
#
# To release: bump "version" in packages/<package>/package.json and add its
# CHANGELOG.md entry in a PR; after it is merged, `git checkout main &&
# git pull`, then `yarn release <package>`. npm asks for a one-time password
# if the account has 2FA.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "release: $*" >&2
  exit 1
}

package="${1:-}"
[ -n "${package}" ] || fail "which package? yarn release <package> ($(ls packages | tr '\n' ' '))"
dir="packages/${package}"
[ -f "${dir}/package.json" ] || fail "no package ${dir}"

name=$(node -p "require('./${dir}/package.json').name")
version=$(node -p "require('./${dir}/package.json').version")
tag="${package}-v${version}"
echo "Releasing ${name}@${version}"

published_head=""
if published_head=$(npm view "${name}@${version}" gitHead 2>/dev/null) &&
  npm view "${name}@${version}" version >/dev/null 2>&1; then
  git fetch --quiet --tags origin
  if git rev-parse --quiet --verify "refs/tags/${tag}" >/dev/null; then
    fail "${name}@${version} is already on npm and tagged ${tag}; bump \"version\" in ${dir}/package.json"
  fi
  [ -n "${published_head}" ] ||
    fail "${name}@${version} is on npm but npm doesn't say which commit; tag it by hand"
  read -r -p "${name}@${version} is on npm but not tagged. Tag ${published_head:0:7} as ${tag}? [y/N] " answer
  [ "${answer}" = "y" ] || [ "${answer}" = "Y" ] || fail "not tagged"
  git tag "${tag}" "${published_head}"
  git push --quiet origin "${tag}"
  echo "Tagged ${published_head:0:7} as ${tag}."
  exit 0
fi

[ "$(git branch --show-current)" = "main" ] || fail "not on main"
[ -z "$(git status --porcelain)" ] || fail "uncommitted changes (git status)"
git fetch --quiet origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] ||
  fail "main is not level with origin/main (git pull)"
grep -qE "^## ${version//./\\.}( |$)" "${dir}/CHANGELOG.md" ||
  fail "${dir}/CHANGELOG.md has no \"## ${version}\" entry"
if git rev-parse --quiet --verify "refs/tags/${tag}" >/dev/null; then
  fail "the tag ${tag} exists already"
fi
npm whoami >/dev/null 2>&1 || fail "not logged in to npm (npm login)"

echo "Checking (as CI does)…"
yarn install --frozen-lockfile --silent
yarn -s typecheck
yarn -s lint
yarn -s test
yarn -s build

echo
(cd "${dir}" && npm pack --dry-run 2>&1 | grep -E "npm notice (name|version|filename|package size|unpacked size|total files)")
echo
read -r -p "Publish ${name}@${version} to npm? [y/N] " answer
[ "${answer}" = "y" ] || [ "${answer}" = "Y" ] || fail "not published"

(cd "${dir}" && npm publish)
git tag "${tag}"
git push --quiet origin "${tag}"
echo "Published ${name}@${version} and pushed the tag ${tag}."
