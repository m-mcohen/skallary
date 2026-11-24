// src/domain/suggest.ts -- the app's own amount for a budget line. Fixed lines come from the bill: usual amount x payments a year / 12, summed
// over the line's bills (found by the app or marked "This repeats" by the user; lapsed and "Not
// recurring" ones never reach here, detectRecurring drops them). A fixed line with no bill,
// and every other line, averages complete months: months with nothing count as zero, the
// average starts at the line's first month with spending, and the month in progress is
// never in it. The Budget's "average month" column uses the same averageMonth.
import { rollupMonthly, type MonthlyRollup } from "./rollups";
import type { Account, NormalizedTxn } from "./types";
import type { Cadence, RecurringSeries } from "./recurring";
import { priorMonths } from "./seed";

export const PAYMENTS_A_YEAR: Record<Cadence, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, annual: 1 };

export interface AverageMonth { cents: number; months: number; emptyMonths: number }

export function averageMonth(rollups: MonthlyRollup[], line: string, kind: "expense" | "income", beforeMonth: string, n: 3 | 12): AverageMonth | null {
  const mine = rollups.filter((x) => x.planningCategory === line && x.kind === kind && x.period < beforeMonth);
  const first = mine.filter((x) => x.amountCents !== 0).map((x) => x.period).sort()[0];
  if (!first) return null;
  const months = priorMonths(beforeMonth, n).filter((m) => m >= first);
  if (months.length === 0) return null;
  const byMonth = new Map<string, number>();
  for (const x of mine) byMonth.set(x.period, (byMonth.get(x.period) ?? 0) + x.amountCents);
  const total = months.reduce((sum, m) => sum + (byMonth.get(m) ?? 0), 0);
  return { cents: Math.round(total / months.length), months: months.length, emptyMonths: months.filter((m) => (byMonth.get(m) ?? 0) === 0).length };
}

export interface BillBasis { label: string; cadence: Cadence; usualCents: number }

export function billMonthly(series: RecurringSeries[], line: string): { cents: number; bills: BillBasis[] } | null {
  const mine = series.filter((x) => x.planningCategory === line);
  if (mine.length === 0) return null;
  const bills = mine.map((x) => ({ label: x.label, cadence: x.cadence, usualCents: Math.abs(x.typicalAmountCents) }));
  const cents = bills.reduce((sum, b) => sum + Math.round((b.usualCents * PAYMENTS_A_YEAR[b.cadence]) / 12), 0);
  return { cents, bills };
}

export type SuggestionBasis = { kind: "bill"; bills: BillBasis[] } | { kind: "average"; months: number; emptyMonths: number };
export interface LineSuggestion { planningCategory: string; amountCents: number; basis: SuggestionBasis }

export interface YearlyExclusion {
  txnIds: ReadonlySet<string>;
  cents: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export function yearlyExclusion(prepared: NormalizedTxn[], accounts: Account[], mapping: Record<string, string>, txnIds: ReadonlySet<string>): YearlyExclusion {
  const cents = new Map<string, Map<string, number>>();
  const matched = prepared.filter(row => txnIds.has(row.sourceTransactionId));
  for (const row of rollupMonthly(matched, accounts, mapping)) {
    if (row.kind !== "expense") continue;
    const periods = cents.get(row.planningCategory) ?? new Map<string, number>();
    periods.set(row.period, row.amountCents);
    cents.set(row.planningCategory, periods);
  }
  return { txnIds, cents };
}

export function suggestLine(line: string, fixed: boolean, rollups: MonthlyRollup[], series: RecurringSeries[], beforeMonth: string, exclude?: YearlyExclusion): LineSuggestion {
  const eligible = exclude?.txnIds.size ? series.filter(item => !item.charges.some(charge => exclude.txnIds.has(charge.id))) : series;
  const bill = fixed ? billMonthly(eligible, line) : null;
  if (bill) return { planningCategory: line, amountCents: bill.cents, basis: { kind: "bill", bills: bill.bills } };
  const costs = exclude?.cents.get(line);
  const history = costs ? rollups.map(row => row.kind === "expense" && row.planningCategory === line
    ? { ...row, amountCents: row.amountCents - (costs.get(row.period) ?? 0) } : row) : rollups;
  const avg = averageMonth(history, line, "expense", beforeMonth, 12);
  return { planningCategory: line, amountCents: avg?.cents ?? 0, basis: { kind: "average", months: avg?.months ?? 0, emptyMonths: avg?.emptyMonths ?? 0 } };
}
