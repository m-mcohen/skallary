import { lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { findMatches } from "./publish-check/match.mjs";

function git(...args) {
  const result = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error || result.status !== 0) throw new Error("Cannot read git input");
  return result.stdout;
}

function loadInputs(folder) {
  const data = JSON.parse(readFileSync(join(folder, "inputs.json"), "utf8"));
  if (!data || typeof data.builtAt !== "string" || !Number.isFinite(Date.parse(data.builtAt)) ||
      !Array.isArray(data.amountsCents) || !data.amountsCents.every(Number.isSafeInteger) ||
      !["strings", "tails", "ids"].every((key) => Array.isArray(data[key]) && data[key].every((value) => typeof value === "string"))) {
    throw new Error("Invalid private input");
  }
  let allow = "";
  try { allow = readFileSync(join(folder, "allow.txt"), "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return { ...data, amountsCents: new Set(data.amountsCents), allow: new Set(allow.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) };
}

function main() {
  if (!process.env.LOCALAPPDATA) throw new Error("Missing local folder");
  const folder = join(process.env.LOCALAPPDATA, "finance", "private", "publish-check");
  try {
    if (!statSync(folder).isDirectory()) throw new Error("Invalid private folder");
  } catch (error) {
    if (error.code !== "ENOENT" || process.env.FINANCE_PUBLISH_REQUIRED === "1") throw error;
    console.log("Publish check is not set up here.");
    return 0;
  }
  const inputs = loadInputs(folder);
  if (Date.now() - Date.parse(inputs.builtAt) > 7 * 86400000) {
    console.log("Publish check inputs are older than 7 days; rebuild them.");
  }
  const [mode, value, ...extra] = process.argv.slice(2);
  const single = mode === "--staged" || mode === "--tree";
  if (mode === "--push-ref" ? extra.length !== 2 : extra.length || (single ? value !== undefined : !["--range", "--text", "--text-file", "--file"].includes(mode) || value === undefined)) {
    throw new Error("Invalid arguments");
  }

  // Buffer reports until all targets have been read. No raw error, ref or path is printed.
  const reports = [];
  const scan = (text, path, label = path, firstLine = 1) => {
    for (const match of findMatches(text, inputs, path)) {
      const line = firstLine + text.slice(0, match.index).split("\n").length - 1;
      reports.push(`${label}:${line} ${match.kind}`);
    }
  };
  let position = 0;
  const fileName = (path) => {
    position++;
    const hidden = findMatches(path, { ...inputs, allow: new Set() }, path).length > 0;
    const label = hidden ? `<a file name>:${position}` : JSON.stringify(path).slice(1, -1);
    for (const match of findMatches(path, inputs, path)) reports.push(`<a file name>:${position} ${match.kind}`);
    return label;
  };
  const scanFile = (path) => {
    const label = fileName(path);
    const text = lstatSync(path).isSymbolicLink() ? readlinkSync(path) : readFileSync(path, "utf8");
    if (!text.includes("\0")) scan(text, path, label);
  };
  const diffOptions = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames"];
  const scanDiff = (args) => {
    const paths = git(...args, ...diffOptions, "--name-only", "-z", "--diff-filter=ACMT", "--").split("\0").filter(Boolean);
    for (const path of paths) {
      const label = fileName(path);
      const patch = git(...args, ...diffOptions, "--unified=0", "--", path);
      let line;
      for (const text of patch.split("\n")) {
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
        if (hunk) { line = Number(hunk[1]); continue; }
        if (line === undefined) continue;
        if (text.startsWith("+")) { scan(text.slice(1), path, label, line); line++; }
        else if (text.startsWith(" ")) line++;
      }
    }
  };

  function scanHistory(revisions) {
    const commits = git("rev-list", "--reverse", ...revisions).trim().split("\n").filter(Boolean);
    for (const commit of commits) {
      scan(git("show", "--no-patch", "--format=%B", commit), "@commit-message");
      const parent = git("rev-list", "--parents", "-n", "1", commit).trim().split(" ")[1];
      scanDiff(parent ? ["diff", parent, commit] : ["diff-tree", "--root", "--no-commit-id", "-r", "-p", commit]);
    }
  }

  if (mode === "--push-ref") {
    const [old, remote] = extra;
    if (![value, old].every(id => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id)) || !remote) throw Error();
    let object = value;
    while (git("cat-file", "-t", object).trim() === "tag") {
      const tag = git("cat-file", "tag", object);
      const end = tag.indexOf("\n\n");
      const target = /^object ([0-9a-f]+)\n/.exec(tag);
      if (end < 0 || !target) throw Error();
      scan(tag.slice(end + 2), "@commit-message");
      object = target[1];
    }
    const tip = git("rev-parse", "--verify", object + "^{commit}").trim();
    if (/^0+$/.test(old)) {
      // A URL or an unrecognized remote has no trustworthy tracking namespace.
      const named = git("remote").split(/\r?\n/).includes(remote) && !/[*?\[\\]/.test(remote);
      scanHistory(named ? [tip, "--not", "--remotes=" + remote] : [tip]);
    } else {
      const base = git("rev-parse", "--verify", old + "^{commit}").trim();
      scanHistory([base + ".." + tip]);
    }
  } else if (mode === "--text" || mode === "--text-file") {
    const scope = process.env.FINANCE_PUBLISH_TEXT_SCOPE;
    let text = value;
    if (mode === "--text-file") {
      const lines = readFileSync(value, "utf8").split(/\r?\n/);
      const end = lines.indexOf("# ------------------------ >8 ------------------------");
      // Below the marker, omit single-dash removals and old-file headers (three dashes).
      text = lines.map((line, index) => end >= 0 && index > end && /^-(?!-)|^---/.test(line) ? "" : line).join("\n");
    }
    scan(text, scope === "@commit-message" || scope === "@branch-name" ? scope : "@text");
  }
  else if (mode === "--file") scanFile(relative(process.cwd(), resolve(value)).replaceAll("\\", "/"));
  else if (mode === "--tree") {
    for (const path of new Set(git("ls-files", "--cached", "-z").split("\0").filter(Boolean))) scanFile(path);
  } else if (mode === "--staged") scanDiff(["diff", "--cached"]);
  else {
    const parts = value.split("..");
    if (parts.length !== 2 || parts.some((part) => !part || part.startsWith("."))) throw new Error("Invalid range");
    const [a, b] = parts.map((ref) => git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim());
    const branch = git("rev-parse", "--symbolic-full-name", "--verify", "--end-of-options", parts[1]).trim();
    if (branch.startsWith("refs/heads/")) scan(branch.slice("refs/heads/".length), "@branch-name");
    scanHistory([`${a}..${b}`]);
  }
  if (reports.length) console.log(reports.join("\n"));
  return reports.length ? 1 : 0;
}

try { process.exitCode = main(); }
catch {
  console.error("Publish check could not read its inputs or scan target.");
  process.exitCode = 2;
}
