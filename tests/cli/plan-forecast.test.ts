import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeRepository } from "../../src/data/repo.node.js";

// Windows note: `npx` resolves to npx.cmd, which execFileSync (without shell:true)
// cannot exec directly (ENOENT). Invoke node directly with the tsx loader instead —
// this still runs the real CLI in a separate child process end-to-end.
const txn = (date: string, merchant: string, category: string | null, account: string, amountCents: number) => ({
  sourceTransactionId: `t-${date}-${merchant}-${amountCents}`, accountId: account, date, amountCents,
  sourceCategory: category, merchant, isTransfer: false, sourceUpdatedAt: null,
});
/** Puts transactions straight into the database file; the CLI has no import command. */
function store(db: string, rows: ReturnType<typeof txn>[]) {
  const repo = new NodeRepository(db);
  repo.upsertTransactions(rows);
  repo.connection().close();
}
const run = (db: string, ...args: string[]) =>
  execFileSync(process.execPath, ["--import", "tsx", "cli/finance.ts", ...args, "--db", db], { encoding: "utf8" });

test("create plan, set budget, sync actuals, forecast --json", () => {
  const dir = mkdtempSync(join(tmpdir(), "finp-"));
  const db = join(dir, "t.db");
  run(db, "plan", "create", "2027", "2027 Base", "2027-01-01", "2027-12-31");
  run(db, "budget", "set", "2027", "Dining Out", "700");
  store(db, [txn("2027-01-15", "Restaurant", "Dining Out", "Checking", -80000)]);
  const out = run(db, "forecast", "2027", "--json");
  const f = JSON.parse(out);
  expect(f.planId).toBe("2027");
  const jan = f.months.find((m: any) => m.period === "2027-01");
  const dining = jan.cells.find((c: any) => c.planningCategory === "Dining Out");
  expect(dining.planCents).toBe(70000);
  expect(dining.actualCents).toBe(80000);
});

test("actuals rollup runs the transfer matcher first, so a payback out of the pot account is not a gift", () => {
  const dir = mkdtempSync(join(tmpdir(), "finp-"));
  const db = join(dir, "t.db");
  // Two legs of one move between the pot account and checking, three days apart: the matcher pairs them.
  store(db, [
    txn("2027-01-15", "Transfer", null, "Giving Savings", -10000),
    txn("2027-01-16", "Transfer", null, "Checking", 10000),
    txn("2027-01-20", "Local Charity", "Charity", "Checking", -5000),
  ]);
  const raw = new Database(db);
  const add = raw.prepare("INSERT INTO accounts (id, name, type, institution, currency, is_owned, include_in_spend, type_source, maaser_pot) VALUES (?, ?, 'depository', NULL, 'USD', 1, 1, 'feed', ?)");
  add.run("Giving Savings", "Giving Savings", 1);
  add.run("Checking", "Checking", 0);
  raw.close();
  const rows = JSON.parse(run(db, "actuals", "rollup", "--json"));
  const charity = rows.find((r: any) => r.planningCategory === "Charity");
  expect(charity.amountCents).toBe(5000);
});
