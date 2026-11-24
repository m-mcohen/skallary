import { spawnSync } from "node:child_process";
import { chmodSync, statSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const managed = ["pre-commit", "commit-msg", "pre-push"];
function git(args, optional = false) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (optional && result.status === 1) return null;
  if (result.status !== 0) throw Error();
  return result.stdout.trimEnd();
}
function put(path, bytes, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, bytes, { flag: "wx", mode });
    chmodSync(temp, mode);
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
}

function install() {
  if (!process.env.LOCALAPPDATA) throw Error();
  const destination = resolve(process.env.LOCALAPPDATA, "finance/private/hooks");
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const marker = join(destination, ".finance-managed");
  const ownership = "finance-publish-hooks-v1\n";
  if (existsSync(destination) && readdirSync(destination).length &&
      (!existsSync(marker) || readFileSync(marker,"utf8") !== ownership)) {
    throw Error("Existing private hook folder belongs to another installation.");
  }
  const configured = git(["config", "--path", "--get", "core.hooksPath"], true);
  const previous = configured && relative(resolve(configured), destination) === ""
    ? git(["config", "--get", "finance.previousHooksPath"])
    : configured ?? join(common, "hooks");
  const oldDir = git(["-c", "core.hooksPath=" + previous, "rev-parse", "--path-format=absolute", "--git-path", "hooks"]);
  if (!relative(oldDir, destination)) throw Error();
  const oldHooks = existsSync(oldDir) ? readdirSync(oldDir, { withFileTypes: true })
    .filter(entry => !entry.isDirectory() && /^[a-z]+(?:-[a-z]+)*$/.test(entry.name))
    .map(entry => entry.name) : [];

  // Write the checker and its sole import before enabling the wrappers.
  put(marker, ownership, 0o600);
  put(join(destination, "publish-check/match.mjs"), readFileSync(join(scripts, "publish-check/match.mjs")), 0o600);
  put(join(destination, "publish-check.mjs"), readFileSync(join(scripts, "publish-check.mjs")), 0o600);
  for (const name of ["dispatch.sh", ...managed]) {
    put(join(destination, name), readFileSync(join(scripts, "../.githooks", name)), 0o755);
  }
  for (const name of oldHooks.filter(name => !managed.includes(name))) {
    put(join(destination, name), '#!/bin/sh\nset -eu\n. "$(dirname "$0")/dispatch.sh"\nchain_hook ' + name + ' "$@"\n', 0o755);
  }
  git(["config", "--local", "finance.previousHooksPath", previous]);
  git(["config", "--local", "core.hooksPath", destination]);
  if (relative(resolve(git(["config", "--path", "--get", "core.hooksPath"])), destination)) throw Error();
  console.log(`Publish hooks installed. Previous hooks kept: ${oldHooks.length}.`);
}

function check() {
  if (!process.env.LOCALAPPDATA) throw Error();
  const configured = git(["config", "--path", "--get", "core.hooksPath"], true);
  if (!configured || relative(resolve(configured), resolve(process.env.LOCALAPPDATA, "finance/private/hooks"))) throw Error();
  const folder = git(["rev-parse", "--path-format=absolute", "--git-path", "hooks"]);
  if (!managed.every(name => statSync(join(folder, name), { throwIfNoEntry: false })?.isFile())) throw Error();
  console.log("All three publish hooks are present.");
}

try {
  if (process.argv.length === 2) install();
  else if (process.argv.length === 3 && process.argv[2] === "--check") check();
  else throw Error();
}
catch {
  console.error(process.argv[2] === "--check" ? "The configured publish hooks are missing or unreadable." : "Could not install the publish hooks. Check the repository configuration and private hook folder.");
  process.exitCode = 2;
}
