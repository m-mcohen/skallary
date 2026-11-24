import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { applyMigrations } from "../../src/data/migrate.node.js";

const hooks = ["pre-commit", "commit-msg", "pre-push"];
const installer = resolve("scripts/install-hooks.mjs");
const builder = resolve("scripts/publish-check/build-inputs.ts");
const token = "Toy Moon Sticks";
const tail = "0000";

test("builds the expected private inputs and prints only counts", () => {
  const root = mkdtempSync(join(tmpdir(), "toy-inputs-"));
  try {
    const copy = join(root, "copy");
    const local = join(root, "local");
    const folder = join(local, "finance/private/publish-check");
    mkdirSync(join(copy, "finance"), { recursive: true });
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "extra.txt"), token);
    const db = new Database(join(copy, "finance/finance.db"));
    const accountName = "Toy Bank " + tail;
    const transactionAmount = 100 * 100 + 1;
    const balance = 1000 * 100 + 100;
    const saved = balance + 100;
    try {
      applyMigrations(db);
      db.pragma("foreign_keys=OFF");
      const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name <> '_migrations'").pluck().all() as string[];
      for (const table of tables) db.exec('DELETE FROM "' + table.replace(/"/g, '""') + '"');
      db.prepare("INSERT INTO accounts(id, name, conn_id, balance_cents) VALUES (?, ?, ?, ?)").run("toy-box", accountName, "block1:ring2:toy333:letters:four", balance);
      const insert = db.prepare("INSERT INTO transactions(source_transaction_id, account_id, date, amount_cents, merchant, first_seen_at, last_seen_at) VALUES (?, 'toy-box', '2026-01-01', ?, 'Toy Market', '', '')");
      insert.run("one", -transactionAmount);
      insert.run("two", -(saved + 100));
      db.prepare("INSERT INTO app_settings(key,value) VALUES ('toy',?)").run(JSON.stringify({ items: [saved, 10000] }));
    } finally { db.close(); }
    const result = spawnSync(process.execPath, ["--import", "tsx", builder, copy], { env: { ...process.env, LOCALAPPDATA: local }, encoding: "utf8" });
    expect(result.status).toBe(0);
    const inputs = JSON.parse(readFileSync(join(folder, "inputs.json"), "utf8"));
    expect(inputs).toEqual({ builtAt: expect.any(String), amountsCents: [transactionAmount, balance, saved], strings: [token], tails: [tail], ids: ["block1", "block1:ring2:toy333:letters:four", "toy-box", "toy333"] });
    expect(result.stdout.trim()).toBe("Amounts: 3, strings: 1, tails: 1, ids: 4");
    expect(result.stderr.trim()).toBe("");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Git hook files start with the shell interpreter", () => {
  for (const hook of hooks) expect(readFileSync(join(".githooks", hook), "utf8").split(/\r?\n/)[0]).toBe("#!/bin/sh");
});

test("Git hook files use line feeds on Windows", () => {
  for (const hook of [...hooks, "dispatch.sh"]) expect(readFileSync(join(".githooks", hook)).includes(13)).toBe(false);
});

test("the installed hook refuses a commit containing a private token", () => {
  const root = mkdtempSync(join(tmpdir(), "toy hooks "));
  try {
    const repo = join(root, "repo");
    const local = join(root, "local");
    const privateFolder = join(local, "finance/private/publish-check");
    mkdirSync(repo);
    mkdirSync(privateFolder, { recursive: true });
    const env = { ...process.env, LOCALAPPDATA: local, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(root, "empty.config"), GIT_TERMINAL_PROMPT: "0" };
    const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: repo, env, encoding: "utf8" });
    writeFileSync(join(privateFolder, "inputs.json"), JSON.stringify({ builtAt: new Date().toISOString(), amountsCents: [], strings: [token], tails: [], ids: [] }));
    expect(run("git", ["init","-q"]).status).toBe(0);
    expect(run(process.execPath,[installer]).status).toBe(0);
    writeFileSync(join(repo,"sample.txt"), token);
    expect(run("git",["add","sample.txt"]).status).toBe(0);
    const result = run("git",["-c","user.name=Toy","-c","user.email=toy@example.invalid","-c","commit.gpgSign=false","commit","-m","made up"]);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("sample.txt:1 string");
    expect(run("git",["rev-parse","--verify","HEAD"]).status).not.toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function withRepo(check: (root: string, git: (args: string[], status?: number) => string, install: (args?: string[], status?: number) => string) => void) {
  const root = mkdtempSync(join(tmpdir(), "toy-review-"));
  try {
    const env = { ...process.env, LOCALAPPDATA: join(root, "local"), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(root, "empty.config") };
    const folder = join(env.LOCALAPPDATA, "finance/private/publish-check");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "inputs.json"), JSON.stringify({ builtAt: new Date().toISOString(), amountsCents: [], strings: [token], tails: [], ids: [] }));
    const run = (cmd: string, args: string[], status: number) => {
      const result = spawnSync(cmd, args, { cwd: root, env, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(status);
      return result.stdout + result.stderr;
    };
    const git = (args: string[], status = 0) => run("git", ["-c", "user.name=Toy", "-c", "user.email=toy@example.invalid", ...args], status);
    git(["init", "-q", "-b", "main"]);
    check(root, git, (args = [], status = 0) => run(process.execPath, [installer, ...args], status));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("a second empty remote scans history already on origin", () => {
  withRepo((root, git, install) => {
    for (const name of ["origin", "second"]) {
      const path = join(root, name + ".git");
      git(["init", "--bare", "-q", path]);
      git(["remote", "add", name, path]);
    }
    writeFileSync(join(root, "toy.txt"), token);
    git(["add", "toy.txt"]);
    git(["commit", "-qm", "toy history"]);
    git(["rm", "toy.txt"]);
    git(["commit", "-qm", "toy cleanup"]);
    git(["push", "-q", "origin", "main"]);
    install();
    expect(git(["push", "second", "main"], 1)).toContain("toy.txt:1 string");
    expect(git(["ls-remote", "--heads", "second"]).trim()).toBe("");
  });
});

test("an annotated tag with a matching message cannot be pushed", () => {
  withRepo((root, git, install) => {
    const path = join(root, "target.git");
    git(["init", "--bare", "-q", path]);
    git(["commit", "--allow-empty", "-qm", "toy history"]);
    git(["tag", "-a", "toy-tag", "-m", token]);
    install();
    expect(git(["push", path, "refs/tags/toy-tag"], 1)).toContain("@commit-message:1 string");
  });
});

const scissors = "# ------------------------ >8 ------------------------";
// One repo and one install serve every message given: each repo costs a dozen process starts,
// which is what ran past the time limit when the full suite loaded the machine.
function messageCheck(messages: string[][], status: number, expected?: string) {
  withRepo((root, git, install) => {
    install();
    const file = join(root, "message");
    for (const lines of messages) {
      writeFileSync(file, lines.join("\n"));
      const output = git(["hook", "run", "commit-msg", "--", file], status);
      if (expected) expect(output).toContain(expected);
    }
  });
}

test("the commit message hook refuses a token on a comment line", () => {
  messageCheck([["Toy change", "# " + token]], 1, "@commit-message:2 string");
});

test("the commit message hook refuses a token below the scissors on an added, unchanged or double-dash line", () => {
  messageCheck(["+", " ", "--"].map((prefix) => ["Toy change", scissors, "diff --git a/x b/x", prefix + token]), 1, "@commit-message:4 string");
});

test("the commit message hook accepts a token only on a removed line below the scissors", () => {
  messageCheck([["Toy change", scissors, "--- " + token, "-" + token, "+++ b/x"]], 0);
});

test("checking the installed hooks reports a missing folder", () => {
  withRepo((root, git, install) => {
    install();
    install(["--check"]);
    git(["config", "core.hooksPath", join(root, "missing")]);
    install(["--check"], 2);
  });
});

test("checking the installed hooks refuses another folder holding the three hooks", () => {
  withRepo((root, git, install) => {
    install();
    const other = join(root, "other");
    cpSync(git(["config", "core.hooksPath"]).trim(), other, { recursive: true });
    git(["config", "core.hooksPath", other]);
    install(["--check"], 2);
  });
});
