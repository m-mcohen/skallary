import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeRepository } from "../../src/data/repo.node.js";

// Windows note: `npx` resolves to npx.cmd, which execFileSync (without shell:true)
// cannot exec directly (ENOENT). Invoke node directly with the tsx loader instead —
// this still runs the real CLI in a separate child process end-to-end.
const txn = (date: string, merchant: string, category: string | null, account: string, amountCents: number, n = 0) => ({
  sourceTransactionId: `t-${date}-${merchant}-${n}`, accountId: account, date, amountCents,
  sourceCategory: category, merchant, isTransfer: false, sourceUpdatedAt: null,
});

function runCli(args: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx", "cli/finance.ts", ...args], { encoding: "utf8" });
}

test("stored transactions roll up via CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "fin-"));
  const db = join(dir, "t.db");
  const repo = new NodeRepository(db);
  repo.upsertTransactions([txn("2026-08-01", "Grocer", "Groceries", "Checking", -10000)]);
  repo.connection().close();
  const out = runCli(["actuals", "rollup", "--db", db, "--json"]);
  const rollups = JSON.parse(out);
  expect(rollups[0]).toMatchObject({ period: "2026-08", planningCategory: "Groceries", amountCents: 10000 });
});
