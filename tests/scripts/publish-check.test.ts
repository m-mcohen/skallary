import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { findMatches } from "../../scripts/publish-check/match.mjs";

const root = process.cwd();
const runner = resolve(root, "scripts/publish-check.mjs");
const inputs = {
  amountsCents: new Set([123456, 98765]),
  strings: ["Zephyr Credit Union", "x9k2"],
  tails: ["4242"],
  ids: ["demo-id-z9"],
  allow: new Set<string>(),
};

describe("matcher", () => {
  test("normalizes the listed numeric forms and applies the amount thresholds", () => {
    for (const value of ["1_234_56", "123456", "1,234.56", "1234.56", "$1,234.56", "$1234.56", "98_765", "987.65", "$1,101", "1_101", "$1101", "1101.00", "100.01"]) {
      expect(findMatches(value, { ...inputs, amountsCents: new Set([123456, 98765, 110100, 10001]) }), value)
        .toEqual([{ index: 0, kind: "amount" }]);
    }
    for (const value of ["99.99", "100.00", "999.00", "1000.00", "1100.00", "1234", "1101", "123456"]) {
      expect(findMatches(value, { ...inputs, amountsCents: new Set([9999, 10000, 99900, 100000, 110000, 110100, 123400, 12345600]) }), value).toEqual([]);
    }
  });

  test("excludes longer runs, dates, versions, colors and line numbers", () => {
    for (const value of ["12345", "1234567", "a123456b", "2026-11-20", "11/20/2026", "v987.65", "987.65.0", "#123456", "file.ts:123456", "line 123456", "line: 123456", "123456: source"]) {
      expect(findMatches(value, { ...inputs, amountsCents: new Set([123456, 98765, 2026, 1120]) }), value).toEqual([]);
    }
  });

  test("checks each value on its own when commas join numbers that are not thousands groups", () => {
    const at = (...indexes: number[]) => indexes.map((index) => ({ index, kind: "amount" }));
    expect(findMatches("[123456,98765]", inputs)).toEqual(at(1, 8));
    expect(findMatches("[1234.56,987.65]", inputs)).toEqual(at(1, 9));
    expect(findMatches("2026-01-05,1234.56,Toys", inputs)).toEqual(at(11));
    expect(findMatches("id,amount\n17,1234.56", inputs)).toEqual(at(13));
    expect(findMatches("2026-01-05,987.65", inputs)).toEqual(at(11));
    expect(findMatches("17,987.65", inputs)).toEqual(at(3));
    expect(findMatches("[12,987.65]", inputs)).toEqual(at(4));
  });

  test("still matches money written after a line, # or file:line cue", () => {
    for (const [text, index] of [["# 1234.56 is a toy", 2], ["budget line: $1,234.56", 13], ["toy.amount: 1234.56", 12], ["1234.56:", 0]] as const) {
      expect(findMatches(text, inputs), text).toEqual([{ index, kind: "amount" }]);
    }
  });

  test("treats an underscore, hyphen or dot beside a curated name or id as a boundary", () => {
    expect(findMatches("Zephyr Credit Union_export.csv acct_demo-id-z9_v2 x-demo-id-z9.json", inputs))
      .toEqual([{ index: 0, kind: "string" }, { index: 36, kind: "string" }, { index: 52, kind: "string" }]);
  });

  test("matches curated strings and ids on case-insensitive boundaries with a minimum length", () => {
    expect(findMatches("zephyr CREDIT union demo-ID-z9", inputs))
      .toEqual([{ index: 0, kind: "string" }, { index: 20, kind: "string" }]);
    expect(findMatches("ax9k2b x9k2 azephyr credit unionb Xdemo-id-z9Y", inputs)).toEqual([]);
  });

  test("matches an \"=\" entry at any length as a whole word, and ignores a short plain entry", () => {
    const exact = { ...inputs, strings: ["=ACME"], tails: [] };
    for (const text of ["ACME", "Acme job offer", "acme_offer"]) {
      expect(findMatches(text, exact), text).toEqual([{ index: 0, kind: "string" }]);
    }
    for (const text of ["ACMEX", "XACME"]) expect(findMatches(text, exact), text).toEqual([]);
    expect(findMatches("ACME", { ...exact, strings: ["ACME"] })).toEqual([]);
  });

  test("requires the B3 context for four-digit account tails on the same line", () => {
    for (const prefix of ["ACCOUNT ", "acct ", "checking ", "savings ", "card ", "ending ", "ending in ", "xx", "x".repeat(30), "**", "...", "Zephyr Credit Union ("]) {
      const suffix = prefix.endsWith("(") ? ")" : "";
      expect(findMatches(prefix + "4242" + suffix, inputs), prefix)
        .toEqual([{ index: prefix.length, kind: "string" }].concat(prefix.startsWith("Zephyr") ? [{ index: 0, kind: "string" }] : []).sort((a, b) => a.index - b.index));
    }
    expect(findMatches("acct" + " ".repeat(20) + "4242", inputs)).toEqual([{ index: 24, kind: "string" }]);
    for (const text of ["4242", "acct\n4242", "acct" + " ".repeat(21) + "4242", "disaccount" + " ".repeat(17) + "4242", "discount 4242", "account 14242", "card 42421", "Zephyr Credit Union text (4242)"]) {
      expect(findMatches(text, { ...inputs, strings: [] }), text).toEqual([]);
    }
    expect(findMatches("Zephyr Credit Union (4242)", { ...inputs, allow: new Set(["@text :: Zephyr Credit Union"]) }))
      .toEqual([{ index: 21, kind: "string" }]);
  });

  test("allows tokens only in their scoped file glob or pseudo-path", () => {
    const allow = new Set(["src/**/demo.* :: 1234.56", "@commit-message :: Zephyr Credit Union", "@branch-name :: demo-id-z9", "@text :: 987.65", "123456"]);
    expect(findMatches("1234.56", { ...inputs, allow }, "src/demo.ts")).toEqual([]);
    expect(findMatches("1234.56", { ...inputs, allow }, "src/deep/demo.ts")).toEqual([]);
    expect(findMatches("1234.56", { ...inputs, allow }, "other/demo.ts")).toEqual([{ index: 0, kind: "amount" }]);
    expect(findMatches("123456", { ...inputs, allow })).toEqual([{ index: 0, kind: "amount" }]);
    expect(findMatches("Zephyr Credit Union", { ...inputs, allow }, "@commit-message")).toEqual([]);
    expect(findMatches("demo-id-z9", { ...inputs, allow }, "@branch-name")).toEqual([]);
    expect(findMatches("987.65", { ...inputs, allow })).toEqual([]);
    expect(findMatches("Zephyr Credit Union", { ...inputs, allow }, "@text")).toEqual([{ index: 0, kind: "string" }]);
    expect(findMatches("ZEPHYR CREDIT UNION", { ...inputs, allow }, "@commit-message")).toEqual([]);
    expect(findMatches("987.65", { ...inputs, allow: new Set(["* :: 987.65"]) })).toEqual([{ index: 0, kind: "amount" }]);
  });
});

describe("command", () => {
  let dir: string;
  let repo: string;
  let local: string;
  let privateDir: string;

  function git(...args: string[]) {
    const result = spawnSync("git", ["-c", "core.hooksPath=disabled-hooks", "-c", "user.name=Demo", "-c", "user.email=demo@example.invalid", "-c", "commit.gpgsign=false", ...args], {
      cwd: repo, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "NUL", GIT_CONFIG_NOSYSTEM: "1" },
    });
    if (result.status !== 0) throw new Error("Temporary git fixture failed: " + result.stderr);
    return result.stdout.trim();
  }

  function run(...args: string[]) {
    const result = spawnSync(process.execPath, [runner, ...args], {
      cwd: repo, encoding: "utf8", env: { ...process.env, LOCALAPPDATA: local, NODE_OPTIONS: "--no-experimental-webstorage" },
    });
    return { code: result.status, output: result.stdout + result.stderr };
  }

  function saveInputs(patch: Record<string, unknown> = {}) {
    writeFileSync(join(privateDir, "inputs.json"), JSON.stringify({
      builtAt: new Date().toISOString(), amountsCents: [...inputs.amountsCents],
      strings: inputs.strings, tails: inputs.tails, ids: inputs.ids, ...patch,
    }));
  }

  beforeEach(() => {
    mkdirSync(join(root, ".superpowers"), { recursive: true });
    dir = mkdtempSync(join(root, ".superpowers", "publish-check-"));
    repo = join(dir, "repo");
    local = join(dir, "local");
    privateDir = join(local, "finance/private/publish-check");
    mkdirSync(repo);
    mkdirSync(privateDir, { recursive: true });
    saveInputs();
    git("init", "--initial-branch=demo");
    writeFileSync(join(repo, "demo.txt"), "1234.56\nordinary\n");
    git("add", "demo.txt");
    git("commit", "-m", "initial");
  });

  afterEach(() => {
    // Only this test's newly created, worktree-local fixture is removed.
    rmSync(dir, { recursive: true, force: true });
  });

  test("staged checks only added index lines at their destination line numbers", () => {
    writeFileSync(join(repo, "demo.txt"), "1234.56\nchanged\n");
    git("add", "demo.txt");
    expect(run("--staged")).toEqual({ code: 0, output: "" });
    writeFileSync(join(repo, "demo.txt"), "1234.56\nchanged\n987.65\n");
    git("add", "demo.txt");
    writeFileSync(join(repo, "demo.txt"), "ordinary working copy\n");
    expect(run("--staged")).toEqual({ code: 1, output: "demo.txt:3 amount\n" });
  });

  test("redacts matching filenames and any matching path printed for content", () => {
    const filename = "Zephyr Credit Union.txt";
    writeFileSync(join(repo, filename), "Zephyr Credit Union\n");
    git("add", filename);
    const result = run("--staged");
    expect(result.code).toBe(1);
    expect(result.output).toBe("<a file name>:1 string\n<a file name>:1:1 string\n");
    expect(result.output).not.toContain("Zephyr");
    // An allowed file name still must not appear in reports about its contents.
    writeFileSync(join(repo, filename), "987.65\n");
    git("add", filename);
    writeFileSync(join(privateDir, "allow.txt"), "*.txt :: Zephyr Credit Union\n");
    const allowedName = run("--staged");
    expect(allowedName).toEqual({ code: 1, output: "<a file name>:1:1 amount\n" });
  });

  test("range checks each commit's added lines, filenames, messages and branch name", () => {
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(repo, "added.txt"), "987.65\n");
    writeFileSync(join(repo, "123456.txt"), "ordinary\n");
    git("add", ".");
    git("commit", "-m", "Zephyr Credit Union");
    writeFileSync(join(repo, "added.txt"), "ordinary\n");
    git("add", ".");
    git("commit", "-m", "remove added amount");
    git("branch", "demo-id-z9");
    const result = run("--range", `${base}..demo-id-z9`);
    expect(result.code).toBe(1);
    expect(result.output).toContain("added.txt:1 amount\n");
    expect(result.output).toContain("<a file name>:1 amount\n");
    expect(result.output).toContain("@commit-message:1 string\n");
    expect(result.output).toContain("@branch-name:1 string\n");
    for (const value of ["987.65", "123456", "Zephyr", "demo-id-z9"]) expect(result.output).not.toContain(value);
    writeFileSync(join(privateDir, "allow.txt"), "@commit-message :: Zephyr Credit Union\n@branch-name :: demo-id-z9\n");
    expect(run("--range", `${base}..demo-id-z9`).output).not.toMatch(/@commit-message|@branch-name/);
  });

  test("text reports positions without values and honors the text scope", () => {
    expect(run("--text", "ordinary\nZephyr Credit Union 987.65")).toEqual({ code: 1, output: "@text:2 string\n@text:2 amount\n" });
    writeFileSync(join(privateDir, "allow.txt"), "@text :: Zephyr Credit Union\n@text :: 987.65\n");
    expect(run("--text", "Zephyr Credit Union 987.65")).toEqual({ code: 0, output: "" });
  });

  test("tree scans tracked files and file scans an untracked file", () => {
    writeFileSync(join(repo, "untracked.txt"), "987.65\n");
    expect(run("--tree")).toEqual({ code: 1, output: "demo.txt:1 amount\n" });
    expect(run("--file", "untracked.txt")).toEqual({ code: 1, output: "untracked.txt:1 amount\n" });
    writeFileSync(join(privateDir, "allow.txt"), "demo.* :: 1234.56\n");
    expect(run("--tree")).toEqual({ code: 0, output: "" });
    writeFileSync(join(repo, "demo.txt"), "987.65\n");
    expect(run("--tree")).toEqual({ code: 1, output: "demo.txt:1 amount\n" });
  });

  test("fails closed for missing, unparsable or malformed private inputs", () => {
    const file = join(privateDir, "inputs.json");
    const original = readFileSync(file);
    rmSync(file);
    expect(run("--text", "ordinary").code).toBe(2);
    writeFileSync(file, "{987.65");
    const invalid = run("--text", "ordinary");
    expect(invalid.code).toBe(2);
    expect(invalid.output).not.toContain("987.65");
    writeFileSync(file, original);
    saveInputs({ amountsCents: ["123456"] });
    expect(run("--text", "ordinary").code).toBe(2);
    saveInputs({ builtAt: "invalid" });
    expect(run("--text", "ordinary").code).toBe(2);
  });

  test("is off with one line when the private folder is absent", () => {
    rmSync(privateDir, { recursive: true });
    expect(run("--text", "Zephyr Credit Union")).toEqual({ code: 0, output: "Publish check is not set up here.\n" });
  });

  test("warns once for inputs older than seven days", () => {
    saveInputs({ builtAt: new Date(Date.now() - 8 * 86400000).toISOString() });
    expect(run("--text", "ordinary")).toEqual({ code: 0, output: "Publish check inputs are older than 7 days; rebuild them.\n" });
  });

  test("returns 2 for unreadable scan targets and invalid arguments without echoing them", () => {
    for (const args of [["--file", "Zephyr Credit Union.txt"], ["--range", "bad..Zephyr Credit Union"], ["--range", "HEAD...HEAD"], ["--file"], ["--text"], ["--unknown"]]) {
      const result = run(...args);
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.output).not.toContain("Zephyr");
    }
  });
});
