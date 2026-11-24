import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { applyMigrations } from "../../src/data/migrate.node.js";

/** A copy folder holding a made-up household: one account, one plan with one line, three transactions. */
function madeUpCopy(): string {
  const root = mkdtempSync(join(tmpdir(), "snapshot-"));
  mkdirSync(join(root, "finance"));
  const db = new Database(join(root, "finance", "finance.db"));
  try {
    applyMigrations(db);
    db.pragma("foreign_keys = OFF");
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name <> '_migrations'").pluck().all() as string[];
    for (const name of tables) db.exec('DELETE FROM "' + name.replaceAll('"', '""') + '"');
    db.exec("INSERT INTO accounts(id,name) VALUES ('toy','Toy Box')");
    db.exec("INSERT INTO plans VALUES ('toy','Toy year','2026-01-01','2026-12-31','2026-01-01')");
    db.exec("INSERT INTO budget_lines(plan_id,planning_category,period,amount_cents) VALUES ('toy','Toy blocks','',98765)");
    const insert = db.prepare("INSERT INTO transactions(source_transaction_id,account_id,date,amount_cents,source_category,first_seen_at,last_seen_at) VALUES (?, 'toy', ?, ?, 'Toy blocks', ?, ?)");
    for (const [i, day] of ["2026-01-01", "2026-02-01", "2026-03-01"].entries()) insert.run("toy-" + i, day, -10000, day, day);
  } finally { db.close(); }
  return root;
}

function snapshotOf(root: string, name: string, ...args: string[]): string {
  const file = join(root, name);
  execFileSync(process.execPath, ["--import", "tsx", "scripts/figures-snapshot.ts", root, file, ...args]);
  return readFileSync(file, "utf8");
}

it("captures the made-up household reproducibly as of its newest transaction", () => {
  const root = madeUpCopy();
  try {
    const first = snapshotOf(root, "first.json");
    const snapshot = JSON.parse(first);
    expect(snapshot.today).toBe("2026-03-01");
    expect(Object.keys(snapshot.cases)).toEqual(expect.arrayContaining(["budget-2026", "dashboard-2026-03", "forecast", "reports", "ledger", "net-worth-included", "net-worth-excluded", "charity-2026", "salary", "row-counts"]));
    expect(snapshot.cases["row-counts"].transactions).toBe(3);
    expect(snapshot.cases["row-counts"]).not.toHaveProperty("_migrations");
    expect(snapshotOf(root, "second.json", "--today", "2026-03-01")).toBe(first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("leaves the copy it is given byte for byte as it was", () => {
  const root = madeUpCopy();
  try {
    const file = join(root, "finance", "finance.db");
    const before = readFileSync(file);
    snapshotOf(root, "out.json");
    expect(readFileSync(file).equals(before)).toBe(true);
    // The child run directly, with a pre-made folder named in the old environment variable
    // and holding a hard link to the copy, is refused (no parent to remove a copy), makes no copy, and leaves the target alone.
    // The child gets a private temp folder, so a real snapshot running elsewhere at the same
    // moment cannot add a copy to the list being compared.
    const priv = mkdtempSync(join(tmpdir(), "snapshot-private-"));
    const trap = mkdtempSync(join(priv, "figures-snapshot-"));
    try {
      mkdirSync(join(trap, "finance"));
      linkSync(file, join(trap, "finance", "finance.db"));
      const copies = () => readdirSync(priv).filter(n => n.startsWith("figures-snapshot-")).sort();
      const left = copies();
      expect(() => execFileSync(process.execPath, ["--import", "tsx", "scripts/figures-snapshot.ts", root, join(root, "again.json")],
        { stdio: "pipe", env: { ...process.env, TEMP: priv, TMP: priv, TMPDIR: priv, FIGURES_SNAPSHOT_CHILD: "1", FIGURES_SNAPSHOT_WORK: trap } })).toThrow();
      expect(copies()).toEqual(left);
      expect(readFileSync(file).equals(before)).toBe(true);
    } finally { rmSync(priv, { recursive: true, force: true }); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("keeps the Salary page's and the top bar's Salary needed as two figures", () => {
  const root = madeUpCopy();
  try {
    const salary = JSON.parse(snapshotOf(root, "out.json")).cases.salary;
    expect(salary).toHaveProperty("needed-ladder");
    expect(salary).toHaveProperty("needed-top-bar");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
