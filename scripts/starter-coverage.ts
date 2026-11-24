// scripts/starter-coverage.ts -- how much of a household's history the starter rules would file.
// Runs on a COPY of a database only, and prints
// counts and shares only: never a payee, an amount or a category of any row.
//
//   npx tsx scripts/starter-coverage.ts <copy folder>
//
// <copy folder> holds finance/finance.db, as %LOCALAPPDATA% does. The copy is read; nothing is
// applied to it.
import { assertCopyFolder } from "./lib/copy-guard.js";
import { applyRules, type CategorizationRule } from "../src/domain/rules.js";
import { STARTER_RULES, STARTER_RULE_PRIORITY } from "../src/domain/starter-set.js";

const base = assertCopyFolder(process.argv[2], "Usage: npx tsx scripts/starter-coverage.ts <copy folder>");
process.env.LOCALAPPDATA = base;
process.env.FINANCE_NO_AUTOSYNC = "1";
const { sqliteFinanceRepository } = await import("../server/repositories/sqliteFinanceRepository.js");
const repo = sqliteFinanceRepository();

const rules: CategorizationRule[] = STARTER_RULES.map((r, i) => ({
  id: i + 1, priority: STARTER_RULE_PRIORITY, memoContains: r.match, action: "categorize", toCategory: r.planningCategory,
}));
const mapping = repo.getCategoryMappings();
const planning = (c: string | null | undefined) => (c ? mapping[c] ?? c : null);

// Every row that is spending or income (moves between accounts are not filed), stripped of its
// category, as a bank feed would send it.
const rows = repo.getTransactions().filter((t) => !t.isTransfer);
const today = new Map(rows.map((t) => [t.sourceTransactionId, planning(t.sourceCategory)]));
const filed = applyRules(rows.map((t) => ({ ...t, sourceCategory: null })), rules).filter((t) => t.sourceCategory);
const agree = filed.filter((t) => today.get(t.sourceTransactionId) === t.sourceCategory).length;

const pct = (n: number, d: number) => (d === 0 ? "0.0" : ((100 * n) / d).toFixed(1));
console.log(`Starter rules: ${STARTER_RULES.length}`);
console.log(`Rows the starter rules would file: ${filed.length} of ${rows.length} (${pct(filed.length, rows.length)}%)`);
console.log(`Of those, filed where the row is filed today: ${agree} of ${filed.length} (${pct(agree, filed.length)}%)`);
