// scripts/make-release.mjs -- builds the release ZIP a new user downloads.
//
//   node scripts/make-release.mjs
//
// Builds the pages (vite build), then writes release/skallary-<version>.zip with what is
// needed to run the app and nothing else: the built pages, the server and the source it imports,
// the migrations, the sample-data builder, the start files, package.json and package-lock.json,
// the README and its screenshots, the LICENSE. No tests, notes, git history, database files, .env
// files or private paths. Prints the file count and size.
//
// The server's runtime packages ship already installed, so a new PC needs Node.js and nothing
// else: no npm, no Python, no C++ build tools. They are installed into release/stage with
// --ignore-scripts, which yields exactly the runtime set: express, better-sqlite3 (its Windows
// x64 binary comes pre-built inside the package, a Node-API addon that loads on any supported
// Node.js, so nothing is compiled) and tsx (the server runs as "node --import tsx
// server/index.ts"). Their tests, docs and other non-runtime files are left out, and the files
// that do ship are copied to release/ship and loaded from there before the ZIP is written.
// Front-end packages are bundled into dist/ and do not ship as packages.
//
// runtime.json records the oldest Node.js the shipped packages accept (their "engines" field)
// and the version this was tested with; scripts/check-node.cjs stops the start files with a plain
// message on an older or non-64-bit Node.js.
//
// THIRD-PARTY-NOTICES.txt carries the license of every shipped package, of every package whose
// code the page build put into dist/ (read from the build's own module list), and of the fonts.
//
// No new dependencies: the ZIP is written here with node:zlib.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const outDir = join(root, "release");
const outFile = join(outDir, `skallary-${pkg.version}.zip`);
const stage = join(outDir, "stage");
const ship = join(outDir, "ship");

// What goes in: folders (walked) and single files, relative to the repo root.
const FOLDERS = ["dist", "server", "src", "migrations", "demo", "docs/images"];
const FILES = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.node.json", "README.md", "LICENSE", "run.bat", "scripts/launch.ps1", "scripts/start-sample.cmd", "scripts/check-node.cjs", "scripts/schema-dump.ts"];

// The packages the server imports at runtime (traced from server/index.ts, demo/build-sample-db.ts
// and scripts/schema-dump.ts), at the versions in package-lock.json. Their own dependencies follow.
const RUNTIME_PACKAGES = ["better-sqlite3", "express", "tsx"];
// Inside the shipped packages, left out: command shims; better-sqlite3's C++ source, build files
// and the binaries for other systems (only prebuilds/win32-x64.node loads on 64-bit Windows);
// node-addon-api, the C++ headers only a compile needs; and every package's tests, CI settings, docs,
// examples, benchmarks, type declarations, source maps and readme or changelog files.
// License and notice files always ship.
const KEEP_ALWAYS = /\/(licen[cs]e|notice|copying)[^/]*$/i;
const RUNTIME_SKIP = new RegExp([
  String.raw`^node_modules\/\.bin\/`,
  String.raw`^node_modules\/better-sqlite3\/(deps|src|build)\/`,
  String.raw`^node_modules\/better-sqlite3\/prebuilds\/(?!win32-x64\.node$)[^/]+$`,
  String.raw`^node_modules\/better-sqlite3\/binding\.gyp$`,
  String.raw`^node_modules\/node-addon-api\/`,
  String.raw`\/(tests?|__tests__|spec|\.github|\.circleci|docs?|examples?|benchmarks?|bench|coverage|\.nyc_output)\/$`,
  String.raw`\.(md|markdown|map|d\.ts|d\.mts|d\.cts)$`,
  String.raw`\/(\.travis\.yml|\.eslintrc[^/]*|\.eslintignore|\.editorconfig|\.npmignore|\.nycrc[^/]*|\.airtap\.yml|\.gitattributes|\.prettierrc[^/]*|\.jshintrc|\.zuul\.yml|appveyor\.yml|tsconfig\.json|Makefile|\.taprc|\.github)$`,
].join("|"), "i");
const shippedSkip = { test: (path) => !KEEP_ALWAYS.test(path) && RUNTIME_SKIP.test(path) };

// Never in the ZIP, wherever they sit (the shipped packages are filtered with RUNTIME_SKIP instead).
const BANNED_NAME = /(^|\/)(node_modules|\.git|\.env[^/]*|tests?|__tests__)(\/|$)|\.(db|db-shm|db-wal|sqlite|log|pickle)$|\.(test|spec)\.[tj]sx?$|(^|\/)(secrets|\.mm|private)(\/|$)|(^|\/)simplefin-token\.txt$/i;
// Text that must not appear in any file: the folder this checkout sits in (worked out from this
// script's own location, in either slash style) and any Windows user folder.
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const checkoutParent = dirname(root);
const PRIVATE_TEXT = [
  new RegExp(escapeRegExp(checkoutParent.split("/").join("\\")), "i"),
  new RegExp(escapeRegExp(checkoutParent.split("\\").join("/")), "i"),
  /C:\\Users\\[A-Za-z0-9_.-]+\\/i,
];

const CRLF = (text) => text.replace(/\r?\n/g, "\r\n");

// Start.cmd and Start-Sample.cmd are thin: they check Node, then call run.bat and
// scripts/start-sample.cmd, which ship as they are in the repo. Nothing is downloaded.
const nodeCheck = (runtime) => `where node >nul 2>nul || (
  echo Node.js was not found. Install Node.js ${runtime.testedWithMajor} (64-bit^) from https://nodejs.org/en/download, then double-click this file again.
  goto :fail
)
if not exist "node_modules\\better-sqlite3\\package.json" (
  echo This folder is missing the app's packages. Download the ZIP from Releases again and unzip all of it.
  goto :fail
)
node scripts\\check-node.cjs || goto :fail`;

const startCmd = (runtime) => CRLF(`@echo off
rem Skallary: double-click this file to start the app.
title Skallary
rem The packages the app needs are already in this folder; nothing is downloaded.
setlocal
pushd "%~dp0" || (echo Could not open the app's folder. & pause & exit /b 1)

${nodeCheck(runtime)}

echo Starting Skallary. Keep this window open while you use the app. Close it to stop the app.
set "FINANCE_NODE_CHECKED=1"
call "%~dp0run.bat"
if errorlevel 1 goto :fail
popd
exit /b 0

:fail
popd
pause
exit /b 1
`);

const startSampleCmd = (runtime) => CRLF(`@echo off
rem Skallary with made-up sample data. Nothing here is yours and nothing links to a bank.
title Skallary Sample
setlocal
pushd "%~dp0" || (echo Could not open the app's folder. & pause & exit /b 1)

${nodeCheck(runtime)}

popd
call "%~dp0scripts\\start-sample.cmd"
exit /b

:fail
popd
pause
exit /b 1
`);

function run(command, args, cwd, what) {
  // npm is a .cmd file on Windows, so it runs through the shell as one fixed command line.
  const result = command === "npm"
    ? spawnSync(["npm", ...args].join(" "), { cwd, stdio: "inherit", shell: true })
    : spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${what} failed`);
}

function walk(base, folder, skip, found = []) {
  for (const entry of readdirSync(join(base, folder), { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (skip.test(entry.isDirectory() ? `${path}/` : path)) continue;
    if (entry.isDirectory()) walk(base, path, skip, found);
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

// Builds the pages and returns every module the bundle was made from, as Rollup reports it.
async function buildPages() {
  const { build } = await import("vite");
  const bundled = new Set();
  const collector = {
    name: "release-module-list",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") for (const id of Object.keys(output.modules)) bundled.add(id);
      }
    },
  };
  await build({ root, logLevel: "warn", plugins: [collector] });
  return [...bundled];
}

// Installs the runtime packages into release/stage.
function stageRuntime() {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const dependencies = {};
  for (const name of RUNTIME_PACKAGES) {
    const version = lock.packages?.[`node_modules/${name}`]?.version;
    if (!version) throw new Error(`package-lock.json has no version for ${name}`);
    dependencies[name] = version;
  }
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", dependencies }, null, 2));
  // The full lockfile pins the versions of the packages' own dependencies; npm drops the rest.
  writeFileSync(join(stage, "package-lock.json"), readFileSync(join(root, "package-lock.json")));
  run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], stage, "Installing the runtime packages");
}

// Copies only the files that will ship into release/ship and proves the server's packages load
// from there, so a file the filter wrongly left out fails the build, not a user's first start.
function proveShippedFiles(runtimeNames) {
  if (!runtimeNames.includes("node_modules/better-sqlite3/prebuilds/win32-x64.node")) throw new Error("The ZIP would leave out better-sqlite3's Windows x64 binary");
  rmSync(ship, { recursive: true, force: true });
  for (const name of runtimeNames) {
    const target = join(ship, ...name.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(stage, ...name.split("/")), target);
  }
  writeFileSync(join(ship, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(ship, "check.ts"), [
    "import Database from 'better-sqlite3';",
    "import express from 'express';",
    "const db = new Database(':memory:');",
    "const one: number = (db.prepare('select 1 as one').get() as { one: number }).one;",
    "const server = express().listen(0, '127.0.0.1', () => { server.close(); process.exit(one === 1 ? 0 : 1); });",
  ].join("\n"));
  const check = spawnSync(process.execPath, ["--import", "tsx", "check.ts"], { cwd: ship, stdio: "inherit" });
  if (check.status !== 0) throw new Error("The shipped runtime packages did not load");
}

// The oldest Node.js major every shipped top-level package and this app accept (">=N" engines).
function minimumNodeMajor() {
  const majors = [pkg, ...RUNTIME_PACKAGES.map((name) => JSON.parse(readFileSync(join(stage, "node_modules", name, "package.json"), "utf8")))]
    .map((meta) => /^\s*>=\s*(\d+)/.exec(meta.engines?.node ?? "")?.[1])
    .filter(Boolean)
    .map(Number);
  if (majors.length === 0) throw new Error("No package states the Node.js versions it supports");
  return Math.max(...majors);
}

// The folder of the package a file belongs to: the path up to its last node_modules/<name>.
function packageFolderOf(path) {
  const clean = path.replace(/^\0/, "").split("?")[0].split("\\").join("/");
  const match = /^((?:.*\/)?node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(clean);
  return match ? match[1] : null;
}

function licenseText(folder) {
  const files = readdirSync(folder).filter((name) => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(name)).sort();
  return files.map((name) => readFileSync(join(folder, name), "utf8").trim()).join("\n\n");
}

// One block per package: name, version, license, the license text. Three groups: the server's
// shipped packages, the packages whose code is inside the page bundle, and the fonts in dist/.
function thirdPartyNotices(runtimeNames, bundledIds) {
  const missing = [];
  const block = (folder, note, fallbackFolder) => {
    const meta = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
    const text = licenseText(folder) || (fallbackFolder && existsSync(fallbackFolder) ? licenseText(fallbackFolder) : "");
    if (!text) missing.push(`${meta.name}@${meta.version}${note ? ` (${note})` : ""}`);
    return { name: meta.name, text: `${meta.name} ${meta.version}${note ? ` (${note})` : ""}\nLicense: ${meta.license ?? "not stated"}\n\n${text || "No license file is included in this package."}` };
  };

  const server = [...new Set(runtimeNames.map(packageFolderOf).filter(Boolean))]
    .map((folder) => join(stage, ...folder.split("/")))
    .filter((folder) => JSON.parse(readFileSync(join(folder, "package.json"), "utf8")).version)
    .map((folder) => {
      // esbuild's per-system binary packages carry no license file; they are esbuild's own (MIT).
      const name = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")).name;
      return block(folder, "", name.startsWith("@esbuild/") ? join(stage, "node_modules", "esbuild") : null);
    });

  // The page bundle: every package a bundled module came from, plus Vite's own helper code.
  const bundleFolders = new Set(bundledIds.map(packageFolderOf).filter(Boolean));
  if (bundledIds.some((id) => /^\0?vite\//.test(id))) bundleFolders.add(join(root, "node_modules", "vite"));
  // The app's own style sheets pull packages in with @import (Tailwind and friends); those are
  // compiled into the CSS bundle without appearing as modules, so read the imports themselves.
  for (const id of bundledIds) {
    const path = id.replace(/^\0/, "").split("?")[0];
    if (!/\.css$/i.test(path) || packageFolderOf(path) || !existsSync(path)) continue;
    for (const [, specifier] of readFileSync(path, "utf8").matchAll(/@import\s+(?:url\()?\s*["']([^"'./][^"']*)["']/g)) {
      const parts = specifier.split("/");
      const folder = join(root, "node_modules", ...(specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)));
      if (existsSync(join(folder, "package.json"))) bundleFolders.add(folder);
      else missing.push(`${specifier} (imported by a style sheet, package not found)`);
    }
  }

  // Fonts: match each font file in dist/ to the @fontsource package it was copied from.
  const fontPackages = [];
  for (const scope of ["@fontsource", "@fontsource-variable"]) {
    const scopeDir = join(root, "node_modules", scope);
    if (!existsSync(scopeDir)) continue;
    for (const name of readdirSync(scopeDir)) {
      const dir = join(scopeDir, name);
      fontPackages.push({ dir, files: existsSync(join(dir, "files")) ? new Set(readdirSync(join(dir, "files"))) : new Set() });
    }
  }
  const fontFolders = new Set();
  for (const file of walk(root, "dist", /$^/).filter((name) => /\.(woff2?|ttf|otf)$/i.test(name))) {
    const original = file.split("/").pop().replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/i, "$1");
    const owner = fontPackages.find((candidate) => candidate.files.has(original));
    if (owner) fontFolders.add(resolve(owner.dir));
    else missing.push(`${file} (font with no known source package)`);
  }

  const seen = new Set();
  const bundle = [...new Set([...bundleFolders].map((folder) => resolve(folder)))].filter((folder) => !fontFolders.has(folder))
    .filter((folder) => {
      const meta = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
      const key = `${meta.name}@${meta.version}`; // the same version nested under two packages
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((folder) => block(folder, "")).sort((a, b) => a.name.localeCompare(b.name));
  const fonts = [...fontFolders].map((folder) => block(folder, "font files in dist/assets")).sort((a, b) => a.name.localeCompare(b.name));

  const rule = "=".repeat(78);
  const section = (title, blocks) => [`${title}\n${"-".repeat(title.length)}`, ...blocks.map((entry) => entry.text)].join(`\n\n${rule}\n\n`);
  const head = [
    "Third-party notices for Skallary",
    "",
    "This app is licensed under the GNU AGPL 3.0 or later (see LICENSE). The ZIP also includes",
    "packages and fonts made by others: the server's packages in node_modules, the packages whose",
    "code is built into the pages in dist/, and the font files in dist/assets. Their licenses and",
    "notices follow, generated by scripts/make-release.mjs from what this ZIP actually contains.",
    "",
    missing.length > 0 ? `No license file was found for: ${missing.join("; ")}.` : "A license file was found for every package and font listed.",
  ].join("\n");
  const text = [head, section(`1. Server packages in node_modules (${server.length})`, server),
    section(`2. Packages built into the pages in dist/ (${bundle.length})`, bundle),
    section(`3. Fonts in dist/assets (${fonts.length})`, fonts)].join(`\n\n${rule}\n${rule}\n\n`);
  return { text: CRLF(`${text}\n`), missing, counts: { server: server.length, bundle: bundle.length, fonts: fonts.length } };
}

// A ZIP writer for plain files: one deflated entry each, forward-slash names, no folder entries.
function writeZip(entries, file) {
  const parts = [];
  const central = [];
  let offset = 0;
  const stamp = new Date();
  const time = (stamp.getHours() << 11) | (stamp.getMinutes() << 5) | (stamp.getSeconds() >> 1);
  const date = ((stamp.getFullYear() - 1980) << 9) | ((stamp.getMonth() + 1) << 5) | stamp.getDate();
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, packed);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8); head.writeUInt16LE(8, 10);
    head.writeUInt16LE(time, 12); head.writeUInt16LE(date, 14); head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(packed.length, 20); head.writeUInt32LE(data.length, 24); head.writeUInt16LE(nameBytes.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...parts, centralBytes, end]));
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Build the release on 64-bit Windows: its packages are prepared for that system");
  const bundledIds = await buildPages();
  if (!existsSync(join(root, "dist", "index.html"))) throw new Error("The build did not produce dist/index.html");
  stageRuntime();
  const runtimeNames = walk(stage, "node_modules", shippedSkip);
  proveShippedFiles(runtimeNames);

  const names = new Set();
  for (const folder of FOLDERS) {
    if (!existsSync(join(root, folder))) throw new Error(`Missing folder: ${folder}`);
    for (const name of walk(root, folder, BANNED_NAME)) names.add(name);
  }
  for (const name of FILES) {
    if (!existsSync(join(root, name))) throw new Error(`Missing file: ${name}`);
    names.add(name);
  }

  const toBytes = (name, data) => (/\.(cmd|bat)$/i.test(name) ? Buffer.from(CRLF(data.toString("utf8"))) : data);
  const entries = [...names].sort().map((name) => ({ name, data: toBytes(name, readFileSync(join(root, ...name.split("/")))) }));
  const shipped = runtimeNames.map((name) => ({ name, data: readFileSync(join(stage, ...name.split("/"))) }));

  const runtime = {
    nodeMinMajor: minimumNodeMajor(),
    testedWith: process.versions.node,
    testedWithMajor: Number(process.versions.node.split(".")[0]),
    platform: process.platform,
    arch: process.arch,
    packages: RUNTIME_PACKAGES,
  };
  const notices = thirdPartyNotices(runtimeNames, bundledIds);
  entries.push(
    { name: "Start.cmd", data: Buffer.from(startCmd(runtime)) },
    { name: "Start-Sample.cmd", data: Buffer.from(startSampleCmd(runtime)) },
    { name: "runtime.json", data: Buffer.from(`${JSON.stringify(runtime, null, 2)}\n`) },
    { name: "THIRD-PARTY-NOTICES.txt", data: Buffer.from(notices.text) },
  );

  // Refuse to ship the author's paths or a banned file name.
  const problems = [];
  for (const { name, data } of [...entries, ...shipped]) {
    if (!name.startsWith("node_modules/") && BANNED_NAME.test(name)) problems.push(`${name}: a file that must not ship`);
    if (/\.(png|ico|woff2?|ttf|node)$/i.test(name)) continue;
    const text = data.toString("utf8");
    if (PRIVATE_TEXT.some((pattern) => pattern.test(text))) problems.push(`${name}: a private path`);
  }
  if (problems.length > 0) throw new Error(`Not written. ${problems.join("; ")}`);

  mkdirSync(outDir, { recursive: true });
  rmSync(outFile, { force: true });
  writeZip([...entries, ...shipped], outFile);
  const bytes = statSync(outFile).size;
  const topLevel = [...new Set(runtimeNames.filter((name) => name.split("/").length > 2).map((name) => name.split("/").slice(1, name.split("/")[1].startsWith("@") ? 3 : 2).join("/")))].sort();
  console.log(`Runtime packages (Node.js ${runtime.nodeMinMajor} or newer, win32 x64, tested with ${runtime.testedWith}): ${topLevel.length} (${topLevel.join(", ")})`);
  console.log(`THIRD-PARTY-NOTICES.txt: ${notices.counts.server} server packages, ${notices.counts.bundle} bundled into the pages, ${notices.counts.fonts} fonts${notices.missing.length > 0 ? `; no license file for ${notices.missing.join("; ")}` : ""}`);
  console.log(`${relative(root, outFile).split(sep).join("/")}: ${entries.length + shipped.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
