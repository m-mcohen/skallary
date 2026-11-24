// tests/ui/visible-wording.test.ts -- the house rule for anything the user reads
// Visible wording: no double hyphens, no em dash between words, no HTML dash entity.
//
// Reads the UI source, drops comments, and looks at what is left. A lone dash used
// as an empty-value placeholder is allowed; a dash between words is not. The
// Scenarios and Lifestyle screens are replaced, so they are skipped.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const UI_DIR = fileURLToPath(new URL("../../src/ui/", import.meta.url));
// The rewrite deleted the old Scenarios and Lifestyle screens, so nothing is skipped now.
const SKIP: string[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** The file with block comments and line comments removed, keeping line numbers. */
function withoutComments(text: string): string[] {
  const noBlocks = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
  return noBlocks.split(/\r?\n/).map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1"));
}

const OFFENDER = / -- |&mdash;| \u2014 |\u2014 [a-z]|[a-z] \u2014/;

test("no double hyphen or em dash between words in anything the UI shows", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(UI_DIR)) {
    const rel = relative(UI_DIR, file).split("\\").join("/");
    if (SKIP.some((s) => rel === s || rel.startsWith(s))) continue;
    withoutComments(readFileSync(file, "utf8")).forEach((line, i) => {
      if (OFFENDER.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 110)}`);
    });
  }
  expect(offenders).toEqual([]);
});

/** Files (outside SKIP) whose code, comments removed, matches `bad`. */
function codeOffenders(bad: RegExp): string[] {
  return sourceFiles(UI_DIR)
    .map((file) => relative(UI_DIR, file).split("\\").join("/"))
    .filter((rel) => !SKIP.some((s) => rel === s || rel.startsWith(s)))
    .filter((rel) => bad.test(withoutComments(readFileSync(join(UI_DIR, rel), "utf8")).join("\n")));
}

// A UTC date turns into tomorrow after about 8 pm in Florida,
// so on the last evening of a month every screen thought it was next month.
test("no screen works out today, or this month, as a UTC date", () => {
  expect(codeOffenders(/new Date\(\)\.toISOString\(\)\.slice\(0, ?(10|7)\)/)).toEqual([]);
});

// "Burn" was renamed Monthly budget; one confirmation box kept it.
test("no screen text says Burn", () => {
  expect(codeOffenders(/\bBurn\b/)).toEqual([]);
});

// A value that does not exist is left blank, and one still
// loading shows a skeleton. A lone dash reads as zero to an accountant.
test("no screen shows a lone dash for a missing value", () => {
  expect(codeOffenders(/"—"|>—</)).toEqual([]);
});

// Chart months read Feb 2026, the same as Reports and Net worth.
test("no chart shortens the year to two digits", () => {
  expect(codeOffenders(/y\.slice\(2\)/)).toEqual([]);
});

// "Recurring" means recurring charges. The budget's mark is
// "Fixed cost" everywhere it is named, and help no longer calls the screen Bills.
test("the budget mark is called Fixed cost, and the overview names recurring charges", async () => {
  const { GLOSSARY } = await import("../../src/help/glossary");
  const { HELP_SCREENS } = await import("../../src/help/index");
  expect(GLOSSARY.find((t) => t.id === "recurring-mark")!.term).toBe("Fixed cost");
  const text = JSON.stringify(HELP_SCREENS);
  expect(text).not.toMatch(/marked recurring|Recurring column|Recurring plus Variable|the budget, bills/);
  expect(text).toContain("recurring charges");
});

// The Lifestyle section was retired.
test("Settings, Salary no longer points at the Lifestyle section", () => {
  const src = readFileSync(new URL("../../src/ui/SalaryAssumptionsCard.tsx", import.meta.url), "utf8");
  expect(src).not.toMatch(/Lifestyle/);
});
