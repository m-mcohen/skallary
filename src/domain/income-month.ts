// src/domain/income-month.ts -- the Dashboard's Income card: the spending card's twin. Income from the 1st through
// today against the same days of last month, the biggest sources by payer, and
// what investments paid, kept on a line of its own. Totals go through the same
// rollup as Reports (sumForBaseline), so each figure equals the ledger it opens.
import { baselineFor, baselineHasHistory, sumForBaseline, type DateRange } from "./compare";
import { resolvePeriod, type Period } from "./period";
import { ruleKeyFor } from "./rules";
import { toRows } from "./transactions-view";
import type { Account, NormalizedTxn } from "./types";

export interface IncomeSource {
  /** The payer, as the ledger's payer filter matches it (rules.ruleKeyFor). */
  payeeKey: string;
  /** The payer as the bank names it, from its largest deposit this month. */
  label: string;
  cents: number;
}

export interface IncomeMonthToDate {
  period: Period;
  /** Income so far this month, investment income aside. */
  cents: number;
  /** The same days of last month, or null when the history does not reach back that far. */
  baseline: { range: DateRange; cents: number } | null;
  /** What investments paid so far this month (interest, dividends): its own figure. */
  investmentIncomeCents: number;
  /** The biggest payers so far this month, at most five, largest first. */
  topSources: IncomeSource[];
}

const TOP_SOURCES = 5;

export function incomeMonthToDate(
  prepared: NormalizedTxn[],
  accounts: Account[],
  mapping: Record<string, string>,
  asOf: string
): IncomeMonthToDate {
  const period = resolvePeriod("this-month", asOf);
  const range: DateRange = { from: period.from!, to: period.to! };
  const sums = sumForBaseline(prepared, accounts, mapping, { ranges: [range], divideBy: 1 });

  // Grouped by the payer key the ledger filters on, so a source's link lands on
  // exactly the rows it adds up. Counted accounts only, as the rollup counts.
  const bySource = new Map<string, { cents: number; label: string; largest: number }>();
  for (const row of toRows(prepared, accounts, mapping)) {
    if (row.kind !== "income" || !row.counted) continue;
    const day = row.txn.date.slice(0, 10);
    if (day < range.from || day > range.to) continue;
    const key = ruleKeyFor(row.txn);
    const name = (row.txn.payee ?? row.txn.merchant ?? row.txn.description ?? "").trim() || "Unnamed deposit";
    const s = bySource.get(key) ?? { cents: 0, label: name, largest: -Infinity };
    s.cents += row.txn.amountCents;
    if (row.txn.amountCents > s.largest) {
      s.largest = row.txn.amountCents;
      s.label = name;
    }
    bySource.set(key, s);
  }
  const topSources = [...bySource.entries()]
    .filter(([, s]) => s.cents > 0)
    .map(([payeeKey, s]) => ({ payeeKey, label: s.label, cents: s.cents }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, TOP_SOURCES);

  const month = { period, cents: sums.incomeCents, investmentIncomeCents: sums.investmentIncomeCents, topSources };
  const baseline = baselineFor(period, "previous");
  const earliest = prepared.reduce<string | null>((min, t) => (min == null || t.date < min ? t.date : min), null);
  if (!baseline || !baselineHasHistory(baseline, earliest)) return { ...month, baseline: null };
  return {
    ...month,
    baseline: { range: baseline.ranges[0], cents: sumForBaseline(prepared, accounts, mapping, baseline).incomeCents },
  };
}
