// Which packages a change affects, so CI checks only those:
//
//   node scripts/affected.mjs list <base>   the affected packages' directory
//                                           names, as a JSON array, in build
//                                           order (dependencies first)
//   node scripts/affected.mjs run <task>    `yarn workspace <name> run <task>`
//                                           for each package in $AFFECTED (the
//                                           list's JSON; every package
//                                           without it), skipping a package
//                                           without that script. `build` also
//                                           builds the workspace packages they
//                                           depend on: a package is
//                                           typechecked against its
//                                           dependencies' dist
//
// A package is affected when a file under packages/<dir>/ changed since
// <base>, or when it depends (directly or not) on an affected package. A
// change to anything outside packages/ that the packages are built with (the
// lockfile, root package.json, tsconfig.base.json, eslint config, the workflow,
// these scripts) affects every package. Root docs (*.md, LICENSE) affect none.
// With no <base> (a push to main, the weekly run), every package is affected.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Workspace packages: directory name, npm name, workspace dependencies. */
function packages() {
  const dirs = readdirSync(path.join(root, "packages")).filter((dir) =>
    existsSync(path.join(root, "packages", dir, "package.json")),
  );
  const manifests = dirs.map((dir) => ({
    dir,
    json: JSON.parse(
      readFileSync(path.join(root, "packages", dir, "package.json"), "utf8"),
    ),
  }));
  const names = new Set(manifests.map(({ json }) => json.name));
  return manifests.map(({ dir, json }) => {
    const deps = Object.keys({
      ...json.dependencies,
      ...json.devDependencies,
      ...json.peerDependencies,
      ...json.optionalDependencies,
    });
    return {
      dir,
      name: json.name,
      scripts: json.scripts ?? {},
      deps: deps.filter((dep) => names.has(dep)),
    };
  });
}

/** `all` in dependency order: a package after the ones it depends on. */
function buildOrder(all) {
  const byName = new Map(all.map((pkg) => [pkg.name, pkg]));
  const ordered = [];
  const state = new Map();
  const visit = (pkg) => {
    if (state.get(pkg.name) === "done") return;
    if (state.get(pkg.name) === "visiting") {
      throw new Error(
        `workspace packages depend on each other in a cycle: ${pkg.name}`,
      );
    }
    state.set(pkg.name, "visiting");
    for (const dep of pkg.deps) visit(byName.get(dep));
    state.set(pkg.name, "done");
    ordered.push(pkg);
  };
  [...all].sort((a, b) => a.dir.localeCompare(b.dir)).forEach(visit);
  return ordered;
}

/** Changed files that affect no package. */
const NO_PACKAGE = (file) =>
  /^[^/]+\.md$/.test(file) || file === "LICENSE" || file.startsWith("plans/");

function affected(base) {
  const all = buildOrder(packages());
  if (!base) return all;
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", `${base}...HEAD`],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
  const touched = new Set();
  for (const file of changed) {
    const match = /^packages\/([^/]+)\//.exec(file);
    if (match) {
      touched.add(match[1]);
    } else if (!NO_PACKAGE(file)) {
      return all;
    }
  }
  // Dependents of a touched package, until nothing more is added.
  const byName = new Map(all.map((pkg) => [pkg.name, pkg]));
  let grew = true;
  while (grew) {
    grew = false;
    for (const pkg of all) {
      if (touched.has(pkg.dir)) continue;
      if (pkg.deps.some((dep) => touched.has(byName.get(dep).dir))) {
        touched.add(pkg.dir);
        grew = true;
      }
    }
  }
  return all.filter((pkg) => touched.has(pkg.dir));
}

const [mode, arg] = process.argv.slice(2);
if (mode === "list") {
  process.stdout.write(
    `${JSON.stringify(affected(arg).map((pkg) => pkg.dir))}\n`,
  );
} else if (mode === "run" && arg) {
  const dirs = process.env.AFFECTED ? JSON.parse(process.env.AFFECTED) : null;
  const all = buildOrder(packages());
  const wanted = new Set(dirs ?? all.map((pkg) => pkg.dir));
  if (arg === "build") {
    const byName = new Map(all.map((pkg) => [pkg.name, pkg]));
    // Reverse build order: a package comes before its dependencies.
    for (const pkg of [...all].reverse()) {
      if (wanted.has(pkg.dir))
        pkg.deps.forEach((dep) => wanted.add(byName.get(dep).dir));
    }
  }
  const selected = all.filter((pkg) => wanted.has(pkg.dir));
  if (!selected.length) console.log(`${arg}: no package affected`);
  for (const pkg of selected) {
    if (!pkg.scripts[arg]) {
      console.log(`${arg}: ${pkg.name} has no ${arg} script`);
      continue;
    }
    console.log(`\n${arg}: ${pkg.name}`);
    const { status } = spawnSync("yarn", ["workspace", pkg.name, "run", arg], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (status !== 0) process.exit(status ?? 1);
  }
} else {
  console.error("usage: node scripts/affected.mjs list [<base>] | run <task>");
  process.exit(2);
}
