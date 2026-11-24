// scripts/check-node.cjs -- run by the start files before the server starts.
//
// The release ZIP ships its packages already installed for 64-bit Windows and records, in
// runtime.json, the oldest Node.js major they accept and the version it was tested with. If this
// Node.js is older or not 64-bit, print a plain message naming the version to install and exit 1.
// A source checkout has no runtime.json and installs its own packages, so it always passes.
"use strict";
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const file = join(__dirname, "..", "runtime.json");
if (!existsSync(file)) process.exit(0);

const runtime = JSON.parse(readFileSync(file, "utf8"));
const major = Number(process.versions.node.split(".")[0]);
if (major >= runtime.nodeMinMajor && process.arch === runtime.arch) process.exit(0);

const have = `Node.js ${process.versions.node}${process.arch === "x64" ? "" : ` (${process.arch})`}`;
console.log("");
console.log(`Skallary needs Node.js ${runtime.nodeMinMajor} or newer, 64-bit ("x64"). This PC has ${have}.`);
console.log(`Install Node.js ${runtime.testedWithMajor} (64-bit) from https://nodejs.org/en/download, then start the app again.`);
console.log(`(The app was tested with Node.js ${runtime.testedWith}.)`);
console.log("");
process.exit(1);
