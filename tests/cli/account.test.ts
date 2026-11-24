import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

import { demoAccounts } from "../demo";

const [demoAccount] = demoAccounts();
// Invoke Node directly so Windows runs the CLI without a shell wrapper.
const run = (db: string, ...args: string[]) =>
  execFileSync(process.execPath, ["--import", "tsx", "cli/finance.ts", ...args, "--db", db], { encoding: "utf8" });

function seedAccountAndTxn(db: string, accountId: string) {
  // Bootstrap schema via a harmless CLI call, then seed an account + txn directly
  // (there is no CLI account-upsert command; that's the Monarch/CSV sync's job).
  run(db, "actuals", "rollup", "--json");
  const conn = new Database(db);
  conn.prepare(
    `INSERT INTO accounts (id, name, type, institution, currency, is_owned, include_in_spend)
     VALUES (?, ?, ?, ?, 'USD', 1, 1)`
  ).run(accountId, demoAccount.name, demoAccount.type, demoAccount.institution);
  conn.prepare(
    `INSERT INTO transactions (source_transaction_id, account_id, date, amount_cents, source_category,
       merchant, is_transfer, source_updated_at, first_seen_at, last_seen_at, sync_version, is_deleted)
     VALUES (?, ?, '2026-01-10', -2000, 'Books', 'Toy Bookshop', 0, NULL, '2026-01-10T12:00:00Z', '2026-01-10T12:00:00Z', 1, 0)`
  ).run("toy-book-order", accountId);
  conn.close();
}

test("account list shows the seeded account", () => {
  const dir = mkdtempSync(join(tmpdir(), "finacct-"));
  const db = join(dir, "t.db");
  seedAccountAndTxn(db, "toy-list-account");

  const out = run(db, "account", "list", "--json");
  const rows = JSON.parse(out);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "toy-list-account", name: demoAccount.name, institution: demoAccount.institution, includeInSpend: true });
});

test("account exclude drops that account's transactions from the rollup; account include restores them", () => {
  const dir = mkdtempSync(join(tmpdir(), "finacct-"));
  const db = join(dir, "t.db");
  seedAccountAndTxn(db, "toy-spend-account");

  const before = JSON.parse(run(db, "actuals", "rollup", "--json"));
  expect(before.find((r: any) => r.planningCategory === "Books")).toBeTruthy();

  run(db, "account", "exclude", "toy-spend-account");
  const listAfterExclude = JSON.parse(run(db, "account", "list", "--json"));
  expect(listAfterExclude[0].includeInSpend).toBe(false);

  const afterExclude = JSON.parse(run(db, "actuals", "rollup", "--json"));
  expect(afterExclude.find((r: any) => r.planningCategory === "Books")).toBeUndefined();

  run(db, "account", "include", "toy-spend-account");
  const afterInclude = JSON.parse(run(db, "actuals", "rollup", "--json"));
  expect(afterInclude.find((r: any) => r.planningCategory === "Books")).toBeTruthy();
});
